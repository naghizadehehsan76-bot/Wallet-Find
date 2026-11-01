-- Activate only the already-reviewed Polygon PoS network and its two supported assets.
-- POL is deposit-enabled as the native gas asset; USDT0 is enabled for deposits
-- and withdrawals. No user balances or existing ledger entries are modified.
DO $$
DECLARE
  network_rows INTEGER;
  pol_rows INTEGER;
  usdt0_rows INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "system_settings"
    WHERE "key" = 'wallet_global_emergency_pause'
      AND "value" = 'true'
  ) THEN
    RAISE EXCEPTION 'Cannot activate Polygon wallets while the global emergency pause is active';
  END IF;

  UPDATE "wallet_networks"
  SET
    "isEnabled" = true,
    "depositEnabled" = true,
    "withdrawalEnabled" = true,
    "finalityDepth" = 128,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE
    "id" = 'eip155:137'
    AND "family" = 'EVM'
    AND "chainId" = 137
    AND "networkKey" = 'polygon'
    AND "nativeAssetSymbol" = 'POL'
    AND "nativeAssetDecimals" = 18;
  GET DIAGNOSTICS network_rows = ROW_COUNT;
  IF network_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one verified Polygon network row; found %', network_rows;
  END IF;

  UPDATE "wallet_assets"
  SET
    "depositEnabled" = true,
    "withdrawalEnabled" = false,
    "confirmationCount" = 128,
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
    AND "verificationStatus" = 'VERIFIED';
  GET DIAGNOSTICS pol_rows = ROW_COUNT;
  IF pol_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one verified native Polygon POL asset; found %', pol_rows;
  END IF;

  UPDATE "wallet_assets"
  SET
    "depositEnabled" = true,
    "withdrawalEnabled" = true,
    "confirmationCount" = 128,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE
    "id" = 'eip155:137/erc20:0xc2132d05d31c914a87c6611c10748aeb04b58e8f'
    AND "networkId" = 'eip155:137'
    AND "assetType" = 'TOKEN'
    AND "assetReference" = 'erc20:0xc2132d05d31c914a87c6611c10748aeb04b58e8f'
    AND lower("contractAddress") = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f'
    AND "symbol" = 'USDT0'
    AND "decimals" = 6
    AND "issuerClassification" = 'USDT0_POLYGON_POS_CANONICAL_DEPLOYMENT'
    AND "verificationStatus" = 'VERIFIED';
  GET DIAGNOSTICS usdt0_rows = ROW_COUNT;
  IF usdt0_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one verified Polygon USDT0 asset; found %', usdt0_rows;
  END IF;
END $$;
