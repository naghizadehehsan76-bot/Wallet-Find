# Wallet-Find code audit — 2026-11-04

## Scope and safety
- Audited the feature branch against production baseline `ba18a5ecad1c1df826febf7a1aa0396b74b13516`.
- All edits are isolated to `feature/less-code-2026-11-04`.
- No production database writes, schema changes, environment-variable changes, API route changes, wallet-flow changes, UI redesign, or deployment were performed.
- Current database export was reported as downloaded by the owner; its bytes were not independently inspected in this session.

## 1. Confirmed duplication / safe consolidation
- Fixed-scale six-decimal formatting existed independently in `contest/prize-pool.service.ts` and `stats/stats.controller.ts`.
- Added `formatAssetUnitsFixed` to the existing exact-integer asset utility and reused it in both modules.
- Preserved the old output contract: exactly six fractional digits, including trailing zeroes; negative values are not silently changed by the shared primitive. The two call sites retain their prior non-negative clamp.
- Added focused tests for zero, trailing zeroes, negative values, and zero-decimal assets.
- Kept `wallet.service.ts`'s `formatMicro` separate because it deliberately uses the variable-precision formatter and has different output semantics.

## 2. Confirmed unused/generated artifacts removed
- Removed `frontend/src/assets/react.svg` and `frontend/src/assets/vite.svg`; no source references were found.
- Removed tracked TypeScript compiler output for Prisma config: `backend/prisma.config.js`, `.js.map`, `.d.ts`, and `.d.ts.map`. The source of truth `backend/prisma.config.ts` remains.
- Added ignore entries so these generated Prisma config artifacts are not reintroduced accidentally.
- Kept `backend/src/config/test-db.ts`: it has no automated call site, but remains a useful manual database diagnostic and removing it would not meaningfully improve runtime code.

## 3. Similar code deliberately retained
- Legacy Polygon deposit scanner and generic EVM scanner are not interchangeable. They use different persistence/accounting paths and reorganization handling. The generic scanner explicitly enters cursor-only mode when `POLYGON_DEPOSIT_SCANNER_ENABLED=true`; an existing test protects that ownership gate.
- The legacy scanner is not imported by `server.ts` in the audited source, so its actual runtime activation must be checked against production configuration before any attempt to remove or reactivate it. Read-only production counts at audit time: `wallet_deposits=0`, `wallet_withdrawals=0`, `treasury_deposits=0`, `treasury_ledger=0`; newer `wallet_chain_deposits=3`, `wallet_chain_withdrawals=2`, `wallet_journals=13`, `wallet_journal_postings=26`. Empty tables alone are not proof that legacy code is safe to delete.
- Legacy `walletTransaction` balances and the journal-posting ledger remain separate in `wallet.service.ts`; do not merge or delete either without a data migration and explicit accounting reconciliation.
- Withdrawal signing, broadcast reconciliation, journal idempotency, reversal, and reorg paths remain separate. Similar-looking code here enforces different state transitions and safety guarantees.
- CI workflows overlap, but have different triggers and checks. Do not remove one until required branch-protection/status-check dependencies are verified.

## 4. Refactors recommended, not performed
- `wallet.service.ts`, `wallet.controller.ts`, `wallet-chain-withdrawal.service.ts`, `mvp-contest-seed.service.ts`, and `AdminControlCenter.tsx` are large modules. Split by responsibility only in small steps with behavior characterization tests; file size alone is not proof of duplication.
- Add focused tests around legacy-to-journal balance presentation, Turnkey webhook replay/idempotency, Polygon withdrawal uncertain-broadcast recovery, and challenge round-boundary behavior before touching those paths.
- Consider a backend unused-symbol/compiler audit separately; enabling strict unused checks across the entire backend at once may expose unrelated legacy warnings and should not be mixed into this behavior-preserving cleanup.

## Validation
- GitHub Actions CI run: [41791090157](https://github.com/naghizadehehsan76-bot/Wallet-Find/actions/runs/41791090157)
- Head commit tested: `43e944826752a9ff5ea8301e97200c56faee7752`
- Backend: dependency install, high/critical audit gate, Prisma migrations on disposable PostgreSQL 18, Prisma generation, TypeScript build, and all configured backend tests passed.
- Frontend: dependency install, high/critical audit gate, TypeScript/Vite build, and ESLint passed.
- No production deployment or merge was performed.
