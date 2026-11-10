import prisma from "../../config/prisma.js";
import { getContestLeaderboard } from "./leaderboard.service.js";
import { calculatePrizeAllocations } from "./prize-distribution.js";

const MICRO = 1_000_000n;
const ROUND_ALLOCATION_MICRO = MICRO / 10n;

function formatMicro(value: bigint) {
  const safe = value > 0n ? value : 0n;
  return `${safe / MICRO}.${(safe % MICRO).toString().padStart(6, "0")}`;
}

/**
 * Reserves exactly 0.1 USDT0 from the verified global-fund balance when the
 * scheduler observes the round as active. A round is not partially funded. Only reconciled real funding can
 * increase the global fund. The unique reference key makes retries safe.
 */
async function ensurePool(tx: any, contestId: string, now = new Date()) {
  const contest = await tx.contest.findUnique({
    where: { id: contestId },
    select: { id: true, startsAt: true, status: true },
  });
  if (!contest) throw new Error("CONTEST_NOT_FOUND");

  await tx.globalPrizeFund.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });

  let pool = await tx.prizePool.upsert({
    where: { contestId },
    update: {},
    create: { contestId, currency: "USDT0", testOnly: false },
  });
  if (pool.status !== "OPEN" || contest.status !== "ACTIVE" || !contest.startsAt || contest.startsAt > now) return pool;

  const allocationKey = "round-allocation:" + contestId;
  const existing = await tx.globalPrizeLedger.findUnique({ where: { referenceKey: allocationKey } });
  if (existing) return pool;

  const fund = await tx.globalPrizeFund.findUnique({ where: { id: "global" } });
  const available = BigInt(fund?.balanceMicro ?? 0n);
  if (available < ROUND_ALLOCATION_MICRO) return pool;
  const amount = ROUND_ALLOCATION_MICRO;

  await tx.globalPrizeLedger.create({
    data: {
      id: "round-allocation-" + contestId,
      type: "ROUND_ALLOCATION",
      amountMicro: amount,
      contestId,
      effectiveAt: contest.startsAt,
      referenceKey: allocationKey,
      note: "Reservation of 0.1 USDT0 from confirmed real global prize fund",
    },
  });
  await tx.globalPrizeFund.update({
    where: { id: "global" },
    data: {
      balanceMicro: { decrement: amount },
      totalAllocatedMicro: { increment: amount },
      updatedAt: now,
    },
  });
  pool = await tx.prizePool.update({
    where: { contestId },
    data: {
      seededMicro: amount,
      rolloverInMicro: 0n,
      rolloverOutMicro: 0n,
      awardedMicro: 0n,
      projectProfitMicro: 0n,
      testOnly: false,
    },
  });
  await tx.prizeLedger.create({
    data: {
      contestId,
      type: "GLOBAL_ALLOCATION",
      amountMicro: amount,
      note: "Confirmed real 0.1 USDT0 allocation from global prize fund",
      referenceKey: "round-real-allocation:" + contestId,
    },
  });
  return pool;
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
    unused: formatMicro(remaining),
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

export async function reserveRoundPrizeAllocation(contestId: string, now = new Date()) {
  // Fast-path checks keep empty/unfunded rounds out of serializable transactions.
  // The checks are advisory only; ensurePool revalidates all conditions atomically.
  const [contest, pool, fund] = await Promise.all([
    prisma.contest.findUnique({
      where: { id: contestId },
      select: { id: true, startsAt: true, status: true },
    }),
    prisma.prizePool.findUnique({ where: { contestId } }),
    prisma.globalPrizeFund.findUnique({
      where: { id: "global" },
      select: { balanceMicro: true },
    }),
  ]);
  if (!contest) throw new Error("CONTEST_NOT_FOUND");
  if (contest.status !== "ACTIVE" || !contest.startsAt || contest.startsAt > now) return pool;
  if (pool && (pool.status !== "OPEN" || BigInt(pool.seededMicro) > 0n)) return pool;
  if (BigInt(fund?.balanceMicro ?? 0n) < ROUND_ALLOCATION_MICRO) return pool;

  return prisma.$transaction(
    (tx) => ensurePool(tx, contestId, now),
    { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
  );
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
  const completed = leaderboard.entries
    .filter((entry) => entry.completed)
    .map((entry) => ({
      userId: entry.userId,
      username: entry.username,
      rank: entry.rank,
      elapsedMs: entry.totalResponseTimeMs,
    }));

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
      "prize-pool-settlement:" + contestId,
    );
    const pool = await tx.prizePool.findUnique({ where: { contestId } });
    if (!pool) throw new Error("PRIZE_POOL_NOT_ALLOCATED_AT_ROUND_START");
    if (pool.status !== "OPEN") {
      return {
        contestId,
        status: pool.status,
        seeded: formatMicro(BigInt(pool.seededMicro)),
        awarded: formatMicro(BigInt(pool.awardedMicro)),
        reused: true,
      };
    }

    const seeded = BigInt(pool.seededMicro);
    if (seeded <= 0n) {
      const settled = await tx.prizePool.update({
        where: { contestId },
        data: { awardedMicro: 0n, status: "SETTLED", settledAt: new Date() },
      });
      return { contestId, status: settled.status, seeded: "0.000000", awarded: "0.000000", awards: [] };
    }

    const allocations = calculatePrizeAllocations(
      seeded,
      completed.map(({ userId, rank, elapsedMs }) => ({ userId, rank, elapsedMs })),
    );
    const usernameById = new Map(completed.map((entry) => [entry.userId, entry.username]));
    const payableAllocations = allocations.filter((allocation) => allocation.amountMicro > 0n);
    const awarded = payableAllocations.reduce((total, allocation) => total + allocation.amountMicro, 0n);

    // One bulk insert avoids holding a financial transaction open for one
    // database round-trip per winner.
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
          type: "AWARD",
          amountMicro: awarded,
          note: "Final participant awards calculated from verified round allocation",
          referenceKey: "round-awards:" + contestId,
        },
      });
    }

    const updated = await tx.prizePool.update({
      where: { contestId },
      data: {
        awardedMicro: awarded,
        status: awarded > 0n ? "PAYOUT_PENDING" : "SETTLED",
        settledAt: new Date(),
      },
    });
    const returnedToGlobal = await returnUnusedWithinTransaction(
      tx,
      { ...pool, awardedMicro: awarded, status: updated.status },
      contestId,
      updated.settledAt ?? new Date(),
    );
    await tx.auditLog.create({
      data: {
        userId: actorUserId ?? null,
        action: "PRIZE_POOL_SETTLEMENT_PREPARED",
        entity: "PrizePool",
        entityId: contestId,
        metadata: {
          seededMicro: seeded.toString(),
          awardedMicro: awarded.toString(),
          payoutCount: allocations.length,
          unusedMicro: (seeded + BigInt(pool.rolloverInMicro ?? 0n) - awarded).toString(),
          payoutMode: "INTERNAL_WALLET_LEDGER",
        },
      },
    });

    return {
      contestId,
      status: updated.status,
      seeded: formatMicro(seeded),
      awarded: formatMicro(awarded),
      unused: "0.000000",
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
