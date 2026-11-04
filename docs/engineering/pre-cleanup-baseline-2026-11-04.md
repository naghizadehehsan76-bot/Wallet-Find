# Pre-cleanup baseline — 2026-11-04

## Source control
- Production branch: `main`
- Baseline commit: `ba18a5ecad1c1df826febf7a1aa0396b74b13516`
- Immutable rollback branch: `backup/pre-cleanup-2026-11-04`
- Refactor branch: `refactor/less-code-2026-11-04`
- No changes have been made to `main`.

## Render production
- Service: `wallet-find`
- Service ID: `srv-dba85ccs728c73dubf2g`
- URL: `https://wallet-find.onrender.com`
- Production deploy ID: `dep-dbl5tfp7lnhs739u8bhg`
- Deployed commit: `ba18a5ecad1c1df826febf7a1aa0396b74b13516`
- Deploy status: `live`
- Latest observed CI run: `41730299172`, conclusion `success`
- Health check path configured: `/health`
- Auto deploy is enabled on `main`.

## Render PostgreSQL baseline
- Database: `wallet_find`
- Resource ID: `dpg-dba851cs728c73duat7g-a`
- PostgreSQL major version: 18
- Database size at capture: 28 MB
- Captured: 2026-11-04 07:06 UTC
- Applied Prisma migrations: 35; all observed as finished, none rolled back.
- No schema migration or data mutation is part of this cleanup.

## Exact row-count baseline
Captured read-only from production at 2026-11-04 07:06 UTC:
- users: 11
- contests: 1,571
- contest_clues: 18,852
- submissions: 427
- wallet_accounts: 5
- wallet_addresses: 22
- wallet_networks: 7
- wallet_assets: 9
- wallet_chain_deposits: 3
- wallet_chain_withdrawals: 2
- wallet_journals: 13
- wallet_journal_postings: 26
- turnkey_webhook_events: 7
- prize_pools: 924
- prize_ledger: 77
- global_prize_ledger: 77
- audit_logs: 5,142

## Safety constraints
- Preserve all current product behavior, API contracts, database schema, data, UI and visual design.
- Do not change wallet balances, ledger semantics, Turnkey signing/webhooks, deposit/withdrawal processing, contest timing/rules, prize logic, or production environment variables.
- No deletion of a scanner or legacy accounting path until ownership, runtime activation, data dependencies, and regression coverage are proven.
- All changes stay on the refactor branch and must pass CI before a pull request is considered.
- Do not merge or deploy until a current database export is verified and the user approves the production rollout.

## Database backup status
A previously downloaded 2.5 MB export was reported on 2026-11-02, but it predates later database migrations and production activity observed on 2026-11-03/04. It is not accepted as a current pre-cleanup restore point.
The available Render connector supports read-only SQL inspection but does not expose a database export/backup operation. A fresh Render dashboard export must be created and verified before production rollout.
