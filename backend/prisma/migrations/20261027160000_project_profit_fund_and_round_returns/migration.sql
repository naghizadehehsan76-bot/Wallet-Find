ALTER TYPE "GlobalPrizeLedgerType" ADD VALUE 'ROUND_UNUSED_RETURN';

ALTER TABLE "prize_pools"
ADD COLUMN "returnedToGlobalMicro" BIGINT NOT NULL DEFAULT 0;

CREATE TYPE "ProjectProfitLedgerType" AS ENUM ('CONTRIBUTION_SHARE');

CREATE TABLE "project_profit_funds" (
  "id" TEXT NOT NULL DEFAULT 'project',
  "balanceMicro" BIGINT NOT NULL DEFAULT 0,
  "totalContributedMicro" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_profit_funds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_profit_ledger" (
  "id" TEXT NOT NULL,
  "type" "ProjectProfitLedgerType" NOT NULL,
  "amountMicro" BIGINT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "referenceKey" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_profit_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_profit_ledger_referenceKey_key"
ON "project_profit_ledger"("referenceKey");

CREATE INDEX "project_profit_ledger_type_effectiveAt_idx"
ON "project_profit_ledger"("type", "effectiveAt");
