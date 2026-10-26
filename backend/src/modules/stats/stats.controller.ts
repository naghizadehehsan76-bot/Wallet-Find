import type { Request, Response } from "express";
import prisma from "../../config/prisma.js";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

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
      prisma.user.count({
        where: { role: "USER" },
      }),
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
