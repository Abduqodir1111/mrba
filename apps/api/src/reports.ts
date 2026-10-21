import { Costing, addCosts, scaleCost } from "./costing";
import { effectivePurchase, revisionInclude } from "./purchase-values";
import { page, PageQuery } from "./pagination";
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";
import { Database } from "./db";
import { AccessGuard, Allow } from "./identity";
import { decimal, ensure } from "./factory";
class Filters {
  @IsOptional() @IsIn(["true", "false"]) currentPeriod?: string;
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
  @Get("reports/production-period") async productionPeriod(@Query() q: Filters) {
    ensure(q.from && q.to, "Выберите начало и конец периода");
    const from = new Date(q.from.length === 10 ? `${q.from}T00:00:00+05:00` : q.from);
    const to = new Date(q.to.length === 10 ? `${q.to}T00:00:00+05:00` : q.to);
    ensure(Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from < to, "Укажите корректный период; конец периода не включается");
    return this.db.$transaction(async tx => {
      const batches = await tx.productionBatch.findMany({
        where: { status: "COMPLETED", completedAt: { gte: from, lt: to }, equipmentId: q.equipmentId, documents: { some: { type: "PRODUCTION_COMPLETE", status: "POSTED" } } },
        include: {
          nextBatch: { select: { id: true } },
          inputs: { include: { lot: { include: { item: true, originDocument: true } } } },
          outputs: { include: { lot: { include: { item: true } } } },
          documents: { where: { type: "PRODUCTION_COMPLETE", status: "POSTED" }, include: { kettleRecoveries: { where: { status: "POSTED" } } } },
        },
      });
      const included = new Set(batches.map(batch => batch.id));
      const costing = new Costing(tx);
      const externalInputs = batches.flatMap(batch => batch.inputs).filter(input => !((input.lot.isCarryover || input.lot.item.kind === "WASTE") && included.has(input.lot.originDocument.batchId ?? "")));
      const inputKg = externalInputs.reduce((sum, input) => sum.plus(input.quantityKg), decimal("0"));
      const incomingCarryoverKg = externalInputs.filter(input => input.lot.isCarryover).reduce((sum, input) => sum.plus(input.quantityKg), decimal("0"));
      const grossLoadedKg = batches.flatMap(batch => batch.inputs).reduce((sum, input) => sum.plus(input.quantityKg), decimal("0"));
      const inputCost = await costing.total(externalInputs);
      const products = new Map<string, { id: string; name: string; quantityKg: ReturnType<typeof decimal>; values: ReturnType<typeof scaleCost>[] }>();
      const wastes = new Map<string, { id: string; name: string; quantityKg: ReturnType<typeof decimal> }>();
      const carryValues: ReturnType<typeof scaleCost>[] = [];
      let carryoverKg = decimal("0"), recoveryDifferenceKg = decimal("0");
      for (const batch of batches) {
        for (const output of batch.outputs) {
          if (output.lot.item.kind === "PRODUCT") {
            const row = products.get(output.lot.itemId) ?? { id: output.lot.itemId, name: output.lot.item.name, quantityKg: decimal("0"), values: [] };
            row.quantityKg = row.quantityKg.plus(output.quantityKg);
            row.values.push(scaleCost(await costing.unit(output.lotId), output.quantityKg));
            products.set(row.id, row);
          } else if (output.lot.item.kind === "WASTE") {
            const row = wastes.get(output.lot.itemId) ?? { id: output.lot.itemId, name: output.lot.item.name, quantityKg: decimal("0") };
            row.quantityKg = row.quantityKg.plus(output.quantityKg);
            wastes.set(row.id, row);
          }
        }
        const completion = batch.documents[0];
        const difference = (completion?.kettleRecoveries ?? []).reduce((sum, doc) => sum.plus(doc.differenceKg ?? 0), decimal("0"));
        recoveryDifferenceKg = recoveryDifferenceKg.plus(difference);
        if (batch.nextBatch && included.has(batch.nextBatch.id)) continue;
        const quantity = batch.carryoverKg.plus(difference);
        carryoverKg = carryoverKg.plus(quantity);
        if (quantity.gt(0) && completion) {
          const carry = await tx.stockLot.findFirst({ where: { originDocumentId: completion.id, isCarryover: true } });
          carryValues.push(carry ? scaleCost(await costing.unit(carry.id), quantity) : { known: false, amounts: {} });
        }
      }
      const productKg = [...products.values()].reduce((sum, row) => sum.plus(row.quantityKg), decimal("0"));
      const productCost = addCosts([...products.values()].flatMap(row => row.values));
      const wasteKg = [...wastes.values()].reduce((sum, row) => sum.plus(row.quantityKg), decimal("0"));
      const reusedWasteKg = batches.flatMap(batch => batch.inputs).filter(input => input.lot.item.kind === "WASTE" && included.has(input.lot.originDocument.batchId ?? "")).reduce((sum, input) => sum.plus(input.quantityKg), decimal("0"));
      const lossKg = batches.reduce((sum, batch) => sum.plus(batch.differenceKg ?? 0), decimal("0"));
      const percent = (weight: ReturnType<typeof decimal>) => inputKg.gt(0) ? weight.div(inputKg).times(100).toString() : null;
      const average = (value: ReturnType<typeof addCosts>, quantity: ReturnType<typeof decimal>) => quantity.gt(0) ? scaleCost(value, decimal("1").div(quantity)) : null;
      return {
        from: from.toISOString(), toExclusive: to.toISOString(), timezone: "Asia/Tashkent", batchCount: batches.length,
        inputKg: inputKg.toString(), freshInputKg: inputKg.minus(incomingCarryoverKg).toString(), incomingCarryoverKg: incomingCarryoverKg.toString(), grossLoadedKg: grossLoadedKg.toString(),
        productKg: productKg.toString(), wasteKg: wasteKg.toString(), reusedWasteKg: reusedWasteKg.toString(), netWasteKg: wasteKg.minus(reusedWasteKg).toString(),
        wastePercent: percent(wasteKg), lossKg: lossKg.toString(), lossPercent: percent(lossKg), carryoverKg: carryoverKg.toString(), recoveryDifferenceKg: recoveryDifferenceKg.toString(),
        inputCost, productCost, averageUnitCost: average(productCost, productKg), carryoverCost: addCosts(carryValues),
        products: [...products.values()].map(row => { const cost = addCosts(row.values); return { id: row.id, name: row.name, quantityKg: row.quantityKg.toString(), cost, unitCost: average(cost, row.quantityKg) }; }),
        wastes: [...wastes.values()].map(row => ({ ...row, quantityKg: row.quantityKg.toString() })),
      };
    }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  }
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
    const lastClose = q.currentPeriod === "true" ? await this.db.monthClose.findFirst({ orderBy: { number: "desc" }, select: { id: true } }) : null;
    const lines = await this.db.shipmentLine.findMany({
      where: {
        shipment: {
          document: { status: "POSTED", occurredAt: { gte: from, lt: to }, ...(lastClose ? { command: { reportingPeriodId: lastClose.id } } : {}) },
        },
      },
      orderBy: [{ shipment: { document: { occurredAt: "desc" } } }, { shipmentId: "desc" }, { id: "asc" }],
      select: {
        id: true,
        itemId: true,
        unitPricePerKg: true,
        quantityKg: true,
        amount: true,
        item: { select: { name: true } },
        shipment: { select: { id: true, currency: true, customer: { select: { id: true, name: true } }, document: { select: { occurredAt: true } } } },
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
    const sales = new Map<string, { id: string; customerId: string; customerName: string; occurredAt: string; currency: string; quantityKg: string; amount: string; lines: { id: string; itemId: string; name: string; quantityKg: string; unitPricePerKg: string; amount: string }[] }>();
    for (const line of lines) {
      const sale = sales.get(line.shipment.id) ?? { id: line.shipment.id, customerId: line.shipment.customer.id, customerName: line.shipment.customer.name, occurredAt: line.shipment.document.occurredAt.toISOString(), currency: line.shipment.currency, quantityKg: "0", amount: "0", lines: [] };
      sale.quantityKg = decimal(sale.quantityKg).plus(line.quantityKg).toString();
      sale.amount = decimal(sale.amount).plus(line.amount).toString();
      sale.lines.push({ id: line.id, itemId: line.itemId, name: line.item.name, quantityKg: line.quantityKg.toString(), unitPricePerKg: line.unitPricePerKg.toString(), amount: line.amount.toString() });
      sales.set(sale.id, sale);
    }
    return {
      sales: [...sales.values()],
      from: q.from,
      to: q.to,
      rows: rows.map((r) => ({
        ...r,
        quantityKg: r.quantityKg.toString(),
        averageUnitPrice: r.quantityKg.gt(0) ? r.amount.div(r.quantityKg).toString() : null,
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
        const closedPeriod = !q.from && !q.to ? await tx.monthClose.findFirst({ orderBy: { number: "desc" }, select: { id: true, to: true } }) : null;
        const command = closedPeriod ? { reportingPeriodId: closedPeriod.id } : undefined;
        const purchaseRows = await tx.purchaseReceipt.findMany({
          where: {
            postedAt: period,
            supplierId: q.supplierId,
            lines: {
              some: {
                lot: { stockLot: { originDocument: { status: "POSTED", command } } },
              },
            },
          },
          include: { supplier: true, lines: { include: { material: true, revisions: revisionInclude } } },
        });
        const purchases = purchaseRows.map(r => ({ ...r, lines: r.lines.map(l => { const effective = effectivePurchase(l); return { ...effective, currency: effective.currency ?? r.currency }; }) }));
        const batches = await tx.productionBatch.findMany({
          where: {
            ...((!q.from || q.from.length === 10) &&
            (!q.to || q.to.length === 10)
              ? { shift: { businessDate: { gte: q.from, lt: q.to } } }
              : { completedAt: period }),
            ...(command ? { documents: { some: { type: "PRODUCTION_COMPLETE", status: "POSTED", command } } } : {}),
            status: "COMPLETED",
            equipmentId: q.equipmentId,
            shiftId: q.shiftId,
          },
          include: {
            documents: { where: { type: "PRODUCTION_COMPLETE", status: "POSTED" }, include: { kettleRecoveries: { where: { status: "POSTED" } } } },
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
          where: { postedAt: period, document: command ? { command } : undefined },
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
            document: { occurredAt: period, status: "POSTED", command },
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
          amount: purchases.flatMap(p => p.lines).filter(l => l.currency === currency).reduce((a,l) => a.plus(l.amount), decimal("0"))
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
          period: { from: from?.toISOString() ?? closedPeriod?.to.toISOString(), toExclusive: to?.toISOString(), current: !q.from && !q.to },
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
                    : sum.plus(b.carryoverKg).plus(b.documents.flatMap(d => d.kettleRecoveries).reduce((a, r) => a.plus(r.differenceKg ?? 0), decimal("0"))),
                decimal("0"),
              )
              .toString(),
            recoveryDifferenceKg: batches.flatMap(b => b.documents.flatMap(d => d.kettleRecoveries)).reduce((a, r) => a.plus(r.differenceKg ?? 0), decimal("0")).toString(),
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
