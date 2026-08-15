# Wallet-Find / 12Keys — Testing Strategy

## Build checks

Frontend:
- `npm ci`
- `npm run build`
- `npm run lint`

Backend:
- `npm ci`
- `DATABASE_URL=<test-value> npx prisma generate`
- `npm run build`

## Critical contest behavior to test

1. Authentication is required for contest participation.
2. An inactive contest cannot accept submissions.
3. A player receives only the current unsolved clue.
4. A player cannot submit a future clue.
5. A wrong answer creates a Submission with `isCorrect=false`.
6. A wrong answer does not unlock the next clue.
7. A correct answer creates a correct Submission.
8. A correct answer unlocks exactly the next clue.
9. Correct-answer response time is calculated server-side.
10. Clue 12 completion produces a completed contest state.
11. Correct answers are never returned by player-facing APIs.
12. Leaderboard ordering is calculated server-side.

## Security regression tests

- unauthorized requests return 401
- admin endpoints reject non-admin users
- malformed inputs return 400
- correctAnswer never appears in current-clue responses
- answer submissions are rate-limited
- authentication endpoints are rate-limited
- oversized JSON requests are rejected

## End-to-end flow

Register
→ Login
→ Load active contest
→ Load current clue
→ Submit wrong answer
→ Verify current key remains active
→ Submit correct answer
→ Verify next key becomes current
→ Repeat through key 12
→ Verify completion
→ Verify leaderboard entry

## UI regression checks

The 12Keys prototype remains the visual source of truth.

Verify after frontend changes:
- 3 × 4 grid remains intact
- current input remains inside the active key cell
- solved/current/locked states remain visually distinct
- mobile layout remains usable
- Persian RTL works
- English LTR works
- bottom navigation remains usable
- wallet-inspired ordered-word interaction remains intact

## CI policy

Every pull request should run the repository CI workflow.

A feature should not be considered complete solely because local TypeScript compilation succeeds.

CI success plus relevant behavioral verification is required.
