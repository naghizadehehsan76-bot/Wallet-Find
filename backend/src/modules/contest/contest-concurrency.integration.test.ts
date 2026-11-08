import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { submitAnswer } from "./contest.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("parallel participants and duplicate answer requests preserve one ordered answer per clue", {
  skip: !shouldRun,
  timeout: 180_000,
}, async () => {
  const suffix = randomUUID();
  const userIds = Array.from({ length: 20 }, (_, index) => `ci-concurrent-${suffix}-${index}`);
  let contestId: string | null = null;
  const startsAt = new Date(Date.now() - 60_000);
  const endsAt = new Date(Date.now() + 14 * 60_000);

  try {
    const contest = await prisma.contest.create({
      data: {
        title: "CI concurrent submission test",
        status: "ACTIVE",
        language: "en",
        startsAt,
        endsAt,
      },
      select: { id: true },
    });
    const activeContestId = contest.id;
    contestId = activeContestId;

    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: id + "@example.invalid",
        username: id,
        passwordHash: "ci-only-not-a-real-password",
      })),
    });

    await prisma.contestClue.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        contestId: activeContestId,
        sequence: index + 1,
        content: "Synthetic concurrency clue " + (index + 1),
        correctAnswer: "ci-answer-" + (index + 1),
        publishedAt: startsAt,
      })),
    });

    const clues = await prisma.contestClue.findMany({
      where: { contestId: activeContestId },
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true },
    });
    assert.equal(clues.length, 12);

    for (const clue of clues) {
      // Keep the burst above the five-connection CI pool while avoiding an
      // artificial connection-queue timeout from launching every fixture at once.
      for (let offset = 0; offset < userIds.length; offset += 2) {
        const batch = userIds.slice(offset, offset + 2);
        const attempts = await Promise.allSettled(batch.flatMap((userId) =>
          Array.from({ length: 2 }, () => submitAnswer(userId, activeContestId, {
            clueId: clue.id,
            answer: "ci-answer-" + clue.sequence,
          })),
        ));

        const unexpected = attempts.filter((result) =>
          result.status === "rejected"
          && !(result.reason instanceof Error
            && result.reason.message === "CLUE_NOT_CURRENT"),
        );
        assert.deepEqual(unexpected, [], `unexpected errors at clue ${clue.sequence}`);
      }
    }

    const grouped = await prisma.submission.groupBy({
      by: ["userId"],
      where: { contestId },
      _count: { _all: true },
    });
    assert.equal(grouped.length, userIds.length);
    assert.ok(grouped.every((row) => row._count._all === 12));

    const totals = await prisma.submission.groupBy({
      by: ["clueId", "isCorrect"],
      where: { contestId },
      _count: { _all: true },
    });
    assert.equal(totals.length, 12);
    assert.ok(totals.every((row) => row.isCorrect && row._count._all === userIds.length));

    const finalRows = await prisma.submission.count({
      where: { contestId: activeContestId, isCorrect: true },
    });
    assert.equal(finalRows, userIds.length * 12);
  } finally {
    if (contestId) await prisma.contest.deleteMany({ where: { id: contestId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
