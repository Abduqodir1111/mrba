ALTER TABLE "BusinessDocument" ADD COLUMN "recoverySourceId" UUID REFERENCES "BusinessDocument"("id") ON DELETE RESTRICT;
CREATE INDEX "BusinessDocument_recoverySourceId_idx" ON "BusinessDocument"("recoverySourceId");
ALTER TABLE "BusinessDocument" ADD CONSTRAINT "kettle_recovery_quantities" CHECK ("type" <> 'KETTLE_RECOVERY' OR ("batchId" IS NOT NULL AND "adjustmentBeforeKg" > 0 AND "adjustmentAfterKg" > 0 AND "differenceKg" = "adjustmentAfterKg" - "adjustmentBeforeKg"));
CREATE FUNCTION protect_kettle_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."type" = 'KETTLE_RECOVERY' AND (NEW."recoverySourceId", NEW."adjustmentBeforeKg", NEW."adjustmentAfterKg", NEW."differenceKg", NEW."batchId") IS DISTINCT FROM (OLD."recoverySourceId", OLD."adjustmentBeforeKg", OLD."adjustmentAfterKg", OLD."differenceKg", OLD."batchId") THEN
  RAISE EXCEPTION 'Posted recovery quantities are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kettle_recovery_immutable BEFORE UPDATE ON "BusinessDocument" FOR EACH ROW EXECUTE FUNCTION protect_kettle_recovery();
