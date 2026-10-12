ALTER TABLE "ProductionBatch" DROP CONSTRAINT "batch_status";
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "batch_status" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REVERSED', 'RETURNED'));
