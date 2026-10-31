import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS } from "./contest.logic.js";

const MICRO = 1_000_000n;
const BASIS_POINTS = 10_000n;
const PODIUM_BASIS_POINTS = [5_000n, 2_250n, 1_250n] as const;
const LOWER_RANK_BASIS_POINTS = 1_000n;
const PROJECT_PROFIT_BASIS_POINTS = 500n;
const ROUND_ALLOCATION_MICRO = 1n * MICRO;
const DAILY_GLOBAL_FUNDING = 50n * MICRO;

function formatMicro(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MICRO;
  const fraction = (absolute % MICRO).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcDayKey(date: Date): string {
  return utcDayStart(date).toISOString().slice(0, 10);
}

/**
 * Record the simulated 50 USDT daily sponsor/investor contribution exactly
 * once per UTC day. Missed days are backfilled after a scheduler interruption.
 * The singleton row serializes concurrent calls before reading/inserting ledger rows.
 */
async function ensureDailyGlobalFunding(tx: any, now: Date) {
  await tx.globalPrizeFund.upsert({
    where: { id: "global" },
    update: { updatedAt: now },
    create: { id: "global", updatedAt: now },
  });
  await tx.projectProfitFund.upsert({
    where: { id: "project" },
    update: { updatedAt: now },
    create: { id: "project", updatedAt: now },
  });

  const todayStart = utcDayStart(now);
  const latestFunding = await tx.globalPrizeLedger.findFirst({
    where: { type: "DAILY_FUNDING" },
    orderBy: { effectiveAt: "desc" },
    select: { effectiveAt: true },
  });

  const cursor = latestFunding
    ? utcDayStart(latestFunding.effectiveAt)
    : new Date(todayStart);
  if (latestFunding) cursor.setUTCDate(cursor.getUTCDate() + 1);

  while (cursor.getTime() <= todayStart.getTime()) {
    const dayKey = utcDayKey(cursor);
    const referenceKey = "daily-funding:" + dayKey;
    const existing = await tx.globalPrizeLedger.findUnique({ where: { referenceKey } });
    if (!existing) {
      const globalShare = DAILY_GLOBAL_FUNDING * (BASIS_POINTS - PROJECT_PROFIT_BASIS_POINTS) / BASIS_POINTS;
      const projectShare = DAILY_GLOBAL_FUNDING * PROJECT_PROFIT_BASIS_POINTS / BASIS_POINTS;
      await tx.globalPrizeLedger.create({
        data: {
          id: "daily-funding-" + dayKey,
          type: "DAILY_FUNDING",
          amountMicro: DAILY_GLOBAL_FUNDING,
          dayKey,
          effectiveAt: new Date(cursor),
          referenceKey,
          note: "SIMULATED SPONSOR / INVESTOR CONTRIBUTION 50.000000 USDT; 95% to global prize fund and 5% to project dividend fund; no real assets transferred",
        },
      });
      await tx.globalPrizeFund.update({
        where: { id: "global" },
        data: {
          balanceMicro: { increment: globalShare },
          totalFundedMicro: { increment: DAILY_GLOBAL_FUNDING },
          updatedAt: now,
        },
      });
      if (projectShare > 0n) {
        await tx.projectProfitLedger.create({
          data: {
            type: "CONTRIBUTION_SHARE",
            amountMicro: projectShare,
            effectiveAt: new Date(cursor),
            referenceKey: "project-contribution-share:" + dayKey,
            note: "SIMULATED immediate 5% share of sponsor/investor contribution for " + dayKey + "; no real assets transferred",
          },
        });
        await tx.projectProfitFund.update({
          where: { id: "project" },
          data: {
            balanceMicro: { increment: projectShare },
            totalContributedMicro: { increment: projectShare },
            updatedAt: now,
          },
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return tx.globalPrizeFund.findUnique({ where: { id: "global" } });
}
export async function ensureDailyGlobalPrizeFunding(now = new Date()): Promise<void> {
  await prisma.$transaction((tx) => ensureDailyGlobalFunding(tx, now));
}

async function ensurePool(tx: any, contestId: string, now = new Date()) {
  const contest = await tx.contest.findUnique({
    where: { id: contestId },
    select: { id: true, startsAt: true },
  });
  if (!contest) throw new Error("CONTEST_NOT_FOUND");

  let pool = await tx.prizePool.upsert({
    where: { contestId },
    update: {},
    create: { contestId, testOnly: true, currency: "USDT" },
  });

  const globalFund = await ensureDailyGlobalFunding(tx, now);
  if (pool.status !== "OPEN" || !contest.startsAt || contest.startsAt > now) {
    return pool;
  }

  // Allocate exactly 1 USDT from the available global fund once per round.
  // The unique ledger key makes retries safe.
  const allocationKey = "round-allocation:" + contestId;
  let allocation = await tx.globalPrizeLedger.findUnique({
    where: { referenceKey: allocationKey },
  });

  if (!allocation) {
    const available = BigInt(globalFund?.balanceMicro ?? 0n);
    const amount = available < ROUND_ALLOCATION_MICRO ? available : ROUND_ALLOCATION_MICRO;
    const note = "SIMULATED ROUND ALLOCATION 1.000000 USDT from global prize fund for round " + contestId + "; no real assets transferred";
    allocation = await tx.globalPrizeLedger.create({
      data: {
        id: "round-allocation-" + contestId,
        type: "ROUND_ALLOCATION",
        amountMicro: amount,
        contestId,
        effectiveAt: contest.startsAt,
        referenceKey: allocationKey,
        note,
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
  }

  const allocatedAmount = BigInt(allocation.amountMicro);
  pool = await tx.prizePool.update({
    where: { contestId },
    data: {
      seededMicro: allocatedAmount,
      rolloverInMicro: 0n,
      rolloverOutMicro: 0n,
      awardedMicro: 0n,
      projectProfitMicro: 0n,
      testOnly: true,
    },
  });

  // Keep the per-round ledger aligned with the fixed 1 USDT allocation.
  const roundLedgerKey = "test-funding-initial:" + contestId;
  const roundLedger = await tx.prizeLedger.findUnique({
    where: { referenceKey: roundLedgerKey },
    select: { id: true, amountMicro: true, type: true, note: true },
  });
  const roundLedgerNote = "SIMULATED FIXED 1 USDT GLOBAL PRIZE FUND ALLOCATION " + formatMicro(allocatedAmount) + " USDT for round " + contestId + "; no real assets transferred";
  if (!roundLedger) {
    await tx.prizeLedger.create({
      data: {
        contestId,
        type: "GLOBAL_ALLOCATION",
        amountMicro: allocatedAmount,
        note: roundLedgerNote,
        referenceKey: roundLedgerKey,
      },
    });
  } else if (
    BigInt(roundLedger.amountMicro) !== allocatedAmount ||
    roundLedger.type !== "GLOBAL_ALLOCATION" ||
    roundLedger.note !== roundLedgerNote
  ) {
    await tx.prizeLedger.update({
      where: { referenceKey: roundLedgerKey },
      data: {
        type: "GLOBAL_ALLOCATION",
        amountMicro: allocatedAmount,
        note: roundLedgerNote,
      },
    });
  }

  return pool;
}

export async function initializePrizePoolForRound(contestId: string, now = new Date()) {
  return prisma.$transaction((tx) => ensurePool(tx, contestId, now));
}

export async function getGlobalPrizePoolSnapshot(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const fund = await ensureDailyGlobalFunding(tx, now);
    const dailyEntry = await tx.globalPrizeLedger.findUnique({
      where: { dayKey: utcDayKey(now) },
      select: { amountMicro: true },
    });
    return {
      totalPool: formatMicro(BigInt(fund?.balanceMicro ?? 0n)),
      dailyContribution: formatMicro(BigInt(dailyEntry?.amountMicro ?? 0n)),
      totalDailyFunding: formatMicro(BigInt(fund?.totalFundedMicro ?? 0n)),
      totalRoundAllocations: formatMicro(BigInt(fund?.totalAllocatedMicro ?? 0n)),
      currency: "USDT" as const,
      simulatedOnly: true as const,
      updatedAt: now.toISOString(),
    };
  });
}


export async function getProjectProfitPoolAdminSnapshot(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await ensureDailyGlobalFunding(tx, now);
    const fund = await tx.projectProfitFund.findUnique({ where: { id: "project" } });
    const ledger = await tx.projectProfitLedger.findMany({
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, type: true, amountMicro: true, effectiveAt: true, note: true, createdAt: true },
    });
    return {
      balance: formatMicro(BigInt(fund?.balanceMicro ?? 0n)),
      totalContributed: formatMicro(BigInt(fund?.totalContributedMicro ?? 0n)),
      currency: "USDT" as const,
      simulatedOnly: true as const,
      ledger: ledger.map((row) => ({
        id: row.id,
        type: row.type,
        amount: formatMicro(BigInt(row.amountMicro)),
        effectiveAt: row.effectiveAt,
        note: row.note,
        createdAt: row.createdAt,
      })),
      updatedAt: now.toISOString(),
    };
  });
}

function responsePool(pool: any) {
  const total = BigInt(pool.seededMicro) + BigInt(pool.rolloverInMicro);
  const returnedToGlobal = BigInt(pool.returnedToGlobalMicro ?? 0n);
  const spent = BigInt(pool.awardedMicro) + BigInt(pool.rolloverOutMicro) + BigInt(pool.projectProfitMicro ?? 0n) + returnedToGlobal;
  const remaining = total > spent ? total - spent : 0n;
  const available = pool.status === "SETTLED" ? 0n : remaining;
  const unused = pool.status === "SETTLED" ? remaining : 0n;
  return {
    contestId: pool.contestId,
    currency: pool.currency,
    testOnly: true,
    status: pool.status,
    seeded: formatMicro(BigInt(pool.seededMicro)),
    rolloverIn: formatMicro(BigInt(pool.rolloverInMicro)),
    total: formatMicro(total),
    awarded: formatMicro(BigInt(pool.awardedMicro)),
    projectProfit: formatMicro(BigInt(pool.projectProfitMicro ?? 0n)),
    rolloverOut: formatMicro(BigInt(pool.rolloverOutMicro)),
    returnedToGlobal: formatMicro(returnedToGlobal),
    available: formatMicro(available),
    unused: formatMicro(unused),
    settledAt: pool.settledAt,
  };
}

export async function getPrizePool(contestId: string) {
  const pool = await prisma.$transaction((tx) => ensurePool(tx, contestId));
  const [ledger, awards] = await Promise.all([
    prisma.prizeLedger.findMany({
      where: { contestId },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, amountMicro: true, note: true, createdAt: true },
    }),
    prisma.prizeAward.findMany({
      where: { contestId },
      orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
      select: { username: true, rank: true, amountMicro: true, status: true },
    }),
  ]);
  return {
    pool: responsePool(pool),
    ledger: ledger.map((row) => ({ ...row, amount: formatMicro(BigInt(row.amountMicro)), amountMicro: undefined })),
    awards: awards.map((row) => ({ ...row, amount: formatMicro(BigInt(row.amountMicro)), amountMicro: undefined })),
  };
}

/** This is explicitly simulated accounting; it never moves real tokens. */
export async function getPublicPrizePool(contestId: string) {
  const pool = await prisma.$transaction((tx) => ensurePool(tx, contestId));
  const awards = await prisma.prizeAward.findMany({
    where: { contestId },
    orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
    select: { username: true, rank: true, amountMicro: true, status: true },
  });
  return {
    pool: responsePool(pool),
    awards: awards.map((row) => ({
      username: row.username,
      rank: row.rank,
      amount: formatMicro(BigInt(row.amountMicro)),
      status: row.status,
    })),
  };
}

export async function testFundPrizePool(
  _contestId: string,
  _rawAmount: unknown,
  _actorUserId?: string,
): Promise<any> {
  // Funding is simulated automatically at 50 USDT per UTC day.
  throw new Error("MANUAL_GLOBAL_POOL_FUNDING_DISABLED");
}

type Finisher = {
  userId: string;
  username: string;
  completedAt: Date;
  elapsedMs: number;
  rank: number;
};

export async function settlePrizePool(_contestId: string, _actorUserId?: string) {
  // Simulated prize awards and wallet credits have been retired.
  // Real payouts will be enabled only after funded custody, signing, and reconciliation are implemented.
  throw new Error("REAL_PRIZE_PAYOUTS_NOT_CONFIGURED");
}
