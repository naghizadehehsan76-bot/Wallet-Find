# Wallet-Find / 12Keys

Wallet-Find is a mobile-first, bilingual (Persian/English) twelve-clue contest application. Players solve clues in order; the server validates answers, records attempts and response timing, and calculates the leaderboard. The wallet screen is a display-only MVP placeholder.

## Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL / Neon, Prisma
- Authentication: JWT with USER and ADMIN roles

## Local development

Requirements: Node.js 24+, npm, and a PostgreSQL development database.

### 1. Configure the backend

From the repository root:

    cd backend
    npm ci
    cp .env.example .env

Set `DATABASE_URL` to a development PostgreSQL connection string and replace `JWT_SECRET` with a long random secret. Keep `.env` private and never commit real credentials.

Generate Prisma Client and start the API:

    npx prisma generate
    npm run build
    npm test
    npm run dev

The API listens on port 3000 by default. Health check: `GET /health`.

### 2. Start the frontend

Open a second terminal from the repository root:

    cd frontend
    npm ci
    npm run dev

Vite prints the local URL and proxies `/api` calls to `http://localhost:3000`. The language selector supports Persian (RTL) and English (LTR).

## Admin and contest flow

1. Register an account. For a local development environment, assign `ADMIN` to the admin account in your development database before using the admin contest factory.
2. Create a contest and save all twelve clues (sequences 1 through 12).
3. Activate the contest manually, or set a start time and let the backend scheduler activate it once all twelve clues exist.
4. Players register/log in, solve clues in order, and appear on the server-calculated leaderboard.

Scheduled clue release times are managed by the backend scheduler and contest settings. Player-facing clue responses do not include `correctAnswer`.

## Validation

The GitHub Actions workflow runs:

- Backend: `npm ci`, `npx prisma generate`, `npm run build`, `npm test`
- Frontend: `npm ci`, `npm run build`, `npm run lint`

## Security and MVP boundaries

- Never commit database credentials, JWT secrets, private keys, or recovery phrases.
- Answer correctness, permissions, progression, timing, and ranking belong on the backend.
- The wallet UI is mocked. Real deposits and withdrawals are not implemented.
- Production use still needs deployment configuration, backups, monitoring, and a security review.

See `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `SECURITY_RULES.md`, `TESTING.md`, and `MVP_CHECKLIST.md` for details.
