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
- Completed participants rank before incomplete participants in any progress view.
- Prize ranking is determined by ascending `completedAt - startsAt` (equivalent to ascending `completedAt` within one round).
- Failed attempts do not add an independent ranking penalty; their 60-second lock already costs real contest time.
- Incomplete participants are not included in prize calculations and receive zero.
- Exact completion-time ties share the same rank. Pool the fixed prizes for all occupied rank slots among tied participants and divide that pooled amount equally. Example: two participants tied for ranks 1 and 2 split the combined 70% equally. The next distinct completion time receives rank 3.
- If fewer than three participants complete the round, only the fixed shares for the ranks actually awarded are paid. Unfilled podium shares and an unallocated fourth-and-lower share remain unused in that settled round; nothing is transferred to a later round.

## 6. Prize calculation and experimental accounting

Let `pool` be the round's total prize pool.

- Nominal rank allocations are `pool * 0.50`, `pool * 0.225`, and `pool * 0.125` for ranks 1, 2, and 3. For a tie spanning rank slots, sum those occupied slots' allocations and divide equally among all tied participants.
- The fourth-and-lower completion pool is `pool * 0.10`. Eligible finisher `i` receives weight `w_i = 900 seconds - elapsed completion time`; calculate with integer milliseconds and allocate `share_i = lowerPool * w_i / sum(weights)`.
- The project dividend pool receives `pool * 0.05` at every round settlement. This contribution is saved in the round's ledger and aggregated separately from participant awards.
- If a round has no submissions, the 5% project contribution is still recorded and the remaining 95% stays unused in that settled round. No unawarded balance, including any unfilled podium share or unused lower-rank share, rolls over into another round.
- Store participant awards and the project-dividend contribution durably. Finalization must be idempotent so a retry cannot duplicate either one.
- Define the pool's currency/token unit and rounding/leftover-dust policy in payout implementation; do not use floating-point arithmetic for token amounts.

## 7. Round lifecycle and scheduling

Recommended lifecycle: `SCHEDULED -> ACTIVE -> FINISHED`, with the next round already scheduled to begin at the same boundary the prior round ends.

- Scheduler creates/prepares the next round ahead of time with 12 complete, ordered clues and a fixed start/end.
- At `startsAt`, it becomes playable.
- At `endsAt`, submission APIs reject new attempts based on timestamps immediately, regardless of scheduler lag. A background scheduler then marks the round finished, snapshots ranking, computes awards, and records the project contribution. Unused balances are not carried forward.
- There is no pause between rounds. The next round starts at the exact end boundary of the previous round; the scheduler should prepare it in advance.
- Use database constraints/transactions to prevent overlapping active rounds and duplicate round creation for the same scheduled boundary.
- If the application restarts or the scheduler is late, it must reconcile all due round transitions in chronological order. Do not reopen a round that has ended.

## 8. Data model changes to evaluate

Existing schema already includes `Contest` with `startsAt`, `endsAt`, `status`; `ContestClue` with sequence and answer; `Submission` with answer, correctness, and server submission timestamp; and `ContestSetting` with clue count and prize percentages.

Current schema/service gaps against these rules:

- `ContestSetting.publishIntervalMinutes` and globally scheduled `publishedAt` currently support timed clue releases. This conflicts with immediate next-clue access and a 15-minute total round. Remove timed release from gameplay logic (or leave the field unused for compatibility) and gate clues only by sequential successful solves.
- Persist per-participant/per-clue lock state (`lockedUntil`) rather than relying on browser state.
- Persist an unambiguous participant completion timestamp and/or derive it safely from the first accepted correct submission for clue 12.
- Persist the fixed prize-pool amount/currency for each round, participant award records, and project-dividend ledger entries.
- Persist a final leaderboard/settlement marker or use a transactional settlement record so finalization and project-dividend allocation are idempotent.
- Add uniqueness/concurrency safeguards for one successful solve per user, round, and clue. Failed attempts may remain multiple rows.
- Consider a participant-round record to represent users who joined but have not submitted yet; the existing `Submission`-only leaderboard cannot list participants with zero attempts.
- Add indexes for scheduled start/end and settlement status as appropriate.

Schema changes should be made through a new Prisma migration, not by editing the production database manually.

## 9. API behavior (contract-level)

Existing routes should be evolved rather than duplicated where possible.

- Get active/current round: return round ID, status, server time, `startsAt`, `endsAt`, remaining seconds, solved answers, current clue, lock state, and next-round start time when the next round is scheduled.
- Submit answer: validate authentication, active window, clue order, and lock on the server; return whether correct, next clue/progress, `lockedUntil` on wrong answer, and completion time on clue 12.
- Get leaderboard: while active, return provisional completion rankings and progress; after finish, return the frozen final ranking and awards.
- Get round results: return final rank, completion status, elapsed time, participant prize amount, project contribution, and unused balance where appropriate.
- Never return `correctAnswer` to the client before it is solved.
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
