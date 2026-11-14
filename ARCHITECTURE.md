# Wallet-Find Architecture

## 1. System Overview

Wallet-Find is a production-oriented, multilingual web platform built as two applications:

- `frontend/`: React, TypeScript and Vite.
- `backend/`: Node.js, Express, TypeScript and Prisma.
- PostgreSQL is the authoritative persistent store.

The backend owns business rules and security-sensitive decisions. The frontend presents state and collects user input; it is never authoritative for financial balances, answer correctness, contest progression, ranking, or official time.

## 2. Backend Structure

Backend capabilities are organized by domain under `backend/src/modules/`. Domain services own business logic and database operations; controllers and routes expose HTTP interfaces; schemas validate external input.

Important domains include:

- Authentication and authorization.
- Contest lifecycle, submissions, progression and leaderboard.
- Wallet operations, deposits, withdrawals and transaction history.
- Prize funding, allocation, settlement and payout.
- Turnkey integration and webhook processing.
- Shared system jobs and background processing.

Keep dependencies directed toward domain services and shared infrastructure. Avoid duplicating financial or contest rules in controllers and frontend components.

## 3. Contest and Prize Rules

The backend is authoritative for contest timing, eligibility, answer validation, progression, completion and ranking.

Contest rounds use server-controlled time boundaries. A player's official completion and ranking are determined by backend records, not by the browser clock.

Prize accounting is maintained internally in PostgreSQL. Internal prize allocations are ledger/accounting operations and must not be represented as on-chain transfers unless an actual blockchain transaction is submitted.

The prize pool is global and shared across supported languages. Language-specific contest content does not create separate prize funds. Funding eligibility, settlement and payout must remain transactional, concurrency-safe and idempotent.

## 4. Wallet and Blockchain Integration

The wallet subsystem uses Turnkey for supported wallet operations and Polygon PoS assets configured by the application. The backend is responsible for wallet provisioning, deposit observation, withdrawal authorization, transaction recording and reconciliation.

Security requirements:

- Never expose private keys, signing material or provider secrets to the frontend.
- Verify provider webhook authenticity before processing events.
- Make webhook processing and financial credits idempotent.
- Keep provider activity/history distinct from Wallet-Find's internal accounting records.
- Use database transactions and appropriate locks for balance-affecting operations.
- Never treat a displayed balance or client-submitted amount as authoritative.

Production financial tests must use a dedicated test database and explicit opt-in safeguards. They must never run against the production database.

## 5. Background Processing and Scaling

The backend can run in separate process roles:

- `all`: HTTP API and background processors.
- `web`: HTTP API only.
- `worker`: background processors only.

The role is controlled by `APP_ROLE`. The worker entry point is `backend/src/worker.ts`.

Work that must execute once across multiple instances uses database-backed leases, atomic claims or resource-specific locks. PostgreSQL remains the source of truth; process-local memory must not be authoritative for shared business or financial state.

Each process uses a bounded database connection pool. Total pool capacity must be planned across all API and worker instances before scaling.

See [docs/SCALABILITY.md](docs/SCALABILITY.md) for deployment and horizontal-scaling guidance.

## 6. Frontend and Internationalization

Frontend code is organized into pages, reusable components, services and internationalization resources.

- Pages compose user-facing workflows.
- Shared components provide reusable presentation.
- Services centralize API communication.
- The i18n layer owns locale selection, translations and text direction.

Supported locales currently include Persian, English, German, Spanish, French, Arabic, Turkish, Portuguese, Russian and Simplified Chinese. Some locales use English base resources with locale-specific overrides; this is an implementation detail that must be reflected in translation coverage checks.

Every user-facing change must be reviewed across all supported locales. Persian and Arabic require right-to-left presentation; other supported locales use left-to-right presentation.

Do not move authoritative business logic into React components or duplicate raw API requests across unrelated pages.

## 7. Database and Data Integrity

Prisma schema and migrations define the database model. Schema changes must be accompanied by reviewed migrations.

Financial and contest records require clear transaction boundaries, uniqueness constraints where appropriate, and safe handling of concurrent requests. Migrations must preserve existing production data unless a separately approved data migration explicitly changes it.

Test cleanup must be scoped to test-owned records and isolated test databases. Never run broad cleanup against production data.

## 8. Quality and Security Gates

Changes should pass the repository's applicable automated checks:

- Backend TypeScript build and tests.
- Frontend TypeScript build and lint.
- Prisma migration validation against a disposable PostgreSQL database.
- Dependency security checks in CI.

Financial integration tests require their dedicated test-database safeguards and explicit opt-in. A successful build alone does not prove that every integration test has run.

## 9. Engineering Principles

1. Prefer the smallest safe change that satisfies the requirement.
2. Keep each module and file focused on a clear responsibility.
3. Preserve existing external behavior unless a requirement explicitly changes it.
4. Keep financial rules server-side, transactional and idempotent.
5. Avoid unnecessary dependencies, duplicate implementations and generated artifacts in source control.
6. Validate changes with automated checks before deployment.
7. Scale API and worker capacity horizontally before considering an architectural rewrite.
