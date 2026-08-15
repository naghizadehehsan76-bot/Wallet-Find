import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import { getContestLeaderboard } from "./leaderboard.service.js";

export async function getLeaderboardHandler(
  req: AuthenticatedRequest,
  res: Response,
) {
  const contestId = req.params.contestId;

  if (!contestId || Array.isArray(contestId)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_CONTEST_ID",
    });
  }

  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "AUTHENTICATION_REQUIRED",
    });
  }

  try {
    const result = await getContestLeaderboard(contestId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "CONTEST_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        error: "CONTEST_NOT_FOUND",
      });
    }

    console.error(error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}
