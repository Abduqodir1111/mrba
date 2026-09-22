import { Query } from "@nestjs/common";
import { page, PageQuery, StockPageQuery } from "./pagination";
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
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
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { currentShift, toKg } from "@mrba/domain";
import { Database } from "./db";
import { AccessGuard, Allow, AuthRequest } from "./identity";
import { OperationsService } from "./operations";
type Tx = Prisma.TransactionClient;
export const decimal = (v: string | Prisma.Decimal) => new Prisma.Decimal(v);
export function kg(v: string, zero = false) {
  if (zero && /^0+$/.test(v)) return "0";
  try {
    return toKg(v, "kg");
  } catch {
    throw new ConflictException(
      "Введите положительный вес в целых килограммах",
    );
  }
}
export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConflictException(message);
}
export async function lock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
export async function balancesLock(
  tx: Tx,
  rows: { lotId: string; locationId: string }[],
) {
  for (const key of [
    ...new Set(rows.map((r) => `${r.lotId}:${r.locationId}`)),
  ].sort())
    await lock(tx, key);
}
export async function movement(
  tx: Tx,
  documentId: string,
  lotId: string,
  locationId: string,
  delta: Prisma.Decimal | string,
  type: string,
) {
  const amount = decimal(delta);
  const where = { lotId_locationId: { lotId, locationId } };
  const b = await tx.inventoryBalance.upsert({
    where,
    create: { lotId, locationId, onHandKg: 0 },
    update: {},
  });
  ensure(
    b.onHandKg.plus(amount).gte(b.reservedKg),
    "Недостаточно свободного остатка",
  );
  await tx.inventoryBalance.update({
    where,
    data: { onHandKg: { increment: amount }, version: { increment: 1 } },
  });
  await tx.stockMovement.create({
    data: {
      documentId,
      commandId: documentId,
      lotId,
      locationId,
      signedQuantityKg: amount,
      type,
    },
  });
}
class NameDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
}
class ItemDto extends NameDto {
  @IsOptional() @IsIn(["STORAGE", "SALE"]) wasteDisposition?: string;
  @IsIn(["PRODUCT", "WASTE"]) kind!: string;
}
class EquipmentDto extends NameDto {
  @IsIn(["BRASS", "COPPER"]) direction!: string;
}
class ReasonDto {
  @IsString() @Matches(/\S/) @MaxLength(1000) reason!: string;
}
class VersionDto {
  @IsInt() @Min(1) version!: number;
}
class LotDto {
  @IsUUID() lotId!: string;
  @IsUUID() locationId!: string;
  @IsString() @Matches(/^\d{1,12}$/) quantityKg!: string;
}
class TransferDto {
  @IsOptional() @IsUUID() lotId?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsUUID() locationId!: string;
  @IsString() @Matches(/^\d{1,12}$/) quantityKg!: string;
  @IsUUID() destinationId!: string;
  @IsString() @Matches(/\S/) @MaxLength(1000) reason!: string;
}
class LoadLineDto {
  @IsUUID() itemId!: string;
  @IsString() @Matches(/^\d{1,12}$/) quantityKg!: string;
}
class LoadBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LoadLineDto)
  lines!: LoadLineDto[];
}
class ReserveDto extends LotDto {
  @IsString() @Matches(/\S/) @MaxLength(1000) reason!: string;
}
class AdjustDto {
  @IsUUID() lotId!: string;
  @IsUUID() locationId!: string;
  @IsString() @Matches(/^\d{1,12}$/) countedKg!: string;
  @IsInt() @Min(1) version!: number;
  @IsString() @Matches(/\S/) @MaxLength(1000) reason!: string;
}
class ReturnDto extends ReserveDto {
  @IsOptional() @IsUUID() supplierId?: string;
}
class BatchDto {
  @IsUUID() equipmentId!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
class OutputDto {
  @IsUUID() itemId!: string;
  @IsString() @Matches(/^\d{1,12}$/) quantityKg!: string;
}
class CompleteDto extends VersionDto {
  @IsOptional() @IsBoolean() handover?: boolean;
  @IsOptional() @IsUUID() carryoverItemId?: string;
  @IsUUID() locationId!: string;
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OutputDto)
  outputs!: OutputDto[];
}
@Injectable()
export class FactoryService {
  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}
  async action(
    actor: string,
    id: string,
    epoch: string,
    type: string,
    dto: any,
    run: (tx: Tx) => Promise<Prisma.InputJsonObject>,
  ) {
    return this.ops.command(actor, id, epoch, type, dto, run);
  }
  async transfer(actor: string, id: string, epoch: string, dto: TransferDto) {
    return this.action(actor, id, epoch, "TRANSFER", dto, async (tx) => {
      ensure(dto.locationId !== dto.destinationId, "Выберите другую зону");
      const locations = await tx.stockLocation.findMany({
        where: { id: { in: [dto.locationId, dto.destinationId] } },
        include: { warehouse: true, batch: true },
      });
      ensure(
        locations.length === 2 &&
          locations[0].warehouse.siteId === locations[1].warehouse.siteId,
        "Зоны должны относиться к одному заводу",
      );
      for (const l of [...locations].sort((a, b) =>
        (a.batch?.id ?? "").localeCompare(b.batch?.id ?? ""),
      ))
        if (l.batch) {
          await lock(tx, `batch:${l.batch.id}`);
          const b = await tx.productionBatch.findUniqueOrThrow({
            where: { id: l.batch.id },
          });
          ensure(
            b.status === "IN_PROGRESS" ||
              (b.status === "REVERSED" && l.id === dto.locationId),
            "Плавка уже закрыта",
          );
        }
      ensure(Boolean(dto.lotId) !== Boolean(dto.itemId), "Выберите сырьё");
      const lots = await tx.stockLot.findMany({
        where: dto.lotId
          ? { id: dto.lotId }
          : {
              itemId: dto.itemId,
              balances: {
                some: { locationId: dto.locationId, onHandKg: { gt: 0 } },
              },
            },
        include: { item: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      ensure(lots.length > 0, "Нет доступного остатка");
      ensure(
        lots.every((lot) => !lot.isCarryover),
        "Остаток в котле можно выпустить только через результат плавки",
      );
      if (locations.some((l) => l.kind === "WIP"))
        ensure(
          lots.every((lot) => ["MATERIAL", "WASTE"].includes(lot.item.kind)),
          "В плавку можно передать только сырьё или отходы",
        );
      await balancesLock(
        tx,
        lots.flatMap((lot) => [
          { lotId: lot.id, locationId: dto.locationId },
          { lotId: lot.id, locationId: dto.destinationId },
        ]),
      );
      const destination = locations.find((l) => l.id === dto.destinationId)!;
      const source = locations.find((l) => l.id === dto.locationId)!;
      const type =
        destination.kind === "WIP"
          ? lots[0].item.kind === "WASTE"
            ? "WASTE_REUSE"
            : "PRODUCTION_ISSUE"
          : source.kind === "WIP"
            ? "PRODUCTION_RETURN"
            : "TRANSFER";
      await tx.businessDocument.create({
        data: {
          id,
          commandId: id,
          type,
          batchId: destination.batch?.id ?? source.batch?.id,
          reason: dto.reason,
        },
      });
      const q = kg(dto.quantityKg);
      let remaining = decimal(q);
      for (const lot of lots) {
        const balance = await tx.inventoryBalance.findUnique({
          where: {
            lotId_locationId: { lotId: lot.id, locationId: dto.locationId },
          },
        });
        const available = balance
          ? balance.onHandKg.minus(balance.reservedKg)
          : decimal("0");
        const take = Prisma.Decimal.min(available, remaining);
        if (take.lte(0)) continue;
        await movement(tx, id, lot.id, dto.locationId, take.negated(), type);
        await movement(tx, id, lot.id, dto.destinationId, take, "TRANSFER");
        remaining = remaining.minus(take);
        if (remaining.isZero()) break;
      }
      ensure(remaining.isZero(), "Недостаточно свободного остатка");
      return { id, quantityKg: q };
    });
  }
  async complete(
    actor: string,
    id: string,
    epoch: string,
    batchId: string,
    dto: CompleteDto,
  ) {
    return this.action(
      actor,
      id,
      epoch,
      "PRODUCTION_COMPLETE",
      { batchId, ...dto },
      async (tx) => {
        await lock(tx, `batch:${batchId}`);
        const batch = await tx.productionBatch.findUniqueOrThrow({
          where: { id: batchId },
          include: { shift: true },
        });
        ensure(
          batch.status === "IN_PROGRESS" && batch.version === dto.version,
          "Плавка изменена или уже завершена",
        );
        await lock(tx, `shift:${batch.shiftId}`);
        const shift = await tx.shiftInstance.findUniqueOrThrow({
          where: { id: batch.shiftId },
        });
        ensure(shift.status === "OPEN", "Смена закрыта");
        const sourceLocation = await tx.stockLocation.findUniqueOrThrow({
          where: { id: batch.wipLocationId },
          include: { warehouse: true },
        });
        const destinations = await tx.stockLocation.findMany({
          where: {
            kind: "STORAGE",
            warehouse: { siteId: sourceLocation.warehouse.siteId },
            name: { in: ["Основной склад", "Склад для продажи"] },
          },
        });
        const rawStorage = destinations.find(
          (l) => l.name === "Основной склад",
        );
        const salesStorage = destinations.find(
          (l) => l.name === "Склад для продажи",
        );
        ensure(
          rawStorage && salesStorage,
          "Не настроены склады сырья и продажи",
        );
        const inputs = await tx.inventoryBalance.findMany({
          where: { locationId: batch.wipLocationId, onHandKg: { gt: 0 } },
        });
        ensure(inputs.length, "Сначала загрузите сырьё в плавку");
        await balancesLock(tx, inputs);
        ensure(
          inputs.every((r) => r.reservedKg.isZero()),
          "Снимите резерв с сырья плавки",
        );
        const total = inputs.reduce((a, r) => a.plus(r.onHandKg), decimal("0"));
        const items = await tx.item.findMany({
          where: {
            id: { in: dto.outputs.map((o) => o.itemId) },
            isActive: true,
          },
        });
        const outputs = dto.outputs.map((o) => {
          const item = items.find((i) => i.id === o.itemId);
          ensure(
            item && ["PRODUCT", "WASTE"].includes(item.kind),
            "Выберите продукцию или отходы",
          );
          return {
            ...o,
            kind: item.kind,
            wasteDisposition: item.wasteDisposition,
            quantityKg: kg(o.quantityKg),
          };
        });
        ensure(
          dto.handover || outputs.some((o) => o.kind === "WASTE"),
          "После плавки обязательно укажите отходы и их вес",
        );
        ensure(
          dto.handover || outputs.some((o) => o.kind === "PRODUCT"),
          "Укажите выпущенную продукцию",
        );
        const outputTotal = outputs.reduce(
          (a, r) => a.plus(r.quantityKg),
          decimal("0"),
        );
        ensure(
          total.gte(outputTotal),
          `Продукция и отходы (${outputTotal} кг) превышают загруженный вес (${total} кг)`,
        );
        const loss = dto.handover
          ? total.div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          : total.minus(outputTotal);
        const carryover = dto.handover
          ? total.minus(outputTotal).minus(loss)
          : decimal("0");
        let nextBatch: {
          id: string;
          wipLocationId: string;
          number: string;
        } | null = null;
        if (dto.handover) {
          ensure(
            carryover.gt(0),
            "После вычета продукции, отходов и 1% потерь должен остаться металл в котле. Если котёл пуст — выключите пересменку",
          );
          const carryItem =
            dto.carryoverItemId &&
            (await tx.item.findUnique({ where: { id: dto.carryoverItemId } }));
          ensure(
            carryItem && carryItem.kind === "PRODUCT" && carryItem.isActive,
            "Выберите продукцию, оставшуюся в котле",
          );
          const next = currentShift(new Date(shift.endsAt));
          await lock(tx, `shift-start:${next.startsAt}`);
          const nextShift = await tx.shiftInstance.upsert({
            where: {
              startsAt_code: { startsAt: next.startsAt, code: next.code },
            },
            create: {
              startsAt: next.startsAt,
              endsAt: next.endsAt,
              businessDate: next.businessDate,
              code: next.code,
              name: next.name,
            },
            update: {},
          });
          await lock(tx, `shift:${nextShift.id}`);
          const openNext = await tx.shiftInstance.findUniqueOrThrow({
            where: { id: nextShift.id },
          });
          ensure(
            openNext.status === "OPEN",
            "Следующая смена закрыта — сначала откройте её",
          );
          const nextId = randomUUID();
          const number = `П-${next.businessDate}-${nextId.slice(0, 8)}`;
          const nextLocation = await tx.stockLocation.create({
            data: {
              warehouseId: sourceLocation.warehouseId,
              name: number,
              kind: "WIP",
            },
          });
          nextBatch = await tx.productionBatch.create({
            data: {
              id: nextId,
              number,
              equipmentId: batch.equipmentId,
              shiftId: nextShift.id,
              wipLocationId: nextLocation.id,
              previousBatchId: batch.id,
              startedAt: next.startsAt,
            },
          });
        }
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "PRODUCTION_COMPLETE",
            batchId,
            differenceKg: loss,
          },
        });
        for (const input of inputs) {
          await movement(
            tx,
            id,
            input.lotId,
            input.locationId,
            input.onHandKg.negated(),
            "PRODUCTION_CONSUMPTION",
          );
          await tx.productionInput.create({
            data: { batchId, lotId: input.lotId, quantityKg: input.onHandKg },
          });
          await tx.transformationInput.create({
            data: {
              documentId: id,
              lotId: input.lotId,
              quantityKg: input.onHandKg,
            },
          });
        }
        for (const out of outputs) {
          const lot = await tx.stockLot.create({
            data: {
              itemId: out.itemId,
              originDocumentId: id,
              stockKind:
                out.kind === "WASTE" && out.wasteDisposition === "STORAGE"
                  ? "MATERIAL"
                  : null,
            },
          });
          await movement(
            tx,
            id,
            lot.id,
            out.kind === "PRODUCT" || out.wasteDisposition === "SALE"
              ? salesStorage.id
              : rawStorage.id,
            out.quantityKg,
            out.kind === "WASTE" ? "WASTE_RECEIPT" : "PRODUCT_RECEIPT",
          );
          await tx.productionOutput.create({
            data: { batchId, lotId: lot.id, quantityKg: out.quantityKg },
          });
          await tx.transformationOutput.create({
            data: { documentId: id, lotId: lot.id, quantityKg: out.quantityKg },
          });
        }
        if (nextBatch) {
          const carriedLot = await tx.stockLot.create({
            data: {
              itemId: dto.carryoverItemId!,
              originDocumentId: id,
              isCarryover: true,
            },
          });
          await movement(
            tx,
            id,
            carriedLot.id,
            nextBatch.wipLocationId,
            carryover,
            "SHIFT_CARRYOVER",
          );
          await tx.transformationOutput.create({
            data: {
              documentId: id,
              lotId: carriedLot.id,
              quantityKg: carryover,
            },
          });
        }
        await tx.productionBatch.update({
          where: { id: batchId },
          data: {
            status: "COMPLETED",
            carryoverKg: carryover,
            completedAt: new Date(),
            differenceKg: loss,
            version: { increment: 1 },
          },
        });
        return {
          id,
          batchId,
          inputKg: total.toString(),
          lossKg: loss.toString(),
          carryoverKg: carryover.toString(),
          nextBatchId: nextBatch?.id ?? null,
          outputKg: outputTotal.toString(),
          wasteKg: outputs
            .filter((o) => o.kind === "WASTE")
            .reduce((a, o) => a.plus(o.quantityKg), decimal("0"))
            .toString(),
        };
      },
    );
  }
}
@Controller()
@UseGuards(AccessGuard)
@Allow("factory.write")
export class FactoryController {
  constructor(
    private db: Database,
    private ops: OperationsService,
    private factory: FactoryService,
  ) {}
  @Get("items") items(@Query() q: PageQuery) {
    return page(this.db.item, { orderBy: { name: "asc" } }, q, "name");
  }
  @Get("locations") locations(@Query() q: PageQuery) {
    return page(
      this.db.stockLocation,
      {
        include: { warehouse: true, batch: true },
        orderBy: { name: "asc" },
      },
      q,
      "name",
    );
  }
  @Get("stock")
  async stock(@Query() q: StockPageQuery) {
    const [lot, location] = q.cursor?.split(":") ?? [];
    const items = await this.db.inventoryBalance.findMany({
      where: {
        onHandKg: { gt: 0 },
        ...(q.search
          ? {
              lot: {
                item: { name: { contains: q.search, mode: "insensitive" } },
              },
            }
          : {}),
        ...(lot
          ? {
              OR: [
                { lotId: { lt: lot } },
                { lotId: lot, locationId: { lt: location } },
              ],
            }
          : {}),
      },
      include: { lot: { include: { item: true } }, location: true },
      orderBy: [{ lotId: "desc" }, { locationId: "desc" }],
      take: q.limit + 1,
    });
    const last = items[q.limit - 1];
    return {
      items: items.slice(0, q.limit),
      nextCursor:
        items.length > q.limit ? `${last.lotId}:${last.locationId}` : null,
    };
  }
  @Get("equipment") equipment(@Query() q: PageQuery) {
    return page(this.db.equipment, { orderBy: { name: "asc" } }, q, "name");
  }
  @Get("batches") batches(@Query() q: PageQuery) {
    return page(
      this.db.productionBatch,
      {
        include: {
          equipment: true,
          shift: true,
          previousBatch: {
            select: { id: true, number: true, carryoverKg: true },
          },
          nextBatch: { select: { id: true, number: true } },
          inputs: { include: { lot: { include: { item: true } } } },
          outputs: { include: { lot: { include: { item: true } } } },
        },
        orderBy: { startedAt: "desc" },
      },
      q,
      "number",
    );
  }
  @Get("shifts") shifts(@Query() q: PageQuery) {
    return page(this.db.shiftInstance, { orderBy: { startsAt: "desc" } }, q);
  }
  @Get("reservations") reservations(@Query() q: PageQuery) {
    return page(
      this.db.stockReservation,
      {
        where: { status: "ACTIVE" },
        include: { lot: { include: { item: true } } },
      },
      q,
    );
  }
  @Post("items") item(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: ItemDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "ITEM_CREATE",
      dto,
      async (tx) => {
        const r = await tx.item.create({
          data: {
            name: dto.name.trim(),
            kind: dto.kind,
            wasteDisposition:
              dto.kind === "WASTE" ? dto.wasteDisposition : null,
          },
        });
        return {
          id: r.id,
          name: r.name,
          kind: r.kind,
          wasteDisposition: r.wasteDisposition,
        };
      },
    );
  }
  @Post("equipment") createEquipment(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: EquipmentDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "EQUIPMENT_CREATE",
      dto,
      async (tx) => {
        const site = await tx.site.findFirstOrThrow();
        const r = await tx.equipment.create({
          data: {
            siteId: site.id,
            name: dto.name.trim(),
            direction: dto.direction,
          },
        });
        return { id: r.id, name: r.name };
      },
    );
  }
  @Post("locations") location(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: NameDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "LOCATION_CREATE",
      dto,
      async (tx) => {
        const w = await tx.warehouse.findFirstOrThrow();
        const r = await tx.stockLocation.create({
          data: { warehouseId: w.id, name: dto.name.trim() },
        });
        return { id: r.id, name: r.name };
      },
    );
  }
  @Post("batches/:id/load") loadBatch(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) batchId: string,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: LoadBatchDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "PRODUCTION_ISSUE",
      { batchId, ...dto },
      async (tx) => {
        await lock(tx, `batch:${batchId}`);
        const batch = await tx.productionBatch.findUniqueOrThrow({
          where: { id: batchId },
        });
        ensure(batch.status === "IN_PROGRESS", "Плавка уже закрыта");
        const destination = await tx.stockLocation.findUniqueOrThrow({
          where: { id: batch.wipLocationId },
          include: { warehouse: true },
        });
        const source = await tx.stockLocation.findFirstOrThrow({
          where: {
            name: "Основной склад",
            kind: "STORAGE",
            warehouse: { siteId: destination.warehouse.siteId },
          },
        });
        ensure(
          new Set(dto.lines.map((l) => l.itemId)).size === dto.lines.length,
          "Сырьё не должно повторяться",
        );
        const lots = await tx.stockLot.findMany({
          where: {
            itemId: { in: dto.lines.map((l) => l.itemId) },
            balances: { some: { locationId: source.id, onHandKg: { gt: 0 } } },
          },
          include: { item: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        await balancesLock(
          tx,
          lots.flatMap((lot) => [
            { lotId: lot.id, locationId: source.id },
            { lotId: lot.id, locationId: destination.id },
          ]),
        );
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "PRODUCTION_ISSUE",
            batchId,
            reason: "Загрузка сырья в плавку",
          },
        });
        let total = decimal("0");
        for (const line of dto.lines) {
          const item = await tx.item.findUniqueOrThrow({
            where: { id: line.itemId },
          });
          ensure(
            item.isActive && ["MATERIAL", "WASTE"].includes(item.kind),
            "Выберите доступное сырьё или отходы",
          );
          let remaining = decimal(kg(line.quantityKg));
          total = total.plus(remaining);
          for (const lot of lots.filter((l) => l.itemId === item.id)) {
            const balance = await tx.inventoryBalance.findUniqueOrThrow({
              where: {
                lotId_locationId: { lotId: lot.id, locationId: source.id },
              },
            });
            const take = Prisma.Decimal.min(
              balance.onHandKg.minus(balance.reservedKg),
              remaining,
            );
            if (take.lte(0)) continue;
            await movement(
              tx,
              id,
              lot.id,
              source.id,
              take.negated(),
              item.kind === "WASTE" ? "WASTE_REUSE" : "PRODUCTION_ISSUE",
            );
            await movement(tx, id, lot.id, destination.id, take, "TRANSFER");
            remaining = remaining.minus(take);
            if (remaining.isZero()) break;
          }
          ensure(
            remaining.isZero(),
            `Недостаточно сырья «${item.name}»: не хватает ${remaining} кг`,
          );
        }
        return { id, batchId, quantityKg: total.toString() };
      },
    );
  }
  @Post("inventory/transfer") transfer(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: TransferDto,
  ) {
    return this.factory.transfer(req.actor.id, id, epoch, dto);
  }
  @Post("inventory/reserve") reserve(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: ReserveDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "RESERVE",
      dto,
      async (tx) => {
        ensure(
          (
            await tx.stockLocation.findUniqueOrThrow({
              where: { id: dto.locationId },
            })
          ).kind === "STORAGE",
          "Операция доступна только на складе",
        );
        await balancesLock(tx, [dto]);
        const b = await tx.inventoryBalance.findUniqueOrThrow({
          where: {
            lotId_locationId: { lotId: dto.lotId, locationId: dto.locationId },
          },
        });
        const q = kg(dto.quantityKg);
        ensure(
          b.onHandKg.minus(b.reservedKg).gte(q),
          "Недостаточно свободного остатка",
        );
        const r = await tx.stockReservation.create({
          data: {
            lotId: dto.lotId,
            locationId: dto.locationId,
            quantityKg: q,
            remainingKg: q,
            reason: dto.reason,
          },
        });
        await tx.inventoryBalance.update({
          where: {
            lotId_locationId: { lotId: dto.lotId, locationId: dto.locationId },
          },
          data: { reservedKg: { increment: q }, version: { increment: 1 } },
        });
        return { id: r.id, quantityKg: q };
      },
    );
  }
  @Post("reservations/:id/release") release(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "RESERVE_RELEASE",
      { id, ...dto },
      async (tx) => {
        await lock(tx, `reserve:${id}`);
        const r = await tx.stockReservation.findUniqueOrThrow({
          where: { id },
        });
        ensure(r.status === "ACTIVE", "Резерв уже снят");
        await balancesLock(tx, [r]);
        await tx.inventoryBalance.update({
          where: {
            lotId_locationId: { lotId: r.lotId, locationId: r.locationId },
          },
          data: {
            reservedKg: { decrement: r.remainingKg },
            version: { increment: 1 },
          },
        });
        await tx.stockReservation.update({
          where: { id },
          data: { remainingKg: 0, status: "RELEASED" },
        });
        return { id, reason: dto.reason };
      },
    );
  }
  @Post("inventory/adjust") adjust(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: AdjustDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "ADJUSTMENT",
      dto,
      async (tx) => {
        ensure(
          (
            await tx.stockLocation.findUniqueOrThrow({
              where: { id: dto.locationId },
            })
          ).kind === "STORAGE",
          "Операция доступна только на складе",
        );
        await balancesLock(tx, [dto]);
        const b = await tx.inventoryBalance.findUniqueOrThrow({
          where: {
            lotId_locationId: { lotId: dto.lotId, locationId: dto.locationId },
          },
        });
        ensure(b.version === dto.version, "Остаток изменился, обновите данные");
        const q = kg(dto.countedKg, true);
        const delta = decimal(q).minus(b.onHandKg);
        ensure(!delta.isZero(), "Остаток совпадает");
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "ADJUSTMENT",
            reason: dto.reason,
            adjustmentBeforeKg: b.onHandKg,
            adjustmentAfterKg: q,
          },
        });
        await movement(tx, id, dto.lotId, dto.locationId, delta, "ADJUSTMENT");
        return {
          id,
          beforeKg: b.onHandKg.toString(),
          afterKg: q,
          reason: dto.reason,
        };
      },
    );
  }
  @Post("inventory/return-supplier") supplierReturn(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: ReturnDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "SUPPLIER_RETURN",
      dto,
      async (tx) => {
        const lot = await tx.stockLot.findUniqueOrThrow({
          where: { id: dto.lotId },
          include: {
            purchaseLot: { include: { line: { include: { receipt: true } } } },
          },
        });
        ensure(lot.purchaseLot, "Вернуть можно только принятое сырьё");
        if (dto.supplierId)
          ensure(
            lot.purchaseLot.line.receipt.supplierId === dto.supplierId,
            "Партия относится к другому поставщику",
          );
        const loc = await tx.stockLocation.findUniqueOrThrow({
          where: { id: dto.locationId },
        });
        ensure(
          loc.kind === "STORAGE",
          "Сначала верните сырьё из плавки на склад",
        );
        await balancesLock(tx, [dto]);
        const q = kg(dto.quantityKg);
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "SUPPLIER_RETURN",
            supplierId: lot.purchaseLot.line.receipt.supplierId,
            reason: dto.reason,
          },
        });
        await movement(
          tx,
          id,
          dto.lotId,
          dto.locationId,
          decimal(q).negated(),
          "SUPPLIER_RETURN",
        );
        return { id, quantityKg: q };
      },
    );
  }
  @Post("waste/dispose") dispose(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: ReserveDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "WASTE_DISPOSAL",
      dto,
      async (tx) => {
        const lot = await tx.stockLot.findUniqueOrThrow({
          where: { id: dto.lotId },
          include: { item: true },
        });
        ensure(lot.item.kind === "WASTE", "Выберите отходы");
        const loc = await tx.stockLocation.findUniqueOrThrow({
          where: { id: dto.locationId },
        });
        ensure(loc.kind === "STORAGE", "Сначала верните отходы на склад");
        await balancesLock(tx, [dto]);
        const q = kg(dto.quantityKg);
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "WASTE_DISPOSAL",
            reason: dto.reason,
          },
        });
        await movement(
          tx,
          id,
          dto.lotId,
          dto.locationId,
          decimal(q).negated(),
          "WASTE_DISPOSAL",
        );
        return { id, quantityKg: q, reason: dto.reason };
      },
    );
  }
  @Post("batches") batch(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: BatchDto,
  ) {
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "BATCH_START",
      dto,
      async (tx) => {
        const equipment = await tx.equipment.findUniqueOrThrow({
          where: { id: dto.equipmentId },
        });
        ensure(equipment.isActive, "Оборудование отключено");
        const now = currentShift(new Date());
        await lock(tx, `shift-start:${now.startsAt}`);
        const shift = await tx.shiftInstance.upsert({
          where: { startsAt_code: { startsAt: now.startsAt, code: now.code } },
          create: {
            startsAt: now.startsAt,
            endsAt: now.endsAt,
            businessDate: now.businessDate,
            code: now.code,
            name: now.name,
          },
          update: {},
        });
        await lock(tx, `shift:${shift.id}`);
        ensure(
          (
            await tx.shiftInstance.findUniqueOrThrow({
              where: { id: shift.id },
            })
          ).status === "OPEN",
          "Смена закрыта",
        );
        const w = await tx.warehouse.findFirstOrThrow({
          where: { siteId: equipment.siteId },
        });
        const batchId = randomUUID();
        const number = `П-${now.businessDate}-${batchId.slice(0, 8)}`;
        const loc = await tx.stockLocation.create({
          data: { warehouseId: w.id, name: number, kind: "WIP" },
        });
        const b = await tx.productionBatch.create({
          data: {
            id: batchId,
            number,
            equipmentId: equipment.id,
            shiftId: shift.id,
            wipLocationId: loc.id,
            notes: dto.notes,
          },
        });
        return {
          id: b.id,
          number,
          version: b.version,
          wipLocationId: loc.id,
          businessDate: shift.businessDate,
        };
      },
    );
  }
  @Post("batches/:id/complete") complete(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteDto,
  ) {
    return this.factory.complete(req.actor.id, key, epoch, id, dto);
  }
  @Post("batches/:id/cancel") cancel(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "BATCH_CANCEL",
      { id, ...dto },
      async (tx) => {
        await lock(tx, `batch:${id}`);
        const b = await tx.productionBatch.findUniqueOrThrow({ where: { id } });
        ensure(b.status === "IN_PROGRESS", "Плавка уже закрыта");
        ensure(
          !b.previousBatchId,
          "Это продолжение пересменки: завершите плавку, чтобы учесть оставшийся металл",
        );
        const inputs = await tx.inventoryBalance.findMany({
          where: { locationId: b.wipLocationId, onHandKg: { gt: 0 } },
        });
        if (inputs.length) {
          const source = await tx.stockLocation.findUniqueOrThrow({
            where: { id: b.wipLocationId },
            include: { warehouse: true },
          });
          const destination = await tx.stockLocation.findFirstOrThrow({
            where: {
              name: "Основной склад",
              kind: "STORAGE",
              warehouse: { siteId: source.warehouse.siteId },
            },
          });
          await balancesLock(
            tx,
            inputs.flatMap((r) => [
              r,
              { lotId: r.lotId, locationId: destination.id },
            ]),
          );
          await tx.businessDocument.create({
            data: {
              id: key,
              commandId: key,
              type: "PRODUCTION_RETURN",
              batchId: id,
              reason: dto.reason,
            },
          });
          for (const input of inputs) {
            await movement(
              tx,
              key,
              input.lotId,
              b.wipLocationId,
              input.onHandKg.negated(),
              "PRODUCTION_RETURN",
            );
            await movement(
              tx,
              key,
              input.lotId,
              destination.id,
              input.onHandKg,
              "TRANSFER",
            );
          }
        }
        await tx.productionBatch.update({
          where: { id },
          data: { status: "CANCELLED", version: { increment: 1 } },
        });
        return { id, reason: dto.reason };
      },
    );
  }
  @Post("shifts/:id/close") closeShift(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: VersionDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "SHIFT_CLOSE",
      { id, ...dto },
      async (tx) => {
        await lock(tx, `shift:${id}`);
        const s = await tx.shiftInstance.findUniqueOrThrow({ where: { id } });
        ensure(
          s.status === "OPEN" && s.version === dto.version,
          "Смена изменена",
        );
        ensure(
          !(await tx.productionBatch.count({
            where: { shiftId: id, status: "IN_PROGRESS" },
          })),
          "Есть незавершённые плавки",
        );
        await tx.shiftInstance.update({
          where: { id },
          data: { status: "CLOSED", version: { increment: 1 } },
        });
        return { id, status: "CLOSED" };
      },
    );
  }
  @Post("shifts/:id/reopen") reopenShift(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "SHIFT_REOPEN",
      { id, ...dto },
      async (tx) => {
        await lock(tx, `shift:${id}`);
        const s = await tx.shiftInstance.findUniqueOrThrow({ where: { id } });
        ensure(s.status === "CLOSED", "Смена не закрыта");
        await tx.shiftInstance.update({
          where: { id },
          data: { status: "OPEN", version: { increment: 1 } },
        });
        return { id, status: "OPEN", reason: dto.reason };
      },
    );
  }
}
