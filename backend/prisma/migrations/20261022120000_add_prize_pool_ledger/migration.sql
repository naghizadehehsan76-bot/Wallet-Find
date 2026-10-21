CREATE TYPE "PrizeLedgerType" AS ENUM ('TEST_FUNDING', 'ROLLOVER_IN', 'ROLLOVER_OUT', 'AWARD');

CREATE TABLE "prize_pools" (
  "id" TEXT NOT NULL,
  "contestId" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USDT',
  "seededMicro" BIGINT NOT NULL DEFAULT 0,
  "rolloverInMicro" BIGINT NOT NULL DEFAULT 0,
  "rolloverOutMicro" BIGINT NOT NULL DEFAULT 0,
  "awardedMicro" BIGINT NOT NULL DEFAULT 0,
  "testOnly" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prize_pools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prize_ledger" (
  "id" TEXT NOT NULL,
  "contestId" TEXT NOT NULL,
  "type" "PrizeLedgerType" NOT NULL,
  "amountMicro" BIGINT NOT NULL,
  "note" TEXT NOT NULL,
  "referenceKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prize_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prize_awards" (
  "id" TEXT NOT NULL,
  "contestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "amountMicro" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SIMULATED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prize_awards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prize_pools_contestId_key" ON "prize_pools"("contestId");
CREATE UNIQUE INDEX "prize_ledger_referenceKey_key" ON "prize_ledger"("referenceKey");
CREATE INDEX "prize_ledger_contestId_type_idx" ON "prize_ledger"("contestId", "type");
CREATE UNIQUE INDEX "prize_awards_contestId_userId_key" ON "prize_awards"("contestId", "userId");
CREATE INDEX "prize_awards_contestId_rank_idx" ON "prize_awards"("contestId", "rank");

ALTER TABLE "prize_pools" ADD CONSTRAINT "prize_pools_contestId_fkey"
  FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prize_ledger" ADD CONSTRAINT "prize_ledger_contestId_fkey"
  FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prize_awards" ADD CONSTRAINT "prize_awards_contestId_fkey"
  FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
