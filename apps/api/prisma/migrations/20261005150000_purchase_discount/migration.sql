ALTER TABLE "PurchaseLine" ADD COLUMN "discountKg" DECIMAL(20,3) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "purchase_discount_range" CHECK ("discountKg" >= 0 AND "discountKg" <= "quantityKg");
