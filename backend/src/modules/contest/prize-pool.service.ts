import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS } from "./contest.logic.js";

const MICRO = 1_000_000n;
const POOL_PERCENTAGES = [50n, 20n, 10n] as const;

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

  // Create a fictional 100 USDT demo balance for the initial test pool only.
  // This is a ledger fixture only and cannot trigger any blockchain transfer.
  const initialFundingKey = `test-funding-initial:${contestId}`;
  const initialFunding = await tx.prizeLedger.findUnique({
    where: { referenceKey: initialFundingKey },
    select: { id: true },
  });
  const otherPoolsExist = await tx.prizePool.count({
    where: { contestId: { not: contestId } },
  });
  if (!initialFunding && otherPoolsExist === 0 && BigInt(pool.seededMicro) === 0n && pool.status === "OPEN") {
    const demoAmount = 100n * MICRO;
    pool = await tx.prizePool.update({
      where: { contestId },
      data: { seededMicro: { increment: demoAmount }, testOnly: true },
    });
    await tx.prizeLedger.create({
      data: {
        contestId,
        type: "TEST_FUNDING",
        amountMicro: demoAmount,
        note: "INITIAL DEMO BALANCE 100.000000 USDT; simulated only, no real assets transferred",
        referenceKey: initialFundingKey,
      },
    });
  }

  // Carry every not-yet-claimed rollover forward exactly once, when a later
  // round's pool is first accessed. Ledger reference keys make retries safe.
  const currentContest = await tx.contest.findUnique({
    where: { id: contestId },
    select: { startsAt: true },
  });
  if (currentContest?.startsAt && pool.status === "OPEN") {
    const previousPools = await tx.prizePool.findMany({
      where: {
        contestId: { not: contestId },
        status: "SETTLED",
        rolloverOutMicro: { gt: 0n },
        contest: { is: { startsAt: { lt: currentContest.startsAt } } },
      },
      select: { contestId: true, rolloverOutMicro: true },
      orderBy: { contest: { startsAt: "asc" } },
    });
    for (const previous of previousPools) {
      // A globally unique source key prevents the same rollover from being
      // credited to two different future rounds, even under concurrent requests.
      const referenceKey = `rollover-source:${previous.contestId}`;
      const alreadyTransferred = await tx.prizeLedger.findUnique({
        where: { referenceKey },
        select: { id: true },
      });
      if (alreadyTransferred) continue;
      const amount = BigInt(previous.rolloverOutMicro);
      if (amount <= 0n) continue;
      await tx.prizeLedger.create({
        data: {
          contestId,
          type: "ROLLOVER_IN",
          amountMicro: amount,
          note: `Rollover transferred from previous round ${previous.contestId} into round ${contestId}; simulated ledger only`,
          referenceKey,
        },
      });
      pool = await tx.prizePool.update({
        where: { contestId },
        data: { rolloverInMicro: { increment: amount } },
      });
    }
  }
  return pool;
}

function responsePool(pool: any) {
  const total = BigInt(pool.seededMicro) + BigInt(pool.rolloverInMicro);
  const spent = BigInt(pool.awardedMicro) + BigInt(pool.rolloverOutMicro);
  return {
    contestId: pool.contestId,
    currency: pool.currency,
    testOnly: true,
    status: pool.status,
    seeded: formatMicro(BigInt(pool.seededMicro)),
    rolloverIn: formatMicro(BigInt(pool.rolloverInMicro)),
    total: formatMicro(total),
    awarded: formatMicro(BigInt(pool.awardedMicro)),
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

    const correct = await tx.submission.findMany({
      where: { contestId, isCorrect: true },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      select: {
        userId: true,
        submittedAt: true,
        clue: { select: { sequence: true } },
        user: { select: { username: true } },
      },
    });
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

    const totalPool = BigInt(pool.seededMicro) + BigInt(pool.rolloverInMicro);
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
      let slotPercent = 0n;
      for (let slot = index; slot < Math.min(end, 3); slot++) slotPercent += POOL_PERCENTAGES[slot] ?? 0n;
      const groupAmount = totalPool * slotPercent / 100n;
      const groupSize = BigInt(end - index);
      const perPerson = groupAmount / groupSize;
      for (let cursor = index; cursor < end; cursor++) {
        const person = finishers[cursor];
        if (person && index < 3) payouts.set(person.userId, { rank: person.rank, amount: perPerson });
      }
      distributed += perPerson * groupSize;
      index = end;
    }

    // The final 20% is only available to finishers whose competition rank is 4+.
    const lowerPool = totalPool * 20n / 100n;
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
    }

    const rollover = totalPool - distributed;
    if (rollover > 0n) {
      await tx.prizeLedger.create({
        data: {
          contestId,
          type: "ROLLOVER_OUT",
          amountMicro: rollover,
          note: "Unawarded pool balance carried forward to a future round; simulated accounting only",
          referenceKey: `rollover-out:${contestId}`,
        },
      });
    }
    const updated = await tx.prizePool.update({
      where: { contestId },
      data: {
        awardedMicro: distributed,
        rolloverOutMicro: rollover,
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
        metadata: { awardedMicro: distributed.toString(), rolloverMicro: rollover.toString(), completedParticipants: finishers.length },
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
