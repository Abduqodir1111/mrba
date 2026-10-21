import { test } from "node:test";
import assert from "node:assert/strict";
import { saleReportRows } from "../apps/mobile/src/sales-report-data.ts";

const sale = (id, weight, price, overrides = {}) => ({
  id, customerId: "customer-1", customerName: "Алишер", occurredAt: "2026-10-22T10:00:00Z",
  currency: "USD", quantityKg: weight, amount: String(Number(weight) * Number(price)),
  lines: [{ id: `line-${id}`, itemId: "brass", name: "Латунь 60 %", quantityKg: weight, unitPricePerKg: price, amount: String(Number(weight) * Number(price)) }],
  ...overrides,
});

test("individual report keeps repeated sales and their original prices separate", () => {
  const rows = saleReportRows([sale("a", "3000", "8"), sale("b", "2000", "10")], false);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.count, row.quantityKg, row.unitPrice, row.amount]), [[1, "3000", "8", "24000"], [1, "2000", "10", "20000"]]);
});

test("period report combines repeat sales with a weight-based price", () => {
  const [row] = saleReportRows([sale("a", "3000", "8"), sale("b", "2000", "10")], true);
  assert.equal(row.count, 2);
  assert.equal(row.quantityKg, "5000");
  assert.equal(row.amount, "44000");
  assert.equal(row.unitPrice, "8.8");
  assert.equal(row.entries.length, 2);
});

test("different customers, products and currencies never merge", () => {
  const first = sale("a", "1", "8");
  const rows = saleReportRows([first, sale("b", "2", "10", { currency: "UZS" }), sale("c", "1", "8", { customerId: "another-customer" }), sale("d", "1", "8", { lines: [{ ...first.lines[0], id: "other", itemId: "copper" }] })], true);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.count === 1));
});

test("multiple lines of a document count as one sale and decimal weights stay exact", () => {
  const first = sale("a", "0.1", "3");
  first.lines[0].amount = "0.3";
  first.lines.push({ ...first.lines[0], id: "second-line", quantityKg: "0.2", amount: "0.6" });
  const [row] = saleReportRows([first], true);
  assert.equal(row.count, 1);
  assert.equal(row.quantityKg, "0.3");
  assert.equal(row.amount, "0.9");
  assert.equal(row.unitPrice, "3");
  assert.equal(saleReportRows([], true).length, 0);
});
