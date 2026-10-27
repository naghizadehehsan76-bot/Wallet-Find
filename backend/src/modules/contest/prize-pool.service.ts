import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS } from "./contest.logic.js";

const MICRO = 1_000_000n;
const BASIS_POINTS = 10_000n;
const PODIUM_BASIS_POINTS = [5_000n, 2_250n, 1_250n] as const;
const LOWER_RANK_BASIS_POINTS = 1_000n;
const PROJECT_PROFIT_BASIS_POINTS = 500n;
const ROUND_ALLOCATION_BASIS_POINTS = 100n;
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

  // Take exactly 1% of the global fund's currently available balance once
  // per round. The unique ledger key and singleton row lock make retries safe.
  const allocationKey = "round-allocation:" + contestId;
  let allocation = await tx.globalPrizeLedger.findUnique({
    where: { referenceKey: allocationKey },
  });

  if (!allocation) {
    const available = BigInt(globalFund?.balanceMicro ?? 0n);
    const amount = available * ROUND_ALLOCATION_BASIS_POINTS / BASIS_POINTS;
    const note = "SIMULATED ROUND ALLOCATION 1% of global prize fund for round " + contestId + "; no real assets transferred";
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

  // Keep the per-round ledger aligned with the 1% allocation, including legacy
  // open pools that were previously seeded with a fixed 100 USDT.
  const roundLedgerKey = "test-funding-initial:" + contestId;
  const roundLedger = await tx.prizeLedger.findUnique({
    where: { referenceKey: roundLedgerKey },
    select: { id: true, amountMicro: true, type: true, note: true },
  });
  const roundLedgerNote = "SIMULATED 1% GLOBAL PRIZE FUND ALLOCATION " + formatMicro(allocatedAmount) + " USDT for round " + contestId + "; no real assets transferred";
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

export async function settlePrizePool(contestId: string, actorUserId?: string) {
  return prisma.$transaction(async (tx) => {
    const contest = await tx.contest.findUnique({
      where: { id: contestId },
      select: { id: true, status: true, startsAt: true, endsAt: true },
    });
    if (!contest) throw new Error("CONTEST_NOT_FOUND");
    if (contest.status !== "FINISHED" && (!contest.endsAt || Date.now() < contest.endsAt.getTime())) {
      throw new Error("CONTEST_NOT_FINISHED");
    }
    const pool = await ensurePool(tx, contestId);
    if (pool.status === "SETTLED") {
      const existingAwards = await tx.prizeAward.findMany({
        where: { contestId },
        orderBy: [{ rank: "asc" }, { username: "asc" }],
      });
      return {
        alreadySettled: true,
        pool: responsePool(pool),
        awards: existingAwards.map((award: any) => ({
          username: award.username,
          rank: award.rank,
          amount: formatMicro(BigInt(award.amountMicro)),
          status: award.status,
        })),
      };
    }

    const [correct, participantAttempts] = await Promise.all([
      tx.submission.findMany({
        where: { contestId, isCorrect: true },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        select: {
          userId: true,
          submittedAt: true,
          clue: { select: { sequence: true } },
          user: { select: { username: true } },
        },
      }),
      tx.submission.count({ where: { contestId } }),
    ]);
    const byUser = new Map<string, { username: string; solved: Set<number>; completedAt: Date | null }>();
    for (const submission of correct) {
      let row = byUser.get(submission.userId);
      if (!row) {
        row = { username: submission.user.username, solved: new Set<number>(), completedAt: null };
        byUser.set(submission.userId, row);
      }
      row.solved.add(submission.clue.sequence);
      if (submission.clue.sequence === 12 && !row.completedAt) row.completedAt = submission.submittedAt;
    }

    const startMs = contest.startsAt?.getTime();
    const finishers: Finisher[] = [...byUser.entries()]
      .filter(([, value]) => value.solved.size === 12 && value.completedAt !== null)
      .map(([userId, value]) => ({
        userId,
        username: value.username,
        completedAt: value.completedAt as Date,
        elapsedMs: Math.max(0, (value.completedAt as Date).getTime() - (startMs ?? (value.completedAt as Date).getTime())),
        rank: 0,
      }))
      .sort((a, b) => a.elapsedMs - b.elapsedMs || a.completedAt.getTime() - b.completedAt.getTime());

    let position = 1;
    for (let index = 0; index < finishers.length;) {
      const first = finishers[index];
      if (!first) break;
      let end = index + 1;
      while (end < finishers.length) {
        const candidate = finishers[end];
        if (!candidate || candidate.elapsedMs !== first.elapsedMs) break;
        end++;
      }
      for (let cursor = index; cursor < end; cursor++) {
        const person = finishers[cursor];
        if (person) person.rank = position;
      }
      position += end - index;
      index = end;
    }

    const totalPool = BigInt(pool.seededMicro);
    const payouts = new Map<string, { rank: number; amount: bigint }>();
    let distributed = 0n;

    // Tie groups pool the rank-slot prizes they occupy, then split evenly.
    for (let index = 0; index < Math.min(3, finishers.length);) {
      const first = finishers[index];
      if (!first) break;
      let end = index + 1;
      while (end < finishers.length) {
        const candidate = finishers[end];
        if (!candidate || candidate.elapsedMs !== first.elapsedMs) break;
        end++;
      }
      let slotBasisPoints = 0n;
      for (let slot = index; slot < Math.min(end, 3); slot++) slotBasisPoints += PODIUM_BASIS_POINTS[slot] ?? 0n;
      const groupAmount = totalPool * slotBasisPoints / BASIS_POINTS;
      const groupSize = BigInt(end - index);
      const perPerson = groupAmount / groupSize;
      for (let cursor = index; cursor < end; cursor++) {
        const person = finishers[cursor];
        if (person && index < 3) payouts.set(person.userId, { rank: person.rank, amount: perPerson });
      }
      distributed += perPerson * groupSize;
      index = end;
    }

    // 10% is reserved for rank 4+ finishers and weighted by completion speed.
    const lowerPool = totalPool * LOWER_RANK_BASIS_POINTS / BASIS_POINTS;
    const lower = contest.startsAt
      ? finishers.filter((person) => person.rank >= 4 && person.elapsedMs < CONTEST_DURATION_MS)
      : [];
    if (lower.length) {
      const scores = lower.map((person) => BigInt(Math.max(0, CONTEST_DURATION_MS - person.elapsedMs)));
      const scoreTotal = scores.reduce((sum, score) => sum + score, 0n);
      if (scoreTotal > 0n) {
        for (let index = 0; index < lower.length; index++) {
          const person = lower[index];
          const score = scores[index];
          if (!person || score === undefined) continue;
          const share = lowerPool * score / scoreTotal;
          const existing = payouts.get(person.userId);
          payouts.set(person.userId, { rank: person.rank, amount: (existing?.amount ?? 0n) + share });
          distributed += share;
        }
      }
    }

    // The project dividend share is deducted immediately from sponsor/investor
    // contributions, never from a round's allocation. If there are no submissions
    // in this round, return the full unused allocation to the global fund.
    const projectProfit = 0n;
    const returnedToGlobal = participantAttempts === 0 ? totalPool : 0n;
    if (returnedToGlobal > 0n) {
      const returnKey = "round-unused-return:" + contestId;
      const existingReturn = await tx.globalPrizeLedger.findUnique({ where: { referenceKey: returnKey } });
      if (!existingReturn) {
        await tx.globalPrizeLedger.create({
          data: {
            id: "round-unused-return-" + contestId,
            type: "ROUND_UNUSED_RETURN",
            amountMicro: returnedToGlobal,
            contestId,
            effectiveAt: new Date(),
            referenceKey: returnKey,
            note: "SIMULATED unused round allocation returned to global prize fund because no participant submitted an answer; no real assets transferred",
          },
        });
        await tx.globalPrizeFund.update({
          where: { id: "global" },
          data: {
            balanceMicro: { increment: returnedToGlobal },
            updatedAt: new Date(),
          },
        });
      }
    }

    for (const person of finishers) {
      const payout = payouts.get(person.userId);
      if (!payout || payout.amount === 0n) continue;
      await tx.prizeAward.create({
        data: {
          contestId,
          userId: person.userId,
          username: person.username,
          rank: person.rank,
          amountMicro: payout.amount,
          status: "SIMULATED",
        },
      });
      await tx.prizeLedger.create({
        data: {
          contestId,
          type: "AWARD",
          amountMicro: payout.amount,
          note: `SIMULATED prize award for rank ${person.rank} to ${person.username}; no real assets transferred`,
          referenceKey: `award:${contestId}:${person.userId}`,
        },
      });
      await tx.walletTransaction.create({
        data: {
          userId: person.userId,
          type: "PRIZE_CREDIT",
          status: "COMPLETED",
          amountMicro: payout.amount,
          currency: "USDT",
          note: `Simulated prize credit for round ${contestId}, rank ${person.rank}; no real assets transferred.`,
          referenceKey: `prize-credit:${contestId}:${person.userId}`,
          contestId,
        },
      });
    }

    const updated = await tx.prizePool.update({
      where: { contestId },
      data: {
        awardedMicro: distributed,
        projectProfitMicro: 0n,
        returnedToGlobalMicro: returnedToGlobal,
        rolloverOutMicro: 0n,
        status: "SETTLED",
        settledAt: new Date(),
        testOnly: true,
      },
    });
    await tx.auditLog.create({
      data: {
        ...(actorUserId ? { userId: actorUserId } : {}),
        action: "PRIZE_POOL_SIMULATED_SETTLEMENT",
        entity: "PrizePool",
        entityId: pool.id,
        metadata: {
          awardedMicro: distributed.toString(),
          projectProfitMicro: "0",
          returnedToGlobalMicro: returnedToGlobal.toString(),
          completedParticipants: finishers.length,
          participantAttempts,
          rolloverMicro: "0",
        },
      },
    });
    return {
      alreadySettled: false,
      pool: responsePool(updated),
      completedParticipants: finishers.length,
      awards: finishers.flatMap((person) => {
        const payout = payouts.get(person.userId);
        return payout ? [{ username: person.username, rank: person.rank, amount: formatMicro(payout.amount), status: "SIMULATED" }] : [];
      }),
    };
  });
}
