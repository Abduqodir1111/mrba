CREATE TABLE "LeadAgentConfig" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "productIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "minimumOrderKg" INTEGER,
  "buyerTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "outreachLanguages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "intermediaryMode" TEXT NOT NULL DEFAULT 'UNDECIDED',
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "LeadAgentConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadSearchRun" (
  "id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "createdBy" UUID NOT NULL,
  "criteria" JSONB NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'OPENAI',
  "errorMessage" TEXT,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadSearchRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadCandidate" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "companyName" TEXT NOT NULL,
  "normalizedWebsite" TEXT NOT NULL,
  "website" TEXT NOT NULL,
  "country" TEXT,
  "city" TEXT,
  "industry" TEXT,
  "score" INTEGER NOT NULL,
  "scoreExplanation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "contactName" TEXT,
  "contactRole" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "lastVerifiedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "LeadCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadEvidence" (
  "id" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT,
  "excerpt" TEXT,
  "verifiedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "LeadEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadStatusEvent" (
  "id" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "actorId" UUID NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadCandidate_normalizedWebsite_key" ON "LeadCandidate"("normalizedWebsite");
CREATE INDEX "LeadCandidate_status_score_idx" ON "LeadCandidate"("status", "score");
CREATE INDEX "LeadSearchRun_createdAt_idx" ON "LeadSearchRun"("createdAt");
CREATE UNIQUE INDEX "LeadEvidence_candidateId_url_key" ON "LeadEvidence"("candidateId", "url");
CREATE INDEX "LeadStatusEvent_candidateId_createdAt_idx" ON "LeadStatusEvent"("candidateId", "createdAt");
ALTER TABLE "LeadSearchRun" ADD CONSTRAINT "LeadSearchRun_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadCandidate" ADD CONSTRAINT "LeadCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LeadSearchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadEvidence" ADD CONSTRAINT "LeadEvidence_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "LeadCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadStatusEvent" ADD CONSTRAINT "LeadStatusEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "LeadCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadStatusEvent" ADD CONSTRAINT "LeadStatusEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
