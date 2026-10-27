# Wallet-Find: 15-Minute Contest Backend Specification

Status: prize allocation rules updated on main; build/test and deployment still require verification.
Target repository: Wallet-Find
Branch: main

## 1. Purpose

Define the backend behavior for a shared, server-timed, 12-answer contest round. The server is authoritative for start/end times, answer validation, one-minute wrong-answer locks, completion times, rankings, prize allocation, and finalization.

## 2. Approved rules

- A round lasts exactly 15 minutes (900 seconds).
- A round's official `startsAt` is shared by every participant. A late entrant's clock still starts at the round's `startsAt`, not their join time.
- The server's persisted timestamps are authoritative; client clocks are display-only.
- A participant must solve the 12 clues in sequence.
- On a correct answer, the server accepts it immediately and unlocks the next clue immediately. There is no lock after a correct answer.
- On a wrong answer, only that participant's current clue is locked for 60 seconds. The round clock continues to run. The server rejects further attempts for that clue until `lockedUntil`.
- Participants may join while the round is active, but no answer is accepted at or after `endsAt`.
- A participant who does not solve all 12 clues by the deadline receives no prize. Correct answers already submitted remain saved and are returned when they revisit the round.
- At the deadline, the server finalizes the round, calculates and stores the final ranking and awards, and exposes the final results.
- Experimental prize pool: every round receives a fixed simulated 100.000000 USDT base pool.
- Prize split: rank 1 = 50%, rank 2 = 22.5%, rank 3 = 12.5%, and 10% is distributed among completed participants ranked fourth or lower in proportion to their speed score. A further 5% is recorded in the project dividend pool.
- The fourth-and-lower pool is proportional to time score: `score = 900 seconds - elapsed completion time in seconds`. A faster completion earns a larger share. The top-three percentages remain fixed.
- No unawarded amount is rolled into a later round. Every settled round allocates 5% to the project dividend pool; if there are no submissions, the other 95% remains unused in that round.
- Round schedule: each contest lasts 15 minutes, and a new round starts every 15 minutes on fixed server-aligned boundaries with no pause. Example: 20:00–20:15, then 20:15–20:30, then 20:30–20:45.
- The visible countdown is derived from server time and `endsAt`, and reaches zero at the official deadline.

## 3. Authoritative time and boundary conditions

- Persist `startsAt` and `endsAt = startsAt + 15 minutes` for each round.
- Define the active interval as `startsAt <= serverNow < endsAt`.
- A submission is eligible only if its server-side acceptance transaction occurs before `endsAt`. Requests received/processed at or after `endsAt` are rejected, even if the browser countdown has not updated.
- Store a server timestamp for each accepted attempt and the completion timestamp. Never trust a client-provided timestamp or elapsed duration.
- For a completed participant: `elapsedMs = completedAt - startsAt`. Do not sum per-clue response times to rank completed participants.
- A participant who enters late has the same `startsAt`; the late entry does not reset or shorten the official clock.
- A round finalization job must be idempotent and safe to retry after a process restart or delayed scheduler tick.

## 4. Clue progression and attempt processing

For each authenticated submission:

1. Load the round and validate it is within the active interval.
2. Determine the participant's first unsolved clue. Later clues cannot be answered out of order.
3. If that clue is currently locked and `serverNow < lockedUntil`, reject the attempt and return `lockedUntil` / remaining lock duration.
4. Normalize the answer using the existing answer-normalization logic, then compare it server-side to the stored answer.
5. On a wrong answer, save the failed attempt, set that participant/clue's `lockedUntil = serverNow + 60 seconds`, and return a wrong-answer response. The lock applies only to that participant and clue.
6. On a correct answer, save the successful attempt and solved timestamp exactly once; clear any lock for that clue; expose the next clue immediately.
7. If clue 12 is solved before the deadline, set `completedAt` once and freeze the participant's completion time. Repeated requests must not change it.
8. Perform checks and writes transactionally or with equivalent concurrency protection so parallel requests cannot solve multiple clues out of order, duplicate a correct solve, bypass a lock, or change a completion timestamp.

## 5. Ranking

- Only participants with all 12 clues solved before `endsAt` are prize-eligible.
- Completed participants rank by ascending `completedAt - startsAt`; incomplete participants receive no prize.
- Failed attempts do not add a separate ranking penalty; the one-minute wrong-answer lock already consumes round time.
- Exact completion-time ties share a rank. For tied podium ranks, combine the fixed allocations of the occupied top-three slots and split that amount equally among everyone tied in that group.
- Unfilled allocations, including the unallocated 10% lower-rank pool, stay unused within that settled round. They never increase a subsequent round's fixed 100 USDT pool.

## 6. Prize calculation and experimental accounting

Every round has a fixed simulated pool of exactly 100.000000 USDT.

- First place: 50% (50 USDT); second place: 22.5% (22.5 USDT); third place: 12.5% (12.5 USDT).
- Ranks four and lower share 10% (10 USDT) proportionally by speed score: `score = 900 seconds - elapsed completion time`. Use integer milliseconds for calculations.
- The project dividend pool receives 5% (5 USDT) at every settlement. Store this allocation in `PrizeLedger` as `PROJECT_PROFIT` and in the round's `projectProfitMicro` total.
- A round without participants still allocates 5 USDT to the project dividend pool; its remaining 95 USDT stays unused in that round. No unused amount is carried forward.
- If fewer than three eligible participants finish, only podium shares that can be awarded are paid. Unfilled podium shares and any unallocated lower-rank share remain unused and are not added to another round.
- Exact ties are calculated with integer micro-USDT amounts. Any division remainder stays unused; no floating-point arithmetic is used.
- Store participant awards, project-dividend contributions, and settlement state durably. Finalization must be idempotent so a retry cannot duplicate awards or project contributions.

