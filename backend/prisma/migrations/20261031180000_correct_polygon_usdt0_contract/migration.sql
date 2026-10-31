-- Correct the Polygon PoS USDT0 token address.
-- The previous foundation migration contained a typo in the final hex character
-- (...e8E). The canonical Polygon PoS token address ends in ...e8F.
-- Keep deposits and withdrawals disabled until the chain scanner and payout
-- worker are implemented, tested, and explicitly enabled by operations.

UPDATE "chain_assets"
SET
  "contractAddress" = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  "symbol" = 'USDT0',
  "displayName" = 'USDT0 on Polygon PoS',
  "decimals" = 6,
  "issuerClassification" = 'USDT0_POLYGON_POS_CANONICAL_DEPLOYMENT',
  "canonicalStatus" = 'ONCHAIN_VERIFIED',
  "depositEnabled" = false,
  "withdrawalEnabled" = false,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'asset-polygon-usdt0';

-- Ensure the Polygon wallet network remains disabled until deposit monitoring
-- and withdrawal execution are both ready.
UPDATE "wallet_network_accounts"
SET
  "depositEnabled" = false,
  "withdrawalEnabled" = false,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "chainId" = 137;
