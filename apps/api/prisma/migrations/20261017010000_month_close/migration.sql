ALTER TABLE "CommandReceipt" ADD COLUMN "reportingPeriodId" UUID;
CREATE INDEX "CommandReceipt_reportingPeriodId_idx" ON "CommandReceipt"("reportingPeriodId");
CREATE TABLE "MonthClose" (
 id UUID PRIMARY KEY, number INTEGER NOT NULL UNIQUE,
 "previousId" UUID REFERENCES "MonthClose"(id) ON DELETE RESTRICT,
 "from" TIMESTAMPTZ NOT NULL, "to" TIMESTAMPTZ NOT NULL,
 "closedBy" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "ownerName" TEXT NOT NULL, snapshot JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK ("from" < "to")
);
CREATE INDEX "MonthClose_createdAt_idx" ON "MonthClose"("createdAt");
CREATE TRIGGER month_close_immutable BEFORE UPDATE OR DELETE ON "MonthClose" FOR EACH ROW EXECUTE FUNCTION prevent_history_change();
