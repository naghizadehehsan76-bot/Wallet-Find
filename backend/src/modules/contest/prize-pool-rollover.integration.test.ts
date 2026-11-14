import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { returnSettledPrizePoolUnusedToGlobal, settlePrizePool } from "./prize-pool.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("returns an unpaid finalized USDT0 remainder to the global fund exactly once", {
  skip: !shouldRun,
  timeout: 60_000,
}, async () => {
  const suffix = randomUUID();
  let referenceKey = "";
  let contestId: string | undefined;

  await prisma.globalPrizeFund.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });
  const beforeFund = await prisma.globalPrizeFund.findUniqueOrThrow({ where: { id: "global" } });

  try {
    const contest = await prisma.contest.create({
      data: {
        title: "CI prize rollover " + suffix,
        status: "FINISHED",
        language: "en",
        startsAt: new Date(Date.now() - 30 * 60_000),
        endsAt: new Date(Date.now() - 15 * 60_000),
        prizePool: {
          create: {
            currency: "USDT0",
            seededMicro: 100_000n,
            awardedMicro: 25_000n,
            testOnly: false,
            status: "SETTLED",
          },
        },
      },
      select: { id: true },
    });
    contestId = contest.id;
    referenceKey = "round-unused-return:" + contest.id;

    assert.equal(await returnSettledPrizePoolUnusedToGlobal(contest.id), "0.075000");
    assert.equal(await returnSettledPrizePoolUnusedToGlobal(contest.id), "0.000000");

    const [afterFund, pool, globalReturn, roundReturn] = await Promise.all([
      prisma.globalPrizeFund.findUniqueOrThrow({ where: { id: "global" } }),
      prisma.prizePool.findUniqueOrThrow({ where: { contestId: contest.id } }),
      prisma.globalPrizeLedger.findUnique({ where: { referenceKey } }),
      prisma.prizeLedger.findUnique({ where: { referenceKey: "round-rollover-out:" + contest.id } }),
    ]);

    assert.equal(BigInt(afterFund.balanceMicro) - BigInt(beforeFund.balanceMicro), 75_000n);
    assert.equal(pool.returnedToGlobalMicro, 75_000n);
    assert.equal(pool.rolloverOutMicro, 75_000n);
    assert.equal(globalReturn?.amountMicro, 75_000n);
    assert.equal(globalReturn?.type, "ROUND_UNUSED_RETURN");
    assert.equal(roundReturn?.amountMicro, 75_000n);
    assert.equal(roundReturn?.type, "ROLLOVER_OUT");
  } finally {
    await prisma.globalPrizeLedger.deleteMany({ where: { referenceKey } });
    if (contestId) {
      await prisma.prizeLedger.deleteMany({ where: { contestId } });
      await prisma.contest.delete({ where: { id: contestId } });
    }
    await prisma.globalPrizeFund.update({
      where: { id: "global" },
      data: { balanceMicro: beforeFund.balanceMicro },
    });
  }
});


test("cancels a round prize permanently when the shared fund is below 0.1 USDT0", {
  skip: !shouldRun,
  timeout: 60_000,
}, async () => {
  const suffix = randomUUID();
  let contestId: string | undefined;
  await prisma.globalPrizeFund.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });
  const beforeFund = await prisma.globalPrizeFund.findUniqueOrThrow({ where: { id: "global" } });

  try {
    await prisma.globalPrizeFund.update({
      where: { id: "global" },
      data: { balanceMicro: 50_000n },
    });
    const contest = await prisma.contest.create({
      data: {
        title: "CI insufficient prize funding " + suffix,
        status: "FINISHED",
        language: "en",
        startsAt: new Date(Date.now() - 30 * 60_000),
        endsAt: new Date(Date.now() - 15 * 60_000),
      },
      select: { id: true },
    });
    contestId = contest.id;

    const result = await settlePrizePool(contest.id, null);
    const [pool, awards, afterFund] = await Promise.all([
      prisma.prizePool.findUniqueOrThrow({ where: { contestId: contest.id } }),
      prisma.prizeAward.count({ where: { contestId: contest.id } }),
      prisma.globalPrizeFund.findUniqueOrThrow({ where: { id: "global" } }),
    ]);

    assert.equal(result.status, "CANCELLED_INSUFFICIENT_FUNDS");
    assert.equal(pool.status, "SETTLED");
    assert.equal(pool.awardedMicro, 0n);
    assert.equal(awards, 0);
    assert.equal(afterFund.balanceMicro, 50_000n);
  } finally {
    if (contestId) {
      await prisma.auditLog.deleteMany({
        where: {
          entity: "PrizePool",
          entityId: contestId,
          action: "PRIZE_POOL_CANCELLED_INSUFFICIENT_GLOBAL_FUNDS",
        },
      });
      await prisma.contest.deleteMany({ where: { id: contestId } });
    }
    await prisma.globalPrizeFund.update({
      where: { id: "global" },
      data: { balanceMicro: beforeFund.balanceMicro },
    });
  }
});


test("does not restore prize eligibility after the shared fund is topped up", {
  skip: !shouldRun,
  timeout: 60_000,
}, async () => {
  const suffix = randomUUID();
  let contestId: string | undefined;
  await prisma.globalPrizeFund.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });
  const beforeFund = await prisma.globalPrizeFund.findUniqueOrThrow({ where: { id: "global" } });

  try {
    await prisma.globalPrizeFund.update({
      where: { id: "global" },
      data: { balanceMicro: 150_000n },
    });
    const contest = await prisma.contest.create({
      data: {
        title: "CI invalidated prize funding " + suffix,
        status: "FINISHED",
        language: "en",
        startsAt: new Date(Date.now() - 30 * 60_000),
        endsAt: new Date(Date.now() - 15 * 60_000),
        prizeFundingInvalidatedAt: new Date(Date.now() - 10 * 60_000),
      },
      select: { id: true },
    });
    contestId = contest.id;

    const result = await settlePrizePool(contest.id, null);
    const pool = await prisma.prizePool.findUniqueOrThrow({ where: { contestId: contest.id } });
    assert.equal(result.status, "CANCELLED_INSUFFICIENT_FUNDS");
    assert.equal(pool.status, "SETTLED");
    assert.equal(pool.awardedMicro, 0n);
    assert.equal(await prisma.prizeAward.count({ where: { contestId: contest.id } }), 0);
  } finally {
    if (contestId) {
      await prisma.auditLog.deleteMany({
        where: {
          entity: "PrizePool",
          entityId: contestId,
          action: "PRIZE_POOL_CANCELLED_INSUFFICIENT_GLOBAL_FUNDS",
        },
      });
      await prisma.contest.deleteMany({ where: { id: contestId } });
    }
    await prisma.globalPrizeFund.update({
      where: { id: "global" },
      data: { balanceMicro: beforeFund.balanceMicro },
    });
  }
});
