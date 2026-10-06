import test from "node:test";
import assert from "node:assert/strict";
import { receiptSummary } from "../apps/mobile/src/receipt-preview.ts";

const line = (values = {}) => ({
  materialId: "copper", material: { name: "Кизил" }, status: "POSTED", currency: "UZS",
  grossKg: "10000", returnedKg: "500", discountKg: "300", discountPercent: "10",
  percentDiscountKg: "920", priceKnown: true, amount: "496800000", ...values,
});

test("receipt summary preserves manual and percentage discounts without subtracting them from physical receipts", () => {
  const [group] = receiptSummary([line()]);
  assert.equal(group.total.toString(), "9500");
  assert.equal(group.payable.toString(), "8280");
  assert.equal(group.manual.plus(group.percent).toString(), "1220");
  assert.equal(group.amount.div(group.pricedKg).toString(), "60000");
});

test("summary separates currencies, excludes cancelled receipts and counts missing prices", () => {
  const groups = receiptSummary([
    line(), line({ status: "REVERSED" }),
    line({ priceKnown: false, amount: "0" }),
    line({ currency: "USD", amount: "8280" }),
  ]);
  assert.equal(groups.length, 2);
  const uzs = groups.find(group => group.currency === "UZS");
  assert.equal(uzs.count, 2);
  assert.equal(uzs.unpriced, 1);
  assert.equal(uzs.amount.toString(), "496800000");
  assert.equal(uzs.total.toString(), "19000");
});

test("weighted price uses payable kilograms and keeps different percentages distinct", () => {
  const [group] = receiptSummary([line(), line({
    grossKg: "1000", returnedKg: "0", discountKg: "0", discountPercent: "0",
    percentDiscountKg: "0", amount: "100000000",
  })]);
  assert.equal(group.pricedKg.toString(), "9280");
  assert.equal(group.amount.div(group.pricedKg).toDecimalPlaces(2).toString(), "64310.34");
  assert.equal(group.percentages.size, 2);
});

test("client example uses weighted payable price, not average of purchase prices", () => {
  const [group] = receiptSummary([
    line({grossKg:"3000",returnedKg:"0",discountKg:"0",percentDiscountKg:"0",discountPercent:"0",amount:"60000000"}),
    line({grossKg:"2000",returnedKg:"0",discountKg:"0",percentDiscountKg:"0",discountPercent:"0",amount:"42000000"}),
  ]);
  assert.equal(group.amount.toString(), "102000000");
  assert.equal(group.payable.toString(), "5000");
  assert.equal(group.amount.div(group.pricedKg).toString(), "20400");
});

test("fully discounted receipt has physical stock but no payable weight", () => {
  const [group] = receiptSummary([line({grossKg:"100",returnedKg:"0",discountKg:"100",percentDiscountKg:"0",discountPercent:"0",amount:"0"})]);
  assert.equal(group.total.toString(), "100");
  assert.equal(group.payable.toString(), "0");
  assert.equal(group.pricedKg.toString(), "0");
});
