import prisma from "../../config/prisma.js";

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  username: string;
  solvedCount: number;
  totalResponseTimeMs: number;
  incorrectAttempts: number;
  completed: boolean;
};

export async function getContestLeaderboard(
  contestId: string,
  limit = 100,
) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  const submissions = await prisma.submission.findMany({
    where: { contestId },
    select: {
      userId: true,
      clueId: true,
      isCorrect: true,
      responseTimeMs: true,
      user: {
        select: { username: true },
      },
    },
  });

  const byUser = new Map<
    string,
    {
      username: string;
      solvedClueIds: Set<string>;
      totalResponseTimeMs: bigint;
      incorrectAttempts: number;
    }
  >();

  for (const submission of submissions) {
    const existing = byUser.get(submission.userId);

    if (!existing) {
      byUser.set(submission.userId, {
        username: submission.user.username,
        solvedClueIds: new Set(
          submission.isCorrect ? [submission.clueId] : [],
        ),
        totalResponseTimeMs:
          submission.isCorrect
            ? submission.responseTimeMs ?? 0n
            : 0n,
        incorrectAttempts: submission.isCorrect ? 0 : 1,
      });
      continue;
    }

    if (submission.isCorrect) {
      existing.solvedClueIds.add(submission.clueId);
      existing.totalResponseTimeMs +=
        submission.responseTimeMs ?? 0n;
    } else {
      existing.incorrectAttempts += 1;
    }
  }

  const entries = [...byUser.entries()]
    .map(([userId, value]) => ({
      userId,
      username: value.username,
      solvedCount: value.solvedClueIds.size,
      totalResponseTimeMs: Number(value.totalResponseTimeMs),
      incorrectAttempts: value.incorrectAttempts,
      completed: value.solvedClueIds.size >= 12,
    }))
    .sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? -1 : 1;
      }

      if (a.completed && b.completed) {
        if (a.totalResponseTimeMs !== b.totalResponseTimeMs) {
          return a.totalResponseTimeMs - b.totalResponseTimeMs;
        }

        return a.incorrectAttempts - b.incorrectAttempts;
      }

      if (a.solvedCount !== b.solvedCount) {
        return b.solvedCount - a.solvedCount;
      }

      if (a.totalResponseTimeMs !== b.totalResponseTimeMs) {
        return a.totalResponseTimeMs - b.totalResponseTimeMs;
      }

      return a.incorrectAttempts - b.incorrectAttempts;
    })
    .slice(0, limit);

  const leaderboard: LeaderboardEntry[] = entries.map(
    (entry, index) => ({
      rank: index + 1,
      ...entry,
    }),
  );

  return {
    contestId,
    entries: leaderboard,
  };
}
