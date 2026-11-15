import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import prisma from "../../config/prisma.js";
import { getContestsLeaderboards } from "./leaderboard.service.js";
import { challengeNumberAt, getChallengeScheduleAnchor } from "./challenge-schedule.js";

const HISTORY_PAGE_SIZE = 20;
const HISTORY_ENTRY_LIMIT = 500;
const MICRO_UNITS = 1_000_000n;

function formatMicroAmount(value: bigint): string {
  const safe = value > 0n ? value : 0n;
  return `${safe / MICRO_UNITS}.${(safe % MICRO_UNITS).toString().padStart(6, "0")}`;
}

export async function getLeaderboardHistoryHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  }

  try {
    const requestedPage = typeof req.query.page === "string" ? Number(req.query.page) : 1;
    const safeRequestedPage = Number.isFinite(requestedPage)
      ? Math.max(1, Math.floor(requestedPage))
      : 1;

    // A history round must have at least one participant submission.
    // This excludes generated/scheduled empty rounds without deleting any data.
    const historyStatuses: Array<"ACTIVE" | "FINISHED"> = ["ACTIVE", "FINISHED"];
    const historyWhere = {
      startsAt: { not: null },
      status: { in: historyStatuses },
      submissions: { some: {} },
    };

    const total = await prisma.contest.count({ where: historyWhere });
    const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    const page = Math.min(safeRequestedPage, pageCount);

    const [contests, scheduleAnchor] = await Promise.all([
      prisma.contest.findMany({
        where: historyWhere,
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * HISTORY_PAGE_SIZE,
        take: HISTORY_PAGE_SIZE,
        select: {
          id: true,
          title: true,
          status: true,
          language: true,
          startsAt: true,
          endsAt: true,
        },
      }),
      getChallengeScheduleAnchor(),
    ]);

    const contestIds = contests.map((contest) => contest.id);
    const leaderboards = await getContestsLeaderboards(contestIds, HISTORY_ENTRY_LIMIT);
    const participantIds = [...new Set(
      [...leaderboards.values()].flatMap((board) => board.entries.map((entry) => entry.userId)),
    )];

    const [awards, paidPrizeTotals] = participantIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.prizeAward.findMany({
            where: {
              contestId: { in: contestIds },
              userId: { in: participantIds },
            },
            select: {
              contestId: true,
              userId: true,
              amountMicro: true,
              status: true,
              transactionHash: true,
            },
          }),
          prisma.prizeAward.groupBy({
            by: ["userId"],
            where: {
              userId: { in: participantIds },
              status: "PAID",
            },
            _sum: { amountMicro: true },
          }),
        ]);

    const awardByContestAndUser = new Map(
      awards.map((award) => [`${award.contestId}:${award.userId}`, award]),
    );
    const paidTotalByUser = new Map(
      paidPrizeTotals.map((item) => [item.userId, item._sum.amountMicro ?? 0n]),
    );

    const rounds = contests.map((contest) => {
      const leaderboard = leaderboards.get(contest.id);
      return {
        id: contest.id,
        number: challengeNumberAt(contest.startsAt, scheduleAnchor),
        title: contest.title,
        status: contest.status,
        startsAt: contest.startsAt?.toISOString() ?? null,
        endsAt: contest.endsAt?.toISOString() ?? null,
        entries: (leaderboard?.entries ?? []).map((entry) => {
          const award = awardByContestAndUser.get(`${contest.id}:${entry.userId}`);
          const awardedAmount = award ? BigInt(award.amountMicro) : 0n;
          return {
            ...entry,
            prizeAwarded: formatMicroAmount(awardedAmount),
            prizeEarned: award?.status === "PAID" ? formatMicroAmount(awardedAmount) : "0.000000",
            totalPrizeEarned: formatMicroAmount(paidTotalByUser.get(entry.userId) ?? 0n),
            prizeStatus: award?.status ?? null,
            prizeTransactionHash: award?.transactionHash ?? null,
          };
        }),
      };
    });

    return res.json({
      success: true,
      data: {
        rounds,
        page,
        pageSize: HISTORY_PAGE_SIZE,
        pageCount,
        total,
      },
    });
  } catch (error) {
    console.error("Unable to build paginated leaderboard history", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}
