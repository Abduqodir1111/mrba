ALTER TABLE "PurchaseLine"
 ADD COLUMN "returnedKg" DECIMAL(20,3) NOT NULL DEFAULT 0,
 ADD COLUMN "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
 ADD COLUMN "percentDiscountKg" DECIMAL(20,3) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseLine" DROP CONSTRAINT purchase_positive;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT purchase_positive CHECK (
 "quantityKg" > 0 AND "unitPricePerKg" > 0
 AND "discountKg" = trunc("discountKg")
 AND "returnedKg" >= 0 AND "returnedKg" = trunc("returnedKg")
 AND "discountPercent" BETWEEN 0 AND 100
 AND "percentDiscountKg" = round(("quantityKg" - "discountKg") * "discountPercent" / 100, 3)
 AND amount = ("quantityKg" - "discountKg" - "percentDiscountKg") * "unitPricePerKg"
);
