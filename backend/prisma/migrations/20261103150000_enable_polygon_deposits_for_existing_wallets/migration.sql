-- Enable incoming deposits on Polygon for all existing custodial wallet accounts.
-- This does not enable withdrawals or alter balances, deposits, or ledger entries.
UPDATE "wallet_network_accounts"
SET "depositEnabled" = TRUE,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "chainId" = 137
  AND "networkKey" = 'polygon'
  AND "depositEnabled" = FALSE;
