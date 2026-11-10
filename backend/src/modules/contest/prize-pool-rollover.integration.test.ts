import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { returnSettledPrizePoolUnusedToGlobal } from "./prize-pool.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("returns an unpaid finalized USDT0 remainder to the global fund exactly once", {
  skip: !shouldRun,
  timeout: 60_000,
}, async () => {
  const suffix = randomUUID();
  const referenceKey = "round-unused-return:" + suffix;
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
