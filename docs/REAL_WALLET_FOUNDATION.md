# Wallet-Find Custodial Wallet — Current Implementation Audit

Audit baseline: `main` commit `456524da2ef4a6569f9adfa86478adcfbd56f792`, reviewed on 2026-11-01.
This document distinguishes repository code from production deployment and live-chain operation.

## Current code already present

- Backend dependencies include Turnkey Server SDK, Turnkey Viem integration, and viem.
- Prisma contains legacy simulated `WalletTransaction` history plus initial custodial wallet, per-network account, chain asset, user deposit, withdrawal, and scan-cursor models.
- Each user can receive a Turnkey Sub-Organization with its own EVM wallet when a verified user opens the wallet page. Creation is protected by a database advisory lock. The account stores the Sub-Organization identifiers, public API key, and an AES-256-GCM encrypted API private key.
- The first supported EVM networks are represented as BNB Smart Chain (chain ID 56) and Polygon PoS (chain ID 137); both network account flags are created disabled.
- A Polygon USDT0 deposit scanner exists. It reads ERC-20 Transfer logs, persists deposit events, tracks confirmations and block hashes, avoids duplicate log records, and has basic reorg handling.
- The Polygon withdrawal path includes an admin review step, a Turnkey signer, token/native-gas balance checks, broadcast tracking, and a confirmation/reconciliation endpoint.
- Separate Polygon prize-treasury wallet/deposit/ledger/reconciliation functionality exists. This is not the same ledger as an end-user multi-asset wallet.
- Admin endpoints expose user wallet summaries, withdrawal requests/review/execution, treasury deposits, treasury ledger history, and treasury reconciliation.

## Important limitations still present in the audited main branch

- Wallet API and UI remain hardcoded to Polygon / USDT0.
- The user balance calculation still aggregates legacy `WalletTransaction` rows by type without network or asset segregation. A legacy row is not proof of on-chain funds.
- The scanner remains Polygon-specific. Its `toMicro(raw, decimals)` helper only accepts six-decimal assets, so it cannot safely process 18-decimal tokens.
- The existing `BigInt` amount columns map to PostgreSQL signed 64-bit integers. They are not a general storage solution for full 18-decimal token amounts or uint256-scale chain amounts.
- `WalletNetworkAccount` and `WalletAccount` do not yet provide a complete network-specific address registry for Bitcoin/Solana.
- The current scanner cursor does not have a database-backed distributed lease/heartbeat.
- Turnkey provisioning performs a remote Sub-Organization creation call while a database transaction/advisory lock is open. A durable provisioning-intent/reconciliation workflow is still needed for uncertain remote outcomes.
- Withdrawal sending and recovery are not yet generic. A broadcast/signing ambiguity can require manual review.
- The UI formats some amounts through JavaScript `Number`, which can lose precision for sufficiently large values.
- There is no complete double-entry user wallet journal, and generic network adapters for Bitcoin/Solana do not yet exist.

## Existing chain-asset metadata

| Network | Asset | Chain ID | Contract | Current repository safety state |
|---|---|---:|---|---|
| BNB Smart Chain | Binance-Peg BSC-USD representation often displayed as USDT | 56 | `0x55d398326f99059fF775485246999027B3197955` | `REVIEW_REQUIRED`; 18 decimals; deposits and withdrawals disabled |
| Polygon PoS | USDT0 | 137 | `0xc2132d05d31c914a87c6611c10748aeb04b58e8f` | Marked on-chain verified in the database seed/migration; deposits and withdrawals disabled |

The BSC token above must not be described as a Tether-issued native USDt token. Keep it disabled until its representation, issuer/custody assumptions, redemption risk, contract behavior, and user-facing disclosure are explicitly accepted and verified.

## Critical migration safety warning

The migration `20261031120000_custodial_wallet_foundation` contains destructive SQL:
- deletes `wallet_transactions` rows where `type = 'PRIZE_CREDIT'`;
- deletes all `prize_awards` rows;
- deletes `prize_ledger` rows where `type = 'AWARD'`;
- resets `prize_pools.awardedMicro` to zero.

Do not assume this migration has or has not run in Production. Before any deployment that could apply pending migrations, read the production `_prisma_migrations` state, take/verify a database backup, and compare financial row counts and totals. Never replay or edit an already-applied migration. The correct remediation depends on whether it has already been applied and on the actual production data state.

## Production/deployment status

Repository code alone does not prove that Turnkey environment variables are present, that the migrations have run, that the scanner is active, or that deposits/withdrawals have been tested on-chain.

The Render Blueprint currently defines a Free web service and runs `prisma migrate deploy` during service startup. Consequently, merging code with a new migration into an auto-deploying production branch can apply database changes on restart. Production service status, applied migration history, environment variables, backup availability, and live-chain behavior must be verified separately before activation.

## Multi-asset / multi-chain implementation status

The initial repository implementation is a Polygon-first custodial wallet, not a finished Multi-Asset / Multi-Chain wallet.

The development branch `feature/multi-asset-wallet-foundation` adds:
- exact decimal-string / BigInt conversion helpers and tests;
- a generic network and network-scoped asset registry;
- network-specific public wallet-address records;
- generic chain deposit/withdrawal record models using `NUMERIC(78,0)` atomic amounts;
- a generic journal header/posting structure;
- per-network scanner cursor and lease metadata.

These branch changes are additive and do not activate deposits/withdrawals or migrate legacy simulated balances into the new ledger. They must pass CI and migration review before merge. The legacy Polygon services remain in place as compatibility code until the generic adapters and replacement lifecycle are validated.

## Remaining staged work

1. Complete and validate the generalized wallet foundation; define immutable balanced journal posting services and safe legacy-history display.
2. Implement the generic deposit engine with network adapters, leases, finality, idempotency, and reorg recovery.
3. Add BNB Smart Chain as a second-network proof while keeping the candidate token disabled until its risk decision is resolved.
4. Replace hardcoded wallet APIs/UI with asset/network-driven data and exact string formatting.
5. Implement generic withdrawal reservations, fee-asset accounting, Turnkey signing policies, broadcast recovery, and chain confirmation.
6. Run security, integration, migration, backup/recovery, monitoring, and production-readiness checks.

No production deposit, withdrawal, sweep, or prize-payout activation is implied by this document.
