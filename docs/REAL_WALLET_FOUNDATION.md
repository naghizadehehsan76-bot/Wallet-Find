# Real Wallet Foundation — BNB Smart Chain + Polygon

## Scope and safety boundary

This document defines the first implementation stage for the custodial Wallet-Find wallet. It does not activate deposits, withdrawals, signing, sweeping, or prize payouts. The current wallet API remains simulated until the later implementation and security review are complete.

Implementation branch: `feature/real-wallet-foundation`

## Confirmed product decisions

- Custodial wallet operated by Wallet-Find.
- Supported networks: BNB Smart Chain (BEP20) and Polygon PoS.
- BNB asset requested: USDT (BEP20).
- Polygon asset requested: native USDT0.
- One dedicated EVM receiving address per user may be reused on both networks.
- Balances, deposits, confirmations, withdrawals, and transaction history are network-specific.
- A withdrawal can spend only the available balance on its own network.
- No real funds or existing simulated balances are migrated automatically.

## Verified network metadata

| Network | Chain ID | Asset | Contract | Status |
|---|---:|---|---|---|
| BNB Smart Chain mainnet | 56 | USDT / BEP20 | Not approved | Deposits disabled pending authoritative contract verification |
| Polygon PoS mainnet | 137 | USDT0 | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | Listed by USDT0 deployment documentation; verify on-chain before enabling |

Important: Tether's supported-protocol page lists USDT on BNB Smart Chain as an ERC-20-compatible deployment, but its BNB section does not publish a USD₮ contract address (it lists XAU₮ only). Do not treat a popular BSC token with symbol USDT as canonical merely because its name or symbol matches. The BNB token address must be confirmed through an authoritative issuer or network source and checked on-chain (contract bytecode, decimals, symbol/name, transfer behavior, and verified explorer metadata) before deposits can be enabled.

Polygon's USDT0 documentation lists Polygon PoS (chain ID 137) token address `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`. Polygon announced the migration of its USDT to native USDT0. The implementation must identify this asset by both chain ID and exact contract address, not symbol alone.

## Current repository facts

- The current `WalletTransaction` table is a generic simulated ledger.
- Current wallet service reports `simulatedOnly: true`.
- Deposit and withdrawal endpoints create pending simulated requests; they do not monitor chains or transfer assets.
- There is no wallet-account/address model, deposit scanner, chain cursor, or signed withdrawal pipeline yet.
- `@turnkey/sdk-server` is not currently a backend dependency.
- Existing `WalletTransaction` rows must not be silently interpreted as on-chain funds.

## Proposed data model (not yet applied)

1. `WalletAccount`
   - `id`, `userId` (unique), `turnkeyWalletId`, `turnkeyAccountId`, `address`, `derivationPath`, `status`, timestamps.
   - Store public address and Turnkey identifiers only. Never store a private key, seed phrase, or API private key.

2. `WalletNetworkAccount` or network-scoped account metadata
   - `walletAccountId`, `chainId`, `networkKey`, `depositEnabled`, `withdrawalEnabled`, timestamps.
   - Unique on wallet account + chain ID.

3. `ChainAsset`
   - `chainId`, `contractAddress`, `symbol`, `decimals`, `canonicalStatus`, `depositEnabled`, `withdrawalEnabled`.
   - Unique on chain ID + normalized contract address.
   - Asset configuration must be admin-controlled and auditable; do not identify tokens by symbol alone.

4. `WalletDeposit`
   - User/account/network/asset references, transaction hash, log index, block number/hash, from/to addresses, raw token amount, normalized micro amount, confirmation state, credited ledger transaction ID, timestamps.
   - Unique idempotency key on chain ID + transaction hash + log index.
   - Credit only after configured confirmations and canonical block checks.

5. `WalletWithdrawal`
   - User/account/network/asset references, destination, raw and normalized amount, fee/gas quote, status, idempotency key, Turnkey activity/request identifiers, transaction hash, approval/audit fields, timestamps.
   - No user-supplied gas price or arbitrary calldata.

6. `ChainScanCursor`
   - Chain ID, last safely processed block, last block hash, scanner lease/heartbeat metadata.
   - Reorg-safe scanner must rewind to a configured finality buffer when block hashes diverge.

7. Ledger extensions
   - Every deposit credit, withdrawal reservation, withdrawal settlement, fee, and reversal must be represented as immutable, reference-keyed ledger entries.
   - Use database transactions and unique constraints for idempotency.
   - Keep the existing simulated ledger distinguishable from on-chain ledger history.

## Required service boundaries

- AddressProvisioningService: create or retrieve one user EVM address through Turnkey; persist public identifiers only.
- ChainScannerService: independently scan BSC and Polygon logs; validate chain, token contract, destination, amount, block canonicality, and confirmations.
- DepositCreditService: atomically credit a confirmed deposit exactly once.
- WithdrawalService: reserve funds, validate policy/limits/destination, create a narrowly scoped Turnkey signing request, broadcast, and reconcile finality.
- GasManagementService: monitor native BNB on BSC and POL on Polygon. Do not promise withdrawals until gas funding and operational ownership are defined.
- ReconciliationService: compare ledger balances with on-chain balances and outstanding reservations; alert on discrepancies.

## Security and operational requirements before live funds

- Create a dedicated non-root Turnkey service user. Do not use the Root user/API key for production transaction signing.
- Apply least-privilege Turnkey policies; restrict supported chains, token contracts, methods, destinations/allowlists, and spend limits where supported.
- Keep the Turnkey API private key only in Render secret environment variables. Never commit it or send it through chat.
- Use separate RPC endpoints for each chain, with provider failover and rate-limit handling.
- Validate chain ID and contract address server-side for every deposit and withdrawal.
- Use exact integer arithmetic (USDT/USDT0 6 decimals only after on-chain verification); never use floating point for amounts.
- Add confirmation thresholds, reorg handling, replay protection, withdrawal limits, audit logs, alerts, backups, and incident-response procedures.
- Never enable deposits or withdrawals based solely on frontend configuration.
- Do not automatically sweep user funds until gas, custody, reconciliation, and recovery procedures have been designed and tested.

## Staged implementation plan

1. **Foundation (this branch):** document network/asset decisions, safety gates, and target architecture. No runtime behavior changes.
2. **Schema-only PR:** add wallet account, asset, deposit, withdrawal, and scanner-cursor tables; generate and review a migration without enabling chain operations.
3. **Turnkey integration:** provision a non-root service identity and test wallet/address creation on test environments.
4. **Read-only chain monitoring:** monitor test deposits and validate event parsing, confirmations, duplicate handling, and reorg recovery.
5. **Controlled test withdrawals:** test signing, gas management, limits, and reconciliation with non-production assets.
6. **Production readiness review:** verify BNB USDT contract, legal/compliance requirements, custody controls, operational runbooks, backups, monitoring, and user-facing disclosures.
7. **Explicit activation:** enable one network/asset at a time only after all gates pass.

## Explicitly not done

- No Prisma schema or migration changes.
- No package installation.
- No Turnkey API calls, wallet creation, or signing.
- No Render environment-variable changes.
- No production deploy.
- No real deposits, withdrawals, sweeps, or prize payouts.
- No changes to existing balances or prize accounting.
