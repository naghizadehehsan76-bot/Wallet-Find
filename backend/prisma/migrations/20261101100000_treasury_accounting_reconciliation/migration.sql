-- Immutable snapshots comparing Polygon USDT0 holdings with the signed treasury ledger.
-- This migration is additive and does not enable deposits, withdrawals, or transfers.

CREATE TABLE "treasury_reconciliations" (
  "id" TEXT NOT NULL,
  "treasuryWalletId" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "asset" TEXT NOT NULL DEFAULT 'USDT0',
  "blockNumber" BIGINT NOT NULL,
  "blockHash" TEXT NOT NULL,
  "onChainBalanceMicro" BIGINT NOT NULL,
  "ledgerBalanceMicro" BIGINT NOT NULL,
  "differenceMicro" BIGINT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "treasury_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "treasury_reconciliations_treasuryWalletId_createdAt_idx"
  ON "treasury_reconciliations"("treasuryWalletId", "createdAt");
CREATE INDEX "treasury_reconciliations_status_createdAt_idx"
  ON "treasury_reconciliations"("status", "createdAt");

ALTER TABLE "treasury_reconciliations"
  ADD CONSTRAINT "treasury_reconciliations_treasuryWalletId_fkey"
  FOREIGN KEY ("treasuryWalletId") REFERENCES "treasury_wallets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
