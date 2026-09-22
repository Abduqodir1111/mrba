import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Database } from "./db";
import { OperationsService } from "./operations";
import { AccessGuard, Allow, AuthRequest } from "./identity";
import { balancesLock, decimal, ensure, kg, lock, movement } from "./factory";
class Reason {
  @IsString() @Matches(/\S/) @MaxLength(1000) reason!: string;
}
class Output {
  @IsUUID() itemId!: string;
  @IsString() @Matches(/^\d{1,12}$/) quantityKg!: string;
}
class Recovery extends Reason {
  @IsUUID() lotId!: string;
  @IsUUID() locationId!: string;
  @IsString() @Matches(/^\d{1,12}$/) quantityKg!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => Output)
  outputs!: Output[];
}
@Controller()
@UseGuards(AccessGuard)
@Allow("factory.write")
export class CorrectionsController {
  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}
  @Post("waste/recover") recover(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: Recovery,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "WASTE_RECOVERY",
      dto,
      async (tx) => {
        const input = await tx.stockLot.findUniqueOrThrow({
          where: { id: dto.lotId },
          include: { item: true },
        });
        ensure(input.item.kind === "WASTE", "Выберите партию отходов");
        const loc = await tx.stockLocation.findUniqueOrThrow({
          where: { id: dto.locationId },
        });
        ensure(loc.kind === "STORAGE", "Переработка оформляется на складе");
        const q = kg(dto.quantityKg);
        ensure(
          dto.outputs
            .reduce((a, o) => a.plus(kg(o.quantityKg)), decimal("0"))
            .eq(q),
          "Распределите всю массу между сырьём и оставшимися отходами",
        );
        await balancesLock(tx, [dto]);
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "WASTE_RECOVERY",
            reason: dto.reason,
            differenceKg: 0,
          },
        });
        await movement(
          tx,
          id,
          dto.lotId,
          dto.locationId,
          decimal(q).negated(),
          "WASTE_RECOVERY_INPUT",
        );
        await tx.transformationInput.create({
          data: { documentId: id, lotId: dto.lotId, quantityKg: q },
        });
        for (const out of dto.outputs) {
          const item = await tx.item.findUniqueOrThrow({
            where: { id: out.itemId },
          });
          ensure(
            item.isActive && ["MATERIAL", "WASTE"].includes(item.kind),
            "Выберите сырьё или отходы",
          );
          const lot = await tx.stockLot.create({
            data: { itemId: item.id, originDocumentId: id },
          });
          await movement(
            tx,
            id,
            lot.id,
            dto.locationId,
            out.quantityKg,
            "WASTE_RECOVERY_OUTPUT",
          );
          await tx.transformationOutput.create({
            data: { documentId: id, lotId: lot.id, quantityKg: out.quantityKg },
          });
        }
        return { id, inputKg: q, reason: dto.reason };
      },
    );
  }
  @Post("documents/:id/reverse") reverse(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: Reason,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "REVERSAL",
      { id, ...dto },
      async (tx) => {
        const hint = await tx.businessDocument.findUniqueOrThrow({
          where: { id },
          include: {
            shipment: true,
            movements: { include: { location: { include: { batch: true } } } },
          },
        });
        const batchIds = [
          ...new Set(
            [
              hint.batchId,
              ...hint.movements.map((m) => m.location.batch?.id),
            ].filter((v): v is string => !!v),
          ),
        ].sort();
        for (const bid of batchIds) await lock(tx, `batch:${bid}`);
        if (hint.shipment?.contractId)
          await lock(tx, `contract:${hint.shipment.contractId}`);
        await lock(tx, `document:${id}`);
        const doc = await tx.businessDocument.findUniqueOrThrow({
          where: { id },
          include: { movements: true, shipment: true },
        });
        ensure(
          doc.status === "POSTED" && doc.type !== "REVERSAL",
          "Документ уже отменён или является сторно",
        );
        ensure(
          !doc.shipment?.departedAt,
          "Машина уже выехала; оформите физический возврат отдельным документом",
        );
        for (const bid of batchIds) {
          const b = await tx.productionBatch.findUniqueOrThrow({
            where: { id: bid },
          });
          ensure(
            doc.type === "PRODUCTION_COMPLETE" || b.status === "IN_PROGRESS",
            "Плавка закрыта; сначала отмените её завершение",
          );
        }
        if (doc.type === "PRODUCTION_COMPLETE" && doc.batchId) {
          const b = await tx.productionBatch.findUniqueOrThrow({
            where: { id: doc.batchId },
            include: { shift: true },
          });
          ensure(
            b.shift.status === "OPEN",
            "Перед отменой завершения откройте смену",
          );
        }
        const carryChild =
          doc.type === "PRODUCTION_COMPLETE" && doc.batchId
            ? await tx.productionBatch.findUnique({
                where: { previousBatchId: doc.batchId },
              })
            : null;
        if (carryChild) {
          ensure(
            carryChild.status === "IN_PROGRESS",
            "Сначала отмените операции следующей смены",
          );
          ensure(
            !(await tx.businessDocument.count({
              where: { batchId: carryChild.id, status: "POSTED" },
            })),
            "В следующую смену уже внесены операции. Сначала отмените их",
          );
          const extraBalances = await tx.inventoryBalance.count({
            where: {
              locationId: carryChild.wipLocationId,
              onHandKg: { gt: 0 },
              lot: { originDocumentId: { not: id } },
            },
          });
          ensure(extraBalances === 0, "Следующая смена содержит другой металл");
        }
        await balancesLock(tx, doc.movements);
        const later = await tx.stockMovement.count({
          where: {
            lotId: { in: doc.movements.map((m) => m.lotId) },
            documentId: { not: id },
            postedAt: { gte: doc.postedAt },
            document: { status: "POSTED", type: { not: "REVERSAL" } },
          },
        });
        ensure(
          later === 0,
          "Есть последующие операции с партиями. Сначала отмените их",
        );
        await tx.businessDocument.create({
          data: {
            id: key,
            commandId: key,
            type: "REVERSAL",
            reversesId: id,
            reason: dto.reason,
          },
        });
        for (const m of doc.movements)
          await movement(
            tx,
            key,
            m.lotId,
            m.locationId,
            m.signedQuantityKg.negated(),
            "REVERSAL",
          );
        await tx.businessDocument.update({
          where: { id },
          data: { status: "REVERSED", version: { increment: 1 } },
        });
        if (doc.type === "PRODUCTION_COMPLETE" && doc.batchId)
          await tx.productionBatch.update({
            where: { id: doc.batchId },
            data: { status: "REVERSED", version: { increment: 1 } },
          });
        if (carryChild)
          await tx.productionBatch.update({
            where: { id: carryChild.id },
            data: { status: "CANCELLED", version: { increment: 1 } },
          });
        return { id: key, reversesId: id, reason: dto.reason };
      },
    );
  }
}
