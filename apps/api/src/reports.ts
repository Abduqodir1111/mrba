import { page, PageQuery } from "./pagination";
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsDateString, IsOptional, IsUUID } from "class-validator";
import { Database } from "./db";
import { AccessGuard, Allow } from "./identity";
import { decimal, ensure } from "./factory";
class Filters {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() equipmentId?: string;
  @IsOptional() @IsUUID() shiftId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
}
@Controller()
@UseGuards(AccessGuard)
@Allow("audit.read")
export class ReportsController {
  constructor(private db: Database) {}
  @Get("reports/sales") async salesSummary(@Query() q: Filters) {
    ensure(
      q.from &&
        q.to &&
        /^\d{4}-\d{2}-\d{2}$/.test(q.from) &&
        /^\d{4}-\d{2}-\d{2}$/.test(q.to),
      "Укажите даты начала и окончания периода",
    );
    const from = new Date(`${q.from}T00:00:00+05:00`);
    const end = new Date(`${q.to}T00:00:00+05:00`);
    ensure(from <= end, "Начало периода должно быть не позже окончания");
    const to = new Date(end.getTime() + 86400000);
    const lines = await this.db.shipmentLine.findMany({
      where: {
        shipment: {
          document: { status: "POSTED", occurredAt: { gte: from, lt: to } },
        },
      },
      select: {
        itemId: true,
        quantityKg: true,
        amount: true,
        item: { select: { name: true } },
        shipment: { select: { currency: true } },
      },
    });
    const groups = new Map<
      string,
      {
        itemId: string;
        name: string;
        currency: string;
        quantityKg: ReturnType<typeof decimal>;
        amount: ReturnType<typeof decimal>;
      }
    >();
    for (const line of lines) {
      const currency = line.shipment.currency;
      const key = `${line.itemId}:${currency}`;
      const row = groups.get(key) ?? {
        itemId: line.itemId,
        name: line.item.name,
        currency,
        quantityKg: decimal("0"),
        amount: decimal("0"),
      };
      row.quantityKg = row.quantityKg.plus(line.quantityKg);
      row.amount = row.amount.plus(line.amount);
      groups.set(key, row);
    }
    const rows = [...groups.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name, "ru") ||
        a.currency.localeCompare(b.currency),
    );
    return {
      from: q.from,
      to: q.to,
      rows: rows.map((r) => ({
        ...r,
        quantityKg: r.quantityKg.toString(),
        amount: r.amount.toString(),
      })),
      totalKg: rows
        .reduce((sum, r) => sum.plus(r.quantityKg), decimal("0"))
        .toString(),
      totals: ["USD", "UZS"].map((currency) => ({
        currency,
        amount: rows
          .filter((r) => r.currency === currency)
          .reduce((sum, r) => sum.plus(r.amount), decimal("0"))
          .toString(),
      })),
    };
  }
  @Get("reports") async reports(@Query() q: Filters) {
    const from = q.from
      ? new Date(q.from.length === 10 ? q.from + "T00:00:00+05:00" : q.from)
      : undefined;
    const to = q.to
      ? new Date(q.to.length === 10 ? q.to + "T00:00:00+05:00" : q.to)
      : undefined;
    ensure(
      !from || !to || from < to,
      "Начало периода должно быть раньше конца; конец периода не включается",
    );
    const period = { gte: from, lt: to };
    return this.db.$transaction(
      async (tx) => {
        const purchases = await tx.purchaseReceipt.findMany({
          where: {
            postedAt: period,
            supplierId: q.supplierId,
            lines: {
              some: {
                lot: { stockLot: { originDocument: { status: "POSTED" } } },
              },
            },
          },
          include: { supplier: true, lines: { include: { material: true } } },
        });
        const batches = await tx.productionBatch.findMany({
          where: {
            ...((!q.from || q.from.length === 10) &&
            (!q.to || q.to.length === 10)
              ? { shift: { businessDate: { gte: q.from, lt: q.to } } }
              : { completedAt: period }),
            status: "COMPLETED",
            equipmentId: q.equipmentId,
            shiftId: q.shiftId,
          },
          include: {
            equipment: true,
            shift: true,
            nextBatch: { select: { id: true } },
            inputs: { include: { lot: { include: { originDocument: true } } } },
            outputs: { include: { lot: { include: { item: true } } } },
          },
        });
        const stock = await tx.inventoryBalance.findMany({
          where: { onHandKg: { gt: 0 } },
          include: { location: true, lot: { include: { item: true } } },
        });
        const movements = await tx.stockMovement.findMany({
          where: { postedAt: period },
          include: {
            lot: { include: { item: true } },
            location: true,
            document: true,
          },
          orderBy: { postedAt: "desc" },
        });
        const shipments = await tx.shipment.findMany({
          where: {
            customerId: q.customerId,
            document: { occurredAt: period, status: "POSTED" },
          },
          include: {
            customer: true,
            lines: { include: { item: true } },
            document: true,
          },
        });
        const contracts = await tx.contract.findMany({
          where: { customerId: q.customerId },
          include: {
            customer: true,
            lines: {
              include: {
                item: true,
                shipmentLines: {
                  where: { shipment: { document: { status: "POSTED" } } },
                },
              },
            },
            shipments: { where: { document: { status: "POSTED" } } },
          },
        });
        const includedBatches = new Set(batches.map((b) => b.id));
        const input = batches.reduce(
          (a, b) =>
            b.inputs.reduce(
              (v, l) =>
                l.lot.isCarryover &&
                includedBatches.has(l.lot.originDocument.batchId ?? "")
                  ? v
                  : v.plus(l.quantityKg),
              a,
            ),
          decimal("0"),
        );
        const waste = new Map<
          string,
          { id: string; name: string; quantityKg: string }
        >();
        let product = decimal("0");
        let wasteTotal = decimal("0");
        for (const b of batches)
          for (const o of b.outputs) {
            if (o.lot.item.kind === "WASTE") {
              wasteTotal = wasteTotal.plus(o.quantityKg);
              const old = waste.get(o.lot.itemId);
              waste.set(o.lot.itemId, {
                id: o.lot.itemId,
                name: o.lot.item.name,
                quantityKg: decimal(old?.quantityKg ?? "0")
                  .plus(o.quantityKg)
                  .toString(),
              });
            } else product = product.plus(o.quantityKg);
          }
        const purchaseAmounts = ["UZS", "USD"].map((currency) => ({
          currency,
          amount: purchases
            .filter((p) => p.currency === currency)
            .reduce(
              (a, p) => p.lines.reduce((v, l) => v.plus(l.amount), a),
              decimal("0"),
            )
            .toString(),
        }));
        const saleAmounts = ["UZS", "USD"].map((currency) => ({
          currency,
          amount: shipments
            .filter((p) => p.currency === currency)
            .reduce(
              (a, p) => p.lines.reduce((v, l) => v.plus(l.amount), a),
              decimal("0"),
            )
            .toString(),
        }));
        return {
          generatedAt: new Date().toISOString(),
          timezone: "Asia/Tashkent",
          period: { from: from?.toISOString(), toExclusive: to?.toISOString() },
          purchases,
          purchaseAmounts,
          stock,
          stockAsOf: "current",
          movements,
          production: {
            inputKg: input.toString(),
            carryoverKg: batches
              .reduce(
                (sum, b) =>
                  b.nextBatch && includedBatches.has(b.nextBatch.id)
                    ? sum
                    : sum.plus(b.carryoverKg),
                decimal("0"),
              )
              .toString(),
            productKg: product.toString(),
            wasteKg: wasteTotal.toString(),
            lossKg: batches
              .reduce((sum, b) => sum.plus(b.differenceKg ?? 0), decimal("0"))
              .toString(),
            lossPercent: input.isZero()
              ? null
              : batches
                  .reduce(
                    (sum, b) => sum.plus(b.differenceKg ?? 0),
                    decimal("0"),
                  )
                  .div(input)
                  .times(100)
                  .toFixed(2),
            wastePercent: input.isZero()
              ? null
              : wasteTotal.div(input).times(100).toFixed(2),
            wasteBreakdown: [...waste.values()].map((w) => ({
              ...w,
              percentOfInput: input.isZero()
                ? null
                : decimal(w.quantityKg).div(input).times(100).toFixed(2),
            })),
            batches,
          },
          waste: {
            reusedKg: movements
              .filter(
                (m) =>
                  m.lot.item.kind === "WASTE" &&
                  m.type === "PRODUCTION_CONSUMPTION" &&
                  m.document.status === "POSTED",
              )
              .reduce((a, m) => a.minus(m.signedQuantityKg), decimal("0"))
              .toString(),
            soldKg: movements
              .filter(
                (m) =>
                  m.type === "WASTE_SALE" && m.document.status === "POSTED",
              )
              .reduce((a, m) => a.minus(m.signedQuantityKg), decimal("0"))
              .toString(),
            disposedKg: movements
              .filter(
                (m) =>
                  m.type === "WASTE_DISPOSAL" && m.document.status === "POSTED",
              )
              .reduce((a, m) => a.minus(m.signedQuantityKg), decimal("0"))
              .toString(),
          },
          shipments,
          saleAmounts,
          contracts: contracts.map((c) => ({
            ...c,
            departedTrucks: c.shipments.filter((s) => s.departedAt).length,
            lines: c.lines.map((l) => {
              const shipped = l.shipmentLines.reduce(
                (a, s) => a.plus(s.quantityKg),
                decimal("0"),
              );
              return {
                ...l,
                shippedKg: shipped.toString(),
                remainingKg: l.agreedQuantityKg.minus(shipped).toString(),
                completionPercent: shipped
                  .div(l.agreedQuantityKg)
                  .times(100)
                  .toFixed(2),
              };
            }),
          })),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 30000 },
    );
  }
  @Get("audit") audit(@Query() q: PageQuery) {
    return page(
      this.db.auditLog,
      {
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { recordedAt: "desc" },
        take: 200,
      },
      q,
    );
  }
  @Get("documents") documents(@Query() q: PageQuery) {
    return page(
      this.db.businessDocument,
      {
        include: {
          movements: {
            include: { lot: { include: { item: true } }, location: true },
          },
          command: { select: { actorId: true } },
          shipment: true,
        },
        orderBy: { postedAt: "desc" },
      },
      q,
    );
  }
  @Get("trace/:id") async trace(@Param("id", new ParseUUIDPipe()) id: string) {
    const visited = new Set<string>();
    const nodes: any[] = [];
    const edges: any[] = [];
    let queue = [id];
    while (queue.length) {
      const lotId = queue.shift()!;
      if (visited.has(lotId)) continue;
      ensure(visited.size < 1000, "Слишком длинная цепочка; уточните партию");
      visited.add(lotId);
      const lot = await this.db.stockLot.findUniqueOrThrow({
        where: { id: lotId },
        include: {
          item: true,
          purchaseLot: {
            include: {
              line: { include: { receipt: { include: { supplier: true } } } },
            },
          },
          originDocument: { include: { transformationInputs: true } },
          balances: { include: { location: true } },
          allocations: {
            include: {
              shipmentLine: {
                include: {
                  shipment: { include: { customer: true, document: true } },
                },
              },
            },
          },
        },
      });
      nodes.push(lot);
      for (const input of lot.originDocument.transformationInputs) {
        edges.push({
          source: input.lotId,
          target: lot.id,
          documentId: lot.originDocumentId,
          inputKg: input.quantityKg.toString(),
        });
        queue.push(input.lotId);
      }
    }
    return {
      root: id,
      nodes,
      edges,
      note: "Связи показывают состав исходной плавки. Масса отдельного компонента не распределяется между продуктами произвольно.",
    };
  }
}
