import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { runPrizePayoutProcessorOnce } from "./prize-payout.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("parallel payout processors credit one internal prize exactly once without chain signing", {
  skip: !shouldRun,
  timeout: 120_000,
}, async () => {
  const suffix = randomUUID();
  const polygonNetworkId = "ci-polygon-" + suffix;
  const polygonUsdt0AssetId = polygonNetworkId + "/usdt0";
  const userId = "ci-prize-payout-" + suffix;
  const ineligibleUserId = "ci-prize-ineligible-" + suffix;
  const oldEnabled = process.env.PRIZE_PAYOUTS_ENABLED;
  const oldReady = process.env.PRIZE_PAYOUTS_PRODUCTION_READY;
  let contestId: string | null = null;

  try {
    await prisma.walletNetwork.upsert({
      where: { id: polygonNetworkId },
      update: { isEnabled: true },
      create: {
        id: polygonNetworkId,
        family: "EVM",
        chainId: 137,
        networkKey: "ci-polygon-pos-" + suffix,
        displayName: "CI Polygon PoS",
        nativeAssetSymbol: "POL",
        nativeAssetDecimals: 18,
        finalityDepth: 1,
        isEnabled: true,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    });
    await prisma.walletAsset.upsert({
      where: { id: polygonUsdt0AssetId },
      update: {
        verificationStatus: "VERIFIED",
        symbol: "USDT0",
        decimals: 6,
        assetType: "TOKEN",
        contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      },
      create: {
        id: polygonUsdt0AssetId,
        networkId: polygonNetworkId,
        assetType: "TOKEN",
        assetReference: "erc20:0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        symbol: "USDT0",
        displayName: "CI Polygon USDT0",
        decimals: 6,
        issuerClassification: "CI_ONLY",
        verificationStatus: "VERIFIED",
        confirmationCount: 1,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        email: userId + "@example.invalid",
        username: userId,
        passwordHash: "ci-only-not-a-real-password",
      },
    });
    await prisma.user.create({
      data: {
        id: ineligibleUserId,
        email: ineligibleUserId + "@example.invalid",
        username: ineligibleUserId,
        passwordHash: "ci-only-not-a-real-password",
      },
    });
    const contest = await prisma.contest.create({
      data: {
        title: "CI internal payout test",
        status: "FINISHED",
        language: "en",
        startsAt: new Date(Date.now() - 30 * 60_000),
        endsAt: new Date(Date.now() - 15 * 60_000),
        prizePool: {
          create: {
            currency: "USDT0",
            seededMicro: 200_000n,
            awardedMicro: 200_000n,
            testOnly: true,
            status: "PAYOUT_PENDING",
          },
        },
        clues: {
          create: {
            sequence: 1,
            type: "TEXT",
            source: "SYSTEM",
            content: "CI test clue",
            correctAnswer: "yes",
          },
        },
      },
      select: { id: true, clues: { select: { id: true } } },
    });
    contestId = contest.id;
    await prisma.submission.create({
      data: {
        userId,
        contestId: contest.id,
        clueId: contest.clues[0]!.id,
        answer: "yes",
        isCorrect: true,
        prizeEligibleAtJoin: true,
      },
    });
    const ineligibleAward = await prisma.prizeAward.create({
      data: {
        contestId: contest.id,
        userId: ineligibleUserId,
        username: ineligibleUserId,
        rank: 1,
        amountMicro: 100_000n,
        status: "PENDING_PAYMENT",
      },
    });
    const award = await prisma.prizeAward.create({
      data: {
        contestId: contest.id,
        userId,
        username: userId,
        rank: 2,
        amountMicro: 100_000n,
        status: "PENDING_PAYMENT",
      },
    });

    process.env.PRIZE_PAYOUTS_ENABLED = "true";
    process.env.PRIZE_PAYOUTS_PRODUCTION_READY = "true";

    await Promise.all(Array.from({ length: 8 }, () => runPrizePayoutProcessorOnce()));
    // A transient database conflict must leave the award retryable.
    await runPrizePayoutProcessorOnce();

    const finalAward = await prisma.prizeAward.findUnique({ where: { id: award.id } });
    const finalIneligibleAward = await prisma.prizeAward.findUnique({ where: { id: ineligibleAward.id } });
    assert.equal(finalAward?.status, "PAID");
    assert.equal(finalIneligibleAward?.status, "INELIGIBLE");
    assert.equal(await prisma.walletJournal.count({ where: { referenceKey: "prize-award:" + award.id } }), 1);
    assert.equal(await prisma.walletJournalPosting.count({
      where: {
        account: "USER_AVAILABLE",
        journal: { referenceKey: "prize-award:" + award.id, userId },
      },
    }), 1);
    const finalPool = await prisma.prizePool.findUnique({ where: { contestId: contest.id } });
    assert.equal(finalPool?.status, "SETTLED");
  } finally {
    if (oldEnabled === undefined) delete process.env.PRIZE_PAYOUTS_ENABLED;
    else process.env.PRIZE_PAYOUTS_ENABLED = oldEnabled;
    if (oldReady === undefined) delete process.env.PRIZE_PAYOUTS_PRODUCTION_READY;
    else process.env.PRIZE_PAYOUTS_PRODUCTION_READY = oldReady;

    // Remove every row created by this test, including its isolated network
    // and asset records, so repeated CI runs cannot accumulate test data.
    if (contestId) {
      await prisma.contest.deleteMany({ where: { id: contestId } });
    }
    const testUserIds = [userId, ineligibleUserId];
    await prisma.walletJournalPosting.deleteMany({
      where: { journal: { userId: { in: testUserIds } } },
    });
    await prisma.walletJournal.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await prisma.walletAsset.deleteMany({ where: { id: polygonUsdt0AssetId } });
    await prisma.walletNetwork.deleteMany({ where: { id: polygonNetworkId } });
  }
});
