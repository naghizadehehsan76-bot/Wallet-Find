# Wallet-Find Multi-Asset / Multi-Chain Wallet Architecture

Status: architecture baseline for the staged implementation
Repository baseline reviewed: `main` at commit `456524da2ef4a6569f9adfa86478adcfbd56f792`
Safety boundary: this document does not enable deposits, withdrawals, signing, sweeping, or production migrations.

## 1. Non-negotiable design principles

- Treat a network and an asset as separate identities. Never identify an asset by symbol alone.
- Use stable chain/asset identifiers (prefer CAIP-2 for networks and CAIP-19-style identifiers for assets), with explicit aliases for existing integer EVM chain IDs.
- Keep the custody identity separate from addresses. One user Turnkey Sub-Organization may own multiple wallet/address records with different curves and derivation paths.
- Make each network's scanner, RPC health, cursor, confirmation policy, and pause state independent.
- Keep all financial calculations in integer atomic units. Never use JavaScript `number` for money.
- Preserve the current six-decimal Polygon implementation as a legacy adapter until the replacement is proven.
- Treat production database history as financial records. Migrations must be additive or have an explicit, reviewed backfill; no automatic deletion or resetting of financial history.
- Default every new network and asset to disabled. Code support is not the same as production activation.

## 2. Target domain model

### Network registry

A network is identified by a stable string such as `eip155:137`, `eip155:56`, `bip122:<genesis-hash>`, or `solana:mainnet`. Store its family (EVM, BITCOIN, SOLANA, OTHER), native asset metadata, explorer template, finality policy, and operational status. RPC URLs and credentials remain in secret environment configuration, not in public database fields.

The current integer `chainId` fields remain as compatibility fields for existing EVM records during migration. Non-EVM adapters must not be forced to invent an EVM chain ID.

### Asset registry

An asset is uniquely scoped to a network and a native/token reference. It stores symbol, display name, decimals, issuer/representation classification, verification state, minimum deposit, confirmation policy, and independent deposit/withdrawal flags. A token contract address is nullable for native assets. The BSC Binance-Peg representation must remain distinct from issuer-direct Tether USDt and disabled until the product and risk decision is explicit.

### Custody and addresses

`WalletAccount` represents the user's custody identity and Turnkey Sub-Organization. It must not be assumed to be a single universal address. A separate wallet-address record maps a custody identity to a network, address, curve, derivation path, and provider account reference. EVM networks may reuse an EVM address where technically appropriate; Bitcoin and Solana require network-specific address/account derivation.

Provisioning must be a recoverable state machine. Do not hold a database transaction open while waiting for a remote Turnkey API call. Persist a provisioning intent and stable correlation/idempotency key first, then reconcile the remote result before retrying. An uncertain remote result must require lookup/reconciliation, not blind recreation.

### Deposit and withdrawal records

Deposit identity is network + transaction reference + event/output index. Store the raw atomic amount, block/slot reference, canonicality evidence, and lifecycle state. Credit only after the adapter's configured finality rule is met.

Withdrawal identity includes network, asset, destination, raw atomic amount, fee quote (including the fee asset), idempotency key, signing activity, broadcast reference, and reconciliation state. Reserve user funds before requesting signatures. An uncertain signing/broadcast outcome must be reconciled before retrying.

## 3. Accounting and amount precision

The current `BigInt` database fields are PostgreSQL signed 64-bit integers. They are adequate for the existing six-decimal USDT0 path, but they are not a general storage type for 18-decimal tokens or full uint256 token amounts.

The generalized ledger should store atomic amounts in a representation capable of the full range required by supported chains, preferably PostgreSQL `NUMERIC(78,0)` (Prisma `Decimal @db.Decimal(78,0)`) or an explicitly validated decimal-string representation. Convert to JavaScript `bigint` at the service boundary. The amount must always be paired with an asset identifier; a bare `amountMicro` without an asset/decimal context is insufficient.

The target accounting model is an immutable, reference-keyed journal/ledger with separate dimensions for user, custody asset, network, and available/reserved balances. Each journal must balance per asset/network. Reversals are new entries with references to the original record; never rewrite or delete a posted financial entry. Legacy `WalletTransaction` rows remain visible as legacy history until an audited migration maps them; do not silently classify them as on-chain funds.

