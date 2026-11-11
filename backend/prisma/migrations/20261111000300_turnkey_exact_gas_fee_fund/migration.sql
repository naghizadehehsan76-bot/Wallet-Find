ALTER TYPE "WalletLedgerAccount" ADD VALUE IF NOT EXISTS 'TURNKEY_FEE_FUND';

ALTER TABLE "wallet_chain_withdrawals"
ADD COLUMN "gasSponsorship" BOOLEAN NOT NULL DEFAULT false;
