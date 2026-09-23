ALTER TABLE "LeadCandidate"
  ADD COLUMN "companySize" TEXT,
  ADD COLUMN "estimatedOrderKg" INTEGER,
  ADD COLUMN "fitReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "riskFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "internalNotes" TEXT,
  ADD COLUMN "nextContactAt" TIMESTAMPTZ,
  ADD COLUMN "lastContactedAt" TIMESTAMPTZ;
