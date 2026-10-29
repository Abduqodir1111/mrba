import { effectivePurchase, revisionInclude } from "./purchase-values";
import { Prisma } from "@prisma/client";

export type Costs = Record<string, string>;
export type Valuation = { known: boolean; amounts: Costs };
const zero = (): Valuation => ({ known: true, amounts: {} });
export function scaleCost(
  value: Valuation,
  quantity: Prisma.Decimal.Value,
): Valuation {
  return {
    known: value.known,
    amounts: Object.fromEntries(
      Object.entries(value.amounts).map(([currency, amount]) => [
        currency,
        new Prisma.Decimal(amount).times(quantity).toString(),
      ]),
    ),
  };
}
export function addCosts(values: Valuation[]): Valuation {
  const amounts: Costs = {};
  for (const value of values)
    for (const [currency, amount] of Object.entries(value.amounts))
      amounts[currency] = new Prisma.Decimal(amounts[currency] ?? 0)
        .plus(amount)
        .toString();
  return { known: values.every((v) => v.known), amounts };
}

// Period display metric; does not revalue individual batches or stock lots.
export function productionPeriodAverage(value: Valuation, productKg: Prisma.Decimal.Value, carryoverKg: Prisma.Decimal.Value): Valuation | null {
  const weight = new Prisma.Decimal(productKg).plus(carryoverKg);
  return weight.gt(0) ? scaleCost(value, new Prisma.Decimal(1).div(weight)) : null;
}

// Original receipts, revisions and transformation edges are immutable. Derive
// current valuation from the latest revision, including downstream production.
// Never combine currencies or treat an unpriced receipt as a known zero cost.
export class Costing {
  private lots = new Map<string, Valuation>();
  private documents = new Map<string, Valuation>();
  constructor(private db: Prisma.TransactionClient) {}
  async unit(lotId: string, path = new Set<string>()): Promise<Valuation> {
    if (path.has(lotId)) return { known: false, amounts: {} };
    const cached = this.lots.get(lotId);
    if (cached) return cached;
    const lot = await this.db.stockLot.findUnique({
      where: { id: lotId },
      include: {
        item: true,
        purchaseLot: { include: { line: { include: { receipt: true, revisions: revisionInclude } } } },
        originDocument: true,
      },
    });
    let result: Valuation = { known: false, amounts: {} };
    if (lot && ["MONTH_OPENING", "WASTE_INTAKE"].includes(lot.originDocument.type) && lot.openingUnitCost) {
      result = lot.openingUnitCost as unknown as Valuation;
    } else if (lot?.purchaseLot) {
      const line = effectivePurchase(lot.purchaseLot.line);
      if (line.quantityKg.gt(0))
        result = {
          known: line.priceKnown,
          amounts: {
            [line.currency ?? line.receipt.currency]: line.amount
              .div(line.quantityKg)
              .toString(),
          },
        };
    } else if (
      lot &&
      ["PRODUCTION_COMPLETE", "WASTE_RECOVERY", "KETTLE_RECOVERY"].includes(
        lot.originDocument.type,
      )
    ) {
      // The customer allocates the full melt cost to products + kettle carryover.
      // Waste carries zero cost, preventing double counting when it is reused.
      if (
        lot.originDocument.type === "PRODUCTION_COMPLETE" &&
        lot.item.kind === "WASTE"
      )
        result = zero();
      else {
        const nextPath = new Set(path).add(lotId);
        // A weighed carryover recovery shares the ORIGINAL melt's revised unit
        // cost. Scaling the old carryover value alone would leave product costs wrong.
        result = await this.documentUnit(lot.originDocument.recoverySourceId ?? lot.originDocumentId, nextPath);
      }
    }
    this.lots.set(lotId, result);
    return result;
  }
  async documentUnit(
    id: string,
    path: Set<string> = new Set(),
  ): Promise<Valuation> {
    const cached = this.documents.get(id);
    if (cached) return cached;
    const doc = await this.db.businessDocument.findUniqueOrThrow({
      where: { id },
      include: {
        transformationInputs: true,
        kettleRecoveries: { where: { status: "POSTED", type: "KETTLE_RECOVERY" } },
        transformationOutputs: {
          include: { lot: { include: { item: true } } },
        },
      },
    });
    // Keep historical quantities immutable; a posted recovery replaces only the
    // expected carryover weight in this melt's useful-weight denominator.
    const weight = doc.transformationOutputs
      .filter(
        (o) =>
          doc.type !== "PRODUCTION_COMPLETE" ||
          o.lot.isCarryover ||
          o.lot.item.kind === "PRODUCT",
      )
      .reduce((a, o) => a.plus(o.quantityKg), new Prisma.Decimal(0))
      .plus(doc.kettleRecoveries.reduce((a, r) => a.plus(r.differenceKg ?? 0), new Prisma.Decimal(0)));
    const inputs: Valuation[] = [];
    for (const input of doc.transformationInputs)
      inputs.push(
        scaleCost(await this.unit(input.lotId, path), input.quantityKg),
      );
    const total = addCosts(inputs);
    const result =
      weight.gt(0) && inputs.length
        ? {
            known: total.known,
            amounts: Object.fromEntries(
              Object.entries(total.amounts).map(([c, a]) => [
                c,
                new Prisma.Decimal(a).div(weight).toString(),
              ]),
            ),
          }
        : { known: false, amounts: {} };
    this.documents.set(id, result);
    return result;
  }
  async total(
    rows: { lotId: string; quantityKg: Prisma.Decimal.Value }[],
  ): Promise<Valuation> {
    const values: Valuation[] = [];
    for (const row of rows)
      values.push(scaleCost(await this.unit(row.lotId), row.quantityKg));
    return addCosts(values);
  }
}
