-- Additive Multi-Asset / Multi-Chain wallet foundation.
-- Legacy Polygon/USDT0 models and all existing financial rows remain intact.
-- No deposit/withdrawal flags are enabled and no existing balances are migrated.

CREATE TYPE "WalletNetworkFamily" AS ENUM ('EVM', 'BITCOIN', 'SOLANA');
CREATE TYPE "WalletAssetType" AS ENUM ('NATIVE', 'TOKEN');
CREATE TYPE "WalletAssetVerificationStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REVIEW_REQUIRED', 'REJECTED');
CREATE TYPE "WalletAddressType" AS ENUM ('EVM', 'BITCOIN', 'SOLANA');
CREATE TYPE "WalletLedgerEntryType" AS ENUM ('DEPOSIT_CREDIT', 'DEPOSIT_REVERSAL', 'WITHDRAWAL_RESERVE', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_SETTLEMENT', 'NETWORK_FEE', 'INTERNAL_TRANSFER', 'MANUAL_ADJUSTMENT');
CREATE TYPE "WalletLedgerDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "WalletLedgerAccount" AS ENUM ('USER_AVAILABLE', 'USER_RESERVED', 'CUSTODY_ASSET', 'EXTERNAL_COUNTERPARTY', 'NETWORK_FEE_EXPENSE', 'SYSTEM_CLEARING');

CREATE TABLE "wallet_networks" (
  "id" TEXT NOT NULL,
  "family" "WalletNetworkFamily" NOT NULL,
  "chainId" INTEGER,
  "networkKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "nativeAssetSymbol" TEXT NOT NULL,
  "nativeAssetDecimals" INTEGER NOT NULL,
  "explorerTransactionUrlTemplate" TEXT,
  "finalityDepth" INTEGER NOT NULL DEFAULT 1,
  "isTestnet" BOOLEAN NOT NULL DEFAULT false,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
  "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_networks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_networks_chainId_key" ON "wallet_networks"("chainId");
CREATE UNIQUE INDEX "wallet_networks_networkKey_key" ON "wallet_networks"("networkKey");
CREATE INDEX "wallet_networks_family_isEnabled_idx" ON "wallet_networks"("family", "isEnabled");

INSERT INTO "wallet_networks" (
  "id", "family", "chainId", "networkKey", "displayName",
  "nativeAssetSymbol", "nativeAssetDecimals", "explorerTransactionUrlTemplate",
  "finalityDepth", "isTestnet", "isEnabled", "depositEnabled", "withdrawalEnabled", "updatedAt"
) VALUES
  ('eip155:137', 'EVM', 137, 'polygon', 'Polygon PoS', 'POL', 18, 'https://polygonscan.com/tx/{txHash}', 128, false, false, false, false, CURRENT_TIMESTAMP),
  ('eip155:56', 'EVM', 56, 'bsc', 'BNB Smart Chain', 'BNB', 18, 'https://bscscan.com/tx/{txHash}', 32, false, false, false, false, CURRENT_TIMESTAMP);

CREATE TABLE "wallet_assets" (
  "id" TEXT NOT NULL,
  "networkId" TEXT NOT NULL,
  "assetType" "WalletAssetType" NOT NULL,
  "assetReference" TEXT NOT NULL,
  "contractAddress" TEXT,
  "symbol" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "decimals" INTEGER NOT NULL,
  "issuerClassification" TEXT NOT NULL,
  "verificationStatus" "WalletAssetVerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "minDepositAtomic" DECIMAL(78,0),
  "confirmationCount" INTEGER NOT NULL DEFAULT 1,
  "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
  "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_assets_decimals_check" CHECK ("decimals" BETWEEN 0 AND 255),
  CONSTRAINT "wallet_assets_min_deposit_check" CHECK ("minDepositAtomic" IS NULL OR "minDepositAtomic" >= 0)
);
CREATE UNIQUE INDEX "wallet_assets_networkId_assetReference_key" ON "wallet_assets"("networkId", "assetReference");
CREATE INDEX "wallet_assets_networkId_depositEnabled_idx" ON "wallet_assets"("networkId", "depositEnabled");
CREATE INDEX "wallet_assets_networkId_withdrawalEnabled_idx" ON "wallet_assets"("networkId", "withdrawalEnabled");
ALTER TABLE "wallet_assets" ADD CONSTRAINT "wallet_assets_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "wallet_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mirror the already-known Polygon and BSC asset metadata into the new registry.
-- Flags remain disabled; verification labels are copied conservatively.
INSERT INTO "wallet_assets" (
  "id", "networkId", "assetType", "assetReference", "contractAddress",
  "symbol", "displayName", "decimals", "issuerClassification",
  "verificationStatus", "confirmationCount", "depositEnabled", "withdrawalEnabled", "updatedAt"
)
SELECT
  'eip155:' || ca."chainId"::text || '/erc20:' || lower(ca."contractAddress"),
  wn."id",
  'TOKEN',
  'erc20:' || lower(ca."contractAddress"),
  lower(ca."contractAddress"),
  ca."symbol",
  ca."displayName",
  ca."decimals",
  ca."issuerClassification",
  CASE
    WHEN ca."canonicalStatus" = 'ONCHAIN_VERIFIED' THEN 'VERIFIED'::"WalletAssetVerificationStatus"
    WHEN ca."canonicalStatus" = 'REVIEW_REQUIRED' THEN 'REVIEW_REQUIRED'::"WalletAssetVerificationStatus"
    ELSE 'PENDING_VERIFICATION'::"WalletAssetVerificationStatus"
  END,
  CASE WHEN ca."chainId" = 137 THEN 128 ELSE 32 END,
  false,
  false,
  CURRENT_TIMESTAMP
FROM "chain_assets" ca
JOIN "wallet_networks" wn ON wn."chainId" = ca."chainId"
ON CONFLICT ("networkId", "assetReference") DO NOTHING;

-- Native gas assets are registered independently so fee accounting can be
-- asset-scoped. They remain disabled until native deposit parsing and policies
-- have been separately validated and intentionally enabled.
INSERT INTO "wallet_assets" (
  "id", "networkId", "assetType", "assetReference", "contractAddress",
  "symbol", "displayName", "decimals", "issuerClassification",
  "verificationStatus", "confirmationCount", "depositEnabled", "withdrawalEnabled", "updatedAt"
) VALUES
  ('eip155:137/native', 'eip155:137', 'NATIVE', 'native', NULL, 'POL', 'Polygon native POL', 18, 'NATIVE_NETWORK_ASSET', 'VERIFIED', 128, false, false, CURRENT_TIMESTAMP),
  ('eip155:56/native', 'eip155:56', 'NATIVE', 'native', NULL, 'BNB', 'BNB Smart Chain native BNB', 18, 'NATIVE_NETWORK_ASSET', 'VERIFIED', 32, false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("networkId", "assetReference") DO NOTHING;

CREATE TABLE "wallet_addresses" (
  "id" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "networkId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "addressType" "WalletAddressType" NOT NULL,
  "curve" TEXT,
  "derivationPath" TEXT,
  "providerAccountId" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_addresses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_addresses_walletAccountId_networkId_key" ON "wallet_addresses"("walletAccountId", "networkId");
CREATE UNIQUE INDEX "wallet_addresses_networkId_address_key" ON "wallet_addresses"("networkId", "address");
CREATE INDEX "wallet_addresses_walletAccountId_status_idx" ON "wallet_addresses"("walletAccountId", "status");
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_walletAccountId_fkey"
  FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "wallet_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill public EVM addresses for existing wallet/network account pairs only.
-- This does not create a Turnkey wallet or move any funds.
INSERT INTO "wallet_addresses" (
  "id", "walletAccountId", "networkId", "address", "addressType",
  "curve", "derivationPath", "isPrimary", "status", "updatedAt"
)
SELECT
  'legacy-evm-' || wna."id",
  wna."walletAccountId",
  wn."id",
  lower(wa."address"),
  'EVM',
  'SECP256K1',
  wa."derivationPath",
  true,
  CASE WHEN wa."status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'SUSPENDED' END,
  CURRENT_TIMESTAMP
FROM "wallet_network_accounts" wna
JOIN "wallet_accounts" wa ON wa."id" = wna."walletAccountId"
JOIN "wallet_networks" wn ON wn."chainId" = wna."chainId"
ON CONFLICT ("walletAccountId", "networkId") DO NOTHING;

CREATE TABLE "wallet_journals" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "networkId" TEXT NOT NULL,
  "walletAssetId" TEXT NOT NULL,
  "entryType" "WalletLedgerEntryType" NOT NULL,
  "referenceKey" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "reversalOfId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_journals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_journals_referenceKey_key" UNIQUE ("referenceKey"),
  CONSTRAINT "wallet_journals_reversalOfId_key" UNIQUE ("reversalOfId")
);
CREATE INDEX "wallet_journals_userId_createdAt_idx" ON "wallet_journals"("userId", "createdAt");
CREATE INDEX "wallet_journals_networkId_walletAssetId_createdAt_idx" ON "wallet_journals"("networkId", "walletAssetId", "createdAt");
ALTER TABLE "wallet_journals" ADD CONSTRAINT "wallet_journals_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_journals" ADD CONSTRAINT "wallet_journals_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "wallet_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_journals" ADD CONSTRAINT "wallet_journals_walletAssetId_fkey"
  FOREIGN KEY ("walletAssetId") REFERENCES "wallet_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_journals" ADD CONSTRAINT "wallet_journals_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "wallet_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wallet_journal_postings" (
  "id" TEXT NOT NULL,
  "journalId" TEXT NOT NULL,
  "account" "WalletLedgerAccount" NOT NULL,
  "direction" "WalletLedgerDirection" NOT NULL,
  "amountAtomic" DECIMAL(78,0) NOT NULL,
  "accountReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_journal_postings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_journal_postings_amount_check" CHECK ("amountAtomic" > 0)
);
CREATE INDEX "wallet_journal_postings_journalId_account_idx" ON "wallet_journal_postings"("journalId", "account");
ALTER TABLE "wallet_journal_postings" ADD CONSTRAINT "wallet_journal_postings_journalId_fkey"
  FOREIGN KEY ("journalId") REFERENCES "wallet_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level journal integrity: no journal may commit unless it has at
-- least two positive postings and total debits equal total credits.
CREATE FUNCTION "assert_wallet_journal_balanced"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $wallet_balance$
DECLARE
  journal_key TEXT;
  posting_count BIGINT;
  debit_total NUMERIC;
  credit_total NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'wallet_journals' THEN
    IF TG_OP = 'DELETE' THEN
      journal_key := OLD."id";
    ELSE
      journal_key := NEW."id";
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      journal_key := OLD."journalId";
    ELSE
      journal_key := NEW."journalId";
    END IF;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amountAtomic" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amountAtomic" ELSE 0 END), 0)
  INTO posting_count, debit_total, credit_total
  FROM "wallet_journal_postings"
  WHERE "journalId" = journal_key;

  IF posting_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'WALLET_JOURNAL_NOT_BALANCED: %', journal_key
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$wallet_balance$;

