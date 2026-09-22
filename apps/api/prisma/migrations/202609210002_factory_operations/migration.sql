BEGIN;
-- DropForeignKey
ALTER TABLE "InventoryBalance" DROP CONSTRAINT "InventoryBalance_lotId_fkey";

-- DropForeignKey
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_lotId_fkey";

-- DropIndex
DROP INDEX "StockMovement_commandId_lotId_key";

-- AlterTable
ALTER TABLE "InventoryBalance" ADD COLUMN     "reservedKg" DECIMAL(20,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StockLocation" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'STORAGE';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "documentId" UUID;

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "purchaseLotId" UUID,
    "originDocumentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDocument" (
    "id" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "supplierId" UUID,
    "batchId" UUID,
    "reversesId" UUID,
    "differenceKg" DECIMAL(20,3),
    "adjustmentBeforeKg" DECIMAL(20,3),
    "adjustmentAfterKg" DECIMAL(20,3),

    CONSTRAINT "BusinessDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantityKg" DECIMAL(20,3) NOT NULL,
    "remainingKg" DECIMAL(20,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftInstance" (
    "businessDate" VARCHAR(10) NOT NULL,
    "id" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ShiftInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "equipmentId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "wipLocationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "version" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,
    "notes" TEXT,
    "differenceKg" DECIMAL(20,3),
    "differenceReason" TEXT,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionInput" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "quantityKg" DECIMAL(20,3) NOT NULL,

    CONSTRAINT "ProductionInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOutput" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "quantityKg" DECIMAL(20,3) NOT NULL,

    CONSTRAINT "ProductionOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransformationInput" (
    "documentId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "quantityKg" DECIMAL(20,3) NOT NULL,

    CONSTRAINT "TransformationInput_pkey" PRIMARY KEY ("documentId","lotId")
);

-- CreateTable
CREATE TABLE "TransformationOutput" (
    "lotId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "quantityKg" DECIMAL(20,3) NOT NULL,

    CONSTRAINT "TransformationOutput_pkey" PRIMARY KEY ("lotId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "plannedTruckCount" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractLine" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "agreedQuantityKg" DECIMAL(20,3) NOT NULL,
    "unitPricePerKg" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "ContractLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "contractId" UUID,
    "vehicleId" UUID,
    "vehicleNumber" TEXT,
    "currency" "Currency" NOT NULL,
    "kind" TEXT NOT NULL,
    "departedAt" TIMESTAMPTZ,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "contractLineId" UUID,
    "itemId" UUID NOT NULL,
    "quantityKg" DECIMAL(20,3) NOT NULL,
    "unitPricePerKg" DECIMAL(20,6) NOT NULL,
    "amount" DECIMAL(35,9) NOT NULL,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentAllocation" (
    "id" UUID NOT NULL,
    "shipmentLineId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantityKg" DECIMAL(20,3) NOT NULL,

    CONSTRAINT "ShipmentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandIntent" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "epoch" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CommandIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Item_name_kind_key" ON "Item"("name", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_purchaseLotId_key" ON "StockLot"("purchaseLotId");

-- CreateIndex
CREATE INDEX "StockLot_itemId_createdAt_idx" ON "StockLot"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDocument_commandId_key" ON "BusinessDocument"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDocument_reversesId_key" ON "BusinessDocument"("reversesId");

-- CreateIndex
CREATE INDEX "BusinessDocument_type_occurredAt_idx" ON "BusinessDocument"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_siteId_name_key" ON "Equipment"("siteId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftInstance_startsAt_code_key" ON "ShiftInstance"("startsAt", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_number_key" ON "ProductionBatch"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_wipLocationId_key" ON "ProductionBatch"("wipLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionInput_batchId_lotId_key" ON "ProductionInput"("batchId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOutput_lotId_key" ON "ProductionOutput"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_number_key" ON "Contract"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ContractLine_contractId_itemId_key" ON "ContractLine"("contractId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_number_key" ON "Vehicle"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_documentId_key" ON "Shipment"("documentId");

-- CreateIndex
CREATE INDEX "CommandIntent_actorId_status_updatedAt_idx" ON "CommandIntent"("actorId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_commandId_lotId_locationId_key" ON "StockMovement"("commandId", "lotId", "locationId");


-- Preserve existing receipts and their lot identifiers without rewriting quantities.
INSERT INTO "Item" (id,name,kind,"isActive","createdAt") SELECT id,name,'MATERIAL',"isActive","createdAt" FROM "Material";
INSERT INTO "BusinessDocument" (id,"commandId",type,"supplierId","occurredAt","postedAt")
 SELECT c."commandId",c."commandId",'PURCHASE_RECEIPT',r."supplierId",r."postedAt",r."postedAt"
 FROM "CommandReceipt" c JOIN "PurchaseReceipt" r ON r.id=(c.result->>'id')::uuid WHERE c.type='PURCHASE_RECEIPT';
INSERT INTO "StockLot" (id,"itemId","purchaseLotId","originDocumentId")
 SELECT p.id,l."materialId",p.id,c."commandId" FROM "PurchaseLot" p JOIN "PurchaseLine" l ON l.id=p."lineId"
 JOIN "CommandReceipt" c ON c.type='PURCHASE_RECEIPT' AND c.result->>'id'=l."receiptId"::text;
ALTER TABLE "StockMovement" DISABLE TRIGGER stock_immutable;
UPDATE "StockMovement" SET "documentId"="commandId";
ALTER TABLE "StockMovement" ENABLE TRIGGER stock_immutable;
ALTER TABLE "StockMovement" ALTER COLUMN "documentId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BusinessDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_purchaseLotId_fkey" FOREIGN KEY ("purchaseLotId") REFERENCES "PurchaseLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_originDocumentId_fkey" FOREIGN KEY ("originDocumentId") REFERENCES "BusinessDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "CommandReceipt"("commandId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "BusinessDocument_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "BusinessDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ShiftInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_wipLocationId_fkey" FOREIGN KEY ("wipLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionInput" ADD CONSTRAINT "ProductionInput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionInput" ADD CONSTRAINT "ProductionInput_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOutput" ADD CONSTRAINT "ProductionOutput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOutput" ADD CONSTRAINT "ProductionOutput_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformationInput" ADD CONSTRAINT "TransformationInput_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BusinessDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformationInput" ADD CONSTRAINT "TransformationInput_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformationOutput" ADD CONSTRAINT "TransformationOutput_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformationOutput" ADD CONSTRAINT "TransformationOutput_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BusinessDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BusinessDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_contractLineId_fkey" FOREIGN KEY ("contractLineId") REFERENCES "ContractLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentAllocation" ADD CONSTRAINT "ShipmentAllocation_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "ShipmentLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentAllocation" ADD CONSTRAINT "ShipmentAllocation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandIntent" ADD CONSTRAINT "CommandIntent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" DROP CONSTRAINT receipt_positive;
ALTER TABLE "StockMovement" ADD CONSTRAINT movement_nonzero CHECK ("signedQuantityKg" <> 0);
ALTER TABLE "InventoryBalance" ADD CONSTRAINT valid_reservation CHECK ("reservedKg">=0 AND "reservedKg"<="onHandKg");
ALTER TABLE "Item" ADD CONSTRAINT item_kind CHECK (kind IN ('MATERIAL','PRODUCT','WASTE'));
ALTER TABLE "StockLocation" ADD CONSTRAINT location_kind CHECK (kind IN ('STORAGE','WIP'));
ALTER TABLE "StockReservation" ADD CONSTRAINT reservation_quantity CHECK ("quantityKg">0 AND "remainingKg">=0 AND "remainingKg"<="quantityKg");
ALTER TABLE "StockReservation" ADD CONSTRAINT reservation_location FOREIGN KEY ("locationId") REFERENCES "StockLocation"(id);
ALTER TABLE "ShipmentAllocation" ADD CONSTRAINT allocation_location FOREIGN KEY ("locationId") REFERENCES "StockLocation"(id);
ALTER TABLE "ShiftInstance" ADD CONSTRAINT shift_duration CHECK ("endsAt"="startsAt"+interval '12 hours');
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_quantityKg_whole" CHECK ("quantityKg"=trunc("quantityKg")) NOT VALID;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_signedQuantityKg_whole" CHECK ("signedQuantityKg"=trunc("signedQuantityKg")) NOT VALID;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_quantityKg_whole" CHECK ("quantityKg"=trunc("quantityKg")) NOT VALID;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_remainingKg_whole" CHECK ("remainingKg"=trunc("remainingKg")) NOT VALID;
ALTER TABLE "ProductionInput" ADD CONSTRAINT "ProductionInput_quantityKg_whole" CHECK ("quantityKg"=trunc("quantityKg")) NOT VALID;
ALTER TABLE "ProductionOutput" ADD CONSTRAINT "ProductionOutput_quantityKg_whole" CHECK ("quantityKg"=trunc("quantityKg")) NOT VALID;
ALTER TABLE "TransformationInput" ADD CONSTRAINT "TransformationInput_quantityKg_whole" CHECK ("quantityKg"=trunc("quantityKg")) NOT VALID;
ALTER TABLE "TransformationOutput" ADD CONSTRAINT "TransformationOutput_quantityKg_whole" CHECK ("quantityKg"=trunc("quantityKg")) NOT VALID;
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_agreedQuantityKg_whole" CHECK ("agreedQuantityKg"=trunc("agreedQuantityKg")) NOT VALID;
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_quantityKg_whole" CHECK ("quantityKg"=trunc("quantityKg")) NOT VALID;
ALTER TABLE "ShipmentAllocation" ADD CONSTRAINT "ShipmentAllocation_quantityKg_whole" CHECK ("quantityKg"=trunc("quantityKg")) NOT VALID;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON "ProductionInput" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON "ProductionOutput" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON "TransformationInput" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON "TransformationOutput" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON "ShipmentLine" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON "ShipmentAllocation" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON "StockLot" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();

COMMIT;
