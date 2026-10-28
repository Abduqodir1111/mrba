import test from "node:test";
import assert from "node:assert/strict";
import { loadKettleReports } from "../apps/mobile/src/production-period-data.ts";

test("period reports request each kettle separately and preserve its returned figures", async () => {
  const equipment = [{ id: "copper", name: "Медный котёл" }, { id: "brass", name: "Латунный котёл" }];
  const copper = { batchCount: 2, productKg: "1000.5", averageUnitCost: { amounts: { UZS: "120000" } } };
  const brass = { batchCount: 3, productKg: "8000", averageUnitCost: { amounts: { UZS: "70000" } } };
  const calls = [];
  const result = await loadKettleReports(equipment, "from=2026-09-30T19%3A00%3A00.000Z&to=2026-10-28T19%3A00%3A00.000Z", async path => {
    const url = new URL(path, "https://example.test");
    assert.equal(url.searchParams.get("from"), "2026-09-30T19:00:00.000Z");
    assert.equal(url.searchParams.get("to"), "2026-10-28T19:00:00.000Z");
    calls.push(url.searchParams.get("equipmentId"));
    return url.searchParams.get("equipmentId") === "copper" ? copper : brass;
  });
  assert.deepEqual(calls.sort(), ["brass", "copper"]);
  assert.strictEqual(result.find(r => r.equipment.id === "copper").report, copper);
  assert.strictEqual(result.find(r => r.equipment.id === "brass").report, brass);
  assert.deepEqual(equipment.map(e => e.id), ["copper", "brass"]);
});

test("inactive kettles with completed melts remain reportable, empty kettles are omitted", async () => {
  const result = await loadKettleReports([{ id: "old", name: "Старый котёл", isActive: false }, { id: "new", name: "Новый котёл" }], "from=a&to=b", async path => ({ batchCount: path.includes("equipmentId=old") ? 1 : 0 }));
  assert.deepEqual(result.map(r => r.equipment.id), ["old"]);
  assert.deepEqual(await loadKettleReports([], "from=a&to=b", async () => { throw Error("Unexpected request"); }), []);
});

test("failed kettle report rejects the result instead of presenting a partial total", async () => {
  await assert.rejects(loadKettleReports([{ id: "broken", name: "Котёл" }], "from=a&to=b", async () => { throw Error("Server unavailable"); }), /Server unavailable/);
});
