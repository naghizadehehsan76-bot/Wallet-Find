import prisma from "../../config/prisma.js";
import { buildLeaderboardEntries, type LeaderboardAggregateRow } from "./leaderboard.logic.js";

export type { LeaderboardEntry } from "./leaderboard.logic.js";

const MAX_LEADERBOARD_PAGE_SIZE = 5_000;

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

  if (!contest) throw new Error("CONTEST_NOT_FOUND");

  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_LEADERBOARD_PAGE_SIZE, Math.floor(limit)))
    : 100;

  // Aggregate in PostgreSQL and return one row per participant instead of
  // transferring every answer attempt to the API process. A composite index
  // on (contestId, submittedAt) supports the contest-scoped scan.
  const aggregates = await prisma.$queryRaw<LeaderboardAggregateRow[]> `
    SELECT
      s."userId" AS "userId",
      u."username" AS "username",
      COUNT(DISTINCT s."clueId") FILTER (WHERE s."isCorrect")::int AS "solvedCount",
      COUNT(*) FILTER (WHERE NOT s."isCorrect")::int AS "incorrectAttempts",
      MAX(s."submittedAt") FILTER (
        WHERE s."isCorrect" AND clue."sequence" = 12
      ) AS "completedAt",
      MAX(s."submittedAt") AS "lastSubmittedAt"
    FROM "submissions" AS s
    INNER JOIN "users" AS u ON u."id" = s."userId"
    INNER JOIN "contest_clues" AS clue ON clue."id" = s."clueId"
    WHERE s."contestId" = ${contestId}
    GROUP BY s."userId", u."username"
    ORDER BY
      CASE
        WHEN COUNT(DISTINCT s."clueId") FILTER (WHERE s."isCorrect") >= 12
          AND MAX(s."submittedAt") FILTER (
            WHERE s."isCorrect" AND clue."sequence" = 12
          ) IS NOT NULL
        THEN 0 ELSE 1
      END ASC,
      MAX(s."submittedAt") FILTER (
        WHERE s."isCorrect" AND clue."sequence" = 12
      ) ASC NULLS LAST,
      COUNT(DISTINCT s."clueId") FILTER (WHERE s."isCorrect") DESC,
      MAX(s."submittedAt") ASC,
      COUNT(*) FILTER (WHERE NOT s."isCorrect") ASC,
      s."userId" ASC
    LIMIT ${safeLimit}
  `;

  return {
    contestId,
    entries: buildLeaderboardEntries(aggregates, contest.startsAt),
  };
}
