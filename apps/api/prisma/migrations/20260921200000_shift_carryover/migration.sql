ALTER TABLE "StockLot" ADD COLUMN "isCarryover" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductionBatch" ADD COLUMN "previousBatchId" UUID, ADD COLUMN "carryoverKg" DECIMAL(20,3) NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "ProductionBatch_previousBatchId_key" ON "ProductionBatch"("previousBatchId");
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_previousBatchId_fkey" FOREIGN KEY ("previousBatchId") REFERENCES "ProductionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionBatch" ADD CONSTRAINT carryover_whole_positive CHECK ("carryoverKg" >= 0 AND "carryoverKg" = trunc("carryoverKg"));
