BEGIN;
LOCK TABLE "PurchaseLine" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "PurchaseLine" ADD COLUMN "number" INTEGER;
ALTER TABLE "PurchaseLine" DISABLE TRIGGER line_immutable;
-- Legacy fractional weights predate NOT VALID whole-kg checks. Preserve their
-- original values while adding metadata, then restore exactly the same checks.
CREATE TEMP TABLE receipt_number_legacy_checks ON COMMIT DROP AS
SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
WHERE conrelid = '"PurchaseLine"'::regclass AND contype = 'c' AND NOT convalidated;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT * FROM receipt_number_legacy_checks LOOP
    EXECUTE format('ALTER TABLE "PurchaseLine" DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
WITH numbered AS (
  SELECT l.id, row_number() OVER (ORDER BY r."postedAt", r.id, l.id)::integer AS n
  FROM "PurchaseLine" l JOIN "PurchaseReceipt" r ON r.id = l."receiptId"
)
UPDATE "PurchaseLine" l SET "number" = numbered.n FROM numbered WHERE l.id = numbered.id;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT * FROM receipt_number_legacy_checks LOOP
    EXECUTE format('ALTER TABLE "PurchaseLine" ADD CONSTRAINT %I %s', c.conname, c.definition);
  END LOOP;
END $$;
ALTER TABLE "PurchaseLine" ENABLE TRIGGER line_immutable;
CREATE TABLE "PurchaseNumberCounter" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "lastNumber" INTEGER NOT NULL CHECK ("lastNumber" >= 0)
);
INSERT INTO "PurchaseNumberCounter" VALUES (1, (SELECT COALESCE(MAX("number"), 0) FROM "PurchaseLine"));
-- A transactional row lock serializes concurrent receipts. Rollbacks also roll back numbering.
CREATE FUNCTION next_purchase_line_number() RETURNS integer LANGUAGE sql AS $$
  UPDATE "PurchaseNumberCounter" SET "lastNumber" = "lastNumber" + 1 WHERE id = 1 RETURNING "lastNumber";
$$;
ALTER TABLE "PurchaseLine" ALTER COLUMN "number" SET DEFAULT next_purchase_line_number();
ALTER TABLE "PurchaseLine" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_number_positive" CHECK ("number" > 0);
CREATE UNIQUE INDEX "PurchaseLine_number_key" ON "PurchaseLine"("number");
COMMIT;
