# Multi-Asset / Multi-Chain Deposit Infrastructure

## Purpose

Wallet-Find uses a shared EVM deposit pipeline. Network adapters provide chain RPC, confirmation, chunk-size, and reorganization settings. The ChainAsset registry defines the assets accepted on each chain. The scanner, canonicality checks, idempotency, confirmation processing, deposit records, and accounting ledgers are shared.

Asset identity is the database ChainAsset.id (and its chain ID), not the ticker symbol. Amounts in deposit, wallet-ledger, and treasury-ledger records are stored in the asset's smallest units. The legacy database field name amountMicro is retained for compatibility; it does not imply six decimals.

## Current network adapters

| Network | Chain ID | Network key | Scanner flag |
|---|---:|---|---|
| Ethereum | 1 | ethereum | ETHEREUM_DEPOSIT_SCANNER_ENABLED |
| Optimism | 10 | optimism | OPTIMISM_DEPOSIT_SCANNER_ENABLED |
| BNB Smart Chain | 56 | bsc | BSC_DEPOSIT_SCANNER_ENABLED |
| Polygon PoS | 137 | polygon | POLYGON_DEPOSIT_SCANNER_ENABLED |
| Arbitrum One | 42161 | arbitrum | ARBITRUM_DEPOSIT_SCANNER_ENABLED |
| Base | 8453 | base | BASE_DEPOSIT_SCANNER_ENABLED |
| Avalanche C-Chain | 43114 | avalanche | AVALANCHE_DEPOSIT_SCANNER_ENABLED |

Every network is disabled unless its scanner flag, RPC URL, a safe start-block boundary, verified deposit-enabled asset records, and enabled wallet accounts are present. Existing Polygon environment flags remain compatible.

Per-network settings follow the network prefix, for example POLYGON_RPC_URL, POLYGON_DEPOSIT_START_BLOCK, POLYGON_USDT_CONFIRMATIONS, POLYGON_SCAN_BLOCK_CHUNK, and POLYGON_REORG_LOOKBACK_BLOCKS. The confirmation setting currently uses POLYGON_USDT_CONFIRMATIONS for backward compatibility even when other Polygon assets are scanned.

## Asset registry

A token asset is a row in chain_assets with:
- its real chain ID and exact token contract address;
- the token's verified decimals and display name;
- canonicalStatus = ONCHAIN_VERIFIED;
- depositEnabled = true only after contract verification and operational approval;
- withdrawalEnabled = false unless a separately reviewed withdrawal path is implemented.

A native asset uses contractAddress = 'native' and the native coin's actual decimals. The Polygon native POL row is registered with 18 decimals but remains deposit-disabled by default. BSC's Binance-Peg token record remains in REVIEW_REQUIRED and disabled; it is not automatically treated as Tether-issued USDT.

Never enable an asset solely because its ticker or name looks familiar. Verify the network, official contract address, decimals, issuer/representation, and deposit policy first.

## Scanner behavior

- One ChainScanCursor exists per chain. All enabled ERC-20 assets and the native asset on that chain share the same scanned block range.
- ERC-20 deposits are identified from Transfer event logs.
- Native deposits are identified from successful top-level transactions with a positive native value sent directly to a configured wallet/treasury address.
- Native transfers made internally by contract execution are not discovered by the current direct-transaction scanner. Supporting those requires a trace API or a trusted indexed-transfer provider before enabling deposits for assets/networks that depend on internal transfers.
- The cursor advances only after the enabled asset scans for the block range have completed.
- Database unique keys and conditional state transitions make detection and crediting idempotent.
- Deposits are credited only after the required confirmations and block-hash canonicality check.
- Reorganized credited deposits receive compensating wallet/treasury ledger entries. A user wallet affected by a credited reorg is suspended for review.

The scanner initializes a missing cursor at the current confirmation-safe head. It intentionally does not backfill historical blocks on first activation. Set the correct start block and inspect the cursor before enabling a new network.

## Ledger and prize-fund separation

Wallet ledger balances are calculated independently by chainAssetId; two assets with the same ticker on different networks are never combined. Treasury ledger entries also reference their chain asset and carry signed smallest-unit amounts.

The prize-funding snapshot and prize allocation are intentionally restricted to the exact Polygon USDT0 asset (asset-polygon-usdt0). Native POL, and every other asset/network, is excluded from the USDT0 prize fund. Keep withdrawals disabled until an asset-specific execution and reconciliation path is reviewed.

## Safe onboarding checklist

1. Add the network's adapter descriptor to evm-network.registry.ts using its official chain configuration and dedicated environment-variable names.
2. Configure and test its RPC URL, start block, confirmation policy, scan chunk, and reorg lookback.
3. Register each supported native/token asset with the exact chain ID, contract/native marker, decimals, issuer classification, and verified status.
4. Keep deposit and withdrawal flags off until the contract and scanner are reviewed; do not activate all registered assets automatically.
5. Provisioning creates a disabled wallet-network account for registered EVM chains. The operator gate enables only accounts for a scanner whose network deposit setting is explicitly enabled.
6. Test repeated scans, late confirmations, duplicate logs, failed native transactions, reorg before credit, reorg after credit, and separate balances for same-ticker assets on different networks.
7. Confirm that treasury snapshots and prize allocation still use only the intended prize asset.
8. Enable deposits only after CI, staging tests, and an operational review.

## Not included

This is an EVM-oriented base. Bitcoin, Solana, and other non-EVM networks need separate chain adapters and address/account models; they should not be added by pretending they are ERC-20 tokens. Withdrawal execution remains asset-specific and disabled for new assets.
