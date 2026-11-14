import prisma from "../../config/prisma.js";
import { getContestLeaderboard } from "./leaderboard.service.js";
import { calculatePrizeAllocations } from "./prize-distribution.js";

const MICRO = 1_000_000n;
// Every contest uses a fixed 0.1 USDT0 calculation budget. Only payable awards are debited at settlement.
const ROUND_PRIZE_BUDGET_MICRO = MICRO / 10n;

function formatMicro(value: bigint) {
  const safe = value > 0n ? value : 0n;
  return `${safe / MICRO}.${(safe % MICRO).toString().padStart(6, "0")}`;
}

function responsePool(pool: any) {
  const seeded = BigInt(pool.seededMicro);
  const rolloverIn = BigInt(pool.rolloverInMicro ?? 0n);
  const total = seeded + rolloverIn;
  const awarded = BigInt(pool.awardedMicro);
  const returned = BigInt(pool.returnedToGlobalMicro ?? 0n);
  const remaining = total > awarded + returned ? total - awarded - returned : 0n;
  return {
    contestId: pool.contestId,
    currency: "USDT0",
    testOnly: false,
    status: pool.status,
    seeded: formatMicro(seeded),
    rolloverIn: formatMicro(rolloverIn),
    total: formatMicro(total),
    awarded: formatMicro(awarded),
    projectProfit: formatMicro(BigInt(pool.projectProfitMicro ?? 0n)),
    rolloverOut: formatMicro(BigInt(pool.rolloverOutMicro ?? 0n)),
    returnedToGlobal: formatMicro(returned),
    available: formatMicro(pool.status === "OPEN" ? remaining : 0n),
    unused: formatMicro(pool.status === "OPEN" ? 0n : remaining),
    settledAt: pool.settledAt,
  };
}

export async function getGlobalPrizePoolSnapshot(now = new Date()) {
  const fund = await prisma.globalPrizeFund.findUnique({ where: { id: "global" } });
  return {
    totalPool: formatMicro(BigInt(fund?.balanceMicro ?? 0n)),
    dailyContribution: "0.000000",
    totalDailyFunding: "0.000000",
    totalRoundAllocations: formatMicro(BigInt(fund?.totalAllocatedMicro ?? 0n)),
    currency: "USDT0" as const,
    simulatedOnly: false as const,
    updatedAt: now.toISOString(),
  };
}

export async function getProjectProfitPoolAdminSnapshot(now = new Date()) {
  const [fund, ledger] = await Promise.all([
    prisma.projectProfitFund.findUnique({ where: { id: "project" } }),
    prisma.projectProfitLedger.findMany({
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, type: true, amountMicro: true, effectiveAt: true, note: true, createdAt: true },
    }),
  ]);
  return {
    balance: formatMicro(BigInt(fund?.balanceMicro ?? 0n)),
    totalContributed: formatMicro(BigInt(fund?.totalContributedMicro ?? 0n)),
    currency: "USDT" as const,
    simulatedOnly: false as const,
    ledger: ledger.map((row) => ({
      id: row.id, type: row.type, amount: formatMicro(BigInt(row.amountMicro)),
      effectiveAt: row.effectiveAt, note: row.note, createdAt: row.createdAt,
    })),
    updatedAt: now.toISOString(),
  };
}

