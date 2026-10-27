ALTER TYPE "PrizeLedgerType" ADD VALUE 'GLOBAL_ALLOCATION';

CREATE TYPE "GlobalPrizeLedgerType" AS ENUM ('DAILY_FUNDING', 'ROUND_ALLOCATION');

CREATE TABLE "global_prize_funds" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "balanceMicro" BIGINT NOT NULL DEFAULT 0,
  "totalFundedMicro" BIGINT NOT NULL DEFAULT 0,
  "totalAllocatedMicro" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "global_prize_funds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "global_prize_ledger" (
  "id" TEXT NOT NULL,
  "type" "GlobalPrizeLedgerType" NOT NULL,
  "amountMicro" BIGINT NOT NULL,
  "dayKey" TEXT,
  "contestId" TEXT,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "referenceKey" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "global_prize_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_prize_ledger_dayKey_key" ON "global_prize_ledger"("dayKey");
CREATE UNIQUE INDEX "global_prize_ledger_referenceKey_key" ON "global_prize_ledger"("referenceKey");
CREATE INDEX "global_prize_ledger_type_effectiveAt_idx" ON "global_prize_ledger"("type", "effectiveAt");
CREATE INDEX "global_prize_ledger_contestId_idx" ON "global_prize_ledger"("contestId");
