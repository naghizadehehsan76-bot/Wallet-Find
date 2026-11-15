import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { getContestsLeaderboards } from "./leaderboard.service.js";

const shouldRun = (() => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;
  try {
    const databaseName = new URL(connectionString).pathname.replace(/^\//, "");
    return /(?:^|[_-])(ci|test|testing|integration)(?:$|[_-])/i.test(databaseName);
  } catch {
    return false;
  }
})();

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("batches requested contest leaderboards and applies the per-contest entry limit", {
  skip: !shouldRun,
  timeout: 60_000,
}, async () => {
  const suffix = randomUUID();
  const startsAt = new Date(Date.now() - 10 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 15 * 60_000);
  const contestIds: string[] = [];
  const userIds = [
    `history-winner-${suffix}`,
    `history-partial-${suffix}`,
    `history-second-round-${suffix}`,
  ];

  try {
    const firstContest = await prisma.contest.create({
      data: {
        title: `CI leaderboard history first ${suffix}`,
        status: "FINISHED",
        language: "en",
        startsAt,
        endsAt,
      },
      select: { id: true },
    });
    contestIds.push(firstContest.id);

    const secondContest = await prisma.contest.create({
      data: {
        title: `CI leaderboard history second ${suffix}`,
        status: "FINISHED",
        language: "en",
        startsAt,
        endsAt,
      },
      select: { id: true },
    });
    contestIds.push(secondContest.id);

    const emptyContest = await prisma.contest.create({
      data: {
        title: `CI leaderboard history empty ${suffix}`,
        status: "FINISHED",
        language: "en",
        startsAt,
        endsAt,
      },
      select: { id: true },
    });
    contestIds.push(emptyContest.id);

    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: `${id}@example.invalid`,
        username: id,
        passwordHash: "ci-only-not-a-real-password",
      })),
    });

    await Promise.all(contestIds.map((contestId) => prisma.contestClue.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        contestId,
        sequence: index + 1,
        content: `CI history clue ${index + 1}`,
        correctAnswer: `answer-${index + 1}`,
        publishedAt: startsAt,
      })),
    })));

    const clues = await prisma.contestClue.findMany({
      where: { contestId: { in: contestIds } },
      select: { id: true, contestId: true, sequence: true },
    });
    const clueByContestAndSequence = new Map(
      clues.map((clue) => [`${clue.contestId}:${clue.sequence}`, clue.id]),
    );

    const submissions = [
      ...Array.from({ length: 12 }, (_, index) => ({
        userId: userIds[0]!,
        contestId: firstContest.id,
        clueId: clueByContestAndSequence.get(`${firstContest.id}:${index + 1}`)!,
        answer: `answer-${index + 1}`,
        isCorrect: true,
        submittedAt: new Date(startsAt.getTime() + (index + 1) * 1_000),
      })),
      {
        userId: userIds[1]!,
        contestId: firstContest.id,
        clueId: clueByContestAndSequence.get(`${firstContest.id}:1`)!,
        answer: "incorrect",
        isCorrect: false,
        submittedAt: new Date(startsAt.getTime() + 30_000),
      },
      {
        userId: userIds[2]!,
        contestId: secondContest.id,
        clueId: clueByContestAndSequence.get(`${secondContest.id}:1`)!,
        answer: "answer-1",
        isCorrect: true,
        submittedAt: new Date(startsAt.getTime() + 5_000),
      },
    ];

    await prisma.submission.createMany({ data: submissions });

    const boards = await getContestsLeaderboards(
      [firstContest.id, secondContest.id, emptyContest.id],
      1,
    );

    assert.equal(boards.size, 3);
    assert.equal(boards.get(firstContest.id)?.entries.length, 1);
    assert.equal(boards.get(firstContest.id)?.entries[0]?.userId, userIds[0]);
    assert.equal(boards.get(firstContest.id)?.entries[0]?.completed, true);
    assert.equal(boards.get(secondContest.id)?.entries.length, 1);
    assert.equal(boards.get(secondContest.id)?.entries[0]?.userId, userIds[2]);
    assert.deepEqual(boards.get(emptyContest.id)?.entries, []);
  } finally {
    if (contestIds.length > 0) {
      await prisma.contest.deleteMany({ where: { id: { in: contestIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
