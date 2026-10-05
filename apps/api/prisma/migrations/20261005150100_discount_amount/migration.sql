ALTER TABLE "PurchaseLine" DROP CONSTRAINT purchase_positive;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT purchase_positive CHECK (
  "quantityKg" > 0 AND "unitPricePerKg" > 0
  AND "discountKg" = trunc("discountKg")
  AND amount = ("quantityKg" - "discountKg") * "unitPricePerKg"
);
