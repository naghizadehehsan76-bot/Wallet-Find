import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { cleanupExpiredEmptyChallenges } from "./empty-contest-cleanup.service.js";

const shouldRun = (() => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;
  try {
    const databaseName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
    return /(?:^|[_-])(ci|test|testing|integration)(?:$|[_-])/i.test(databaseName);
  } catch {
    return false;
  }
})();

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("deletes expired empty challenge content while preserving linked financial and visit records", {
  skip: !shouldRun,
  timeout: 60_000,
}, async () => {
  const suffix = randomUUID();
  const now = new Date();
  const startsAt = new Date(now.getTime() - 20 * 60_000);
  const endsAt = new Date(now.getTime() - 5 * 60_000);
  const userId = "ci-empty-cleanup-" + suffix;
  const trackingToken = randomUUID();
  const contestIds: string[] = [];

  try {
    await prisma.user.create({
      data: {
        id: userId,
        email: userId + "@example.invalid",
        username: userId,
        passwordHash: "ci-only-not-a-real-password",
      },
    });

    const removable = await prisma.contest.create({
      data: {
        title: "CI empty challenge removable " + suffix,
        status: "FINISHED",
        language: "en",
        startsAt,
        endsAt,
        clues: {
          create: {
            sequence: 1,
            content: "temporary clue content",
            correctAnswer: "answer",
            sourceUrl: "https://example.com/source",
          },
        },
      },
      select: { id: true, clues: { select: { id: true } } },
    });
    contestIds.push(removable.id);

    const visit = await prisma.contestSourceVisit.create({
      data: {
        username: "ci-visitor",
        contestId: removable.id,
        contestTitle: removable.title,
        contestLanguage: "en",
        contestStartsAt: startsAt,
        clueId: removable.clues[0]!.id,
        clueSequence: 1,
        sourceUrl: "https://example.com/source",
        sourceHostname: "example.com",
        trackingToken,
      },
      select: { id: true },
    });

    const financial = await prisma.contest.create({
      data: {
        title: "CI empty challenge financial shell " + suffix,
        status: "FINISHED",
        language: "en",
        startsAt,
        endsAt,
        clues: {
          create: {
            sequence: 1,
            content: "financial shell clue content",
            correctAnswer: "answer",
          },
        },
        prizePool: { create: { currency: "USDT0", testOnly: false } },
        prizeLedger: {
          create: {
            type: "GLOBAL_ALLOCATION",
            amountMicro: 0n,
            note: "CI zero-value financial audit fixture",
            referenceKey: "ci-empty-cleanup-ledger-" + suffix,
          },
        },
      },
      select: { id: true },
    });
    contestIds.push(financial.id);

    const participant = await prisma.contest.create({
      data: {
        title: "CI empty cleanup participant " + suffix,
        status: "FINISHED",
        language: "en",
        startsAt,
        endsAt,
        clues: {
          create: {
            sequence: 1,
            content: "participant clue content",
            correctAnswer: "answer",
          },
        },
      },
      select: { id: true, clues: { select: { id: true } } },
    });
    contestIds.push(participant.id);

    await prisma.submission.create({
      data: {
        userId,
        contestId: participant.id,
        clueId: participant.clues[0]!.id,
        answer: "wrong answer",
        isCorrect: false,
      },
    });

    const future = await prisma.contest.create({
      data: {
        title: "CI empty cleanup future " + suffix,
        status: "ACTIVE",
        language: "en",
        startsAt,
        endsAt: new Date(now.getTime() + 10 * 60_000),
        clues: {
          create: {
            sequence: 1,
            content: "future clue content",
            correctAnswer: "answer",
          },
        },
      },
      select: { id: true },
    });
    contestIds.push(future.id);

    const result = await cleanupExpiredEmptyChallenges(now);
    assert.ok(result.deletedContests >= 1);

    const [removedContest, retainedFinancial, retainedParticipant, retainedFuture, retainedVisit, remainingFinancialClues] = await Promise.all([
      prisma.contest.findUnique({ where: { id: removable.id } }),
      prisma.contest.findUnique({ where: { id: financial.id } }),
      prisma.contest.findUnique({ where: { id: participant.id } }),
      prisma.contest.findUnique({ where: { id: future.id } }),
      prisma.contestSourceVisit.findUnique({ where: { id: visit.id } }),
      prisma.contestClue.count({ where: { contestId: financial.id } }),
    ]);

    assert.equal(removedContest, null);
    assert.ok(retainedFinancial);
    assert.ok(retainedParticipant);
    assert.ok(retainedFuture);
    assert.equal(remainingFinancialClues, 0);
    assert.equal(retainedVisit?.contestId, null);
    assert.equal(retainedVisit?.clueId, null);
    assert.equal(await prisma.prizeLedger.count({ where: { contestId: financial.id } }), 1);
    assert.ok(result.deletedClues >= 2);
  } finally {
    await prisma.contestSourceVisit.deleteMany({ where: { trackingToken } });
    if (contestIds.length > 0) {
      await prisma.contest.deleteMany({ where: { id: { in: contestIds } } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  }
});
