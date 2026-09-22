import { test } from "node:test";
import assert from "node:assert/strict";
import { toKg, currentShift } from "./index";
test("tonnes and kilograms preserve exact mass", () => {
  assert.equal(toKg("1.234", "t"), "1234");
  assert.equal(toKg("1234", "kg"), "1234");
  for (const value of [
    "0",
    "-1",
    "Infinity",
    "1e3",
    "0.0001",
    "1.5",
    "1234.567",
  ])
    assert.throws(() => toKg(value, "kg"));
});
test("Tashkent shifts at midnight and exact boundaries", () => {
  assert.equal(currentShift(new Date("2026-09-21T02:59:59Z")).code, "NIGHT");
  assert.equal(currentShift(new Date("2026-09-21T03:00:00Z")).code, "DAY");
  assert.equal(currentShift(new Date("2026-09-21T15:00:00Z")).code, "NIGHT");
  const night = currentShift(new Date("2026-09-21T21:00:00Z"));
  assert.equal(night.businessDate, "2026-09-21");
  assert.equal(
    currentShift(new Date("2026-01-01T02:00:00Z")).businessDate,
    "2025-12-31",
  );
  assert.throws(() => toKg("1.2345", "t"));
  assert.equal(night.startsAt, "2026-09-21T15:00:00.000Z");
  assert.equal(night.endsAt, "2026-09-22T03:00:00.000Z");
});
