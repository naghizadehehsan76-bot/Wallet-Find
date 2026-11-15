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

type ContestLeaderboardAggregateRow = LeaderboardAggregateRow & {
  contestId: string;
  contestStartsAt: Date | null;
};

/**
 * Build leaderboards for several contests with one grouped database query.
 * The history page uses this instead of issuing one leaderboard query per
 * challenge. PostgreSQL limits each contest partition before rows reach Node.
 */
export async function getContestsLeaderboards(
  contestIds: readonly string[],
  limit = 500,
): Promise<Map<string, { contestId: string; entries: ReturnType<typeof buildLeaderboardEntries> }>> {
  const result = new Map<string, { contestId: string; entries: ReturnType<typeof buildLeaderboardEntries> }>();
  if (contestIds.length === 0) return result;

  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_LEADERBOARD_PAGE_SIZE, Math.floor(limit)))
    : 100;

  const contestIdsJson = JSON.stringify([...new Set(contestIds)]);
  const aggregates = await prisma.$queryRaw<ContestLeaderboardAggregateRow[]> `
    WITH contest_ids AS (
      SELECT jsonb_array_elements_text(${contestIdsJson}::jsonb) AS "contestId"
    ),
    aggregates AS (
      SELECT
        s."contestId" AS "contestId",
        s."userId" AS "userId",
        u."username" AS "username",
        COUNT(DISTINCT s."clueId") FILTER (WHERE s."isCorrect")::int AS "solvedCount",
        COUNT(*) FILTER (WHERE NOT s."isCorrect")::int AS "incorrectAttempts",
        MAX(s."submittedAt") FILTER (
          WHERE s."isCorrect" AND clue."sequence" = 12
        ) AS "completedAt",
        MAX(s."submittedAt") AS "lastSubmittedAt",
        contest."startsAt" AS "contestStartsAt"
      FROM "submissions" AS s
      INNER JOIN "users" AS u ON u."id" = s."userId"
      INNER JOIN "contest_clues" AS clue ON clue."id" = s."clueId"
      INNER JOIN "contests" AS contest ON contest."id" = s."contestId"
      WHERE s."contestId" IN (SELECT "contestId" FROM contest_ids)
      GROUP BY s."contestId", s."userId", u."username", contest."startsAt"
    ),
    ranked AS (
      SELECT
        aggregates.*,
        ROW_NUMBER() OVER (
          PARTITION BY "contestId"
          ORDER BY
            CASE
              WHEN "solvedCount" >= 12 AND "completedAt" IS NOT NULL THEN 0
              ELSE 1
            END ASC,
            "completedAt" ASC NULLS LAST,
            "solvedCount" DESC,
            "lastSubmittedAt" ASC NULLS LAST,
            "incorrectAttempts" ASC,
            "userId" ASC
        ) AS "position"
      FROM aggregates
    )
    SELECT
      "contestId",
      "userId",
      "username",
      "solvedCount",
      "incorrectAttempts",
      "completedAt",
      "lastSubmittedAt",
      "contestStartsAt"
    FROM ranked
    WHERE "position" <= ${safeLimit}
    ORDER BY "contestId" ASC, "position" ASC
  `;

  const rowsByContest = new Map<string, ContestLeaderboardAggregateRow[]>();
  for (const row of aggregates) {
    const rows = rowsByContest.get(row.contestId) ?? [];
    rows.push(row);
    rowsByContest.set(row.contestId, rows);
  }

  for (const contestId of new Set(contestIds)) {
    const rows = rowsByContest.get(contestId) ?? [];
    result.set(contestId, {
      contestId,
      entries: buildLeaderboardEntries(rows, rows[0]?.contestStartsAt ?? null),
    });
  }

  return result;
}

