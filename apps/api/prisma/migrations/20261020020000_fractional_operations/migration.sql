-- Decimal(20,3) already stores gram precision. Remove only integer-weight checks.
ALTER TABLE "StockReservation" DROP CONSTRAINT "StockReservation_quantityKg_whole";
ALTER TABLE "StockReservation" DROP CONSTRAINT "StockReservation_remainingKg_whole";
ALTER TABLE "ProductionInput" DROP CONSTRAINT "ProductionInput_quantityKg_whole";
ALTER TABLE "ProductionOutput" DROP CONSTRAINT "ProductionOutput_quantityKg_whole";
ALTER TABLE "TransformationInput" DROP CONSTRAINT "TransformationInput_quantityKg_whole";
ALTER TABLE "TransformationOutput" DROP CONSTRAINT "TransformationOutput_quantityKg_whole";
ALTER TABLE "ContractLine" DROP CONSTRAINT "ContractLine_agreedQuantityKg_whole";
ALTER TABLE "ShipmentLine" DROP CONSTRAINT "ShipmentLine_quantityKg_whole";
ALTER TABLE "ShipmentAllocation" DROP CONSTRAINT "ShipmentAllocation_quantityKg_whole";
ALTER TABLE "ProductionBatch" DROP CONSTRAINT carryover_whole_positive;
ALTER TABLE "ProductionBatch" ADD CONSTRAINT carryover_positive CHECK ("carryoverKg" >= 0);
