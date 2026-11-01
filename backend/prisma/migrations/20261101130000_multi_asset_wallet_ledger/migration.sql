-- Make internal wallet and treasury ledgers identify an asset by chain asset,
-- not by ticker alone. This prevents (for example) USDT on two chains from
-- becoming one combined balance. Amount columns retain their legacy names but
-- now consistently store the asset's smallest indivisible units.
ALTER TABLE "wallet_transactions"
  ADD COLUMN "chainId" INTEGER,
  ADD COLUMN "chainAssetId" TEXT;

ALTER TABLE "treasury_ledger"
  ADD COLUMN "chainId" INTEGER,
  ADD COLUMN "chainAssetId" TEXT;

-- Preserve historical Polygon USDT0 balances and link them to the canonical
-- asset registry row created by the wallet foundation migration.
UPDATE "wallet_transactions"
SET "chainId" = 137,
    "chainAssetId" = 'asset-polygon-usdt0',
    "currency" = 'USDT0'
WHERE "currency" IN ('USDT', 'USDT0')
  AND EXISTS (SELECT 1 FROM "chain_assets" WHERE "id" = 'asset-polygon-usdt0');

UPDATE "treasury_ledger"
SET "chainId" = 137,
    "chainAssetId" = 'asset-polygon-usdt0'
WHERE "currency" = 'USDT0'
  AND EXISTS (SELECT 1 FROM "chain_assets" WHERE "id" = 'asset-polygon-usdt0');

CREATE INDEX "wallet_transactions_chainAssetId_createdAt_idx"
  ON "wallet_transactions"("chainAssetId", "createdAt");
CREATE INDEX "treasury_ledger_chainAssetId_effectiveAt_idx"
  ON "treasury_ledger"("chainAssetId", "effectiveAt");

ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_chainAssetId_fkey"
  FOREIGN KEY ("chainAssetId") REFERENCES "chain_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treasury_ledger"
  ADD CONSTRAINT "treasury_ledger_chainAssetId_fkey"
  FOREIGN KEY ("chainAssetId") REFERENCES "chain_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Register native POL as a distinct Polygon asset. It is intentionally
-- disabled: registering an asset must never activate deposits or withdrawals.
INSERT INTO "chain_assets" (
  "id", "chainId", "contractAddress", "symbol", "displayName", "decimals",
  "issuerClassification", "canonicalStatus", "depositEnabled", "withdrawalEnabled", "updatedAt"
) VALUES (
  'asset-polygon-pol-native', 137, 'native', 'POL', 'Native POL on Polygon PoS', 18,
  'POLYGON_NATIVE_ASSET', 'ONCHAIN_VERIFIED', true, false, CURRENT_TIMESTAMP
)
ON CONFLICT ("chainId", "contractAddress") DO NOTHING;
