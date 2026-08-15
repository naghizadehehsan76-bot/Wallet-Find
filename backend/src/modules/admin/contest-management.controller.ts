import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import {
  activateContest,
  finishContest,
} from "./contest-management.service.js";

function handleContestError(error: unknown, res: Response) {
  if (!(error instanceof Error)) {
    console.error(error);
    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }

  const notFound = error.message === "CONTEST_NOT_FOUND";

  if (notFound) {
    return res.status(404).json({
      success: false,
      error: error.message,
    });
  }

  const conflicts = new Set([
    "CONTEST_ALREADY_ACTIVE",
    "CONTEST_CANNOT_BE_ACTIVATED",
    "CONTEST_REQUIRES_12_CLUES",
    "ANOTHER_CONTEST_ALREADY_ACTIVE",
    "CONTEST_END_ALREADY_PASSED",
    "CONTEST_NOT_ACTIVE",
  ]);

  if (conflicts.has(error.message)) {
    return res.status(409).json({
      success: false,
      error: error.message,
    });
  }

  console.error(error);

  return res.status(500).json({
    success: false,
    error: "INTERNAL_SERVER_ERROR",
  });
}

export async function activateContestHandler(
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

  try {
    const contest = await activateContest(
      contestId,
      req.user?.userId,
    );

    return res.status(200).json({
      success: true,
      data: { contest },
    });
  } catch (error) {
    return handleContestError(error, res);
  }
}

export async function finishContestHandler(
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

  try {
    const contest = await finishContest(
      contestId,
      req.user?.userId,
    );

    return res.status(200).json({
      success: true,
      data: { contest },
    });
  } catch (error) {
    return handleContestError(error, res);
  }
}
