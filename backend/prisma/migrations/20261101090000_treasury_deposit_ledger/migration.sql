-- Independent Polygon treasury deposit records and treasury accounting ledger.
-- This migration is additive only: it does not enable deposits or withdrawals.

CREATE TYPE "TreasuryLedgerType" AS ENUM (
  'DEPOSIT_CREDIT',
  'DEPOSIT_REVERSAL',
  'WITHDRAWAL_DEBIT',
  'WITHDRAWAL_REVERSAL',
  'GAS_EXPENSE',
  'MANUAL_ADJUSTMENT'
);

CREATE TABLE "treasury_deposits" (
  "id" TEXT NOT NULL,
  "treasuryWalletId" TEXT NOT NULL,
  "chainAssetId" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "transactionHash" TEXT NOT NULL,
  "logIndex" INTEGER NOT NULL,
  "blockNumber" BIGINT NOT NULL,
  "blockHash" TEXT NOT NULL,
  "fromAddress" TEXT NOT NULL,
  "toAddress" TEXT NOT NULL,
  "rawAmount" TEXT NOT NULL,
  "amountMicro" BIGINT,
  "status" "WalletDepositStatus" NOT NULL DEFAULT 'DETECTED',
  "confirmationCount" INTEGER NOT NULL DEFAULT 0,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "creditedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "treasury_deposits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "treasury_deposits_chainId_transactionHash_logIndex_key"
  ON "treasury_deposits"("chainId", "transactionHash", "logIndex");
CREATE INDEX "treasury_deposits_treasuryWalletId_status_detectedAt_idx"
  ON "treasury_deposits"("treasuryWalletId", "status", "detectedAt");
CREATE INDEX "treasury_deposits_chainId_blockNumber_idx"
  ON "treasury_deposits"("chainId", "blockNumber");

ALTER TABLE "treasury_deposits"
  ADD CONSTRAINT "treasury_deposits_treasuryWalletId_fkey"
  FOREIGN KEY ("treasuryWalletId") REFERENCES "treasury_wallets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treasury_deposits"
  ADD CONSTRAINT "treasury_deposits_chainAssetId_fkey"
  FOREIGN KEY ("chainAssetId") REFERENCES "chain_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "treasury_ledger" (
  "id" TEXT NOT NULL,
  "treasuryWalletId" TEXT NOT NULL,
  "depositId" TEXT,
  "type" "TreasuryLedgerType" NOT NULL,
  "amountMicro" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USDT0',
  "transactionHash" TEXT,
  "referenceKey" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "treasury_ledger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_ledger_amount_nonzero_check" CHECK ("amountMicro" <> 0)
);

CREATE UNIQUE INDEX "treasury_ledger_referenceKey_key"
  ON "treasury_ledger"("referenceKey");
CREATE INDEX "treasury_ledger_treasuryWalletId_effectiveAt_idx"
  ON "treasury_ledger"("treasuryWalletId", "effectiveAt");
CREATE INDEX "treasury_ledger_type_effectiveAt_idx"
  ON "treasury_ledger"("type", "effectiveAt");
CREATE INDEX "treasury_ledger_depositId_idx"
  ON "treasury_ledger"("depositId");

ALTER TABLE "treasury_ledger"
  ADD CONSTRAINT "treasury_ledger_treasuryWalletId_fkey"
  FOREIGN KEY ("treasuryWalletId") REFERENCES "treasury_wallets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treasury_ledger"
  ADD CONSTRAINT "treasury_ledger_depositId_fkey"
  FOREIGN KEY ("depositId") REFERENCES "treasury_deposits"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
