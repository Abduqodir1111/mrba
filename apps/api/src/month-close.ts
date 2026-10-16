import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Prisma } from "@prisma/client";
import { Database } from "./db";
import { AccessGuard, Allow, AuthRequest } from "./identity";
import { OperationsService } from "./operations";
import { Costing, addCosts, scaleCost } from "./costing";
import { effectivePurchase, revisionInclude } from "./purchase-values";
import { ensure, movement } from "./factory";
class CloseDto {
  @IsOptional() @IsUUID() previousId?: string;
}
class OpeningLineDto {
  @IsUUID() itemId!: string;
  @IsUUID() locationId!: string;
  @IsOptional() @IsUUID() sourceLotId?: string;
  @IsString() @Matches(/^\d{1,12}(?:\.\d{1,3})?$/) quantityKg!: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}(?:\.\d{1,6})?$/)
  unitPricePerKg?: string;
  @IsOptional() @IsIn(["UZS", "USD"]) currency?: "UZS" | "USD";
}
class OpeningDto {
  @IsUUID() closeId!: string;
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OpeningLineDto)
  lines!: OpeningLineDto[];
}
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
const sum = (rows: any[], field: string) =>
  rows
    .reduce((a, r) => a.plus(r[field] ?? 0), new Prisma.Decimal(0))
    .toString();
const amounts = (rows: any[]) =>
  ["UZS", "USD"].map((currency) => ({
    currency,
    amount: sum(
      rows.filter((r) => r.currency === currency && r.priceKnown !== false),
      "amount",
    ),
  }));

