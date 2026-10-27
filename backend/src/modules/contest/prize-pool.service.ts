import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS } from "./contest.logic.js";

const MICRO = 1_000_000n;
const BASIS_POINTS = 10_000n;
const PODIUM_BASIS_POINTS = [5_000n, 2_250n, 1_250n] as const;
const LOWER_RANK_BASIS_POINTS = 1_000n;
const PROJECT_PROFIT_BASIS_POINTS = 500n;
const FIXED_TEST_POOL = 100n * MICRO;

function formatMicro(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MICRO;
  const fraction = (absolute % MICRO).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function parseUsdt(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,12}(\.\d{1,6})?$/.test(value)) {
    throw new Error("INVALID_TEST_FUNDING_AMOUNT");
  }
  const whole = value.split(".")[0] ?? "0";
  const fraction = value.split(".")[1] ?? "";
  return BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, "0") || "0");
}

async function ensurePool(tx: any, contestId: string) {
  const contest = await tx.contest.findUnique({
    where: { id: contestId },
    select: { id: true },
  });
  if (!contest) throw new Error("CONTEST_NOT_FOUND");
  let pool = await tx.prizePool.upsert({
    where: { contestId },
    update: {},
    create: { contestId, testOnly: true, currency: "USDT" },
  });

  // Every experimental round has a fixed simulated pool of exactly 100 USDT.
  // No setting, unused share, or prior-round balance can increase a later round.
  const initialFundingKey = `test-funding-initial:${contestId}`;
  const initialFunding = await tx.prizeLedger.findUnique({
    where: { referenceKey: initialFundingKey },
    select: { id: true },
  });

  if (pool.status === "OPEN") {
    // Normalize still-open legacy test records to the fixed experimental rule.
    if (
      BigInt(pool.seededMicro) !== FIXED_TEST_POOL ||
      BigInt(pool.rolloverInMicro) !== 0n ||
      BigInt(pool.rolloverOutMicro) !== 0n ||
      BigInt(pool.awardedMicro) !== 0n ||
      BigInt(pool.projectProfitMicro ?? 0n) !== 0n
    ) {
      pool = await tx.prizePool.update({
        where: { contestId },
        data: {
          seededMicro: FIXED_TEST_POOL,
          rolloverInMicro: 0n,
          rolloverOutMicro: 0n,
          awardedMicro: 0n,
          projectProfitMicro: 0n,
          testOnly: true,
        },
      });
    }

    if (!initialFunding) {
      await tx.prizeLedger.create({
        data: {
          contestId,
          type: "TEST_FUNDING",
          amountMicro: FIXED_TEST_POOL,
          note: `SIMULATED FIXED ROUND PRIZE POOL 100.000000 USDT for round ${contestId}; no real assets transferred`,
          referenceKey: initialFundingKey,
        },
      });
    }
  }

  // Experimental prize balances are isolated per round; no rollover is applied.
  return pool;
}

function responsePool(pool: any) {
  const total = BigInt(pool.seededMicro) + BigInt(pool.rolloverInMicro);
  const spent = BigInt(pool.awardedMicro) + BigInt(pool.rolloverOutMicro) + BigInt(pool.projectProfitMicro ?? 0n);
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
    available: formatMicro(total - spent),
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

export async function testFundPrizePool(contestId: string, rawAmount: unknown, actorUserId?: string) {
  const amount = parseUsdt(rawAmount);
  if (amount <= 0n) throw new Error("INVALID_TEST_FUNDING_AMOUNT");

  return prisma.$transaction(async (tx) => {
    const pool = await ensurePool(tx, contestId);
    if (pool.status === "SETTLED") throw new Error("PRIZE_POOL_ALREADY_SETTLED");
    const ledgerId = `test-funding:${contestId}:${Date.now()}:${actorUserId ?? "admin"}`;
    const updated = await tx.prizePool.update({
      where: { contestId },
      data: { seededMicro: { increment: amount }, testOnly: true },
    });
    await tx.prizeLedger.create({
      data: {
        contestId,
        type: "TEST_FUNDING",
        amountMicro: amount,
        note: `SIMULATED TEST FUNDING ${formatMicro(amount)} USDT; no real assets transferred`,
        referenceKey: ledgerId,
      },
    });
    await tx.auditLog.create({
      data: {
        ...(actorUserId ? { userId: actorUserId } : {}),
        action: "PRIZE_POOL_TEST_FUNDED",
        entity: "PrizePool",
        entityId: pool.id,
        metadata: { amountMicro: amount.toString(), testOnly: true },
      },
    });
    return responsePool(updated);
  });
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

    // A truly empty round is not treated as project revenue. Once anyone has
    // submitted in a round, the 5% share is recorded in the project dividend pool.
    const projectProfit = participantAttempts > 0
      ? totalPool * PROJECT_PROFIT_BASIS_POINTS / BASIS_POINTS
      : 0n;

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

    if (projectProfit > 0n) {
      await tx.prizeLedger.create({
        data: {
          contestId,
          type: "PROJECT_PROFIT",
          amountMicro: projectProfit,
          note: `SIMULATED 5% project dividend pool contribution for round ${contestId}; no real assets transferred`,
          referenceKey: `project-profit:${contestId}`,
        },
      });
    }

    const updated = await tx.prizePool.update({
      where: { contestId },
      data: {
        awardedMicro: distributed,
        projectProfitMicro: projectProfit,
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
          projectProfitMicro: projectProfit.toString(),
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
