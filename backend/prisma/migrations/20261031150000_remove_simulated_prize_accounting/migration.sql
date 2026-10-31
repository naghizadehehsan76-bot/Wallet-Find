-- Retire simulated prize accounting and clear only known test/preview financial records.
-- Preserve user accounts, challenge history, and any non-test transaction records.

DELETE FROM "wallet_transactions"
WHERE "type" IN ('PRIZE_CREDIT', 'DEPOSIT_REQUEST', 'WITHDRAWAL_REQUEST');

DELETE FROM "prize_awards";

DELETE FROM "prize_ledger";

DELETE FROM "global_prize_ledger";

UPDATE "global_prize_funds"
SET "balanceMicro" = 0,
    "totalFundedMicro" = 0,
    "totalAllocatedMicro" = 0,
    "updatedAt" = CURRENT_TIMESTAMP;

DELETE FROM "project_profit_ledger";

UPDATE "project_profit_funds"
SET "balanceMicro" = 0,
    "totalContributedMicro" = 0,
    "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "prize_pools" ALTER COLUMN "testOnly" SET DEFAULT false;
ALTER TABLE "prize_awards" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

UPDATE "prize_pools"
SET "seededMicro" = 0,
    "rolloverInMicro" = 0,
    "rolloverOutMicro" = 0,
    "awardedMicro" = 0,
    "projectProfitMicro" = 0,
    "returnedToGlobalMicro" = 0,
    "testOnly" = false,
    "status" = 'OPEN',
    "settledAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP;

-- Remove obsolete simulated-only ledger enum members without rewriting migration history.
ALTER TYPE "PrizeLedgerType" RENAME TO "PrizeLedgerType_old";
CREATE TYPE "PrizeLedgerType" AS ENUM ('ROLLOVER_IN', 'ROLLOVER_OUT', 'AWARD', 'PROJECT_PROFIT', 'GLOBAL_ALLOCATION');
ALTER TABLE "prize_ledger"
  ALTER COLUMN "type" TYPE "PrizeLedgerType"
  USING ("type"::text::"PrizeLedgerType");
DROP TYPE "PrizeLedgerType_old";

ALTER TYPE "GlobalPrizeLedgerType" RENAME TO "GlobalPrizeLedgerType_old";
CREATE TYPE "GlobalPrizeLedgerType" AS ENUM ('ROUND_ALLOCATION', 'ROUND_UNUSED_RETURN');
ALTER TABLE "global_prize_ledger"
  ALTER COLUMN "type" TYPE "GlobalPrizeLedgerType"
  USING ("type"::text::"GlobalPrizeLedgerType");
DROP TYPE "GlobalPrizeLedgerType_old";
