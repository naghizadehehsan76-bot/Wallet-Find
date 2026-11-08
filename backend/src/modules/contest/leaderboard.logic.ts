import { calculateResponseTimeMs } from "./contest.logic.js";

export type LeaderboardAggregateRow = {
  userId: string;
  username: string;
  solvedCount: number;
  incorrectAttempts: number;
  completedAt: Date | null;
  lastSubmittedAt: Date | null;
};

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  username: string;
  solvedCount: number;
  totalResponseTimeMs: number;
  incorrectAttempts: number;
  completed: boolean;
};

/**
 * Convert one database aggregate row per participant into the public ranking.
 * The SQL query already orders and limits the aggregate rows; this function
 * preserves that order and applies the shared tie-ranking rule.
 */
export function buildLeaderboardEntries(
  rows: readonly LeaderboardAggregateRow[],
  contestStartTime: Date | null,
): LeaderboardEntry[] {
  const entries = rows.map((row) => {
    const completed = row.solvedCount >= 12 && row.completedAt !== null;
    const referenceTime = completed ? row.completedAt : row.lastSubmittedAt;
    const overallElapsedMs = referenceTime && contestStartTime
      ? calculateResponseTimeMs(referenceTime, [contestStartTime])
      : 0;

    return {
      userId: row.userId,
      username: row.username,
      solvedCount: row.solvedCount,
      totalResponseTimeMs: overallElapsedMs,
      incorrectAttempts: row.incorrectAttempts,
      completed,
    };
  }).sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? -1 : 1;

    if (a.completed && b.completed) {
      return a.totalResponseTimeMs - b.totalResponseTimeMs;
    }

    if (a.solvedCount !== b.solvedCount) return b.solvedCount - a.solvedCount;
    if (a.totalResponseTimeMs !== b.totalResponseTimeMs) {
      return a.totalResponseTimeMs - b.totalResponseTimeMs;
    }
    if (a.incorrectAttempts !== b.incorrectAttempts) {
      return a.incorrectAttempts - b.incorrectAttempts;
    }
    return a.userId.localeCompare(b.userId);
  });

  let previousCompletedTotal: number | null = null;
  let previousRank = 0;

  return entries.map((entry, index) => {
    const rank = entry.completed
      && previousCompletedTotal !== null
      && entry.totalResponseTimeMs === previousCompletedTotal
      ? previousRank
      : index + 1;

    previousCompletedTotal = entry.completed ? entry.totalResponseTimeMs : null;
    previousRank = rank;

    return { rank, ...entry };
  });
}
