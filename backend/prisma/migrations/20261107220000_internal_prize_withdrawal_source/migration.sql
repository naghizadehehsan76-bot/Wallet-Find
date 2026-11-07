ALTER TABLE "wallet_chain_withdrawals"
ADD COLUMN "fundingSource" TEXT NOT NULL DEFAULT 'USER_WALLET';
