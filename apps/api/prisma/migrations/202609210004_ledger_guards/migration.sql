BEGIN;
ALTER TABLE "ProductionInput" ADD CONSTRAINT production_input_positive CHECK ("quantityKg">0);
ALTER TABLE "ProductionOutput" ADD CONSTRAINT production_output_positive CHECK ("quantityKg">0);
ALTER TABLE "TransformationInput" ADD CONSTRAINT transformation_input_positive CHECK ("quantityKg">0);
ALTER TABLE "TransformationOutput" ADD CONSTRAINT transformation_output_positive CHECK ("quantityKg">0);
ALTER TABLE "ContractLine" ADD CONSTRAINT contract_line_positive CHECK ("agreedQuantityKg">0 AND "unitPricePerKg">0);
ALTER TABLE "ShipmentLine" ADD CONSTRAINT shipment_line_exact CHECK ("quantityKg">0 AND "unitPricePerKg">0 AND amount="quantityKg"*"unitPricePerKg");
ALTER TABLE "ShipmentAllocation" ADD CONSTRAINT shipment_allocation_positive CHECK ("quantityKg">0);
ALTER TABLE "BusinessDocument" ADD CONSTRAINT document_status CHECK (status IN ('POSTED','REVERSED'));
ALTER TABLE "ProductionBatch" ADD CONSTRAINT batch_status CHECK (status IN ('IN_PROGRESS','COMPLETED','CANCELLED','REVERSED'));
ALTER TABLE "ShiftInstance" ADD CONSTRAINT shift_status CHECK (status IN ('OPEN','CLOSED'));
ALTER TABLE "Contract" ADD CONSTRAINT contract_status CHECK (status IN ('ACTIVE','CLOSED'));
ALTER TABLE "StockReservation" ADD CONSTRAINT reservation_status CHECK (status IN ('ACTIVE','RELEASED'));
CREATE FUNCTION protect_document_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted document cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-'status'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'version')
 OR OLD.status<>'POSTED' OR NEW.status<>'REVERSED' OR NEW.version<>OLD.version+1
 THEN RAISE EXCEPTION 'Only a documented reversal may change document status'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "BusinessDocument" r WHERE r."reversesId"=OLD.id AND r.type='REVERSAL') THEN RAISE EXCEPTION 'Reversal document required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_history BEFORE UPDATE OR DELETE ON "BusinessDocument" FOR EACH ROW EXECUTE FUNCTION protect_document_history();
CREATE FUNCTION protect_command_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Command receipt cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-'result') IS DISTINCT FROM (to_jsonb(OLD)-'result') OR OLD.result<>'{}'::jsonb THEN RAISE EXCEPTION 'Command receipt is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER command_history BEFORE UPDATE OR DELETE ON "CommandReceipt" FOR EACH ROW EXECUTE FUNCTION protect_command_receipt();
CREATE INDEX balance_location ON "InventoryBalance"("locationId");
CREATE INDEX batch_shift_status ON "ProductionBatch"("shiftId",status);
CREATE INDEX shipment_contract ON "Shipment"("contractId");
CREATE INDEX document_batch ON "BusinessDocument"("batchId");
COMMIT;