async function snapshot(tx: Prisma.TransactionClient) {
  const previous = await tx.monthClose.findFirst({
    orderBy: { number: "desc" },
  });
  const periodId = previous?.id ?? null;
  const command = { reportingPeriodId: periodId };
  const documents = await tx.businessDocument.findMany({
    where: { command },
    orderBy: { postedAt: "asc" },
    include: {
      command: { select: { actorId: true, type: true, recordedAt: true } },
      purchaseRevision: { include: { line: { include: { material: true } } } },
    },
  });
  const receipts = await tx.purchaseReceipt.findMany({
    where: {
      lines: { some: { lot: { stockLot: { originDocument: { command } } } } },
    },
    include: {
      supplier: true,
      lines: { include: { material: true, revisions: revisionInclude } },
    },
    orderBy: { postedAt: "asc" },
  });
  const posted = new Set(
    documents.filter((d) => d.status === "POSTED").map((d) => d.id),
  );
  const purchases = [];
  for (const r of receipts) {
    const lot = await tx.stockLot.findFirst({
      where: { purchaseLot: { line: { receiptId: r.id } } },
    });
    purchases.push({
      ...r,
      status: lot && posted.has(lot.originDocumentId) ? "POSTED" : "REVERSED",
      lines: r.lines.map((l) => {
        const effective = effectivePurchase(l);
        return { ...effective, currency: effective.currency ?? r.currency };
      }),
    });
  }
  const batches = await tx.productionBatch.findMany({
    where: { documents: { some: { command } } },
    include: {
      equipment: true,
      shift: true,
      inputs: { include: { lot: { include: { item: true } } } },
      outputs: { include: { lot: { include: { item: true } } } },
      documents: {
        include: { kettleRecoveries: { where: { status: "POSTED" } } },
      },
    },
    orderBy: { startedAt: "asc" },
  });
  const shipments = await tx.shipment.findMany({
    where: { document: { command } },
    include: {
      document: true,
      customer: true,
      lines: { include: { item: true } },
    },
  });
  const movements = await tx.stockMovement.findMany({
    where: { document: { command } },
    include: { lot: { include: { item: true } }, location: true },
    orderBy: { postedAt: "asc" },
  });
  const adjustments = documents.filter((d) =>
    ["ADJUSTMENT", "PURCHASE_CORRECTION", "KETTLE_RECOVERY"].includes(d.type),
  );
  const costing = new Costing(tx);
  const stock = await tx.inventoryBalance.findMany({
    where: { OR: [{ onHandKg: { not: 0 } }, { reservedKg: { not: 0 } }] },
    include: {
      location: { include: { warehouse: true } },
      lot: { include: { item: true } },
    },
    orderBy: { locationId: "asc" },
  });
  const closingStock = [];
  for (const row of stock)
    closingStock.push({
      ...row,
      unitCost: await costing.unit(row.lotId),
      value: scaleCost(await costing.unit(row.lotId), row.onHandKg),
    });
  const production = [];
  for (const b of batches) {
    const completion = b.documents.find(
      (d) => d.type === "PRODUCTION_COMPLETE" && posted.has(d.id),
    );
    const recovery = b.documents.find(
      (d) => d.type === "KETTLE_RECOVERY" && d.status === "POSTED",
    );
    const recoveredOutputs = recovery
      ? await tx.transformationOutput.findMany({
          where: { documentId: recovery.id },
        })
      : [];
    const totalCost = await costing.total(
      recovery ? recoveredOutputs : b.inputs,
    );
    const outputs = [];
    for (const o of b.outputs)
      outputs.push({
        ...o,
        unitCost: await costing.unit(o.lotId),
        value: scaleCost(await costing.unit(o.lotId), o.quantityKg),
      });
    production.push({
      ...b,
      totalCost,
      outputs,
      recovery: recovery
        ? {
            expectedKg: recovery.adjustmentBeforeKg,
            actualKg: recovery.adjustmentAfterKg,
            reason: recovery.reason,
          }
        : null,
      includedInTotals: !!completion,
    });
  }
  const purchaseLines = purchases
    .filter((r) => r.status === "POSTED")
    .flatMap((r) => r.lines);
  const salesLines = shipments
    .filter((s) => s.document.status === "POSTED")
    .flatMap((s) => s.lines.map((l) => ({ ...l, currency: s.currency })));
  const completed = production.filter((b) => b.includedInTotals);
  const outputLines = completed.flatMap((b) => b.outputs);
  const first = await tx.commandReceipt.findFirst({
    where: { ...command, type: { not: "MONTH_CLOSE" } },
    orderBy: { recordedAt: "asc" },
  });
  const openingMovements = await tx.stockMovement.findMany({
    where: { type: "MONTH_OPENING", document: { command } },
    include: {
      location: { include: { warehouse: true } },
      lot: { include: { item: true } },
    },
  });
  const openingStock = openingMovements.map((r) => ({
    ...r,
    onHandKg: r.signedQuantityKg,
    reservedKg: "0",
    unitCost: r.lot.openingUnitCost,
    value: scaleCost(r.lot.openingUnitCost as any, r.signedQuantityKg),
  }));
  const from =
    previous?.to ??
    new Date(
      `${new Date((first?.recordedAt ?? new Date()).getTime() + 5 * 3600000).toISOString().slice(0, 7)}-01T00:00:00+05:00`,
    );
  const to = new Date();
  const owner = previous ? { id: previous.id, number: previous.number } : null;
  const summary = {
    receipts: purchases.filter((r) => r.status === "POSTED").length,
    receivedKg: sum(purchaseLines, "quantityKg"),
    returnedKg: sum(purchaseLines, "returnedKg"),
    grossKg: new Prisma.Decimal(sum(purchaseLines, "quantityKg"))
      .plus(sum(purchaseLines, "returnedKg"))
      .toString(),
    discountKg: new Prisma.Decimal(sum(purchaseLines, "discountKg"))
      .plus(sum(purchaseLines, "percentDiscountKg"))
      .toString(),
    purchaseAmounts: amounts(purchaseLines),
    unpriced: purchaseLines.filter((l) => !l.priceKnown).length,
    completedBatches: completed.length,
    productKg: sum(
      outputLines.filter((o) => o.lot.item.kind === "PRODUCT"),
      "quantityKg",
    ),
    wasteKg: sum(
      outputLines.filter((o) => o.lot.item.kind === "WASTE"),
      "quantityKg",
    ),
    lossKg: sum(completed, "differenceKg"),
    shipments: shipments.filter((s) => s.document.status === "POSTED").length,
    soldKg: sum(salesLines, "quantityKg"),
    saleAmounts: amounts(salesLines),
    stockKg: sum(
      closingStock.filter((r) => r.location.kind === "STORAGE"),
      "onHandKg",
    ),
    wipKg: sum(
      closingStock.filter((r) => r.location.kind === "WIP"),
      "onHandKg",
    ),
    stockValue: addCosts(closingStock.map((r) => r.value)),
  };
  return {
    from,
    to,
    previous: owner,
    summary,
    purchases,
    production,
    shipments,
    movements,
    adjustments,
    documents,
    closingStock,
    openingStock: openingStock.length
      ? openingStock
      : previous && !(previous.snapshot as any).stockReset
        ? (previous.snapshot as any).closingStock
        : [],
    contracts: await tx.contract.findMany({
      include: { customer: true, lines: { include: { item: true } } },
    }),
    operations: documents.length,
    timezone: "Asia/Tashkent",
    schemaVersion: 2,
    stockReset: true,
  };
}
@Controller("month-closes")
@UseGuards(AccessGuard)
@Allow("audit.read")
export class MonthCloseController {
  constructor(
    private db: Database,
    private ops: OperationsService,
  ) {}
  @Get() async list() {
    return this.db.monthClose.findMany({
      orderBy: { number: "desc" },
      select: {
        id: true,
        number: true,
        from: true,
        to: true,
        ownerName: true,
        createdAt: true,
      },
    });
  }
  @Get("preview") async preview() {
    return this.db.$transaction(
      async (tx) => {
        const result = await snapshot(tx);
        const previous = result.previous
          ? await tx.monthClose.findUniqueOrThrow({
              where: { id: result.previous.id },
            })
          : null;
        const openingPending =
          !!(previous?.snapshot as any)?.stockReset &&
          !(await tx.commandReceipt.count({
            where: { type: "MONTH_OPENING", reportingPeriodId: previous!.id },
          }));
        const blockers = [];
        if (
          await tx.productionBatch.count({
            where: {
              status: "IN_PROGRESS",
              OR: [{ inputs: { some: {} } }, { carryoverKg: { gt: 0 } }],
            },
          })
        )
          blockers.push(
            "Есть незавершённые плавки. Завершите или отмените их перед закрытием",
          );
        if (
          result.closingStock.some(
            (r) => r.location.kind === "WIP" && r.onHandKg.gt(0),
          )
        )
          blockers.push(
            "В котлах есть сырьё. Завершите плавку и верните остаток на склад перед закрытием",
          );
        if (result.closingStock.some((r) => r.reservedKg.gt(0)))
          blockers.push(
            "Есть зарезервированные остатки. Снимите резервы перед закрытием",
          );
        return {
          from: result.from,
          to: result.to,
          previous: result.previous,
          summary: result.summary,
          stock: result.closingStock,
          operations: result.operations,
          openingPending,
          blockers,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 60000 },
    );
  }
  @Get("opening") async opening() {
    return this.db.$transaction(
      async (tx) => {
        const latest = await tx.monthClose.findFirst({
          orderBy: { number: "desc" },
        });
        const pending =
          !!(latest?.snapshot as any)?.stockReset &&
          !(await tx.commandReceipt.count({
            where: { type: "MONTH_OPENING", reportingPeriodId: latest!.id },
          }));
        return {
          pending,
          closeId: latest?.id,
          number: latest?.number,
          rows: pending
            ? (latest!.snapshot as any).closingStock.filter(
                (r: any) => r.location.kind === "STORAGE",
              )
            : [],
          items: await tx.item.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
          }),
          locations: await tx.stockLocation.findMany({
            where: { kind: "STORAGE" },
            include: { warehouse: true },
            orderBy: { name: "asc" },
          }),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  @Post("opening") @Allow("factory.write") async saveOpening(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: OpeningDto,
  ) {
    ensure(
      !!(await this.db.userRole.findFirst({
        where: { userId: req.actor.id, role: { code: "OWNER" } },
      })),
      "Подтверждать пересчёт может только владелец",
    );
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "MONTH_OPENING",
      dto,
      async (tx) => {
        const latest = await tx.monthClose.findFirst({
          orderBy: { number: "desc" },
        });
        ensure(
          latest?.id === dto.closeId && (latest.snapshot as any).stockReset,
          "Обновите период пересчёта",
        );
        ensure(
          !(await tx.commandReceipt.count({
            where: {
              type: "MONTH_OPENING",
              reportingPeriodId: latest.id,
              commandId: { not: id },
            },
          })),
          "Фактические остатки уже подтверждены",
        );
        ensure(
          !(await tx.inventoryBalance.count({
            where: {
              OR: [{ onHandKg: { not: 0 } }, { reservedKg: { not: 0 } }],
            },
          })),
          "Склады должны быть пустыми перед вводом начальных остатков",
        );
        const archived = (latest.snapshot as any).closingStock as any[];
        const seen = new Set<string>();
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "MONTH_OPENING",
            reason: `Фактические остатки после отчёта №${latest.number}`,
          },
        });
        for (const line of dto.lines) {
          const key = `${line.itemId}:${line.locationId}:${line.sourceLotId ?? "new"}`;
          ensure(!seen.has(key), "Одна партия указана дважды");
          seen.add(key);
          const quantity = new Prisma.Decimal(line.quantityKg);
          ensure(quantity.gte(0), "Вес не может быть отрицательным");
          const item = await tx.item.findUniqueOrThrow({
            where: { id: line.itemId },
          });
          const location = await tx.stockLocation.findUniqueOrThrow({
            where: { id: line.locationId },
          });
          ensure(
            item.isActive && location.kind === "STORAGE",
            "Выберите действующий материал и склад",
          );
          const source = line.sourceLotId
            ? archived.find(
                (r) =>
                  r.lotId === line.sourceLotId &&
                  r.locationId === line.locationId &&
                  r.lot.itemId === line.itemId,
              )
            : null;
          ensure(
            !line.sourceLotId || source,
            "Партия отсутствует в закрытом отчёте",
          );
          let unitCost = source?.unitCost ?? { known: false, amounts: {} };
          if (line.unitPricePerKg !== undefined) {
            ensure(!!line.currency, "Выберите валюту стоимости");
            unitCost = {
              known: true,
              amounts: {
                [line.currency!]: new Prisma.Decimal(
                  line.unitPricePerKg,
                ).toString(),
              },
            };
          } else ensure(!line.currency, "Укажите стоимость за кг");
          if (quantity.isZero()) continue;
          const lot = await tx.stockLot.create({
            data: {
              itemId: item.id,
              stockKind: source?.lot.stockKind ?? null,
              originDocumentId: id,
              openingUnitCost: json(unitCost),
            },
          });
          await movement(
            tx,
            id,
            lot.id,
            location.id,
            quantity,
            "MONTH_OPENING",
          );
        }
        return { id, closeId: latest.id, lines: dto.lines.length };
      },
    );
  }
  @Get(":id") async detail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.db.monthClose.findUniqueOrThrow({ where: { id } });
  }
  @Post() @Allow("factory.write") async close(
    @Req() req: AuthRequest,
    @Headers("idempotency-key") id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: CloseDto,
  ) {
    ensure(
      !!(await this.db.userRole.findFirst({
        where: { userId: req.actor.id, role: { code: "OWNER" } },
      })),
      "Закрывать месяц может только владелец",
    );
    return this.ops.command(
      req.actor.id,
      id,
      epoch,
      "MONTH_CLOSE",
      dto,
      async (tx) => {
        const latest = await tx.monthClose.findFirst({
          orderBy: { number: "desc" },
          select: { id: true },
        });
        ensure(
          (latest?.id ?? null) === (dto.previousId ?? null),
          "Этот период уже закрыт. Обновите страницу",
        );
        const result = await snapshot(tx);
        ensure(
          !(
            result.previous &&
            ((
              await tx.monthClose.findUniqueOrThrow({
                where: { id: result.previous.id },
              })
            ).snapshot as any)
          )?.stockReset ||
            !!(await tx.commandReceipt.count({
              where: {
                type: "MONTH_OPENING",
                reportingPeriodId: result.previous!.id,
              },
            })),
          "Сначала подтвердите фактические остатки нового периода",
        );
        ensure(
          result.operations > 0 || result.closingStock.length > 0,
          "В текущем периоде ещё нет операций и остатков",
        );
        ensure(
          !(await tx.productionBatch.count({
            where: {
              status: "IN_PROGRESS",
              OR: [{ inputs: { some: {} } }, { carryoverKg: { gt: 0 } }],
            },
          })),
          "Перед закрытием завершите или отмените незавершённые плавки",
        );
        ensure(
          !result.closingStock.some((r) => r.reservedKg.gt(0)),
          "Перед закрытием снимите резервы",
        );
        ensure(
          !result.closingStock.some(
            (r) => r.location.kind === "WIP" && r.onHandKg.gt(0),
          ),
          "Перед закрытием завершите плавки и верните остаток из котлов на склад",
        );
        const number = (result.previous?.number ?? 0) + 1;
        await tx.monthClose.create({
          data: {
            id,
            number,
            stockReset: true,
            previousId: result.previous?.id,
            from: result.from,
            to: result.to,
            closedBy: req.actor.id,
            ownerName: req.actor.name,
            snapshot: json(result),
          },
        });
        await tx.businessDocument.create({
          data: {
            id,
            commandId: id,
            type: "MONTH_CLOSE",
            reason: `Обнуление складов после отчёта №${number}`,
          },
        });
        for (const row of result.closingStock) {
          if (row.onHandKg.gt(0))
            await movement(
              tx,
              id,
              row.lotId,
              row.locationId,
              row.onHandKg.negated(),
              "MONTH_CLOSE",
            );
        }
        return {
          id,
          number,
          from: result.from.toISOString(),
          to: result.to.toISOString(),
          openingPending: true,
        };
      },
    );
  }
}
