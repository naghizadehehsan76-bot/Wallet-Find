# Wallet-Find / 12Keys — Agent Instructions

## Mission

Build and maintain Wallet-Find as a production-ready, multilingual, mobile-first web application based on the existing product concept and UI prototype.

The primary goal is to complete the product from the current repository state to a tested MVP and then to a production-ready version.

## Source of Truth

The existing `12keys.html` UI prototype is the visual source of truth for the user-facing experience.

Do not redesign the interface unless explicitly requested.

Preserve:
- overall visual identity
- colors
- spacing
- typography
- mobile-first layout
- 12-key concept
- 3x4 contest grid
- inline answer input
- bottom navigation
- page hierarchy
- visual tone

Any UI change must preserve the existing design language.

## Product Rules

The main contest contains 12 keys/clues.

Keys are solved in order.

The player answers the current clue directly inside the current key cell.

Do not create a separate answer page unless explicitly requested.

A wrong answer:
- is recorded
- does not unlock the next key
- does not reveal the correct answer

A correct answer:
- is recorded
- records response time
- unlocks the next key

The backend is authoritative for:
- contest state
- current clue
- answer correctness
- progression
- response timing
- ranking
- winner determination

Never trust the frontend for security-sensitive decisions.

## Architecture

Frontend:
- React
- TypeScript
- Vite

Backend:
- Node.js
- Express
- TypeScript
- Prisma

Database:
- PostgreSQL
- Neon

Authentication:
- JWT
- USER and ADMIN roles

## Multilingual Requirements

The application must support multiple languages.

Persian is the current primary language.

English is also supported.

The architecture must allow additional languages later.

UI text must not be unnecessarily hardcoded directly into components.

Use the i18n layer.

Language changes must support:
- translation changes
- RTL/LTR direction changes
- locale-appropriate number formatting where appropriate

Persian and Arabic should use RTL.

English should use LTR.

## Development Rules

Before changing code:
1. inspect the existing implementation
2. identify what already exists
3. avoid duplicating functionality
4. preserve working behavior

Do not rewrite working modules unnecessarily.

Prefer small, isolated changes.

Do not change database schema unless required by the product specification.

Do not create migrations unless the schema change is actually required.

## Testing Rules

Every meaningful feature must pass:
- TypeScript build
- lint
- relevant automated tests

For user-facing flows, prefer end-to-end testing.

Do not mark a task complete just because the code compiles.

## Security Rules

Never expose:
- password hashes
- JWT secrets
- database credentials
- correct clue answers to unauthorized clients

Validate all user input on the backend.

Authentication and authorization must always be enforced server-side.

Do not trust frontend state for permissions or contest progression.

## Git Rules

Do not commit secrets.

Keep commits focused and descriptive.

Do not remove unrelated user changes.

Before completing a task:
- inspect git diff
- run tests/build
- report changed files
- report any remaining risks

## Completion Rule

A task is complete only when:
1. implementation is finished
2. validation succeeds
3. tests/build succeed
4. no obvious regression is introduced
5. acceptance criteria are satisfied

If blocked, explain the blocker instead of silently making an unsafe assumption.
