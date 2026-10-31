-- Custodial wallet foundation. This migration intentionally does not activate chain operations.
-- Remove only simulated prize credits/award history; preserve challenge participation history
-- and all non-prize wallet transactions.

DELETE FROM "wallet_transactions"
WHERE "type" = 'PRIZE_CREDIT';

DELETE FROM "prize_awards";

DELETE FROM "prize_ledger"
WHERE "type" = 'AWARD';

UPDATE "prize_pools"
SET "awardedMicro" = 0,
    "updatedAt" = CURRENT_TIMESTAMP;

CREATE TYPE "WalletAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "WalletDepositStatus" AS ENUM ('DETECTED', 'CONFIRMING', 'CONFIRMED', 'CREDITED', 'REORGED', 'IGNORED');
CREATE TYPE "WalletWithdrawalStatus" AS ENUM ('REQUESTED', 'RESERVED', 'APPROVED', 'SIGNING', 'BROADCAST', 'CONFIRMED', 'FAILED', 'CANCELLED');

CREATE TABLE "wallet_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "turnkeyWalletId" TEXT,
  "turnkeyAccountId" TEXT,
  "address" TEXT NOT NULL,
  "derivationPath" TEXT,
  "status" "WalletAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_accounts_userId_key" ON "wallet_accounts"("userId");
CREATE UNIQUE INDEX "wallet_accounts_address_key" ON "wallet_accounts"("address");
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "wallet_network_accounts" (
  "id" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "networkKey" TEXT NOT NULL,
  "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
  "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_network_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_network_accounts_walletAccountId_chainId_key" ON "wallet_network_accounts"("walletAccountId", "chainId");
CREATE INDEX "wallet_network_accounts_chainId_depositEnabled_idx" ON "wallet_network_accounts"("chainId", "depositEnabled");
ALTER TABLE "wallet_network_accounts" ADD CONSTRAINT "wallet_network_accounts_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "chain_assets" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "decimals" INTEGER NOT NULL,
  "issuerClassification" TEXT NOT NULL,
  "canonicalStatus" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
  "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chain_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chain_assets_chainId_contractAddress_key" ON "chain_assets"("chainId", "contractAddress");
CREATE INDEX "chain_assets_chainId_depositEnabled_idx" ON "chain_assets"("chainId", "depositEnabled");

-- BNB Chain's commonly used 0x55... token is a Binance-Peg / wrapped representation,
-- not a Tether-published native USDt contract. Keep it disabled pending explicit product acceptance.
INSERT INTO "chain_assets" (
  "id", "chainId", "contractAddress", "symbol", "displayName", "decimals",
  "issuerClassification", "canonicalStatus", "depositEnabled", "withdrawalEnabled", "updatedAt"
) VALUES (
  'asset-bsc-usdt-6d8', 56, '0x55d398326f99059fF775485246999027B3197955', 'USDT',
  'Binance-Peg BSC-USD (USDT representation)', 18,
  'BINANCE_PEG_WRAPPED_REPRESENTATION_NOT_TETHER_ISSUED',
  'REVIEW_REQUIRED', false, false, CURRENT_TIMESTAMP
);

INSERT INTO "chain_assets" (
  "id", "chainId", "contractAddress", "symbol", "displayName", "decimals",
  "issuerClassification", "canonicalStatus", "depositEnabled", "withdrawalEnabled", "updatedAt"
) VALUES (
  'asset-polygon-usdt0', 137, '0xc2132D05D31c914a87C6611C10748AEb04B58e8E', 'USDT0',
  'USDT0 on Polygon PoS', 6,
  'USDT0_NATIVE_POLYGON_DEPLOYMENT',
  'ONCHAIN_VERIFICATION_REQUIRED', false, false, CURRENT_TIMESTAMP
);

CREATE TABLE "wallet_deposits" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "walletNetworkAccountId" TEXT NOT NULL,
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
  "creditedLedgerId" TEXT,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "creditedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_deposits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_deposits_creditedLedgerId_key" ON "wallet_deposits"("creditedLedgerId");
CREATE UNIQUE INDEX "wallet_deposits_chainId_transactionHash_logIndex_key" ON "wallet_deposits"("chainId", "transactionHash", "logIndex");
CREATE INDEX "wallet_deposits_userId_status_detectedAt_idx" ON "wallet_deposits"("userId", "status", "detectedAt");
CREATE INDEX "wallet_deposits_chainId_blockNumber_idx" ON "wallet_deposits"("chainId", "blockNumber");
ALTER TABLE "wallet_deposits" ADD CONSTRAINT "wallet_deposits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_deposits" ADD CONSTRAINT "wallet_deposits_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_deposits" ADD CONSTRAINT "wallet_deposits_walletNetworkAccountId_fkey" FOREIGN KEY ("walletNetworkAccountId") REFERENCES "wallet_network_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_deposits" ADD CONSTRAINT "wallet_deposits_chainAssetId_fkey" FOREIGN KEY ("chainAssetId") REFERENCES "chain_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wallet_withdrawals" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "walletNetworkAccountId" TEXT NOT NULL,
  "chainAssetId" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "destinationAddress" TEXT NOT NULL,
  "amountMicro" BIGINT NOT NULL,
  "feeMicro" BIGINT NOT NULL DEFAULT 0,
  "status" "WalletWithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
  "idempotencyKey" TEXT NOT NULL,
  "turnkeyActivityId" TEXT,
  "transactionHash" TEXT,
  "failureCode" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "broadcastAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_withdrawals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_withdrawals_idempotencyKey_key" ON "wallet_withdrawals"("idempotencyKey");
CREATE UNIQUE INDEX "wallet_withdrawals_transactionHash_key" ON "wallet_withdrawals"("transactionHash");
CREATE INDEX "wallet_withdrawals_userId_status_requestedAt_idx" ON "wallet_withdrawals"("userId", "status", "requestedAt");
CREATE INDEX "wallet_withdrawals_chainId_status_idx" ON "wallet_withdrawals"("chainId", "status");
ALTER TABLE "wallet_withdrawals" ADD CONSTRAINT "wallet_withdrawals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_withdrawals" ADD CONSTRAINT "wallet_withdrawals_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_withdrawals" ADD CONSTRAINT "wallet_withdrawals_walletNetworkAccountId_fkey" FOREIGN KEY ("walletNetworkAccountId") REFERENCES "wallet_network_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_withdrawals" ADD CONSTRAINT "wallet_withdrawals_chainAssetId_fkey" FOREIGN KEY ("chainAssetId") REFERENCES "chain_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "chain_scan_cursors" (
  "chainId" INTEGER NOT NULL,
  "lastBlockNumber" BIGINT NOT NULL DEFAULT 0,
  "lastBlockHash" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chain_scan_cursors_pkey" PRIMARY KEY ("chainId")
);