CREATE CONSTRAINT TRIGGER "wallet_journals_balance_check"
AFTER INSERT OR UPDATE ON "wallet_journals"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_wallet_journal_balanced"();

CREATE CONSTRAINT TRIGGER "wallet_journal_postings_balance_check"
AFTER INSERT OR UPDATE OR DELETE ON "wallet_journal_postings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_wallet_journal_balanced"();

-- Posted journal records and postings are append-only. Corrections are made
-- by adding a new reversal/adjustment journal rather than mutating history.
CREATE FUNCTION "reject_wallet_journal_mutation"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $wallet_immutable$
BEGIN
  RAISE EXCEPTION 'WALLET_JOURNAL_IS_IMMUTABLE'
    USING ERRCODE = '55000';
END;
$wallet_immutable$;

CREATE TRIGGER "wallet_journals_immutable"
BEFORE UPDATE OR DELETE ON "wallet_journals"
FOR EACH ROW EXECUTE FUNCTION "reject_wallet_journal_mutation"();

CREATE TRIGGER "wallet_journal_postings_immutable"
BEFORE UPDATE OR DELETE ON "wallet_journal_postings"
FOR EACH ROW EXECUTE FUNCTION "reject_wallet_journal_mutation"();

CREATE TABLE "wallet_chain_deposits" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "walletAddressId" TEXT NOT NULL,
  "networkId" TEXT NOT NULL,
  "walletAssetId" TEXT NOT NULL,
  "transactionReference" TEXT NOT NULL,
  "eventIndex" INTEGER NOT NULL DEFAULT 0,
  "position" TEXT NOT NULL,
  "positionValue" DECIMAL(78,0) NOT NULL,
  "blockHash" TEXT,
  "fromAddress" TEXT,
  "toAddress" TEXT NOT NULL,
  "rawAmount" TEXT NOT NULL,
  "amountAtomic" DECIMAL(78,0) NOT NULL,
  "reviewReason" TEXT,
  "status" "WalletDepositStatus" NOT NULL DEFAULT 'DETECTED',
  "confirmationCount" INTEGER NOT NULL DEFAULT 0,
  "creditedJournalId" TEXT,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "creditedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_chain_deposits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_chain_deposits_amount_check" CHECK ("amountAtomic" > 0)
);
CREATE UNIQUE INDEX "wallet_chain_deposits_networkId_transactionReference_eventIndex_key" ON "wallet_chain_deposits"("networkId", "transactionReference", "eventIndex");
CREATE UNIQUE INDEX "wallet_chain_deposits_creditedJournalId_key" ON "wallet_chain_deposits"("creditedJournalId");
CREATE INDEX "wallet_chain_deposits_userId_status_detectedAt_idx" ON "wallet_chain_deposits"("userId", "status", "detectedAt");
CREATE INDEX "wallet_chain_deposits_networkId_positionValue_idx" ON "wallet_chain_deposits"("networkId", "positionValue");
ALTER TABLE "wallet_chain_deposits" ADD CONSTRAINT "wallet_chain_deposits_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_deposits" ADD CONSTRAINT "wallet_chain_deposits_walletAccountId_fkey"
  FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_deposits" ADD CONSTRAINT "wallet_chain_deposits_walletAddressId_fkey"
  FOREIGN KEY ("walletAddressId") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_deposits" ADD CONSTRAINT "wallet_chain_deposits_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "wallet_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_deposits" ADD CONSTRAINT "wallet_chain_deposits_walletAssetId_fkey"
  FOREIGN KEY ("walletAssetId") REFERENCES "wallet_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wallet_chain_withdrawals" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "walletAddressId" TEXT NOT NULL,
  "networkId" TEXT NOT NULL,
  "walletAssetId" TEXT NOT NULL,
  "feeAssetId" TEXT,
  "destinationAddress" TEXT NOT NULL,
  "amountAtomic" DECIMAL(78,0) NOT NULL,
  "feeAtomic" DECIMAL(78,0),
  "status" "WalletWithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
  "idempotencyKey" TEXT NOT NULL,
  "signerActivityId" TEXT,
  "transactionReference" TEXT,
  "failureCode" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "estimatedGasLimit" DECIMAL(78,0),
  "maxFeePerGasAtomic" DECIMAL(78,0),
  "maxPriorityFeePerGasAtomic" DECIMAL(78,0),
  "feeQuoteExpiresAt" TIMESTAMP(3),
  "actualFeeAtomic" DECIMAL(78,0),
  "blockPosition" TEXT,
  "blockHash" TEXT,
  "confirmationCount" INTEGER NOT NULL DEFAULT 0,
  "lastCheckedAt" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "broadcastAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_chain_withdrawals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_chain_withdrawals_amount_check" CHECK ("amountAtomic" > 0),
  CONSTRAINT "wallet_chain_withdrawals_fee_check" CHECK ("feeAtomic" IS NULL OR "feeAtomic" >= 0)
);
CREATE UNIQUE INDEX "wallet_chain_withdrawals_idempotencyKey_key" ON "wallet_chain_withdrawals"("idempotencyKey");
CREATE UNIQUE INDEX "wallet_chain_withdrawals_transactionReference_key" ON "wallet_chain_withdrawals"("transactionReference");
CREATE INDEX "wallet_chain_withdrawals_userId_status_requestedAt_idx" ON "wallet_chain_withdrawals"("userId", "status", "requestedAt");
CREATE INDEX "wallet_chain_withdrawals_networkId_status_idx" ON "wallet_chain_withdrawals"("networkId", "status");
ALTER TABLE "wallet_chain_withdrawals" ADD CONSTRAINT "wallet_chain_withdrawals_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_withdrawals" ADD CONSTRAINT "wallet_chain_withdrawals_walletAccountId_fkey"
  FOREIGN KEY ("walletAccountId") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_withdrawals" ADD CONSTRAINT "wallet_chain_withdrawals_walletAddressId_fkey"
  FOREIGN KEY ("walletAddressId") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_withdrawals" ADD CONSTRAINT "wallet_chain_withdrawals_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "wallet_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_withdrawals" ADD CONSTRAINT "wallet_chain_withdrawals_walletAssetId_fkey"
  FOREIGN KEY ("walletAssetId") REFERENCES "wallet_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_chain_withdrawals" ADD CONSTRAINT "wallet_chain_withdrawals_feeAssetId_fkey"
  FOREIGN KEY ("feeAssetId") REFERENCES "wallet_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wallet_network_scan_cursors" (
  "networkId" TEXT NOT NULL,
  "cursorPosition" TEXT NOT NULL DEFAULT '0',
  "cursorHash" TEXT,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_network_scan_cursors_pkey" PRIMARY KEY ("networkId")
);
ALTER TABLE "wallet_network_scan_cursors" ADD CONSTRAINT "wallet_network_scan_cursors_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "wallet_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
