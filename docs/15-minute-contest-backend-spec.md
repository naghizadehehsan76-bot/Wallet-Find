# Wallet-Find: 15-Minute Contest Backend Specification

Status: real Polygon USDT0 prize payout workflow implemented on a feature branch; production activation requires funded prize reserves and treasury POL for gas.
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
- Real prize transfers are processed by a separate feature-gated worker. The worker checks treasury reconciliation, all outstanding round reservations, USDT0 balance, POL gas balance, the parent Turnkey signer address, the canonical transaction receipt, the exact Transfer event, and configured finality before marking an award paid.
- A winner's wallet is credited by the existing Polygon deposit scanner after the prize transfer is detected and confirmed. Prize transfers are exempt from the ordinary minimum-deposit threshold.
- A broadcast whose outcome is uncertain is never retried automatically. It is marked for manual review to prevent duplicate payments.
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
- Exact completion-time ties share a rank. For a tie spanning top-three slots, combine the percentages of the podium slots occupied and split their combined amount equally among those tied.
- Unfilled allocations remain unused in that round and never increase a later round's allocation.

## 6. Prize calculation and real-fund safeguards

- The maximum per-round allocation is 1.000000 USDT from the verified global prize-fund balance.
- Participant awards are 50% for first, 20% for second, and 10% for third. The remaining 20% is distributed among ranks four and lower in proportion to inverse server-measured completion time. Exact ties receive equal weight. Unfilled shares remain unused and do not roll over.
- The reservation must be atomic and idempotent. Use integer micro-USDT units and database uniqueness constraints.
- If the global fund has less than 1 USDT, reserve only the available amount. If it has no confirmed funds, the round allocation and prize are zero.
- Ranking and contest completion must never depend on successful prize allocation, settlement, or transfer.
- The system may store a pending award instruction after ranking, but no user wallet balance is credited and no award is marked paid until the actual on-chain transfer is confirmed and reconciled.

## 7. Round lifecycle and scheduling

Recommended lifecycle: `SCHEDULED -> ACTIVE -> FINISHED`.

- Prepare the next round before its start boundary with 12 complete, ordered clues.
- At `startsAt`, initialize that round's fixed 1 USDT allocation from the global fund exactly once.
- At `endsAt`, submissions are rejected immediately. The scheduler marks the round finished, snapshots ranking, computes pending awards, and lets the payout worker process them independently.
- Simulated daily funding is disabled. The global fund can increase only through an administrator allocation backed by a reconciled real Polygon treasury balance.
- No unused round balance is rolled into a later round.
- Use database constraints and transactions to prevent duplicate round allocations or duplicate round creation. Reconcile transitions chronologically if the application restarts.

## 8. Data model

- `GlobalPrizeFund` stores the currently available real balance and cumulative funding and round allocations.
- `GlobalPrizeLedger` records real treasury funding and each round's fixed allocation with unique reference keys.
- `PrizePool` stores the amount allocated to each round, pending/confirmed awards, project contribution, and payout status. Legacy rollover fields remain for compatibility but new allocations set rollover to zero.
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
10. The 50% / 20% / 10% podium shares and inverse-completion-time 20% allocation for ranks four and lower never exceed the round allocation.
11. Exact ties spanning podium positions split the combined occupied podium shares equally.
12. No simulated daily funding is recorded or backfilled.
13. Each active round reserves up to 1 USDT from the verified global fund exactly once.
14. A round with no completed participants creates no payout and leaves its allocation unused; nothing rolls over.
15. Ranks four and lower divide the 20% allocation by inverse completion-time weights.
16. Payouts are sent only from the Polygon prize treasury to the winner's verified Turnkey wallet address.
17. Payouts are idempotent, wait for canonical chain finality, verify the USDT0 Transfer event, and record a treasury debit only after confirmation.
18. An uncertain signing/broadcast result is quarantined for manual review and is never automatically resubmitted.
19. Finalization is safe to retry, and consecutive rounds start every 15 minutes without a gap.


## 11. Prize pool and payment status

- Simulated funding, simulated awards, and test wallet credits are retired.
- The settlement job stores pending award instructions only after the round is finished and the ranking is frozen.
- The payout worker sends Polygon USDT0 from the dedicated parent-owned Turnkey prize treasury to the winner's active Turnkey wallet address.
- A payout is marked `PAID` only after a canonical successful receipt, the exact USDT0 Transfer event, and the configured confirmation depth are verified. The corresponding negative treasury-ledger entry is written in the same database transaction.
- The existing Polygon deposit scanner recognizes the payout transfer as a wallet credit, including awards below the ordinary minimum-deposit threshold.
- A failed or uncertain signing/broadcast result is never automatically resent. It is quarantined for manual review.
- The payout worker requires both `PRIZE_PAYOUTS_ENABLED=true` and `PRIZE_PAYOUTS_PRODUCTION_READY=true`; it also checks the global emergency pause, current treasury reconciliation, all outstanding round reservations, the USDT0 token balance, and POL gas balance.
- The scheduler reserves and settles prizes independently of challenge activation and answer validation. A payout delay cannot delay or prevent a challenge from starting or finishing.
