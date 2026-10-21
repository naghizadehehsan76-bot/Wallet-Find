import { calculateResponseTimeMs } from "./contest.logic.js";

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
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

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
      completedAt: Date | null;
      incorrectAttempts: number;
      lastSubmittedAt: Date | null;
    }
  >();

  for (const submission of submissions) {
    let existing = byUser.get(submission.userId);

    if (!existing) {
      existing = {
        username: submission.user.username,
        solvedClueIds: new Set<string>(),
        totalResponseTimeMs: 0n,
        completedAt: null,
        incorrectAttempts: 0,
        lastSubmittedAt: null,
      };
      byUser.set(submission.userId, existing);
    }

    if (!existing.lastSubmittedAt || submission.submittedAt > existing.lastSubmittedAt) {
      existing.lastSubmittedAt = submission.submittedAt;
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
    if (submission.clue.sequence === 12) {
      existing.completedAt = submission.submittedAt;
    }

    // Completed users are ranked by round completion time below. For
    // incomplete users, the last server timestamp is used only for progress display.
    existing.totalResponseTimeMs += BigInt(0);
  }

  const contestStartTime = contest.startsAt;

  const entries = [...byUser.entries()]
    .map(([userId, value]) => {
      const completed = value.solvedClueIds.size >= 12;
      const overallElapsedMs =
        completed && value.completedAt && contestStartTime
          ? calculateResponseTimeMs(value.completedAt, [contestStartTime])
          : value.lastSubmittedAt && contestStartTime
            ? calculateResponseTimeMs(value.lastSubmittedAt, [contestStartTime])
            : 0;

      return {
        userId,
        username: value.username,
        solvedCount: value.solvedClueIds.size,
        totalResponseTimeMs: overallElapsedMs,
        incorrectAttempts: value.incorrectAttempts,
        completed,
      };
    })
    .sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? -1 : 1;
      }

      if (a.completed && b.completed) {
        // Once both users solved all twelve clues, total elapsed time alone
        // decides the order. Equal totals are a tie, not an error-count win.
        return a.totalResponseTimeMs - b.totalResponseTimeMs;
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

  let previousCompletedTotal: number | null = null;
  let previousRank = 0;

  const leaderboard: LeaderboardEntry[] = entries.map((entry, index) => {
    const rank =
      entry.completed &&
      previousCompletedTotal !== null &&
      entry.totalResponseTimeMs === previousCompletedTotal
        ? previousRank
        : index + 1;

    previousCompletedTotal = entry.completed
      ? entry.totalResponseTimeMs
      : null;
    previousRank = rank;

    return {
      rank,
      ...entry,
    };
  });

  return {
    contestId,
    entries: leaderboard,
  };
}
