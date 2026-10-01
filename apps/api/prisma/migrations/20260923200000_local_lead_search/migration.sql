ALTER TABLE "LeadAgentConfig"
ADD COLUMN "productNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "LeadCandidate"
ADD COLUMN "contactTelegram" TEXT,
ADD COLUMN "contactWhatsapp" TEXT,
ADD COLUMN "outreachLanguage" TEXT,
ADD COLUMN "outreachText" TEXT;