## 4. Adapter boundaries

- EVM adapter: RPC, ERC-20/native transfer parsing, EVM address validation, block hashes, confirmations/finality, reorg handling, gas quotes, and EVM transaction broadcast.
- Bitcoin adapter: UTXO discovery, address derivation, confirmations, fee estimation, spend selection, change outputs, and reorg handling.
- Solana adapter: account/token-account discovery, SPL token parsing, commitment/finality, transaction construction, and signature reconciliation.

The accounting, user API, and common lifecycle state machines must not import EVM-specific libraries. Network-specific dependencies belong inside their adapters. Turnkey support must be checked per curve/chain before an adapter is marked usable.

## 5. Migration strategy

1. Add new generalized identifiers and ledger/address tables without removing or renaming legacy columns.
2. Backfill only records that can be mapped unambiguously; preserve all others as legacy/unclassified.
3. Produce before/after row counts and balance totals for every migration.
4. Add dual-read or explicit compatibility paths, then switch writes only after tests and reconciliation prove equivalence.
5. Keep a rollback plan. Never deploy a migration that deletes prize history, wallet history, or changes a user's balance without explicit approval and a verified backup.

## 6. Staged implementation and acceptance gates

1. **General wallet foundation:** exact amount utilities, network/asset identity, address model, immutable asset-scoped ledger design, and backward compatibility.
2. **Generic deposit engine:** scanner interface, per-network leases/cursors, idempotent event processing, configurable finality and reorg recovery.
3. **Second-network proof:** BNB Smart Chain adapter and test-vector coverage. Keep the candidate Binance-Peg token disabled until its representation is accepted and verified.
4. **Generic API and UI:** dynamic network/asset metadata, network-specific addresses, and asset-scoped balances/history.
5. **Withdrawal engine:** reservations, policy checks, fee asset accounting, Turnkey signing, broadcast recovery, confirmation, and reversal.
6. **Operational/security readiness:** tests, monitoring, backups, incident runbooks, reconciliation, and a network-by-network activation checklist.
7. Bitcoin and Solana adapters can then be added independently against the same contracts; they are not implicitly production-ready because the shared model exists.

A stage passes only when its code, schema migration, CI checks, tests, and explicit acceptance criteria are verified. A successful TypeScript build alone is not proof that funds can be safely handled.


## Registry entries and adapter readiness (2026-11-01)

The additive registry migration seeds these networks with `isEnabled=false`, `depositEnabled=false`, and `withdrawalEnabled=false`:

| Network | Registry identity | Current adapter status |
|---|---|---|
| Ethereum | `eip155:1` | EVM deposit scanner implemented; withdrawal fee model implemented |
| Optimism | `eip155:10` | EVM deposit scanner implemented; withdrawals blocked pending L1 fee accounting |
| BNB Smart Chain | `eip155:56` | EVM deposit scanner and withdrawal fee model implemented |
| Polygon PoS | `eip155:137` | EVM deposit scanner and withdrawal fee model implemented; legacy USDT0 path remains separate |
| Arbitrum One | `eip155:42161` | EVM deposit scanner implemented; withdrawals blocked pending L1 fee accounting |
| Bitcoin | `bip122:000000000019d6689c085ae165831e93` | Registry placeholder only; Bitcoin adapter, UTXO accounting, address derivation, and spend workflow are not implemented |
| Solana Mainnet-Beta | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Registry placeholder only; Solana adapter, SPL token-account handling, Ed25519 custody, and transaction workflow are not implemented |

Native assets are registered as metadata for fee and balance dimensions. Their deposit and withdrawal flags remain disabled. No Bitcoin or Solana receiving address is generated by the current EVM-only Turnkey flow.

The EVM withdrawal fee adapter is deliberately limited to Ethereum, BNB Smart Chain, and Polygon. Optimism and Arbitrum require L1 data-fee accounting and remain blocked for withdrawals until that model is implemented and tested. The registry UI reports adapter implementation separately from operational activation; an implemented adapter is not equivalent to a production-ready or enabled network.

Network identities follow CAIP-2 semantics: EVM chain IDs use the `eip155` namespace, while Bitcoin and Solana use chain-specific non-EVM references.
