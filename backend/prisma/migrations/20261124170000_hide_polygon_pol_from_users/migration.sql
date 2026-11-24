-- Remove native POL as a user-facing wallet asset without deleting historical records.
-- POL remains available to the Polygon infrastructure for network gas operations.
UPDATE "wallet_assets"
SET "depositEnabled" = false,
    "withdrawalEnabled" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "symbol" = 'POL'
  AND "networkId" IN (
    SELECT "id" FROM "wallet_networks" WHERE "chainId" = 137
  );
