import { Query } from "@nestjs/common";
import { page, PageQuery } from "./pagination";
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  isUUID,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { currentShift, toKg } from "@mrba/domain";
import { Database } from "./db";
import { AccessGuard, Allow, AuthRequest } from "./identity";
class NamedDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
}
class LineDto {
  @IsOptional() @IsUUID() materialId?: string;
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  materialName?: string;
  @IsString() @Matches(/^\d{1,12}(?:\.\d{1,6})?$/) quantity!: string;
  @IsIn(["kg", "t"]) unit!: "kg" | "t";
  @IsString() @Matches(/^\d{1,12}(?:\.\d{1,6})?$/) unitPricePerKg!: string;
}
class PurchaseDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsIn(["UZS", "USD"]) currency!: "UZS" | "USD";
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];
}
@Injectable()
export class OperationsService {
  constructor(private db: Database) {}
  async command(
    actorId: string,
    id: string,
    epoch: string,
    type: string,
    payload: unknown,
    run: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonObject>,
  ) {
    if (!isUUID(id)) throw new ConflictException("INVALID_COMMAND_ID");
    if (epoch !== process.env.RECOVERY_EPOCH)
      throw new ConflictException("SERVER_CONTEXT_CHANGED");
    // DTO property order is stable after validation; canonicalize recursively for semantic retries.
    const canonical = (v: any): any =>
      Array.isArray(v)
        ? v.map(canonical)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, canonical(v[k])]),
            )
          : v;
    const payloadHash = createHash("sha256")
      .update(JSON.stringify({ type, payload: canonical(payload) }))
      .digest("hex");
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
        const existing = await tx.commandReceipt.findUnique({
          where: { commandId: id },
        });
        if (existing) {
          if (
            existing.actorId !== actorId ||
            existing.payloadHash !== payloadHash
          )
            throw new ConflictException("IDEMPOTENCY_KEY_REUSED");
          return existing.result;
        }
        const intent = await tx.commandIntent.findUnique({ where: { id } });
        if (
          intent &&
          (intent.actorId !== actorId ||
            intent.epoch !== epoch ||
            intent.status !== "PREPARED")
        )
          throw new ConflictException("Черновик недоступен");
        // The FK anchor and final result are committed together; never visible half-written.
        await tx.commandReceipt.create({
          data: { commandId: id, actorId, type, payloadHash, result: {} },
        });
        const result = await run(tx);
        await tx.commandReceipt.update({
          where: { commandId: id },
          data: { result },
        });
        if (intent)
          await tx.commandIntent.update({
            where: { id },
            data: { status: "POSTED" },
          });
        await tx.auditLog.create({
          data: {
            actorId,
            commandId: id,
            action: type,
            entityId: String(result.id),
            snapshot: result,
          },
        });
        return result;
      },
      { timeout: 30000 },
    );
  }
  async purchase(actorId: string, id: string, epoch: string, dto: PurchaseDto) {
    return this.command(
      actorId,
      id,
      epoch,
      "PURCHASE_RECEIPT",
      dto,
      async (tx) => {
        const site = await tx.site.findFirstOrThrow();
        const location = await tx.stockLocation.findFirstOrThrow({
          where: {
            warehouse: { siteId: site.id },
            kind: "STORAGE",
            name: "Основной склад",
          },
        });
        const supplier = dto.supplierId
          ? await tx.supplier.findFirst({
              where: { id: dto.supplierId, isActive: true },
            })
          : null;
        if (dto.supplierId && !supplier)
          throw new ConflictException("Поставщик недоступен");
        const receipt = await tx.purchaseReceipt.create({
          data: {
            id: randomUUID(),
            siteId: site.id,
            supplierId: supplier?.id,
            createdBy: actorId,
            currency: dto.currency,
            notes: dto.notes,
          },
        });
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "PURCHASE_RECEIPT",
            supplierId: supplier?.id,
          },
        });
        for (const row of dto.lines) {
          if (Boolean(row.materialId) === Boolean(row.materialName))
            throw new ConflictException(
              "Выберите сырьё или укажите новое название",
            );
          let materialId = row.materialId;
          if (row.materialName) {
            const name = row.materialName.trim();
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${name}`}, 0))`;
            let material = await tx.material.findUnique({ where: { name } });
            if (!material) {
              material = await tx.material.create({ data: { name } });
              await tx.item.create({
                data: { id: material.id, name, kind: "MATERIAL" },
              });
            }
            materialId = material.id;
          }
          if (
            !(await tx.material.findFirst({
              where: { id: materialId, isActive: true },
            }))
          )
            throw new ConflictException("Сырьё недоступно");
          let kg: string;
          try {
            kg = toKg(row.quantity, row.unit);
          } catch {
            throw new ConflictException(
              "Вес должен быть положительным, только целые килограммы",
            );
          }
          const price = new Prisma.Decimal(row.unitPricePerKg);
          if (price.lte(0))
            throw new ConflictException("Цена должна быть положительной");
          const amount = new Prisma.Decimal(kg).times(price); // exact, no unapproved monetary rounding
          const line = await tx.purchaseLine.create({
            data: {
              receiptId: receipt.id,
              materialId: materialId!,
              quantityKg: kg,
              unitPricePerKg: price,
              amount,
            },
          });
          const lot = await tx.purchaseLot.create({
            data: { lineId: line.id },
          });
          await tx.stockLot.create({
            data: {
              id: lot.id,
              purchaseLotId: lot.id,
              itemId: materialId!,
              originDocumentId: id,
            },
          });
          await tx.stockMovement.create({
            data: {
              documentId: id,
              lotId: lot.id,
              locationId: location.id,
              commandId: id,
              signedQuantityKg: kg,
              type: "PURCHASE_RECEIPT",
            },
          });
          await tx.inventoryBalance.create({
            data: { lotId: lot.id, locationId: location.id, onHandKg: kg },
          });
        }
        return {
          id: receipt.id,
          postedAt: receipt.postedAt.toISOString(),
          currency: receipt.currency,
          supplier: supplier?.name ?? null,
          lines: dto.lines.length,
        };
      },
    );
  }
}
@Controller()
export class HealthController {
  constructor(private db: Database) {}
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return { status: "ok", database: "connected" };
    } catch {
      throw new ServiceUnavailableException("Database unavailable");
    }
  }
}
@Controller()
@UseGuards(AccessGuard)
export class OperationsController {
  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}
  @Get("system/context") context() {
    return { recoveryEpoch: process.env.RECOVERY_EPOCH };
  }
  @Get("dashboard") @Allow("dashboard.read") async dashboard(
    @Req() req: AuthRequest,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const site = await tx.site.findFirstOrThrow();
        const stock = await tx.inventoryBalance.aggregate({
          where: {
            location: {
              kind: "STORAGE",
              name: "Основной склад",
              warehouse: { siteId: site.id },
            },
          },
          _sum: { onHandKg: true },
        });
        const stockByMaterial = await tx.$queryRaw<
          Array<{ id: string; name: string; quantityKg: string }>
        >`SELECT i.id, i.name, SUM(b."onHandKg")::text AS "quantityKg"
          FROM "InventoryBalance" b
          JOIN "StockLot" l ON l.id=b."lotId"
          JOIN "Item" i ON i.id=l."itemId"
          JOIN "StockLocation" loc ON loc.id=b."locationId"
          JOIN "Warehouse" w ON w.id=loc."warehouseId"
          WHERE loc.name='Основной склад' AND loc.kind='STORAGE' AND w."siteId"=${site.id}::uuid
          GROUP BY i.id, i.name HAVING SUM(b."onHandKg") > 0 ORDER BY i.name, i.id`;
        const totals = await tx.$queryRaw<
          Array<{ currency: string; amount: string }>
        >`SELECT r.currency, SUM(l.amount)::text AS amount FROM "PurchaseLine" l JOIN "PurchaseReceipt" r ON r.id=l."receiptId" JOIN "PurchaseLot" pl ON pl."lineId"=l.id JOIN "StockLot" sl ON sl.id=pl.id JOIN "BusinessDocument" d ON d.id=sl."originDocumentId" WHERE d.status='POSTED' GROUP BY r.currency`;
        return {
          site,
          owner: req.actor.name,
          shift: currentShift(new Date()),
          generatedAt: new Date().toISOString(),
          stockKg: stock._sum.onHandKg?.toString() ?? "0",
          stockByMaterial,
          purchases: await tx.purchaseReceipt.count({
            where: {
              lines: {
                some: {
                  lot: { stockLot: { originDocument: { status: "POSTED" } } },
                },
              },
            },
          }),
          suppliers: await tx.supplier.count(),
          materials: await tx.material.count(),
          purchaseAmounts: totals,
          recent: await tx.purchaseReceipt.findMany({
            where: {
              lines: {
                some: {
                  lot: { stockLot: { originDocument: { status: "POSTED" } } },
                },
              },
            },
            take: 5,
            orderBy: [{ postedAt: "desc" }, { id: "desc" }],
            include: { supplier: true, lines: { include: { material: true } } },
          }),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  @Get("materials") @Allow("catalog.read") materials(@Query() q: PageQuery) {
    return page(
      this.db.material,
      { orderBy: { name: "asc" }, take: 200 },
      q,
      "name",
    );
  }
  @Get("suppliers") @Allow("catalog.read") suppliers(@Query() q: PageQuery) {
    return page(
      this.db.supplier,
      { orderBy: { name: "asc" }, take: 200 },
      q,
      "name",
    );
  }
  @Post("materials") @Allow("catalog.write") material(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: NamedDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "MATERIAL_CREATE",
      dto,
      async (tx) => {
        const r = await tx.material.create({ data: { name: dto.name.trim() } });
        await tx.item.create({
          data: { id: r.id, name: r.name, kind: "MATERIAL" },
        });
        return { id: r.id, name: r.name };
      },
    );
  }
  @Post("suppliers") @Allow("catalog.write") supplier(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: NamedDto,
  ) {
    return this.ops.command(
      req.actor.id,
      key,
      epoch,
      "SUPPLIER_CREATE",
      dto,
      async (tx) => {
        const r = await tx.supplier.create({ data: { name: dto.name.trim() } });
        return { id: r.id, name: r.name };
      },
    );
  }
  @Post("purchase-receipts") @Allow("purchase.post") purchase(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: PurchaseDto,
  ) {
    return this.ops.purchase(req.actor.id, key, epoch, dto);
  }
  @Get("inventory/lots") @Allow("inventory.read") async inventory(
    @Query() q: PageQuery,
  ) {
    const result = await page(
      this.db.purchaseLot,
      {
        take: 200,
        orderBy: { id: "desc" },
        include: {
          stockLot: { include: { balances: { include: { location: true } } } },
          line: {
            include: {
              material: true,
              receipt: { include: { supplier: true } },
            },
          },
        },
      },
      q,
    );
    return {
      ...result,
      items: result.items.map((l: any) => ({
        ...l,
        balances: l.stockLot?.balances ?? [],
      })),
    };
  }
  @Get("commands/:id") async receipt(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const result = await this.db.commandReceipt.findFirst({
      where: { commandId: id, actorId: req.actor.id },
    });
    if (!result) throw new NotFoundException("Результат пока не найден");
    return result;
  }
}