## 7. Round lifecycle and scheduling

Recommended lifecycle: `SCHEDULED -> ACTIVE -> FINISHED`, with the next round already scheduled to begin at the same boundary the prior round ends.

- The scheduler prepares the next round ahead of time with 12 complete, ordered clues and a fixed start/end.
- At `startsAt`, the round becomes playable.
- At `endsAt`, submissions are rejected immediately. A background scheduler then marks the round finished, snapshots ranking, computes awards, records the 5% project contribution, and marks settlement complete.
- Every round receives its own fixed 100 USDT simulated pool. There is no rollover or accumulation of unused balances between rounds.
- Use database constraints/transactions to prevent overlapping rounds and duplicate round creation for one scheduled boundary.
- If the application restarts or the scheduler is late, reconcile due round transitions in chronological order. Do not reopen a round that has ended.

## 8. Data model

- `PrizePool` stores each round's fixed pool, participant awards, project contribution, and settlement status. The legacy rollover fields remain for compatibility but the test settlement sets rollover to zero.
- `PrizeLedger` stores the once-per-round simulated 100 USDT funding record, individual participant awards, and the 5 USDT project contribution as separate durable entries.
- The project dividend pool is the sum of settled `projectProfitMicro` contributions; no participant wallet balance or real asset is used for this total.
- Keep final ranking/settlement idempotent. A repeated request must return the existing awards and must not add another 100 USDT or a second project contribution.
- Schema changes must be applied through Prisma migrations, not by editing the production database manually.

## 9. API behavior (contract-level)

- Get the active/current round: return the round ID, status, server time, `startsAt`, `endsAt`, remaining time, solved answers, current clue, lock state, and next-round start when scheduled.
- Submit answer: validate authentication, the active time window, clue order, and lock server-side; return correctness, next clue/progress, lock expiry on wrong answer, and completion time for clue 12.
- Get leaderboard: return provisional rankings during a round and frozen final rankings and awards after settlement.
- Get round results: return final rank, completion status, elapsed time, participant award, 5% project contribution, and unused balance.
- Never send `correctAnswer` to the client before it is solved.
- API error states should distinguish `CONTEST_NOT_STARTED`, `CONTEST_FINISHED`, `CLUE_LOCKED`, `ANSWER_INCORRECT`, `CLUE_OUT_OF_ORDER`, and `NO_ACTIVE_CONTEST`.


## 10. Required tests before deployment

1. A round starts at its exact scheduled boundary and ends exactly 900 seconds later.
2. A late entrant's elapsed time is measured from the official start.
3. A correct answer immediately exposes the next clue without a time gate.
4. A wrong answer locks only that participant and clue for 60 seconds; the round timer continues.
5. Attempts are rejected during the lock and accepted after it expires.
6. A request at/after `endsAt` is rejected even if the scheduler has not yet marked the round finished.
7. All 12 correct answers before the deadline produce one immutable completion timestamp.
8. Duplicate/concurrent submissions cannot bypass sequence, lock, or completion rules.
9. Correct answers persist for an incomplete participant; incomplete participants receive no award.
10. The 50% / 22.5% / 12.5% podium shares, speed-weighted 10%, and 5% project contribution account for the 100 USDT pool, subject to explicit rounding rules.
11. A fixed 100 USDT simulated pool is initialized exactly once for every round; repeated reads do not add another 100.
12. A round with no submissions still records the 5% project contribution, leaves the other 95% unused, and transfers nothing to the next round.
13. With fourth-and-lower finishers, the 10% allocation is divided by completion-speed weights.
14. Unused podium or lower-rank shares remain in the settled round and never increase the next round's fixed pool.
15. Finalization is safe to retry and safe after server restart.
16. Consecutive rounds start every 15 minutes on fixed server-aligned boundaries with no pause.
17. Equal completion timestamps share the same rank and split the relevant fixed top-three rank-slot allocations equally.


## 11. Prize pool implementation and test mode

- Prize accounting is persisted in `PrizePool`, `PrizeLedger`, and `PrizeAward`; all amounts use integer micro-USDT units (six decimal places).
- Each round receives exactly 100.000000 simulated USDT, initialized once per round. This fixed test amount does not use the real-money 1% global-pool rule.
- The test distribution is 50% / 22.5% / 12.5% for the top three, 10% proportionally among ranks four and lower, and 5% recorded in the project-dividend pool at every settlement.
- Nothing rolls over from a settled round. If a round has no submissions, 5% still goes to the project-dividend pool and the other 95% remains unused.
- Admin endpoints expose pool summary and idempotent settlement. The panel shows participant awards, project-dividend allocation, and the simulated ledger.
- Future real-money model (not active): the global pool may be funded by the owner's initial crypto contribution, sponsors, and investors under separately agreed terms. Each round would be assigned 1% of the global pool's balance, then split using the same 50% / 22.5% / 12.5% / 10% / 5% allocation. Real custody, sponsor invoicing, investor profit-share terms, risk controls, and on-chain settlement need separate implementation and review.
- Test-only records must never be interpreted as real wallet balances, withdrawable funds, or proof of an on-chain transfer.
