import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import prisma from "../../config/prisma.js";
import { getContestLeaderboard } from "./leaderboard.service.js";
import { challengeNumberAt, getChallengeScheduleAnchor } from "./challenge-schedule.js";

export async function getLeaderboardHistoryHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  }

  try {
    const contests = await prisma.contest.findMany({
      where: {
        startsAt: { not: null },
        status: { in: ["ACTIVE", "FINISHED"] },
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, status: true, language: true, startsAt: true, endsAt: true },
    });

    const [englishAnchor, persianAnchor] = await Promise.all([
      getChallengeScheduleAnchor("en"),
      getChallengeScheduleAnchor("fa"),
    ]);

    const allAwards = await prisma.prizeAward.findMany({
      select: { userId: true, amountMicro: true },
    });
    const totalEarnedByUser = new Map<string, bigint>();
    for (const award of allAwards) {
      totalEarnedByUser.set(award.userId, (totalEarnedByUser.get(award.userId) ?? 0n) + award.amountMicro);
    }

    const rounds = await Promise.all(contests.map(async (contest) => {
      const leaderboard = await getContestLeaderboard(contest.id, 500);
      const awards = await prisma.prizeAward.findMany({
        where: { contestId: contest.id },
        select: { userId: true, amountMicro: true, status: true },
      });
      const awardByUser = new Map(awards.map((award) => [award.userId, award]));
      return {
        id: contest.id,
        number: challengeNumberAt(contest.startsAt, contest.language === "fa" ? persianAnchor : englishAnchor),
        title: contest.title,
        status: contest.status,
        startsAt: contest.startsAt?.toISOString() ?? null,
        endsAt: contest.endsAt?.toISOString() ?? null,
        entries: leaderboard.entries.map((entry) => {
          const award = awardByUser.get(entry.userId);
          return {
            ...entry,
            prizeEarned: award ? (Number(award.amountMicro) / 1_000_000).toFixed(6) : "0",
            totalPrizeEarned: ((totalEarnedByUser.get(entry.userId) ?? 0n) / 1_000_000n).toString() +
              "." + (((totalEarnedByUser.get(entry.userId) ?? 0n) % 1_000_000n).toString().padStart(6, "0")),
            prizeStatus: award?.status ?? null,
          };
        }),
      };
    }));

    return res.json({ success: true, data: { rounds } });
  } catch (error) {
    console.error("Unable to build leaderboard history", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}
