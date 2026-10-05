ALTER TABLE "PurchaseLine" ADD COLUMN "supplierName" TEXT, ADD COLUMN "priceKnown" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PurchaseLine" DROP CONSTRAINT purchase_positive;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT purchase_positive CHECK (
 "quantityKg" > 0 AND (("priceKnown" AND "unitPricePerKg" > 0) OR (NOT "priceKnown" AND "unitPricePerKg" = 0))
 AND "discountKg" = trunc("discountKg") AND "returnedKg" >= 0 AND "returnedKg" = trunc("returnedKg")
 AND "discountPercent" BETWEEN 0 AND 100
 AND "percentDiscountKg" = round(("quantityKg" - "discountKg") * "discountPercent" / 100, 3)
 AND amount = ("quantityKg" - "discountKg" - "percentDiscountKg") * "unitPricePerKg"
);
CREATE TABLE "PurchaseRevision" (
 id UUID PRIMARY KEY, "lineId" UUID NOT NULL REFERENCES "PurchaseLine"(id), version INTEGER NOT NULL CHECK(version > 0),
 "commandId" UUID NOT NULL UNIQUE REFERENCES "BusinessDocument"(id), "actorId" UUID NOT NULL REFERENCES "User"(id),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "supplierName" TEXT, currency "Currency" NOT NULL,
 "quantityKg" DECIMAL(20,3) NOT NULL, "returnedKg" DECIMAL(20,3) NOT NULL,
 "discountKg" DECIMAL(20,3) NOT NULL, "discountPercent" DECIMAL(5,2) NOT NULL,
 "percentDiscountKg" DECIMAL(20,3) NOT NULL, "unitPricePerKg" DECIMAL(20,6) NOT NULL,
 "priceKnown" BOOLEAN NOT NULL, amount DECIMAL(35,9) NOT NULL,
 UNIQUE("lineId",version),
 CHECK("quantityKg">0 AND "quantityKg"=trunc("quantityKg") AND "returnedKg">=0 AND "returnedKg"=trunc("returnedKg")
 AND "discountKg" BETWEEN 0 AND "quantityKg" AND "discountKg"=trunc("discountKg")
 AND "discountPercent" BETWEEN 0 AND 100
 AND (("priceKnown" AND "unitPricePerKg">0) OR (NOT "priceKnown" AND "unitPricePerKg"=0))
 AND "percentDiscountKg"=round(("quantityKg"-"discountKg")*"discountPercent"/100,3)
 AND amount=("quantityKg"-"discountKg"-"percentDiscountKg")*"unitPricePerKg")
);
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON "PurchaseRevision" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
CREATE VIEW "EffectivePurchaseLine" AS SELECT l.id,l."receiptId",l."materialId",
 COALESCE(v."quantityKg",l."quantityKg") AS "quantityKg",
 COALESCE(v."discountKg",l."discountKg") AS "discountKg",
 COALESCE(v."percentDiscountKg",l."percentDiscountKg") AS "percentDiscountKg",
 COALESCE(v.amount,l.amount) AS amount, COALESCE(v.currency,r.currency) AS currency,
 COALESCE(v."priceKnown",l."priceKnown") AS "priceKnown"
 FROM "PurchaseLine" l JOIN "PurchaseReceipt" r ON r.id=l."receiptId"
 LEFT JOIN LATERAL (SELECT * FROM "PurchaseRevision" WHERE "lineId"=l.id ORDER BY version DESC LIMIT 1) v ON true;
