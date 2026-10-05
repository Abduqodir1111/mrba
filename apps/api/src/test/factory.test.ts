import { Prisma } from "@prisma/client";
import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { createApp } from "../app";
import { Database } from "../db";
let app: INestApplication,
  db: Database,
  token: string,
  material: string,
  supplier: string,
  product: string,
  waste: string,
  equipment: string,
  location: string,
  salesLocation: string,
  lot: string,
  batch: any,
  customer: string,
  contract: string,
  productLot: string,
  wasteLot: string;
const suffix = randomUUID().slice(0, 8),
  epoch = process.env.RECOVERY_EPOCH!;
const rawPost = (path: string, body: any, id = randomUUID()) =>
  request(app.getHttpServer())
    .post("/api/v1" + path)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Recovery-Epoch", epoch)
    .set("Idempotency-Key", id)
    .send(body);
const post = (path: string, body: any, id = randomUUID(), status = 201) =>
  rawPost(path, body, id).expect(status);
before(async () => {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/mrba_test");
  app = await createApp();
  await app.init();
  db = app.get(Database);
  token = (
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        login: process.env.OWNER_LOGIN,
        password: process.env.OWNER_PASSWORD,
        deviceId: randomUUID(),
      })
      .expect(201)
  ).body.accessToken;
  supplier = (await post("/suppliers", { name: `F supplier ${suffix}` })).body
    .id;
  material = (await post("/materials", { name: `F copper ${suffix}` })).body.id;
  product = (
    await post("/items", { name: `F product ${suffix}`, kind: "PRODUCT" })
  ).body.id;
  waste = (await post("/items", { name: `F waste ${suffix}`, kind: "WASTE" }))
    .body.id;
  equipment = (
    await post("/equipment", {
      name: `F furnace ${suffix}`,
      direction: "COPPER",
    })
  ).body.id;
  const r = await post("/purchase-receipts", {
    supplierId: supplier,
    currency: "UZS",
    lines: [
      {
        materialId: material,
        quantity: "1000",
        unit: "kg",
        unitPricePerKg: "2",
      },
    ],
  });
  const l = await db.stockLot.findFirstOrThrow({
    where: { purchaseLot: { line: { receiptId: r.body.id } } },
    include: { balances: true },
  });
  lot = l.id;
  location = l.balances[0].locationId;
  salesLocation = (
    await db.stockLocation.findFirstOrThrow({
      where: { name: "Склад для продажи", kind: "STORAGE" },
    })
  ).id;
});
after(async () => {
  await app?.close();
});
test("shift closing blocks unfinished batches and reopening requires a reason; retries are idempotent", async () => {
  const shift = await db.shiftInstance.create({
    data: {
      businessDate: "2026-01-01",
      startsAt: new Date("2026-01-01T03:00:00Z"),
      endsAt: new Date("2026-01-01T15:00:00Z"),
      code: `TEST-${suffix}`,
      name: "Test shift lifecycle",
    },
  });
  const warehouse = await db.stockLocation.findUniqueOrThrow({
    where: { id: location },
  });
  const wip = await db.stockLocation.create({
    data: {
      warehouseId: warehouse.warehouseId,
      name: `Shift test ${suffix}`,
      kind: "WIP",
    },
  });
  const unfinished = await db.productionBatch.create({
    data: {
      number: `SHIFT-${suffix}`,
      equipmentId: equipment,
      shiftId: shift.id,
      wipLocationId: wip.id,
    },
  });
  const close = `/shifts/${shift.id}/close`;
  const reopen = `/shifts/${shift.id}/reopen`;
  const read = () =>
    db.shiftInstance.findUniqueOrThrow({ where: { id: shift.id } });
  await post(close, { version: 1 }, randomUUID(), 409);
  assert.equal((await read()).status, "OPEN");
  await post(`/batches/${unfinished.id}/cancel`, {
    reason: "Cancel test batch",
  });
  await post(close, { version: 999 }, randomUUID(), 409);
  const closeKey = randomUUID();
  await post(close, { version: 1 }, closeKey);
  await post(close, { version: 1 }, closeKey);
  assert.equal((await read()).status, "CLOSED");
  assert.equal((await read()).version, 2);
  await post(close, { version: 2 }, randomUUID(), 409);
  for (const body of [{}, { reason: "   " }]) {
    await post(reopen, body, randomUUID(), 400);
  }
  assert.equal((await read()).status, "CLOSED");
  const reopenKey = randomUUID();
  await post(reopen, { reason: "Correction required" }, reopenKey);
  await post(reopen, { reason: "Correction required" }, reopenKey);
  assert.equal((await read()).status, "OPEN");
  assert.equal((await read()).version, 3);
  await post(reopen, { reason: "Already open" }, randomUUID(), 409);
  await post(close, { version: 1 }, randomUUID(), 409);
  const results = await Promise.all([
    rawPost(close, { version: 3 }),
    rawPost(close, { version: 3 }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await read()).status, "CLOSED");
  assert.equal((await read()).version, 4);
});
test("integer kilogram validation accepts exact tonnes, rejects fractional kg", async () => {
  for (const [quantity, unit] of [
    ["1.001", "kg"],
    ["0.0001", "t"],
  ])
    await post(
      "/purchase-receipts",
      {
        supplierId: supplier,
        currency: "UZS",
        lines: [{ materialId: material, quantity, unit, unitPricePerKg: "1" }],
      },
      randomUUID(),
      409,
    );
});
test("reserved quantity cannot be issued; release restores availability", async () => {
  const r = await post("/inventory/reserve", {
    lotId: lot,
    locationId: location,
    quantityKg: "900",
    reason: "Test hold",
  });
  await post(
    "/inventory/return-supplier",
    {
      lotId: lot,
      locationId: location,
      supplierId: supplier,
      quantityKg: "101",
      reason: "Test",
    },
    randomUUID(),
    409,
  );
  await post(`/reservations/${r.body.id}/release`, { reason: "Release" });
});
test("parallel withdrawals cannot overspend a lot", async () => {
  const body = {
    lotId: lot,
    locationId: location,
    supplierId: supplier,
    quantityKg: "1000",
    reason: "Concurrency",
  };
  const responses = await Promise.all([
    rawPost("/inventory/return-supplier", body),
    rawPost("/inventory/return-supplier", body),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const b = await db.inventoryBalance.findUniqueOrThrow({
    where: { lotId_locationId: { lotId: lot, locationId: location } },
  });
  assert.equal(b.onHandKg.toString(), "0");
  await post("/inventory/adjust", {
    lotId: lot,
    locationId: location,
    countedKg: "1000",
    version: b.version,
    reason: "Test stock count",
  });
});
test("completion requires waste and exact balance; replay does not double output", async () => {
  batch = (await post("/batches", { equipmentId: equipment })).body;
  await post("/inventory/transfer", {
    lotId: lot,
    locationId: location,
    destinationId: batch.wipLocationId,
    quantityKg: "1000",
    reason: "Charge",
  });
  await post(
    `/batches/${batch.id}/complete`,
    {
      version: 1,
      locationId: location,
      outputs: [
        { itemId: product, quantityKg: "900" },
        { itemId: product, quantityKg: "100" },
      ],
    },
    randomUUID(),
    409,
  );
  await post(
    `/batches/${batch.id}/complete`,
    {
      version: 1,
      locationId: location,
      outputs: [
        { itemId: product, quantityKg: "900" },
        { itemId: waste, quantityKg: "101" },
      ],
    },
    randomUUID(),
    409,
  );
  const key = randomUUID();
  const body = {
    version: 1,
    locationId: location,
    outputs: [
      { itemId: product, quantityKg: "900" },
      { itemId: waste, quantityKg: "100" },
    ],
  };
  await Promise.all([
    post(`/batches/${batch.id}/complete`, body, key),
    post(`/batches/${batch.id}/complete`, body, key),
  ]);
  assert.equal(
    await db.productionOutput.count({ where: { batchId: batch.id } }),
    2,
  );
  assert.equal(await db.stockMovement.count({ where: { commandId: key } }), 3);
  productLot = (
    await db.stockLot.findFirstOrThrow({
      where: { originDocumentId: key, itemId: product },
    })
  ).id;
  wasteLot = (
    await db.stockLot.findFirstOrThrow({
      where: { originDocumentId: key, itemId: waste },
    })
  ).id;
  await post(`/batches/${batch.id}/complete`, body, randomUUID(), 409);
});
test("waste reuse retains lot origin and requires new accounted output", async () => {
  const second = (await post("/batches", { equipmentId: equipment })).body;
  await post("/inventory/transfer", {
    lotId: wasteLot,
    locationId: location,
    destinationId: second.wipLocationId,
    quantityKg: "40",
    reason: "Reuse waste",
  });
  await post(`/batches/${second.id}/complete`, {
    version: 1,
    locationId: location,
    outputs: [
      { itemId: product, quantityKg: "35" },
      { itemId: waste, quantityKg: "5" },
    ],
  });
  const input = await db.productionInput.findFirstOrThrow({
    where: { batchId: second.id },
  });
  assert.equal(input.lotId, wasteLot);
  assert.equal(input.quantityKg.toString(), "40");
});
test("contract limit and stock allocation are atomic across concurrent shipments", async () => {
  customer = (await post("/customers", { name: `F customer ${suffix}` })).body
    .id;
  contract = (
    await post("/contracts", {
      number: `C-${suffix}`,
      customerId: customer,
      currency: "USD",
      lines: [
        { itemId: product, agreedQuantityKg: "600", unitPricePerKg: "3.5" },
      ],
    })
  ).body.id;
  const body = {
    customerId: customer,
    contractId: contract,
    currency: "USD",
    kind: "PRODUCT",
    vehicleNumber: `TEST-${suffix}`,
    lines: [
      {
        itemId: product,
        allocations: [
          { lotId: productLot, locationId: salesLocation, quantityKg: "400" },
        ],
      },
    ],
  };
  const responses = await Promise.all([
    request(app.getHttpServer())
      .post("/api/v1/shipments")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Recovery-Epoch", epoch)
      .set("Idempotency-Key", randomUUID())
      .send(body),
    request(app.getHttpServer())
      .post("/api/v1/shipments")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Recovery-Epoch", epoch)
      .set("Idempotency-Key", randomUUID())
      .send(body),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await db.shipment.count({ where: { contractId: contract } }), 1);
  assert.equal(
    (
      await db.inventoryBalance.findUniqueOrThrow({
        where: {
          lotId_locationId: { lotId: productLot, locationId: salesLocation },
        },
      })
    ).onHandKg.toString(),
    "500",
  );
});
test("server draft and cancellation fence protect late requests", async () => {
  const id = randomUUID();
  await post(`/drafts/${id}`, {
    route: "/customers",
    payload: { name: `Draft ${suffix}` },
  });
  const draft = await request(app.getHttpServer())
    .get(`/api/v1/drafts/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  assert.equal(draft.body.payload.name, `Draft ${suffix}`);
  await post(`/drafts/${id}/cancel`, {});
  await post("/customers", draft.body.payload, id, 409);
  assert.equal(
    await db.customer.count({ where: { name: `Draft ${suffix}` } }),
    0,
  );
});
test("all balances reconcile after production, waste and shipment", async () => {
  const rows = await db.$queryRaw<
    any[]
  >`SELECT b."lotId" FROM "InventoryBalance" b LEFT JOIN "StockMovement" m ON b."lotId"=m."lotId" AND b."locationId"=m."locationId" GROUP BY b."lotId",b."locationId",b."onHandKg" HAVING b."onHandKg"<>COALESCE(SUM(m."signedQuantityKg"),0)`;
  assert.deepEqual(rows, []);
});
test("reports calculate cohort waste percentage, keep currencies separate and trace purchase origin", async () => {
  const r = await request(app.getHttpServer())
    .get(`/api/v1/reports?equipmentId=${equipment}`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  assert.equal(r.body.production.inputKg, "1040");
  assert.equal(r.body.production.wasteKg, "105");
  assert.equal(r.body.production.wastePercent, "10.10");
  assert.deepEqual(
    r.body.saleAmounts.map((x: any) => x.currency),
    ["UZS", "USD"],
  );
  const trace = await request(app.getHttpServer())
    .get(`/api/v1/trace/${productLot}`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  assert.ok(
    trace.body.nodes.some(
      (n: any) =>
        n.id === lot && n.purchaseLot.line.receipt.supplierId === supplier,
    ),
  );
});
test("keyset pages do not duplicate or silently discard records", async () => {
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const r: request.Response = await request(app.getHttpServer())
      .get("/api/v1/items?limit=100" + (cursor ? "&cursor=" + cursor : ""))
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    ids.push(...r.body.items.map((i: any) => i.id));
    cursor = r.body.nextCursor;
  } while (cursor);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.length, await db.item.count());
});
test("reversal restores stock and contract balance, departure prevents reversal", async () => {
  const sh = await db.shipment.findFirstOrThrow({
    where: { contractId: contract },
  });
  const key = randomUUID();
  await post(
    `/documents/${sh.documentId}/reverse`,
    { reason: "Wrong vehicle" },
    key,
  );
  await post(
    `/documents/${sh.documentId}/reverse`,
    { reason: "Wrong vehicle" },
    key,
  );
  assert.equal(
    (
      await db.inventoryBalance.findUniqueOrThrow({
        where: {
          lotId_locationId: { lotId: productLot, locationId: salesLocation },
        },
      })
    ).onHandKg.toString(),
    "900",
  );
  const ship = (
    await post("/shipments", {
      customerId: customer,
      contractId: contract,
      currency: "USD",
      kind: "PRODUCT",
      vehicleNumber: "TEST-DEPART",
      lines: [
        {
          itemId: product,
          allocations: [
            { lotId: productLot, locationId: salesLocation, quantityKg: "600" },
          ],
        },
      ],
    })
  ).body;
  await post(`/shipments/${ship.id}/depart`, { reason: "Gate confirmed" });
  await post(
    `/documents/${ship.id}/reverse`,
    { reason: "Cannot reverse departure" },
    randomUUID(),
    409,
  );
});
test("waste recovery conserves mass and reversal keeps immutable history", async () => {
  const result = (
    await post("/waste/recover", {
      lotId: wasteLot,
      locationId: location,
      quantityKg: "10",
      outputs: [
        { itemId: material, quantityKg: "8" },
        { itemId: waste, quantityKg: "2" },
      ],
      reason: "Separation",
    })
  ).body;
  assert.equal(
    await db.transformationOutput.count({ where: { documentId: result.id } }),
    2,
  );
  await post(`/documents/${result.id}/reverse`, { reason: "Test correction" });
  assert.equal(
    await db.transformationOutput.count({ where: { documentId: result.id } }),
    2,
  );
});
test("draft payload binding prevents changing an acknowledged command", async () => {
  const key = randomUUID();
  await post(`/drafts/${key}`, {
    route: "/customers",
    payload: { name: `Bound ${suffix}` },
  });
  await post("/customers", { name: `Changed ${suffix}` }, key, 409);
  await post("/customers", { name: `Bound ${suffix}` }, key);
  const r = await db.commandIntent.findUniqueOrThrow({ where: { id: key } });
  assert.equal(r.status, "POSTED");
});
test("catalog optimistic version rejects stale edits", async () => {
  const m = await db.material.findUniqueOrThrow({ where: { id: material } });
  await post(`/catalog/materials/${material}/edit`, {
    name: m.name,
    isActive: true,
    version: m.version,
    category: "Copper",
  });
  await post(
    `/catalog/materials/${material}/edit`,
    { name: "Stale edit", isActive: true, version: m.version },
    randomUUID(),
    409,
  );
  assert.equal(
    (await db.item.findUniqueOrThrow({ where: { id: material } })).name,
    m.name,
  );
});
test("editable server drafts use versions and freeze before execution", async () => {
  const key = randomUUID();
  const payload = { name: `Editable ${suffix}` };
  await post(`/drafts/${key}`, {
    route: "/customers",
    payload,
    status: "DRAFT",
  });
  await post("/customers", payload, key, 409);
  await post(`/drafts/${key}/edit`, {
    version: 1,
    payload: { name: `Edited ${suffix}` },
  });
  await post(`/drafts/${key}/edit`, { version: 1, payload }, randomUUID(), 409);
  await post(`/drafts/${key}/prepare`, { version: 2 });
  await post(`/drafts/${key}/edit`, { version: 3, payload }, randomUUID(), 409);
  await post("/customers", { name: `Edited ${suffix}` }, key);
  assert.equal(
    (await db.commandIntent.findUniqueOrThrow({ where: { id: key } })).status,
    "POSTED",
  );
});
test("class-level permissions deny factory writes without OWNER grants", async () => {
  const argon = await import("argon2");
  const login = `no-access-${suffix}`;
  const password = randomUUID() + randomUUID();
  const user = await db.user.create({
    data: {
      login,
      name: "Isolated permission test",
      passwordHash: await argon.hash(password),
    },
  });
  try {
    const auth = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ login, password, deviceId: randomUUID() })
      .expect(201);
    await request(app.getHttpServer())
      .get("/api/v1/stock")
      .set("Authorization", `Bearer ${auth.body.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/batches")
      .set("Authorization", `Bearer ${auth.body.accessToken}`)
      .set("Idempotency-Key", randomUUID())
      .set("X-Recovery-Epoch", epoch)
      .send({ equipmentId: equipment })
      .expect(403);
  } finally {
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
  }
});

test("waste disposition persists on create and audited edit", async () => {
  const created = (
    await post("/items", {
      name: `Disposition ${suffix}`,
      kind: "WASTE",
      wasteDisposition: "STORAGE",
    })
  ).body;
  assert.equal(created.wasteDisposition, "STORAGE");
  await post(`/catalog/items/${created.id}/edit`, {
    version: 1,
    name: created.name,
    isActive: true,
    wasteDisposition: "SALE",
  });
  const updated = await db.item.findUniqueOrThrow({
    where: { id: created.id },
  });
  assert.equal(updated.wasteDisposition, "SALE");
  assert.equal(updated.version, 2);
  await post(
    "/items",
    {
      name: `Invalid disposition ${suffix}`,
      kind: "WASTE",
      wasteDisposition: "OTHER",
    },
    randomUUID(),
    400,
  );
  await post(
    `/catalog/items/${product}/edit`,
    {
      version: 1,
      name: `F product ${suffix}`,
      isActive: true,
      wasteDisposition: "SALE",
    },
    randomUUID(),
    409,
  );
});

test("receipt without supplier creates stock and replays once", async () => {
  const id = randomUUID();
  const payload = {
    currency: "UZS",
    lines: [
      {
        materialId: material,
        quantity: "123",
        unit: "kg",
        unitPricePerKg: "2",
      },
    ],
  };
  const first = await post("/purchase-receipts", payload, id);
  const replay = await post("/purchase-receipts", payload, id);
  assert.equal(first.body.id, replay.body.id);
  const receipt = await db.purchaseReceipt.findUniqueOrThrow({
    where: { id: first.body.id },
  });
  assert.equal(receipt.supplierId, null);
  const stock = await db.stockLot.findMany({
    where: { originDocumentId: id },
    include: { balances: true },
  });
  assert.equal(stock.length, 1);
  assert.equal(stock[0].balances[0].onHandKg.toString(), "123");
});

test("new raw material is created atomically with receipt and reused", async () => {
  const name = `Inline raw ${suffix}`;
  const body = {
    currency: "UZS",
    lines: [
      { materialName: name, quantity: "20", unit: "kg", unitPricePerKg: "2" },
    ],
  };
  await post(
    "/purchase-receipts",
    { ...body, lines: [{ ...body.lines[0], unitPricePerKg: "0" }] },
    randomUUID(),
    409,
  );
  assert.equal(await db.material.count({ where: { name } }), 0);
  const id = randomUUID();
  await post("/purchase-receipts", body, id);
  await post("/purchase-receipts", body, id);
  await post("/purchase-receipts", body);
  assert.equal(await db.material.count({ where: { name } }), 1);
  const item = await db.item.findFirstOrThrow({
    where: { name, kind: "MATERIAL" },
  });
  assert.equal(await db.stockLot.count({ where: { itemId: item.id } }), 2);
});

test("loading a material combines receipts atomically and preserves remaining stock", async () => {
  const materialId = (await post("/materials", { name: `Combined ${suffix}` }))
    .body.id;
  for (let i = 0; i < 2; i++)
    await post("/purchase-receipts", {
      currency: "UZS",
      lines: [{ materialId, quantity: "100", unit: "kg", unitPricePerKg: "1" }],
    });
  const destination = (
    await post("/locations", { name: `Combined destination ${suffix}` })
  ).body.id;
  const body = {
    itemId: materialId,
    locationId: location,
    destinationId: destination,
    quantityKg: "150",
    reason: "Combined transfer",
  };
  const id = randomUUID();
  await post("/inventory/transfer", body, id);
  await post("/inventory/transfer", body, id);
  await post(
    "/inventory/transfer",
    { ...body, quantityKg: "51" },
    randomUUID(),
    409,
  );
  const source = await db.inventoryBalance.aggregate({
    where: { locationId: location, lot: { itemId: materialId } },
    _sum: { onHandKg: true },
  });
  const target = await db.inventoryBalance.aggregate({
    where: { locationId: destination, lot: { itemId: materialId } },
    _sum: { onHandKg: true },
  });
  assert.equal(source._sum.onHandKg?.toString(), "50");
  assert.equal(target._sum.onHandKg?.toString(), "150");
});

test("warehouse waste becomes raw stock while remaining waste in production reports", async () => {
  const rawId = (await post("/materials", { name: `Return raw ${suffix}` }))
    .body.id;
  const wasteId = (
    await post("/items", {
      name: `Reusable waste ${suffix}`,
      kind: "WASTE",
      wasteDisposition: "STORAGE",
    })
  ).body.id;
  await post("/purchase-receipts", {
    currency: "UZS",
    lines: [
      { materialId: rawId, quantity: "100", unit: "kg", unitPricePerKg: "1" },
    ],
  });
  const b = (await post("/batches", { equipmentId: equipment })).body;
  await post("/inventory/transfer", {
    itemId: rawId,
    locationId: location,
    destinationId: b.wipLocationId,
    quantityKg: "100",
    reason: "Charge",
  });
  const saleWasteId = (
    await post("/items", {
      name: `Sale waste ${suffix}`,
      kind: "WASTE",
      wasteDisposition: "SALE",
    })
  ).body.id;
  const result = await post(`/batches/${b.id}/complete`, {
    version: 1,
    locationId: location,
    outputs: [
      { itemId: product, quantityKg: "70" },
      { itemId: wasteId, quantityKg: "20" },
      { itemId: saleWasteId, quantityKg: "10" },
    ],
  });
  assert.equal(result.body.wasteKg, "30");
  const returned = await db.stockLot.findFirstOrThrow({
    where: { itemId: wasteId },
    include: { item: true, balances: true },
  });
  assert.equal(returned.stockKind, "MATERIAL");
  assert.equal(returned.item.kind, "WASTE");
  assert.equal(returned.balances[0].onHandKg.toString(), "20");
  assert.equal(returned.balances[0].locationId, location);
  const forSale = await db.stockLot.findMany({
    where: {
      originDocumentId: result.body.id,
      itemId: { in: [product, saleWasteId] },
    },
    include: { balances: true },
  });
  assert.equal(forSale.length, 2);
  assert.ok(
    forSale.every((lot) => lot.balances[0].locationId === salesLocation),
  );
  const dashboard = await request(app.getHttpServer())
    .get("/api/v1/dashboard")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  assert.equal(
    dashboard.body.stockByMaterial.find((r: any) => r.id === wasteId)
      .quantityKg,
    "20.000",
  );
});

test("supplier return without supplier reduces stock once and rejects excess", async () => {
  const receipt = (
    await post("/purchase-receipts", {
      currency: "UZS",
      lines: [
        {
          materialId: material,
          quantity: "100",
          unit: "kg",
          unitPricePerKg: "1",
        },
      ],
    })
  ).body;
  const l = await db.stockLot.findFirstOrThrow({
    where: { purchaseLot: { line: { receiptId: receipt.id } } },
    include: { balances: true },
  });
  const payload = {
    lotId: l.id,
    locationId: l.balances[0].locationId,
    quantityKg: "40",
    reason: "Return",
  };
  const id = randomUUID();
  await post("/inventory/return-supplier", payload, id);
  await post("/inventory/return-supplier", payload, id);
  await post(
    "/inventory/return-supplier",
    { ...payload, quantityKg: "61" },
    randomUUID(),
    409,
  );
  const balance = await db.inventoryBalance.findUniqueOrThrow({
    where: {
      lotId_locationId: { lotId: l.id, locationId: payload.locationId },
    },
  });
  assert.equal(balance.onHandKg.toString(), "60");
  assert.equal(
    (await db.businessDocument.findUniqueOrThrow({ where: { id } })).supplierId,
    null,
  );
});

test("multi-material loading is atomic, idempotent and prevents concurrent overspending", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const itemId = (
      await post("/materials", { name: `Multi charge ${suffix} ${i}` })
    ).body.id;
    ids.push(itemId);
    await post("/purchase-receipts", {
      currency: "UZS",
      lines: [
        {
          materialId: itemId,
          quantity: "100",
          unit: "kg",
          unitPricePerKg: "1",
        },
      ],
    });
  }
  const b = (await post("/batches", { equipmentId: equipment })).body;
  const path = `/batches/${b.id}/load`;
  await post(
    path,
    {
      lines: [
        { itemId: ids[0], quantityKg: "40" },
        { itemId: ids[1], quantityKg: "101" },
      ],
    },
    randomUUID(),
    409,
  );
  assert.equal(
    await db.inventoryBalance.count({ where: { locationId: b.wipLocationId } }),
    0,
  );
  const payload = {
    lines: ids.map((itemId) => ({ itemId, quantityKg: "60" })),
  };
  const id = randomUUID();
  await post(path, payload, id);
  await post(path, payload, id);
  const outcomes = await Promise.all([
    rawPost(path, {
      lines: ids.map((itemId) => ({ itemId, quantityKg: "40" })),
    }),
    rawPost(path, {
      lines: ids.map((itemId) => ({ itemId, quantityKg: "40" })),
    }),
  ]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [201, 409]);
  const total = await db.inventoryBalance.aggregate({
    where: { locationId: b.wipLocationId },
    _sum: { onHandKg: true },
  });
  assert.equal(total._sum.onHandKg?.toString(), "200");
});

test("completed empty furnace records actual irreversible losses without inventing stock", async () => {
  const rawId = (await post("/materials", { name: `Loss input ${suffix}` }))
    .body.id;
  await post("/purchase-receipts", {
    currency: "UZS",
    lines: [
      { materialId: rawId, quantity: "10000", unit: "kg", unitPricePerKg: "1" },
    ],
  });
  const b = (await post("/batches", { equipmentId: equipment })).body;
  await post(`/batches/${b.id}/load`, {
    lines: [{ itemId: rawId, quantityKg: "10000" }],
  });
  const id = randomUUID();
  const payload = {
    version: 1,
    locationId: location,
    outputs: [
      { itemId: product, quantityKg: "9000" },
      { itemId: waste, quantityKg: "800" },
    ],
  };
  const first = await post(`/batches/${b.id}/complete`, payload, id);
  await post(`/batches/${b.id}/complete`, payload, id);
  assert.equal(first.body.lossKg, "200");
  const completed = await db.productionBatch.findUniqueOrThrow({
    where: { id: b.id },
  });
  assert.equal(completed.differenceKg?.toString(), "200");
  const remaining = await db.inventoryBalance.aggregate({
    where: { locationId: b.wipLocationId },
    _sum: { onHandKg: true },
  });
  assert.equal(remaining._sum.onHandKg?.toString(), "0");
  const output = await db.productionOutput.aggregate({
    where: { batchId: b.id },
    _sum: { quantityKg: true },
  });
  assert.equal(output._sum.quantityKg?.toString(), "9800");
});

async function handoverFixture(quantity = "1050") {
  const materialId = (
    await post("/materials", { name: `Handover ${randomUUID()}` })
  ).body.id;
  await post("/purchase-receipts", {
    currency: "UZS",
    lines: [{ materialId, quantity, unit: "kg", unitPricePerKg: "2" }],
  });
  const equipmentId = (
    await post("/equipment", {
      name: `Handover kettle ${randomUUID()}`,
      direction: "COPPER",
    })
  ).body.id;
  const b = (await post("/batches", { equipmentId })).body;
  await post(`/batches/${b.id}/load`, {
    lines: [{ itemId: materialId, quantityKg: quantity }],
  });
  return { ...b, equipmentId };
}

test("handover rounds half up, preserves mass and trace, and next shift finishes with actual losses", async () => {
  const b = await handoverFixture();
  const payload = {
    version: 1,
    locationId: location,
    handover: true,
    carryoverItemId: product,
    outputs: [
      { itemId: product, quantityKg: "500" },
      { itemId: waste, quantityKg: "100" },
    ],
  };
  const key = randomUUID();
  const outcomes = await Promise.all([
    rawPost(`/batches/${b.id}/complete`, payload, key),
    rawPost(`/batches/${b.id}/complete`, payload, key),
  ]);
  assert.deepEqual(
    outcomes.map((r) => r.status),
    [201, 201],
  );
  const result = outcomes[0].body;
  assert.equal(result.lossKg, "11");
  assert.equal(result.carryoverKg, "439");
  assert.equal(outcomes[1].body.nextBatchId, result.nextBatchId);
  const parent = await db.productionBatch.findUniqueOrThrow({
    where: { id: b.id },
    include: { shift: true },
  });
  const child = await db.productionBatch.findUniqueOrThrow({
    where: { id: result.nextBatchId },
    include: { shift: true },
  });
  assert.equal(child.equipmentId, b.equipmentId);
  assert.equal(child.previousBatchId, b.id);
  assert.equal(
    child.shift.startsAt.toISOString(),
    parent.shift.endsAt.toISOString(),
  );
  const carried = await db.stockLot.findFirstOrThrow({
    where: { originDocumentId: key, isCarryover: true },
    include: { balances: true },
  });
  assert.equal(carried.balances.length, 1);
  assert.equal(carried.balances[0].locationId, child.wipLocationId);
  assert.equal(carried.balances[0].onHandKg.toString(), "439");
  await post(
    "/inventory/transfer",
    {
      lotId: carried.id,
      locationId: child.wipLocationId,
      destinationId: location,
      quantityKg: "1",
      reason: "test",
    },
    randomUUID(),
    409,
  );
  const finish = await post(`/batches/${child.id}/complete`, {
    version: 1,
    locationId: location,
    outputs: [
      { itemId: product, quantityKg: "400" },
      { itemId: waste, quantityKg: "30" },
    ],
  });
  assert.equal(finish.body.lossKg, "9");
  assert.equal(finish.body.nextBatchId, null);
  await post(
    `/documents/${key}/reverse`,
    { reason: "test downstream" },
    randomUUID(),
    409,
  );
  const report = await request(app.getHttpServer())
    .get(`/api/v1/reports?equipmentId=${b.equipmentId}`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  assert.equal(report.body.production.inputKg, "1050");
  assert.equal(report.body.production.productKg, "900");
  assert.equal(report.body.production.wasteKg, "130");
  assert.equal(report.body.production.lossKg, "20");
  const trace = await request(app.getHttpServer())
    .get(`/api/v1/trace/${carried.id}`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  assert.ok(trace.body.edges.length > 0);
});

test("handover allows no extraction, repeats on current mass, rejects invalid residual and stale commands", async () => {
  const b = await handoverFixture("10000");
  const path = `/batches/${b.id}/complete`;
  const base = {
    version: 1,
    locationId: location,
    handover: true,
    carryoverItemId: product,
  };
  await post(
    path,
    { ...base, outputs: [{ itemId: product, quantityKg: "9950" }] },
    randomUUID(),
    409,
  );
  assert.equal(
    await db.productionBatch.count({ where: { previousBatchId: b.id } }),
    0,
  );
  const first = (await post(path, { ...base, outputs: [] })).body;
  assert.equal(first.lossKg, "100");
  assert.equal(first.carryoverKg, "9900");
  await post(path, { ...base, outputs: [] }, randomUUID(), 409);
  const second = (
    await post(`/batches/${first.nextBatchId}/complete`, {
      ...base,
      outputs: [],
    })
  ).body;
  assert.equal(second.lossKg, "99");
  assert.equal(second.carryoverKg, "9801");
});

test("reversing untouched handover cancels its next stage and restores original weight", async () => {
  const b = await handoverFixture();
  const key = randomUUID();
  const r = (
    await post(
      `/batches/${b.id}/complete`,
      {
        version: 1,
        locationId: location,
        handover: true,
        carryoverItemId: product,
        outputs: [],
      },
      key,
    )
  ).body;
  await post(`/documents/${key}/reverse`, { reason: "test reversal" });
  assert.equal(
    (
      await db.productionBatch.findUniqueOrThrow({
        where: { id: r.nextBatchId },
      })
    ).status,
    "CANCELLED",
  );
  const balance = await db.inventoryBalance.aggregate({
    where: { locationId: b.wipLocationId },
    _sum: { onHandKg: true },
  });
  assert.equal(balance._sum.onHandKg?.toString(), "1050");
});

test("cancel loaded batch returns stock once and closes batch", async () => {
  const b = await handoverFixture("1200");
  const input = await db.inventoryBalance.findFirstOrThrow({
    where: { locationId: b.wipLocationId, onHandKg: { gt: 0 } },
  });
  const key = randomUUID();
  const payload = { reason: "Owner cancelled" };
  await post(`/batches/${b.id}/cancel`, payload, key);
  await post(`/batches/${b.id}/cancel`, payload, key);
  await post(`/batches/${b.id}/cancel`, payload, randomUUID(), 409);
  assert.equal(
    (await db.productionBatch.findUniqueOrThrow({ where: { id: b.id } }))
      .status,
    "CANCELLED",
  );
  const balances = await db.inventoryBalance.findMany({
    where: { lotId: input.lotId },
  });
  assert.equal(
    balances.find((r) => r.locationId === b.wipLocationId)?.onHandKg.toString(),
    "0",
  );
  assert.equal(
    balances.find((r) => r.locationId === location)?.onHandKg.toString(),
    "1200",
  );
});

test("direct product sale uses stock, currencies, exact prices and prevents replay/overselling", async () => {
  const b = await handoverFixture("100");
  const itemId = (
    await post("/items", {
      name: `Direct sale ${randomUUID()}`,
      kind: "PRODUCT",
    })
  ).body.id;
  const current = await db.productionBatch.findUniqueOrThrow({
    where: { id: b.id },
  });
  await post(`/batches/${b.id}/complete`, {
    version: current.version,
    locationId: location,
    outputs: [
      { itemId, quantityKg: "90" },
      { itemId: waste, quantityKg: "9" },
    ],
  });
  const customerName = `Direct customer ${randomUUID()}`;
  const payload = {
    customerName,
    itemId,
    quantityKg: "40",
    unitPricePerKg: "2.125",
    currency: "USD",
  };
  const key = randomUUID();
  const sale = await rawPost("/sales", payload, key);
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(sale.body.amount, "85");
  await post("/sales", payload, key);
  const results = await Promise.all([
    rawPost("/sales", { ...payload, currency: "UZS", unitPricePerKg: "25000" }),
    rawPost("/sales", { ...payload, currency: "UZS", unitPricePerKg: "25000" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const balance = await db.inventoryBalance.aggregate({
    where: { lot: { itemId }, locationId: salesLocation },
    _sum: { onHandKg: true },
  });
  assert.equal(balance._sum.onHandKg?.toString(), "10");
  await post("/sales", { ...payload, quantityKg: "11" }, randomUUID(), 409);
  await post("/sales", { ...payload, quantityKg: "0" }, randomUUID(), 409);
  await post("/sales", { ...payload, unitPricePerKg: "0" }, randomUUID(), 409);
  await post("/sales", { ...payload, itemId: material }, randomUUID(), 409);
  assert.equal(await db.customer.count({ where: { name: customerName } }), 1);
  const saved = await db.shipment.findUniqueOrThrow({
    where: { id: sale.body.id },
    include: { lines: true },
  });
  assert.equal(saved.contractId, null);
  assert.equal(saved.vehicleNumber, null);
  assert.equal(saved.lines[0].quantityKg.toString(), "40");
  assert.equal(saved.lines[0].unitPricePerKg.toString(), "2.125");
  const day = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
  const previousDay = new Date(Date.now() + 5 * 3600000 - 86400000)
    .toISOString()
    .slice(0, 10);
  const getReport = (from: string, to: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/reports/sales?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);
  const report = (await getReport(day, day).expect(200)).body;
  const ownRows = report.rows.filter((r: any) => r.itemId === itemId);
  assert.equal(ownRows.length, 2);
  assert.equal(ownRows.find((r: any) => r.currency === "USD").amount, "85");
  assert.equal(
    ownRows.find((r: any) => r.currency === "UZS").amount,
    "1000000",
  );
  for (const total of report.totals) {
    const sum = report.rows
      .filter((r: any) => r.currency === total.currency)
      .reduce((acc: number, r: any) => acc + Number(r.amount), 0);
    assert.equal(Number(total.amount), sum);
  }
  const before = (await getReport(previousDay, previousDay).expect(200)).body;
  assert.equal(
    before.rows.some((r: any) => r.itemId === itemId),
    false,
  );
  await getReport(day, previousDay).expect(409);
  await post(
    `/documents/${results.find((r) => r.status === 201)!.body.id}/reverse`,
    {
      reason: "Report excludes reversed sale",
    },
  );
  const reversed = (await getReport(day, day).expect(200)).body;
  assert.equal(
    reversed.rows.some((r: any) => r.itemId === itemId && r.currency === "UZS"),
    false,
  );
});

test("manual receipt discount preserves physical stock and survives retry; invalid discount rolls back", async () => {
  const id = randomUUID();
  const name = `Discount ${id}`;
  const body = {
    currency: "UZS",
    lines: [
      {
        materialName: name,
        quantity: "5",
        unit: "t",
        unitPricePerKg: "100",
        discountKg: "300",
      },
    ],
  };
  const receipt = (await post("/purchase-receipts", body, id)).body;
  assert.deepEqual((await post("/purchase-receipts", body, id)).body, receipt);
  const line = await db.purchaseLine.findFirstOrThrow({
    where: { receiptId: receipt.id },
    include: {
      lot: { include: { stockLot: { include: { balances: true } } } },
    },
  });
  assert.equal(line.quantityKg.toString(), "5000");
  assert.equal(line.discountKg.toString(), "300");
  assert.equal(line.amount.toString(), "470000");
  assert.equal(line.lot!.stockLot!.balances[0].onHandKg.toString(), "5000");
  const { Costing } = await import("../costing");
  assert.equal((await new Costing(db).unit(line.lot!.id)).amounts.UZS, "94");
  const summary = (
    await request(app.getHttpServer())
      .get("/api/v1/inventory/discounts")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
  ).body;
  assert.equal(
    summary.items.find((r: any) => r.materialId === line.materialId).discountKg,
    "300.000",
  );
  for (const discountKg of ["5001", "-1", "1.5"]) {
    const badId = randomUUID();
    const result = await rawPost(
      "/purchase-receipts",
      { ...body, lines: [{ ...body.lines[0], discountKg }] },
      badId,
    );
    assert.ok([400, 409].includes(result.status), result.text);
    assert.equal(
      await db.commandReceipt.count({ where: { commandId: badId } }),
      0,
    );
  }
});

test("kettle carryover retains discounted cost; new stock blends at its own cost; waste has no duplicate value", async () => {
  const { Costing, scaleCost } = await import("../costing");
  const mat = (await post("/materials", { name: `Cost ${randomUUID()}` })).body
    .id;
  await post("/purchase-receipts", {
    currency: "UZS",
    lines: [
      {
        materialId: mat,
        quantity: "5000",
        unit: "kg",
        unitPricePerKg: "100",
        discountKg: "500",
      },
    ],
  });
  const eq = (
    await post("/equipment", {
      name: `Cost kettle ${randomUUID()}`,
      direction: "BRASS",
    })
  ).body.id;
  const b = (await post("/batches", { equipmentId: eq })).body;
  await post(`/batches/${b.id}/load`, {
    lines: [{ itemId: mat, quantityKg: "5000" }],
  });
  const payload = {
    version: 1,
    locationId: location,
    handover: true,
    carryoverItemId: product,
    lossKg: "0",
    outputs: [
      { itemId: product, quantityKg: "1000" },
      { itemId: waste, quantityKg: "500" },
    ],
  };
  const key = randomUUID();
  const result = (await post(`/batches/${b.id}/complete`, payload, key)).body;
  assert.equal(result.carryoverKg, "3500");
  assert.equal(result.lossKg, "0");
  assert.deepEqual(
    (await post(`/batches/${b.id}/complete`, payload, key)).body,
    result,
  );
  const carried = await db.stockLot.findFirstOrThrow({
    where: { originDocumentId: key, isCarryover: true },
  });
  const produced = await db.stockLot.findFirstOrThrow({
    where: { originDocumentId: key, itemId: product, isCarryover: false },
  });
  const wasteOut = await db.stockLot.findFirstOrThrow({
    where: { originDocumentId: key, itemId: waste },
  });
  const c = new Costing(db);
  assert.equal((await c.unit(carried.id)).amounts.UZS, "100");
  assert.equal((await c.unit(produced.id)).amounts.UZS, "100");
  assert.deepEqual(await c.unit(wasteOut.id), { known: true, amounts: {} });
  assert.equal(scaleCost(await c.unit(carried.id), 3500).amounts.UZS, "350000");
  await post("/purchase-receipts", {
    currency: "UZS",
    lines: [
      { materialId: mat, quantity: "1500", unit: "kg", unitPricePerKg: "200" },
    ],
  });
  await post(`/batches/${result.nextBatchId}/load`, {
    lines: [{ itemId: mat, quantityKg: "1500" }],
  });
  const endKey = randomUUID();
  await post(
    `/batches/${result.nextBatchId}/complete`,
    {
      version: 1,
      locationId: location,
      outputs: [
        { itemId: product, quantityKg: "4000" },
        { itemId: waste, quantityKg: "500" },
      ],
    },
    endKey,
  );
  const finalLot = await db.stockLot.findFirstOrThrow({
    where: { originDocumentId: endKey, itemId: product },
  });
  assert.equal((await new Costing(db).unit(finalLot.id)).amounts.UZS, "162.5");
  assert.equal((await new Costing(db).unit(carried.id)).amounts.UZS, "100");
});

test("valuation keeps USD and UZS separate and explicit handover loss enforces mass balance", async () => {
  const { Costing } = await import("../costing");
  const b = await handoverFixture("100");
  const mat = (await post("/materials", { name: `USD cost ${randomUUID()}` }))
    .body.id;
  await post("/purchase-receipts", {
    currency: "USD",
    lines: [
      { materialId: mat, quantity: "100", unit: "kg", unitPricePerKg: "3" },
    ],
  });
  await post(`/batches/${b.id}/load`, {
    lines: [{ itemId: mat, quantityKg: "100" }],
  });
  const body = {
    version: 1,
    locationId: location,
    handover: true,
    carryoverItemId: product,
    lossKg: "200",
    outputs: [],
  };
  await post(`/batches/${b.id}/complete`, body, randomUUID(), 409);
  const id = randomUUID();
  const result = (
    await post(`/batches/${b.id}/complete`, { ...body, lossKg: "0" }, id)
  ).body;
  assert.equal(result.carryoverKg, "200");
  const carry = await db.stockLot.findFirstOrThrow({
    where: { originDocumentId: id, isCarryover: true },
  });
  assert.deepEqual(await new Costing(db).unit(carry.id), {
    known: true,
    amounts: { UZS: "1", USD: "1.5" },
  });
});

test("percentage discount follows acceptance return and manual kg discount without removing discounted stock", async () => {
  const id = randomUUID();
  const body = { currency: "UZS", lines: [{ materialName: `Percent ${id}`, quantity: "10", unit: "t", returnedKg: "500", discountKg: "300", discountPercent: "10", unitPricePerKg: "100" }] };
  const receipt = (await post("/purchase-receipts", body, id)).body;
  assert.deepEqual((await post("/purchase-receipts", body, id)).body, receipt);
  const line = await db.purchaseLine.findFirstOrThrow({ where: { receiptId: receipt.id }, include: { lot: { include: { stockLot: { include: { balances: true } } } } } });
  assert.equal(line.quantityKg.toString(), "9500");
  assert.equal(line.returnedKg.toString(), "500");
  assert.equal(line.percentDiscountKg.toString(), "920");
  assert.equal(line.amount.toString(), "828000");
  assert.equal(line.lot!.stockLot!.balances[0].onHandKg.toString(), "9500");
  const { Costing } = await import("../costing");
  const cost = await new Costing(db).unit(line.lot!.id);
  assert.ok(new Prisma.Decimal(cost.amounts.UZS).times(9500).minus(828000).abs().lt("0.000001"));
  for (const change of [{ discountPercent: "101" }, { discountPercent: "-1" }, { discountPercent: "1.123" }, { returnedKg: "10000" }, { returnedKg: "9800" }, { returnedKg: "-1" }]) {
    const bad = randomUUID();
    const response = await rawPost("/purchase-receipts", { ...body, lines: [{ ...body.lines[0], ...change }] }, bad);
    assert.ok([400,409].includes(response.status), response.text);
    assert.equal(await db.commandReceipt.count({ where: { commandId: bad } }), 0);
  }
  for (const percent of ["0", "100", "12.55"]) {
    const saved = (await post("/purchase-receipts", { ...body, lines: [{ ...body.lines[0], discountPercent: percent }] })).body;
    const row = await db.purchaseLine.findFirstOrThrow({ where: { receiptId: saved.id } });
    const extra = new Prisma.Decimal(9200).times(percent).div(100).toDecimalPlaces(3);
    assert.equal(row.percentDiscountKg.toString(), extra.toString());
    assert.equal(row.amount.toString(), new Prisma.Decimal(9200).minus(extra).times(100).toString());
  }
});

test("multi-material receipt is atomic, retains each discount, and retries do not duplicate stock", async () => {
  const id = randomUUID();
  const body = { currency: "UZS", lines: [
    { materialName: `Multi A ${id}`, quantity: "2", unit: "t", returnedKg: "100", discountKg: "50", discountPercent: "10", unitPricePerKg: "100" },
    { materialName: `Multi B ${id}`, quantity: "500", unit: "kg", discountPercent: "2", unitPricePerKg: "200" },
  ] };
  const invalidId = randomUUID();
  await rawPost("/purchase-receipts", { ...body, lines: [body.lines[0], { ...body.lines[1], discountKg: "501" }] }, invalidId).expect(409);
  assert.equal(await db.purchaseReceipt.count({ where: { id: invalidId } }), 0);
  assert.equal(await db.stockMovement.count({ where: { commandId: invalidId } }), 0);
  assert.equal(await db.material.count({ where: { name: { in: body.lines.map(l => l.materialName) } } }), 0);
  const result = (await post("/purchase-receipts", body, id)).body;
  assert.deepEqual((await post("/purchase-receipts", body, id)).body, result);
  const lines = await db.purchaseLine.findMany({ where: { receiptId: result.id }, include: { material: true, lot: { include: { stockLot: { include: { balances: true } } } } } });
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const first = line.material.name === body.lines[0].materialName;
    assert.equal(line.quantityKg.toString(), first ? "1900" : "500");
    assert.equal(line.percentDiscountKg.toString(), first ? "185" : "10");
    assert.equal(line.amount.toString(), first ? "166500" : "98000");
    assert.equal(line.lot!.stockLot!.balances[0].onHandKg.toString(), first ? "1900" : "500");
  }
  assert.equal(await db.stockMovement.count({ where: { commandId: id } }), 2);
});

test("unpriced multi-receipts can be completed later without rewriting history or duplicating returns", async () => {
  const receipt = (await post("/purchase-receipts", { currency: "UZS", lines: [
    { materialId: material, quantity: "10000", unit: "kg", supplierName: "Supplier Later A" },
    { materialId: material, quantity: "200", unit: "kg", supplierName: "Supplier Later B" },
  ] })).body;
  const lines = await db.purchaseLine.findMany({ where: { receiptId: receipt.id }, include: { lot: true }, orderBy: { quantityKg: "desc" } });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].priceKnown, false);
  const line = lines[0], lotId = line.lot!.id;
  const { Costing } = await import("../costing");
  assert.equal((await new Costing(db).unit(lotId)).known, false);
  const edit = { version: 0, supplierName: "Supplier Corrected", returnedKg: "500", discountKg: "300", discountPercent: "10", unitPricePerKg: "100", currency: "UZS" };
  const key = randomUUID();
  const result = (await post(`/purchase-lines/${line.id}/amend`, edit, key)).body;
  assert.equal(result.amount, "828000");
  assert.equal((await post(`/purchase-lines/${line.id}/amend`, edit, key)).body.id, result.id);
  const balance = () => db.inventoryBalance.findUniqueOrThrow({ where: { lotId_locationId: { lotId, locationId: location } } });
  assert.equal((await balance()).onHandKg.toString(), "9500");
  assert.equal(await db.stockMovement.count({ where: { commandId: key } }), 1);
  assert.equal((await new Costing(db).unit(lotId)).amounts.UZS, new Prisma.Decimal(828000).div(9500).toString());
  await post(`/purchase-lines/${line.id}/amend`, { ...edit, unitPricePerKg: "200" }, randomUUID(), 409);
  await post(`/purchase-lines/${line.id}/amend`, { ...edit, version: 1, returnedKg: "499" }, randomUUID(), 409);
  await post(`/purchase-lines/${line.id}/amend`, { ...edit, version: 1, discountPercent: "101" }, randomUUID(), 409);
  const simultaneous = await Promise.all([100,200].map((price) => rawPost(`/purchase-lines/${line.id}/amend`, { ...edit, version: 1, unitPricePerKg: String(price) })));
  assert.deepEqual(simultaneous.map((r) => r.status).sort(), [201,409]);
  assert.equal((await balance()).onHandKg.toString(), "9500");
  const original = await db.purchaseLine.findUniqueOrThrow({ where: { id: line.id } });
  assert.equal(original.quantityKg.toString(), "10000");
  assert.equal(original.priceKnown, false);
  assert.equal(await db.purchaseRevision.count({ where: { lineId: line.id } }), 2);
  const history = (await request(app.getHttpServer()).get("/api/v1/purchase-lines?limit=100").set("Authorization", `Bearer ${token}`).expect(200)).body.items.find((r: any) => r.id === line.id);
  assert.equal(history.supplierName, "Supplier Corrected");
  assert.equal(history.grossKg, "10000");
  assert.equal(history.quantityKg, "9500");
  assert.equal(history.version, 2);
  const origin = await db.stockLot.findUniqueOrThrow({ where: { id: lotId } });
  await post(`/documents/${origin.originDocumentId}/reverse`, { reason: "Amended receipt" }, randomUUID(), 409);
  await post(`/documents/${key}/reverse`, { reason: "Correction" }, randomUUID(), 409);
});

test("late supplier return rejects reserved or consumed stock atomically", async () => {
  const receipt = (await post("/purchase-receipts", { currency: "USD", lines: [{ materialId: material, quantity: "100", unit: "kg" }] })).body;
  const line = await db.purchaseLine.findFirstOrThrow({ where: { receiptId: receipt.id }, include: { lot: true } });
  // An existing physical transfer leaves only 20 kg on the receiving warehouse.
  await post("/inventory/transfer", { lotId: line.lot!.id, locationId: location, destinationId: salesLocation, quantityKg: "80", reason: "Local late-return test" });
  const edit = { version: 0, currency: "USD", returnedKg: "30", discountKg: "0", discountPercent: "0", unitPricePerKg: "1" };
  await post(`/purchase-lines/${line.id}/amend`, edit, randomUUID(), 409);
  assert.equal(await db.purchaseRevision.count({ where: { lineId: line.id } }), 0);
  await post(`/purchase-lines/${line.id}/amend`, { ...edit, returnedKg: "20" });
  const balances = await db.inventoryBalance.findMany({ where: { lotId: line.lot!.id } });
  assert.equal(balances.reduce((sum, b) => sum.plus(b.onHandKg), new Prisma.Decimal(0)).toString(), "80");
});

test("late price flows into completed production and returns cannot use reserved stock", async () => {
  const { Costing } = await import("../costing");
  const mat = (await post("/materials", { name: `Late cost ${randomUUID()}` })).body.id;
  const eq = (await post("/equipment", { name: `Late cost kettle ${randomUUID()}`, direction: "COPPER" })).body.id;
  const receipt = (await post("/purchase-receipts", { currency: "UZS", lines: [{ materialId: mat, quantity: "100", unit: "kg" }] })).body;
  const line = await db.purchaseLine.findFirstOrThrow({ where: { receiptId: receipt.id }, include: { lot: true } });
  const b = (await post("/batches", { equipmentId: eq })).body;
  await post(`/batches/${b.id}/load`, { lines: [{ itemId: mat, quantityKg: "80" }] });
  const key = randomUUID();
  await post(`/batches/${b.id}/complete`, { version: 1, locationId: location, lossKg: "0", outputs: [{ itemId: product, quantityKg: "70" }, { itemId: waste, quantityKg: "10" }] }, key);
  const finished = await db.stockLot.findFirstOrThrow({ where: { originDocumentId: key, itemId: product } });
  assert.equal((await new Costing(db).unit(finished.id)).known, false);
  const amend = { version: 0, currency: "UZS", returnedKg: "0", discountKg: "0", discountPercent: "0", unitPricePerKg: "10" };
  await post(`/purchase-lines/${line.id}/amend`, amend);
  assert.equal((await new Costing(db).unit(finished.id)).amounts.UZS, new Prisma.Decimal(800).div(70).toString());
  await post("/inventory/reserve", { lotId: line.lot!.id, locationId: location, quantityKg: "15", reason: "Reserved" });
  await post(`/purchase-lines/${line.id}/amend`, { ...amend, version: 1, returnedKg: "10" }, randomUUID(), 409);
  assert.equal(await db.purchaseRevision.count({ where: { lineId: line.id } }), 1);
});
