import type { Request, Response } from "express";
import prisma from "../../config/prisma.js";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import { getPublicPrizePool } from "../contest/prize-pool.service.js";

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

const MICRO_USDT = 1_000_000n;

function formatMicroUsdt(value: bigint): string {
  const safeValue = value > 0n ? value : 0n;
  const whole = safeValue / MICRO_USDT;
  const fraction = (safeValue % MICRO_USDT).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

export async function getPublicPrizePoolStatsHandler(
  req: Request,
  res: Response,
) {
  const language = req.query.language === "fa" ? "fa" : "en";
  const now = new Date();

  try {
    const currentContest = await prisma.contest.findFirst({
      where: {
        language,
        status: { in: ["ACTIVE", "SCHEDULED"] },
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { startsAt: "desc" },
      select: { id: true },
    });

    // Initialize the current round before calculating the site-wide total so
    // the first response includes the newly allocated base pool as well.
    const currentPool = currentContest
      ? await getPublicPrizePool(currentContest.id)
      : null;

    const [seededTotal, awardedTotal] = await Promise.all([
      prisma.prizePool.aggregate({
        where: { currency: "USDT" },
        _sum: { seededMicro: true },
      }),
      prisma.prizePool.aggregate({
        where: { currency: "USDT" },
        _sum: { awardedMicro: true },
      }),
    ]);

    const totalFunded = BigInt(seededTotal._sum.seededMicro ?? 0n);
    const totalAwarded = BigInt(awardedTotal._sum.awardedMicro ?? 0n);
    // Count only outside funding minus payouts. Rollover entries move the
    // same funds between rounds and must not be counted as new money.
    const totalPool = totalFunded > totalAwarded ? totalFunded - totalAwarded : 0n;

    return res.status(200).json({
      success: true,
      data: {
        totalPool: formatMicroUsdt(totalPool),
        currentRoundPool: currentPool?.pool.available ?? formatMicroUsdt(0n),
        currency: "USDT",
        simulatedOnly: true,
        updatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to load public prize pool statistics", error);
    return res.status(503).json({
      success: false,
      error: "PRIZE_POOL_STATS_UNAVAILABLE",
    });
  }
}

export async function getPublicSiteStatsHandler(
  _req: Request,
  res: Response,
) {
  try {
    const now = new Date();
    const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS);
    const [onlineUsers, totalUsers] = await Promise.all([
      prisma.user.count({
        where: {
          role: "USER",
          lastSeenAt: { gte: onlineSince },
        },
      }),
      prisma.user.count(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        onlineUsers,
        totalUsers,
        updatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to load public site statistics", error);
    return res.status(503).json({
      success: false,
      error: "SITE_STATS_UNAVAILABLE",
    });
  }
}

export async function recordOnlineHeartbeatHandler(
  req: AuthenticatedRequest,
  res: Response,
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "AUTHENTICATION_REQUIRED",
    });
  }

  try {
    const result = await prisma.user.updateMany({
      where: {
        id: req.user.userId,
        role: "USER",
      },
      data: {
        lastSeenAt: new Date(),
      },
    });

    if (result.count === 0) {
      return res.status(401).json({
        success: false,
        error: "USER_NOT_FOUND",
      });
    }

    return res.status(200).json({
      success: true,
      data: { recorded: true },
    });
  } catch (error) {
    console.error("Failed to record online presence", error);
    return res.status(503).json({
      success: false,
      error: "ONLINE_PRESENCE_UNAVAILABLE",
    });
  }
}
