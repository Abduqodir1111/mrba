import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../app";
import { Database } from "../db";
let app: INestApplication;
let db: Database;
let token: string;
let refreshToken: string;
let supplier: string;
let material: string;
const name = randomUUID();
const epoch = process.env.RECOVERY_EPOCH!;
const headers = () => ({
  Authorization: `Bearer ${token}`,
  "X-Recovery-Epoch": epoch,
});
const receipt = () => ({
  supplierId: supplier,
  currency: "USD",
  lines: [
    {
      materialId: material,
      quantity: "1.234",
      unit: "t",
      unitPricePerKg: "0.123456",
    },
  ],
});
before(async () => {
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/mrba_test",
    "Integration tests must use the dedicated test database",
  );
  app = await createApp();
  await app.init();
  db = app.get(Database);
  const result = await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({
      login: process.env.OWNER_LOGIN,
      password: process.env.OWNER_PASSWORD,
      deviceId: randomUUID(),
    })
    .expect(201);
  token = result.body.accessToken;
  refreshToken = result.body.refreshToken;
  supplier = (
    await request(app.getHttpServer())
      .post("/api/v1/suppliers")
      .set(headers())
      .set("Idempotency-Key", randomUUID())
      .send({ name: `Supplier ${name}` })
      .expect(201)
  ).body.id;
  material = (
    await request(app.getHttpServer())
      .post("/api/v1/materials")
      .set(headers())
      .set("Idempotency-Key", randomUUID())
      .send({ name: `Material ${name}` })
      .expect(201)
  ).body.id;
});
after(async () => {
  await app?.close();
});
test("health checks database; protected routes require authentication", async () => {
  await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
  await request(app.getHttpServer()).get("/api/v1/dashboard").expect(401);
});
test("owner permissions include every enabled feature and invalid login fails", async () => {
  const me = await request(app.getHttpServer())
    .get("/api/v1/auth/me")
    .set(headers())
    .expect(200);
  assert.ok(me.body.permissions.includes("purchase.post"));
  assert.ok(me.body.permissions.includes("audit.read"));
  assert.equal(me.body.passwordHash, undefined);
  await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({
      login: process.env.OWNER_LOGIN,
      password: "wrong",
      deviceId: randomUUID(),
    })
    .expect(401);
});
test("parallel retries have one atomic stock effect and one audit event", async () => {
  const id = randomUUID();
  const body = receipt();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(app.getHttpServer())
        .post("/api/v1/purchase-receipts")
        .set(headers())
        .set("Idempotency-Key", id)
        .send(body)
        .expect(201),
    ),
  );
  assert.ok(results.every((r) => r.body.id === results[0].body.id));
  assert.equal(await db.stockMovement.count({ where: { commandId: id } }), 1);
  assert.equal(await db.auditLog.count({ where: { commandId: id } }), 1);
  const lot = await db.purchaseLot.findFirstOrThrow({
    where: { line: { receiptId: results[0].body.id } },
    include: { stockLot: { include: { balances: true } }, line: true },
  });
  assert.equal(lot.stockLot!.balances[0].onHandKg.toString(), "1234");
  assert.equal(lot.line.amount.toString(), "152.344704");
  const replay = await request(app.getHttpServer())
    .get(`/api/v1/commands/${id}`)
    .set(headers())
    .expect(200);
  assert.equal(replay.body.result.id, results[0].body.id);
  await request(app.getHttpServer())
    .post("/api/v1/purchase-receipts")
    .set(headers())
    .set("Idempotency-Key", id)
    .send({ ...body, currency: "UZS" })
    .expect(409);
});
test("failure in second line rolls back document, first line, stock, audit and receipt", async () => {
  const id = randomUUID();
  const body = receipt();
  body.lines.push({ ...body.lines[0], materialId: randomUUID() });
  const before = await db.purchaseReceipt.count();
  await request(app.getHttpServer())
    .post("/api/v1/purchase-receipts")
    .set(headers())
    .set("Idempotency-Key", id)
    .send(body)
    .expect(409);
  assert.equal(await db.purchaseReceipt.count(), before);
  assert.equal(await db.commandReceipt.count({ where: { commandId: id } }), 0);
  assert.equal(await db.stockMovement.count({ where: { commandId: id } }), 0);
});
test("stale recovery context, unknown fields, zero weight and zero price are rejected", async () => {
  await request(app.getHttpServer())
    .post("/api/v1/purchase-receipts")
    .set(headers())
    .set("X-Recovery-Epoch", "old")
    .set("Idempotency-Key", randomUUID())
    .send(receipt())
    .expect(409);
  await request(app.getHttpServer())
    .post("/api/v1/purchase-receipts")
    .set(headers())
    .set("Idempotency-Key", randomUUID())
    .send({ ...receipt(), fakeAdmin: true })
    .expect(400);
  for (const change of [{ quantity: "0" }, { unitPricePerKg: "0" }]) {
    const body = receipt();
    Object.assign(body.lines[0], change);
    await request(app.getHttpServer())
      .post("/api/v1/purchase-receipts")
      .set(headers())
      .set("Idempotency-Key", randomUUID())
      .send(body)
      .expect(409);
  }
});
test("database constraints prevent historical edits and negative projection", async () => {
  const lot = await db.purchaseLot.findFirstOrThrow({
    where: { line: { materialId: material } },
    include: { stockLot: { include: { balances: true } } },
  });
  await assert.rejects(
    db.inventoryBalance.update({
      where: {
        lotId_locationId: {
          lotId: lot.id,
          locationId: lot.stockLot!.balances[0].locationId,
        },
      },
      data: { onHandKg: "-1" },
    }),
  );
  await assert.rejects(
    db.stockMovement.updateMany({
      where: { lotId: lot.id },
      data: { signedQuantityKg: "1" },
    }),
  );
  await assert.rejects(
    db.auditLog.deleteMany({ where: { action: "PURCHASE_RECEIPT" } }),
  );
});
test("ledger balances reconcile and financial currencies are kept separate", async () => {
  const body = receipt();
  body.currency = "UZS";
  await request(app.getHttpServer())
    .post("/api/v1/purchase-receipts")
    .set(headers())
    .set("Idempotency-Key", randomUUID())
    .send(body)
    .expect(201);
  const rows = await db.$queryRaw<
    any[]
  >`SELECT b."lotId" FROM "InventoryBalance" b JOIN "StockMovement" m ON b."lotId"=m."lotId" AND b."locationId"=m."locationId" GROUP BY b."lotId", b."locationId", b."onHandKg" HAVING b."onHandKg" <> SUM(m."signedQuantityKg")`;
  assert.equal(rows.length, 0);
  const dashboard = await request(app.getHttpServer())
    .get("/api/v1/dashboard")
    .set(headers())
    .expect(200);
  assert.equal(dashboard.body.purchaseAmounts.length, 2);
});
test("refresh rotates once; reuse revokes the family including the replacement access token", async () => {
  const next = await request(app.getHttpServer())
    .post("/api/v1/auth/refresh")
    .send({ refreshToken })
    .expect(201);
  await request(app.getHttpServer())
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${next.body.accessToken}`)
    .expect(200);
  await request(app.getHttpServer())
    .post("/api/v1/auth/refresh")
    .send({ refreshToken })
    .expect(401);
  await request(app.getHttpServer())
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${next.body.accessToken}`)
    .expect(401);
});
