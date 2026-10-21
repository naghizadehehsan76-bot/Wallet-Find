import { calculateCluePublicationTime } from "./contest.logic.js";

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
    select: {
      id: true,
      startsAt: true,
      setting: { select: { publishIntervalMinutes: true } },
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  const intervalMinutes = contest.setting?.publishIntervalMinutes ?? 2;
  const submissions = await prisma.submission.findMany({
    where: { contestId },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: {
      userId: true,
      clueId: true,
      isCorrect: true,
      submittedAt: true,
      responseTimeMs: true,
      clue: {
        select: {
          sequence: true,
          publishedAt: true,
        },
      },
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
    let existing = byUser.get(submission.userId);

    if (!existing) {
      existing = {
        username: submission.user.username,
        solvedClueIds: new Set<string>(),
        totalResponseTimeMs: 0n,
        incorrectAttempts: 0,
      };
      byUser.set(submission.userId, existing);
    }

    if (!submission.isCorrect) {
      existing.incorrectAttempts += 1;
      continue;
    }

    // Count one successful answer per clue only. Submissions are ordered by
    // server timestamp so duplicated concurrent correct requests cannot
    // inflate (or replace) the user's score more than once for the same clue.
    if (existing.solvedClueIds.has(submission.clueId)) {
      continue;
    }
    existing.solvedClueIds.add(submission.clueId);

    const publishedAt =
      submission.clue.publishedAt ??
      calculateCluePublicationTime(
        submission.clue.sequence,
        contest.startsAt,
        intervalMinutes,
      );
    const elapsedMs = publishedAt
      ? Math.max(0, submission.submittedAt.getTime() - publishedAt.getTime())
      : Number(submission.responseTimeMs ?? 0n);

    existing.totalResponseTimeMs += BigInt(elapsedMs);
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
