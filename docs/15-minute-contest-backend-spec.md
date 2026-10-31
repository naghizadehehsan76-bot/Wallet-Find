# Wallet-Find: 15-Minute Contest Backend Specification

Status: prize allocation rules updated on main; build/test and deployment still require verification.
Target repository: Wallet-Find
Branch: main

## 1. Purpose

Define the backend behavior for a shared, server-timed, 12-answer contest round. The server is authoritative for start/end times, answer validation, one-minute wrong-answer locks, completion times, rankings, prize allocation, and finalization.

## 2. Approved rules

- A round lasts exactly 15 minutes (900 seconds), using the same server-defined `startsAt` and `endsAt` for all participants.
- Late entrants use the official round start time, not their join time. Client clocks are display-only.
- Participants solve 12 clues in order. A correct answer immediately unlocks the next clue. A wrong answer locks only that clue for 60 seconds.
- No answer is accepted at or after `endsAt`. Incomplete participants receive no prize; previously accepted correct answers remain saved.
- Contest scheduling, activation, expiry, answer validation, and rankings operate independently of prize-fund and payment services.
- The global prize fund may increase only from real deposits verified on-chain and reconciled by the deposit processor. No simulated daily contribution, manual test funding, or virtual credit is permitted.
- At the start of each round, up to 1.000000 USDT is reserved from the confirmed global fund exactly once. If less than 1 USDT is available, only the available balance is reserved. If the available balance is zero, the round prize is zero.
- Real prize transfers remain disabled until custody signing, payment execution, confirmations, and reconciliation are implemented and enabled. No user wallet may be credited merely because a round is completed.
- No unused amount is rolled into a later round unless a separately approved real-fund policy is implemented.
- Every round lasts 15 minutes and consecutive rounds start on fixed server-aligned boundaries without a gap.

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

- Only participants who solve all 12 clues before `endsAt` qualify for participant prizes. Incomplete participants receive zero.
- Rank completed participants by ascending `completedAt - startsAt`.
- Exact completion-time ties share a rank. For a tie spanning top-three slots, combine the percentages of the slots occupied and split their combined amount equally among those tied.
- Unfilled allocations remain unused in that round and never increase a later round's allocation.

## 6. Prize calculation and real-fund safeguards

- The maximum per-round allocation is 1.000000 USDT from the verified global prize-fund balance.
- The reservation must be atomic and idempotent. Use integer micro-USDT units and database uniqueness constraints.
- If the global fund has less than 1 USDT, reserve only the available amount. If it has no confirmed funds, the round allocation and prize are zero.
- Ranking and contest completion must never depend on successful prize allocation, settlement, or transfer.
- No participant prize or wallet credit is recorded until an actual on-chain transfer is successfully confirmed and reconciled.

## 7. Round lifecycle and scheduling

Recommended lifecycle: `SCHEDULED -> ACTIVE -> FINISHED`.

- Prepare the next round before its start boundary with 12 complete, ordered clues.
- At `startsAt`, initialize that round's fixed 1 USDT allocation from the global fund exactly once.
- At `endsAt`, submissions are rejected immediately. The scheduler marks the round finished, snapshots ranking, computes awards, records the project contribution, and marks settlement complete.
- The scheduler records 50 USDT of simulated daily funding once per UTC date and backfills missed dates after a restart. Unique ledger keys prevent duplicate daily funding.
- No unused round balance is rolled into a later round.
- Use database constraints and transactions to prevent duplicate round allocations or duplicate round creation. Reconcile transitions chronologically if the application restarts.

## 8. Data model

- `GlobalPrizeFund` stores the currently available global balance and cumulative daily funding and round allocations.
- `GlobalPrizeLedger` records one 50 USDT daily contribution per UTC date and each round's fixed 1 USDT allocation with unique reference keys.
- `PrizePool` stores the amount allocated to each round, awards, project contribution, and settlement status. Legacy rollover fields remain for compatibility but the new test settlement sets rollover to zero.
- `PrizeLedger` records the round's global allocation, participant awards, and project contribution.
- The global project dividend total is calculated from settled `projectProfitMicro` values. It is not a participant wallet balance or a real asset.
- Repeated requests must not add duplicate daily funding, duplicate round allocations, or duplicate awards.

## 9. API behavior (contract-level)

- Get the current round: return round ID, status, server time, `startsAt`, `endsAt`, remaining time, solved answers, current clue, and lock state.
- Submit answer: enforce authentication, active-window, clue-order, and lock rules server-side. Return correctness, progress, lock expiry on wrong answer, and completion time for clue 12.
- Get leaderboard: return provisional progress during the round and frozen ranking and awards after settlement.
- Get round results: return final rank, completion status, elapsed time, participant award, project contribution, and unused amount.
- Never return `correctAnswer` before it is solved.
- Distinguish API errors such as `CONTEST_NOT_STARTED`, `CONTEST_FINISHED`, `CLUE_LOCKED`, `ANSWER_INCORRECT`, `CLUE_OUT_OF_ORDER`, and `NO_ACTIVE_CONTEST`.


## 10. Required tests before deployment

1. A round starts at its scheduled boundary and ends exactly 900 seconds later.
2. A late entrant's elapsed time is measured from the official start.
3. A correct answer immediately exposes the next clue.
4. A wrong answer locks only that participant and clue for 60 seconds.
5. Attempts are rejected during the lock and accepted after it expires.
6. A request at/after `endsAt` is rejected even if the scheduler has not marked the round finished.
7. Completion time for clue 12 is immutable and measured from `startsAt`.
8. Duplicate/concurrent submissions cannot bypass sequence, locks, or completion state.
9. Incomplete participants receive no award.
10. The 50% / 22.5% / 12.5% podium shares, speed-weighted 10%, and 5% project contribution account for the round allocation.
11. A 50 USDT contribution is recorded exactly once per UTC date; repeated scheduler/API calls do not duplicate it.
12. Missed UTC days are backfilled after a scheduler outage.
13. Each round receives a fixed 1 USDT allocation (or the remaining balance if below 1 USDT) only once.
14. A round with no participants still records the 5% project contribution; the other 95% remains unused and nothing rolls over.
15. Ranks four and lower divide the 10% allocation by completion-speed weights.
16. Unused shares do not increase the next round's allocation.
17. Finalization is safe to retry, and consecutive rounds start every 15 minutes without a gap.


## 11. Prize pool and payment status

- Simulated funding, simulated awards, and test wallet credits are retired.
- Real deposits are not credited until the chain scanner verifies token contract, destination, amount, block confirmations, and reorg safety.
- Real payouts are not enabled until transaction signing, broadcast, confirmation, idempotency, and reconciliation are implemented.
- The scheduler has no dependency on prize-pool services. Prize allocation is a separate operation and must not delay or prevent a challenge from starting or finishing.
