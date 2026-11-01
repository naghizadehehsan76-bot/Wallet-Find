-- Enable native Polygon POL withdrawals after the generic EVM withdrawal path
-- has been deployed and verified. The network fee is paid in POL, so the
-- withdrawal service reserves both the requested amount and the quoted fee.
DO $$
DECLARE
  network_rows INTEGER;
  pol_rows INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "system_settings"
    WHERE "key" = 'wallet_global_emergency_pause'
      AND "value" = 'true'
  ) THEN
    RAISE EXCEPTION 'Cannot enable Polygon POL withdrawals while the global emergency pause is active';
  END IF;

  SELECT COUNT(*) INTO network_rows
  FROM "wallet_networks"
  WHERE "id" = 'eip155:137'
    AND "family" = 'EVM'
    AND "chainId" = 137
    AND "networkKey" = 'polygon'
    AND "nativeAssetSymbol" = 'POL'
    AND "nativeAssetDecimals" = 18
    AND "isEnabled" = true
    AND "withdrawalEnabled" = true;

  IF network_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one enabled Polygon withdrawal network; found %', network_rows;
  END IF;

  UPDATE "wallet_assets"
  SET
    "withdrawalEnabled" = true,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE
    "id" = 'eip155:137/native'
    AND "networkId" = 'eip155:137'
    AND "assetType" = 'NATIVE'
    AND "assetReference" = 'native'
    AND "contractAddress" IS NULL
    AND "symbol" = 'POL'
    AND "decimals" = 18
    AND "issuerClassification" = 'NATIVE_NETWORK_ASSET'
    AND "verificationStatus" = 'VERIFIED'
    AND "depositEnabled" = true;

  GET DIAGNOSTICS pol_rows = ROW_COUNT;
  IF pol_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one verified native Polygon POL asset; updated %', pol_rows;
  END IF;
END $$;
