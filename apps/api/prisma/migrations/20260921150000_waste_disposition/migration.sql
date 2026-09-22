ALTER TABLE "Item" ADD COLUMN "wasteDisposition" TEXT;
ALTER TABLE "Item" ADD CONSTRAINT "item_waste_disposition_check" CHECK (
  "wasteDisposition" IS NULL OR (kind = 'WASTE' AND "wasteDisposition" IN ('STORAGE', 'SALE'))
);
