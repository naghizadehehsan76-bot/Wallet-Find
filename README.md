# Wallet-Find / 12Keys

Wallet-Find is a multilingual, mobile-first 12-key sequential contest platform.

## Current product surface

- Player authentication and profile
- Server-authoritative 12-key contest engine
- 3 × 4 inline word-entry experience
- Leaderboard
- Admin contest factory and lifecycle controls
- Scheduled contest activation and clue publication
- Audit logging and rate limits
- Persian/English UI with RTL/LTR support
- Advertising data model prepared for advertiser workflows

## Repository layout

- `frontend/` React + Vite + TypeScript client
- `backend/` Express + Prisma + PostgreSQL API
- `AGENTS.md` engineering-agent rules
- `PRODUCT_SPEC.md` product requirements
- `ARCHITECTURE.md` system architecture
- `UI_RULES.md` visual rules
- `MVP_CHECKLIST.md` completion criteria
- `TESTING.md` testing requirements
- `SECURITY_RULES.md` security requirements

## Local development

### Backend

```bash
cd backend
npm install
cp .env.example .env
npx prisma generate
npm run build
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run build
npm run dev
```

The Vite development server proxies `/api` to `http://localhost:3000`.

## Required backend environment

- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `PORT` (optional, defaults to 3000)
- `CONTEST_SCHEDULER_INTERVAL_MS` (optional, defaults to 30000)

Production must provide a strong secret and an explicit `CORS_ORIGIN`.

## Production release gates

A release is not production-ready until all of the following pass:

1. frontend build
2. frontend lint
3. backend build
4. Prisma client generation
5. database migrations applied
6. contest end-to-end test
7. authentication smoke test
8. security smoke test
9. HTTPS configured
10. production environment secrets configured
11. backup and monitoring configured

## Important external dependencies

Real money movement and real advertising payment settlement require an external payment provider or blockchain integration plus production secrets. The repository must not fabricate successful payouts when an external settlement provider is unavailable.

Until those integrations are configured and tested in production, prize payout should remain explicitly marked as pending/manual rather than pretending to be automated.