export async function getPrizePool(contestId: string) {
  // Reading prize-pool information must never create or mutate financial rows.
  // Pool creation and funding reservation belong exclusively to the settlement worker.
  const [storedPool, contest] = await Promise.all([
    prisma.prizePool.findUnique({ where: { contestId } }),
    prisma.contest.findUnique({ where: { id: contestId }, select: { id: true } }),
  ]);
  if (!contest) throw new Error("CONTEST_NOT_FOUND");

  const pool = storedPool ?? {
    contestId,
    currency: "USDT0",
    testOnly: false,
    status: "OPEN",
    seededMicro: 0n,
    rolloverInMicro: 0n,
    rolloverOutMicro: 0n,
    awardedMicro: 0n,
    projectProfitMicro: 0n,
    returnedToGlobalMicro: 0n,
    settledAt: null,
  };
  const [ledger, awards] = await Promise.all([
    prisma.prizeLedger.findMany({
      where: { contestId }, orderBy: { createdAt: "asc" },
      select: { id: true, type: true, amountMicro: true, note: true, createdAt: true },
    }),
    prisma.prizeAward.findMany({
      where: { contestId }, orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
      select: { username: true, rank: true, amountMicro: true, status: true, destinationAddress: true, transactionHash: true, broadcastAt: true, confirmedAt: true, failureCode: true },
    }),
  ]);
  return {
    pool: responsePool(pool),
    ledger: ledger.map((row) => ({ ...row, amount: formatMicro(BigInt(row.amountMicro)), amountMicro: undefined })),
    awards: awards.map((row) => ({ ...row, payoutMode: "INTERNAL_WALLET_LEDGER", amount: formatMicro(BigInt(row.amountMicro)), amountMicro: undefined })),
  };
}

export async function getPublicPrizePool(contestId: string) {
  const result = await getPrizePool(contestId);
  return { pool: result.pool, awards: result.awards };
}

export async function testFundPrizePool(_contestId?: string, _rawAmount?: unknown, _actorUserId?: string): Promise<never> {
  throw new Error("TEST_FUNDING_REMOVED");
}

/**
 * Returns the unpaid remainder of a finalized real USDT0 round to the shared
 * global prize fund. The global-ledger reference is the idempotency boundary:
 * a retry can repair the pool snapshot without crediting the fund twice.
 */
async function returnUnusedWithinTransaction(tx: any, pool: any, contestId: string, now = new Date()) {
  if (pool.testOnly || pool.currency !== "USDT0" || pool.status === "OPEN") return 0n;

  const total = BigInt(pool.seededMicro) + BigInt(pool.rolloverInMicro ?? 0n);
  const awarded = BigInt(pool.awardedMicro);
  const alreadyReturned = BigInt(pool.returnedToGlobalMicro ?? 0n);
  const remaining = total - awarded - alreadyReturned;
  if (remaining <= 0n) return 0n;

  const referenceKey = "round-unused-return:" + contestId;
  const existing = await tx.globalPrizeLedger.findUnique({ where: { referenceKey } });
  const amount = existing ? BigInt(existing.amountMicro) : remaining;

  if (!existing) {
    await tx.globalPrizeFund.upsert({
      where: { id: "global" },
      update: {},
      create: { id: "global" },
    });
    await tx.globalPrizeLedger.create({
      data: {
        type: "ROUND_UNUSED_RETURN",
        amountMicro: amount,
        contestId,
        effectiveAt: now,
        referenceKey,
        note: "Unused unpaid USDT0 prize allocation returned to the global prize fund",
      },
    });
    await tx.globalPrizeFund.update({
      where: { id: "global" },
      data: { balanceMicro: { increment: amount }, updatedAt: now },
    });
  }

  const prizeLedgerKey = "round-rollover-out:" + contestId;
  const prizeLedgerEntry = await tx.prizeLedger.findUnique({ where: { referenceKey: prizeLedgerKey } });
  if (!prizeLedgerEntry) {
    await tx.prizeLedger.create({
      data: {
        contestId,
        type: "ROLLOVER_OUT",
        amountMicro: amount,
        note: "Unused unpaid round allocation returned to the global prize fund",
        referenceKey: prizeLedgerKey,
      },
    });
  }

  await tx.prizePool.update({
    where: { contestId },
    data: {
      returnedToGlobalMicro: { increment: amount - alreadyReturned },
      rolloverOutMicro: { increment: amount - alreadyReturned },
    },
  });
  return amount;
}

/**
 * Repairs finalized USDT0 rounds created before rollover-return accounting
 * was enabled. Safe to call repeatedly; the unique global-ledger reference
 * prevents duplicate credits.
 */
