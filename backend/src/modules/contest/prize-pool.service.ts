import prisma from "../../config/prisma.js";
import { getContestLeaderboard } from "./leaderboard.service.js";
import { calculatePrizeAllocations } from "./prize-distribution.js";

const MICRO = 1_000_000n;
const ROUND_ALLOCATION_MICRO = MICRO;

function formatMicro(value: bigint) {
  const safe = value > 0n ? value : 0n;
  return `${safe / MICRO}.${(safe % MICRO).toString().padStart(6, "0")}`;
}

/**
 * Reserves up to 1 USDT from the verified global-fund balance when the
 * scheduler observes the round as active. Only reconciled real funding can
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
    create: { contestId, currency: "USDT", testOnly: false },
  });
  if (pool.status !== "OPEN" || contest.status !== "ACTIVE" || !contest.startsAt || contest.startsAt > now) return pool;

  const allocationKey = "round-allocation:" + contestId;
  const existing = await tx.globalPrizeLedger.findUnique({ where: { referenceKey: allocationKey } });
  if (existing) return pool;

  const fund = await tx.globalPrizeFund.findUnique({ where: { id: "global" } });
  const available = BigInt(fund?.balanceMicro ?? 0n);
  const amount = available < ROUND_ALLOCATION_MICRO ? available : ROUND_ALLOCATION_MICRO;

  await tx.globalPrizeLedger.create({
    data: {
      id: "round-allocation-" + contestId,
      type: "ROUND_ALLOCATION",
      amountMicro: amount,
      contestId,
      effectiveAt: contest.startsAt,
      referenceKey: allocationKey,
      note: "Reservation from confirmed real USDT global prize fund",
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
      note: "Confirmed real USDT allocation from global prize fund",
      referenceKey: "round-real-allocation:" + contestId,
    },
  });
  return pool;
}

function responsePool(pool: any) {
  const total = BigInt(pool.seededMicro) + BigInt(pool.rolloverInMicro);
  const awarded = BigInt(pool.awardedMicro);
  const remaining = total > awarded ? total - awarded : 0n;
  return {
    contestId: pool.contestId,
    currency: "USDT",
    testOnly: false,
    status: pool.status,
    seeded: formatMicro(BigInt(pool.seededMicro)),
    rolloverIn: "0.000000",
    total: formatMicro(total),
    awarded: formatMicro(awarded),
    projectProfit: "0.000000",
    rolloverOut: "0.000000",
    returnedToGlobal: "0.000000",
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
    currency: "USDT" as const,
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
  const pool = await prisma.$transaction((tx) => ensurePool(tx, contestId));
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
    awards: awards.map((row) => ({ ...row, amount: formatMicro(BigInt(row.amountMicro)), amountMicro: undefined })),
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
  return prisma.$transaction((tx) => ensurePool(tx, contestId, now), { isolationLevel: "Serializable" });
}

/**
 * Freezes the completed ranking and creates immutable payout instructions.
 * Actual transfers are performed by the separate, idempotent payout worker.
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
    let awarded = 0n;

    for (const allocation of allocations) {
      if (allocation.amountMicro <= 0n) continue;
      await tx.prizeAward.create({
        data: {
          contestId,
          userId: allocation.userId,
          username: usernameById.get(allocation.userId) ?? "Wallet-Find user",
          rank: allocation.rank,
          amountMicro: allocation.amountMicro,
          status: "PENDING_PAYMENT",
        },
      });
      awarded += allocation.amountMicro;
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
          unusedMicro: (seeded - awarded).toString(),
          payoutMode: "INTERNAL_WALLET_LEDGER",
        },
      },
    });

    return {
      contestId,
      status: updated.status,
      seeded: formatMicro(seeded),
      awarded: formatMicro(awarded),
      unused: formatMicro(seeded - awarded),
      payoutCount: allocations.length,
      awards: allocations.map((award) => ({
        userId: award.userId,
        username: usernameById.get(award.userId) ?? "Wallet-Find user",
        rank: award.rank,
        amount: formatMicro(award.amountMicro),
        status: "PENDING_PAYMENT",
      })),
    };
  }, { isolationLevel: "Serializable" });
}
