# Wallet-Find / 12Keys — MVP Checklist

## Current Status

This checklist reflects the current repository state.

### Frontend

- [x] React + Vite + TypeScript setup
- [x] Mobile-first 12Keys visual style
- [x] Home page
- [x] Authentication page
- [x] Frontend API client
- [x] Vite API proxy
- [x] Persian language
- [x] English language
- [x] RTL/LTR switching
- [x] Bottom navigation
- [x] Competition page
- [x] 3 × 4 contest grid
- [x] Inline answer input
- [x] Key stage component

### Backend

- [x] Node.js + Express + TypeScript
- [x] Prisma
- [x] PostgreSQL / Neon
- [x] JWT authentication
- [x] USER / ADMIN roles
- [x] Register
- [x] Login
- [x] Contest model
- [x] Contest creation
- [x] ContestClue model
- [x] Clue creation
- [x] Submission model
- [x] Submit Answer API
- [x] Backend TypeScript build

## MVP Work Remaining

### Contest Data

- [ ] Active contest API
- [ ] Current clue API
- [ ] Contest status management
- [ ] Contest activation
- [ ] Contest completion
- [ ] Contest end handling

### Player Progression

- [ ] Determine current clue server-side
- [ ] Prevent clue skipping
- [ ] Return only current clue
- [ ] Unlock next clue after correct answer
- [ ] Keep current clue after wrong answer
- [ ] Record incorrect attempt count
- [ ] Record authoritative response time
- [ ] Detect completion after clue 12

### Frontend Contest Integration

- [ ] Load active contest from backend
- [ ] Load current clue from backend
- [ ] Remove mock contest data
- [ ] Remove mock clue content
- [ ] Send inline answer to backend
- [ ] Display correct answer feedback
- [ ] Display incorrect answer feedback
- [ ] Update 3 × 4 grid after correct answer
- [ ] Unlock next key without opening another page
- [ ] Display contest timer from authoritative backend state where required

### Leaderboard

- [ ] Leaderboard API
- [ ] Server-side ranking
- [ ] Total solving time
- [ ] Incorrect-answer tie-breaker
- [ ] Completed player status
- [ ] Frontend leaderboard integration
- [ ] Live/refresh behavior

### Profile

- [ ] Current user API
- [ ] Player statistics API
- [ ] Contest history API
- [ ] Frontend profile integration

### Wallet

- [ ] Keep wallet UI mocked for MVP
- [ ] Define future wallet architecture
- [ ] Do not implement real withdrawals until contest engine is stable

### Admin

- [ ] Admin contest list
- [ ] Admin contest activation
- [ ] Admin contest edit
- [ ] Admin clue management
- [ ] Admin contestant view
- [ ] Admin results view

### Security

- [ ] Backend authorization audit
- [ ] Rate limiting
- [ ] Input validation audit
- [ ] Prevent answer leakage
- [ ] Prevent contest skipping
- [ ] Prevent unauthorized submissions
- [ ] Security headers
- [ ] CORS review
- [ ] Production environment validation

### Testing

- [ ] Unit tests for answer normalization
- [ ] Unit tests for progression logic
- [ ] Unit tests for timing logic
- [ ] Unit tests for leaderboard logic
- [ ] API integration tests
- [ ] Authentication tests
- [ ] Contest flow E2E test
- [ ] Mobile UI E2E test
- [ ] Frontend build
- [ ] Backend build
- [ ] Frontend lint
- [ ] Backend lint

### Production

- [ ] Production environment configuration
- [ ] Frontend deployment
- [ ] Backend deployment
- [ ] Database production configuration
- [ ] Domain configuration
- [ ] HTTPS verification
- [ ] Health checks
- [ ] Error monitoring
- [ ] Backup strategy
- [ ] Production smoke test

## MVP Completion Criteria

The MVP can be marked complete only when all of the following are true:

- [ ] A new user can register
- [ ] A registered user can login
- [ ] An authenticated user can access an active contest
- [ ] The user sees a 3 × 4 grid containing 12 keys
- [ ] Only the current key is answerable
- [ ] The answer is entered inside the current key cell
- [ ] A wrong answer is recorded
- [ ] A wrong answer does not unlock the next key
- [ ] A correct answer is recorded
- [ ] A correct answer unlocks the next key
- [ ] The backend controls progression
- [ ] Response timing is calculated server-side
- [ ] The player can solve all 12 keys
- [ ] Completing key 12 marks the contest as completed for the player
- [ ] The player appears in the leaderboard
- [ ] The leaderboard ranking is calculated server-side
- [ ] Persian and English work
- [ ] RTL/LTR works correctly
- [ ] Frontend build passes
- [ ] Backend build passes
- [ ] Critical automated tests pass
- [ ] No critical security issue is known

## Agent Execution Rule

Do not mark an item complete based only on code existence.

An item may be marked [x] only after:
1. implementation exists
2. relevant tests pass
3. build/lint passes where applicable
4. the behavior has been verified
5. no obvious regression exists

If an item is uncertain, leave it unchecked and report the uncertainty.