export async function returnSettledPrizePoolUnusedToGlobal(contestId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
      "prize-pool-settlement:" + contestId,
    );
    const pool = await tx.prizePool.findUnique({ where: { contestId } });
    if (!pool) return "0.000000";
    const amount = await returnUnusedWithinTransaction(tx, pool, contestId, new Date());
    return formatMicro(amount);
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
}

/**
 * Freezes the completed ranking and creates immutable internal-credit instructions.
 * The idempotent payout worker credits each winner's Wallet-Find balance; it never broadcasts a chain transaction.
 */
export async function settlePrizePool(contestId?: string, actorUserId?: string | null) {
  if (!contestId) throw new Error("CONTEST_NOT_FOUND");
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, status: true, startsAt: true, endsAt: true },
  });
  if (!contest) throw new Error("CONTEST_NOT_FOUND");
  if (contest.status !== "FINISHED" || (contest.endsAt && contest.endsAt > new Date())) {
    throw new Error("CONTEST_NOT_FINISHED");
  }

  const leaderboard = await getContestLeaderboard(contestId, 5000);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
      "prize-pool-settlement:" + contestId,
    );
    // One global lock serializes all language-round settlements against the same
    // balance. A round never owns or reserves a separate pot while it is active.
    await tx.$queryRawUnsafe(
      "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
      "global-prize-fund-settlement",
    );
    const eligibleParticipants = await tx.submission.findMany({
      where: { contestId, prizeEligibleAtJoin: true },
      distinct: ["userId"],
      select: { userId: true },
    });
    const eligibleUserIds = new Set(eligibleParticipants.map((participant) => participant.userId));
    const eligibleCompleted = leaderboard.entries.filter(
      (entry) => entry.completed && eligibleUserIds.has(entry.userId),
    );
    let previousElapsedMs: number | null = null;
    let previousEligibleRank = 0;
    const completed = eligibleCompleted.map((entry, index) => {
      const rank = previousElapsedMs === entry.totalResponseTimeMs
        ? previousEligibleRank
        : index + 1;
      previousElapsedMs = entry.totalResponseTimeMs;
      previousEligibleRank = rank;
      return {
        userId: entry.userId,
        username: entry.username,
        rank,
        elapsedMs: entry.totalResponseTimeMs,
      };
    });

    let pool = await tx.prizePool.findUnique({ where: { contestId } });
    if (!pool) {
      pool = await tx.prizePool.create({
        data: { contestId, currency: "USDT0", testOnly: false },
      });
    }
    if (pool.status !== "OPEN") {
      return {
        contestId,
        status: pool.status,
        seeded: formatMicro(BigInt(pool.seededMicro)),
        awarded: formatMicro(BigInt(pool.awardedMicro)),
        reused: true,
      };
    }

    const legacySeeded = BigInt(pool.seededMicro) + BigInt(pool.rolloverInMicro ?? 0n);
    const usesLegacyReservation = legacySeeded > 0n;

    // Every round is payable only when the shared fund can cover the full
    // fixed 0.1 USDT0 calculation budget and the round was never invalidated.
    // Insufficient funding cancels payouts permanently; it is never queued.
    await tx.globalPrizeFund.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
    const fund = await tx.globalPrizeFund.findUnique({
      where: { id: "global" },
      select: { balanceMicro: true },
    });
    const available = BigInt(fund?.balanceMicro ?? 0n);
    const fundingState = await tx.contest.findUnique({
      where: { id: contestId },
      select: { prizeFundingInvalidatedAt: true },
    });
    if (fundingState?.prizeFundingInvalidatedAt || available < ROUND_PRIZE_BUDGET_MICRO) {
        const settledAt = new Date();
        const cancelledPool = await tx.prizePool.update({
          where: { contestId },
          data: {
            seededMicro: usesLegacyReservation ? legacySeeded : 0n,
            rolloverInMicro: 0n,
            awardedMicro: 0n,
            status: "SETTLED",
            settledAt,
          },
        });
        const returnedToGlobal = usesLegacyReservation
          ? await returnUnusedWithinTransaction(
            tx,
            { ...pool, seededMicro: legacySeeded, rolloverInMicro: 0n, awardedMicro: 0n, status: cancelledPool.status },
            contestId,
            settledAt,
          )
          : 0n;
        await tx.auditLog.create({
          data: {
            userId: actorUserId ?? null,
            action: "PRIZE_POOL_CANCELLED_FUNDING_INVALIDATED",
            entity: "PrizePool",
            entityId: contestId,
            metadata: {
              requiredMicro: ROUND_PRIZE_BUDGET_MICRO.toString(),
              availableMicro: available.toString(),
              cancellationReason: fundingState?.prizeFundingInvalidatedAt
                ? "FUNDING_SHORTFALL_DURING_ROUND"
                : "INSUFFICIENT_AT_SETTLEMENT",
              invalidatedAt: fundingState?.prizeFundingInvalidatedAt?.toISOString() ?? null,
              returnedToGlobalMicro: returnedToGlobal.toString(),
              payoutCount: 0,
              payoutMode: "SHARED_GLOBAL_FUND",
            },
          },
        });
        return {
          contestId,
          status: "CANCELLED_INSUFFICIENT_FUNDS",
          seeded: "0.000000",
          awarded: "0.000000",
          required: formatMicro(ROUND_PRIZE_BUDGET_MICRO),
          available: formatMicro(available),
          returnedToGlobal: formatMicro(returnedToGlobal),
          payoutCount: 0,
          awards: [],
          settledAt: cancelledPool.settledAt,
        };
    }

    const distributionBase = usesLegacyReservation ? legacySeeded : ROUND_PRIZE_BUDGET_MICRO;
    const allocations = calculatePrizeAllocations(
      distributionBase,
      completed.map(({ userId, rank, elapsedMs }) => ({ userId, rank, elapsedMs })),
    );
    const usernameById = new Map(completed.map((entry) => [entry.userId, entry.username]));
    const payableAllocations = allocations.filter((allocation) => allocation.amountMicro > 0n);
    const awarded = payableAllocations.reduce((total, allocation) => total + allocation.amountMicro, 0n);

    // No winner means no charge to the shared fund. A previously reserved
    // legacy round is returned through the historical exactly-once path.
    if (awarded === 0n) {
      const updated = await tx.prizePool.update({
        where: { contestId },
        data: { seededMicro: legacySeeded, rolloverInMicro: 0n, awardedMicro: 0n, status: "SETTLED", settledAt: new Date() },
      });
      const returned = usesLegacyReservation
        ? await returnUnusedWithinTransaction(tx, { ...pool, seededMicro: legacySeeded, rolloverInMicro: 0n, awardedMicro: 0n, status: updated.status }, contestId, updated.settledAt ?? new Date())
        : 0n;
      await tx.auditLog.create({
        data: {
          userId: actorUserId ?? null,
          action: "PRIZE_POOL_SETTLEMENT_PREPARED",
          entity: "PrizePool",
          entityId: contestId,
          metadata: { seededMicro: legacySeeded.toString(), awardedMicro: "0", payoutCount: 0, payoutMode: "SHARED_GLOBAL_FUND", noWinner: true },
        },
      });
      return { contestId, status: updated.status, seeded: formatMicro(legacySeeded), awarded: "0.000000", returnedToGlobal: formatMicro(returned), payoutCount: 0, awards: [] };
    }

    await tx.globalPrizeFund.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
    if (!usesLegacyReservation) {
      const fund = await tx.globalPrizeFund.findUnique({ where: { id: "global" }, select: { balanceMicro: true } });
      const available = BigInt(fund?.balanceMicro ?? 0n);
      // The full 0.1 USDT0 threshold was checked above while holding the
      // global-fund lock, so the calculated awards must be fully covered.
      if (available < awarded) throw new Error("GLOBAL_PRIZE_FUND_BUDGET_INVARIANT");
      const debitKey = "round-award-debit:" + contestId;
      const existingDebit = await tx.globalPrizeLedger.findUnique({ where: { referenceKey: debitKey } });
      if (!existingDebit) {
        await tx.globalPrizeLedger.create({
          data: {
            type: "ROUND_AWARD_DEBIT",
            amountMicro: awarded,
            contestId,
            effectiveAt: new Date(),
            referenceKey: debitKey,
            note: "Actual winner awards debited at settlement from the shared global USDT0 prize fund",
          },
        });
        await tx.globalPrizeFund.update({
          where: { id: "global" },
          data: {
            balanceMicro: { decrement: awarded },
            totalAllocatedMicro: { increment: awarded },
            updatedAt: new Date(),
          },
        });
        const remainingGlobalBalance = available - awarded;
        if (remainingGlobalBalance < ROUND_PRIZE_BUDGET_MICRO) {
          await tx.contest.updateMany({
            where: {
              status: "ACTIVE",
              prizeFundingInvalidatedAt: null,
              submissions: { some: {} },
            },
            data: { prizeFundingInvalidatedAt: new Date() },
          });
        }
      } else if (BigInt(existingDebit.amountMicro) !== awarded) {
        throw new Error("GLOBAL_PRIZE_DEBIT_AMOUNT_MISMATCH");
      }
    }

    // Store only the actual amount backed by the global-fund debit in the
    // per-round accounting record. The 0.1 USDT0 is a calculation basis,
    // not a segregated/reserved balance.
    const backedSeeded = usesLegacyReservation ? legacySeeded : awarded;
    if (payableAllocations.length > 0) {
      await tx.prizeAward.createMany({
        data: payableAllocations.map((allocation) => ({
          contestId,
          userId: allocation.userId,
          username: usernameById.get(allocation.userId) ?? "Wallet-Find user",
          rank: allocation.rank,
          amountMicro: allocation.amountMicro,
          status: "PENDING_PAYMENT",
        })),
      });
    }

    if (awarded > 0n) {
      await tx.prizeLedger.create({
        data: {
          contestId,
          type: usesLegacyReservation ? "AWARD" : "GLOBAL_ALLOCATION",
          amountMicro: awarded,
          note: usesLegacyReservation
            ? "Winner awards calculated from the round's pre-existing legacy reservation"
            : "Winner awards debited from the shared global USDT0 prize fund at settlement",
          referenceKey: "round-awards:" + contestId,
        },
      });
    }

    const updated = await tx.prizePool.update({
      where: { contestId },
      data: {
        seededMicro: backedSeeded,
        rolloverInMicro: 0n,
        awardedMicro: awarded,
        status: awarded > 0n ? "PAYOUT_PENDING" : "SETTLED",
        settledAt: new Date(),
      },
    });
    const returnedToGlobal = usesLegacyReservation
      ? await returnUnusedWithinTransaction(tx, { ...pool, seededMicro: legacySeeded, awardedMicro: awarded, status: updated.status }, contestId, updated.settledAt ?? new Date())
      : 0n;

    await tx.auditLog.create({
      data: {
        userId: actorUserId ?? null,
        action: "PRIZE_POOL_SETTLEMENT_PREPARED",
        entity: "PrizePool",
        entityId: contestId,
        metadata: {
          distributionBaseMicro: distributionBase.toString(),
          backedSeededMicro: backedSeeded.toString(),
          awardedMicro: awarded.toString(),
          payoutCount: allocations.length,
          payoutMode: usesLegacyReservation ? "LEGACY_ROUND_RESERVATION" : "SHARED_GLOBAL_FUND",
        },
      },
    });

    return {
      contestId,
      status: updated.status,
      seeded: formatMicro(backedSeeded),
      awarded: formatMicro(awarded),
      returnedToGlobal: formatMicro(returnedToGlobal),
      payoutCount: allocations.length,
      awards: allocations.map((award) => ({
        userId: award.userId,
        username: usernameById.get(award.userId) ?? "Wallet-Find user",
        rank: award.rank,
        amount: formatMicro(award.amountMicro),
        status: "PENDING_PAYMENT",
      })),
    };
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
}
