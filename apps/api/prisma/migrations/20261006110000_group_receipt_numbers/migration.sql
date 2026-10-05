BEGIN;
LOCK TABLE "PurchaseReceipt", "PurchaseLine" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "PurchaseReceipt" ADD COLUMN number INTEGER;
ALTER TABLE "PurchaseReceipt" DISABLE TRIGGER purchase_immutable;
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY "postedAt", id)::integer AS n FROM "PurchaseReceipt"
)
UPDATE "PurchaseReceipt" r SET number = numbered.n FROM numbered WHERE r.id = numbered.id;
ALTER TABLE "PurchaseReceipt" ENABLE TRIGGER purchase_immutable;
ALTER TABLE "PurchaseLine" DROP COLUMN number;
DROP FUNCTION next_purchase_line_number();
UPDATE "PurchaseNumberCounter" SET "lastNumber" = (SELECT COALESCE(MAX(number), 0) FROM "PurchaseReceipt") WHERE id = 1;
CREATE FUNCTION next_purchase_receipt_number() RETURNS integer LANGUAGE sql AS $$
  UPDATE "PurchaseNumberCounter" SET "lastNumber" = "lastNumber" + 1 WHERE id = 1 RETURNING "lastNumber";
$$;
ALTER TABLE "PurchaseReceipt" ALTER COLUMN number SET DEFAULT next_purchase_receipt_number();
ALTER TABLE "PurchaseReceipt" ALTER COLUMN number SET NOT NULL;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_number_positive" CHECK (number > 0);
CREATE UNIQUE INDEX "PurchaseReceipt_number_key" ON "PurchaseReceipt"(number);
COMMIT;
