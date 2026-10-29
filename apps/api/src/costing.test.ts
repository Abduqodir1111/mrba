import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { Costing, scaleCost, addCosts, productionPeriodAverage } from "./costing";

test("client example allocates 392720007.60 to 15000 kg product and 1300 kg recovered metal", async () => {
  const cost = new Prisma.Decimal("392720007.60");
  const db = { businessDocument: { findUniqueOrThrow: async () => ({
    type: "PRODUCTION_COMPLETE",
    transformationInputs: [{ lotId: "raw", quantityKg: new Prisma.Decimal("18003") }],
    transformationOutputs: [
      { quantityKg: new Prisma.Decimal("15000"), lot: { isCarryover: false, item: { kind: "PRODUCT" } } },
      { quantityKg: new Prisma.Decimal("1600"), lot: { isCarryover: false, item: { kind: "WASTE" } } },
      { quantityKg: new Prisma.Decimal("1403"), lot: { isCarryover: true, item: { kind: "PRODUCT" } } },
    ],
    kettleRecoveries: [{ differenceKg: new Prisma.Decimal("-103") }],
  }) } } as unknown as Prisma.TransactionClient;
  class PricedInputs extends Costing {
    override async unit() { return { known: true, amounts: { UZS: cost.div("18003").toString() } }; }
  }
  const unit = await new PricedInputs(db).documentUnit("original");
  assert.equal(new Prisma.Decimal(unit.amounts.UZS).toFixed(6), "24093.252000");
  const product = scaleCost(unit, "15000");
  const returned = scaleCost(unit, "1300");
  assert.equal(new Prisma.Decimal(product.amounts.UZS).toFixed(2), "361398780.00");
  assert.equal(new Prisma.Decimal(returned.amounts.UZS).toFixed(2), "31321227.60");
  assert.equal(new Prisma.Decimal(addCosts([product, returned]).amounts.UZS).toFixed(2), cost.toFixed(2));
});


test("period average includes the closing carryover: client October example", () => {
  const result = productionPeriodAverage({ known: true, amounts: { UZS: "3165947327.57" } }, "33000", "1383");
  assert.equal(new Prisma.Decimal(result!.amounts.UZS).toFixed(2), "92078.86");
});

test("period average handles decimal weights, carryover-only and zero output", () => {
  const value = { known: true, amounts: { UZS: "1000", USD: "20" } };
  assert.deepEqual(productionPeriodAverage(value, "2.5", "7.5"), { known: true, amounts: { UZS: "100", USD: "2" } });
  assert.deepEqual(productionPeriodAverage(value, "0", "10"), { known: true, amounts: { UZS: "100", USD: "2" } });
  assert.equal(productionPeriodAverage(value, "0", "0"), null);
  assert.deepEqual(productionPeriodAverage({ ...value, known: false }, "10", "0"), { known: false, amounts: { UZS: "100", USD: "2" } });
});
