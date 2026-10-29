import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";

import {
  createContestSchema,
  createClueSchema,
  submitAnswerSchema,
} from "./contest.schema.js";

import {
  createContest,
  createClue,
  getActiveContest,
  getCurrentClue,
  submitAnswer,
} from "./contest.service.js";
import { ensureMvpActiveContest, startNextMvpContest } from "./mvp-contest-seed.service.js";
import { getLanguageParticipationBlock } from "./language-participation.js";

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function createContestHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  const parsed = createContestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  try {
    const contest = await createContest(parsed.data);

    return res.status(201).json({
      success: true,
      data: { contest },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function createClueHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  const contestId = req.params.contestId;

  if (!contestId || Array.isArray(contestId)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_CONTEST_ID",
    });
  }

  const parsed = createClueSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  try {
    const clue = await createClue(contestId, parsed.data);

    return res.status(201).json({
      success: true,
      data: { clue },
    });
  } catch (error) {
    console.error(error);

    if (
      isError(error) &&
      error.message === "CONTEST_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        error: "CONTEST_NOT_FOUND",
      });
    }

    if (
      isError(error) &&
      error.message === "CONTEST_CLUES_LOCKED"
    ) {
      return res.status(409).json({
        success: false,
        error: "CONTEST_CLUES_LOCKED",
      });
    }

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function getActiveContestHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "AUTHENTICATION_REQUIRED",
    });
  }

  const userId = req.user.userId;
  const language = req.query.language === "fa" ? "fa" : "en";
  try {
    // Validate the clue-generator version before serving an active round.
    // This replaces old rounds whose source phrases cannot be found reliably.
    await ensureMvpActiveContest(language);
    const contest = await getActiveContest(language);
    const participationBlock = await getLanguageParticipationBlock(userId, contest);

    return res.status(200).json({
      success: true,
      data: { ...contest, participationBlock, serverTime: new Date().toISOString() },
    });
  } catch (error) {
    if (
      isError(error) &&
      (error.message === "ACTIVE_CONTEST_NOT_FOUND" || error.message === "MVP_ROUND_GENERATION_FAILED")
    ) {
      console.error("No verified active contest could be prepared.", error);
      return res.status(503).json({
        success: false,
        error: "CONTEST_INITIALIZATION_FAILED",
      });
    }

    if (
      isError(error) &&
      error.message === "CONTEST_FINISHED"
    ) {
      return res.status(409).json({
        success: false,
        error: "CONTEST_FINISHED",
      });
    }

    if (
      isError(error) &&
      error.message === "CONTEST_NOT_STARTED"
    ) {
      return res.status(409).json({
        success: false,
        error: "CONTEST_NOT_STARTED",
      });
    }

    console.error(error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function startNextContestHandler(
  req: AuthenticatedRequest,
  res: Response
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
    const contest = await startNextMvpContest(req.user.userId, contestId);

    return res.status(200).json({
      success: true,
      data: contest,
    });
  } catch (error) {
    if (isError(error) && error.message === "CONTEST_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: "CONTEST_NOT_FOUND",
      });
    }

    if (isError(error) && error.message === "CONTEST_NOT_COMPLETED_BY_USER") {
      return res.status(409).json({
        success: false,
        error: "CONTEST_NOT_COMPLETED_BY_USER",
      });
    }

    console.error("Failed to start next MVP contest", error);

    if (isError(error) && error.message === "MVP_ROUND_GENERATION_FAILED") {
      return res.status(503).json({
        success: false,
        error: "NEXT_CONTEST_GENERATION_FAILED",
      });
    }

    return res.status(500).json({
      success: false,
      error: "NEXT_CONTEST_FAILED",
    });
  }
}

export async function getCurrentClueHandler(
  req: AuthenticatedRequest,
  res: Response
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
    const result = await getCurrentClue(
      req.user.userId,
      contestId,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (!isError(error)) {
      console.error(error);
      return res.status(500).json({
        success: false,
        error: "INTERNAL_SERVER_ERROR",
      });
    }

    if (error.message === "CONTEST_PARTICIPATION_BLOCKED") {
      return res.status(403).json({ success: false, error: error.message });
    }

    if (error.message === "CONTEST_PARTICIPATION_BLOCKED") {
      return res.status(403).json({ success: false, error: error.message });
    }

    const conflictErrors = new Set([
      "CONTEST_NOT_ACTIVE",
      "CONTEST_NOT_STARTED",
      "CONTEST_FINISHED",
      "NO_CLUES_AVAILABLE",
      "CONTEST_REQUIRES_12_CLUES",
    ]);

    if (error.message === "CONTEST_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    if (conflictErrors.has(error.message)) {
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
}

export async function submitAnswerHandler(
  req: AuthenticatedRequest,
  res: Response
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

  const parsed = submitAnswerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await submitAnswer(
      req.user.userId,
      contestId,
      parsed.data,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(error);

    if (!(error instanceof Error)) {
      return res.status(500).json({
        success: false,
        error: "INTERNAL_SERVER_ERROR",
      });
    }

    const clientErrors = new Set([
      "CONTEST_NOT_FOUND",
      "CONTEST_NOT_ACTIVE",
      "CONTEST_NOT_STARTED",
      "CONTEST_FINISHED",
      "NO_CLUES_AVAILABLE",
      "CONTEST_REQUIRES_12_CLUES",
      "CLUE_NOT_CURRENT",
      "CLUE_NOT_PUBLISHED",
      "CLUE_ALREADY_SOLVED",
      "CLUE_LOCKED",
      "LANGUAGE_CHALLENGE_ALREADY_COMPLETED",
    ]);

    if (clientErrors.has(error.message)) {
      const status =
        error.message === "CONTEST_NOT_FOUND" ? 404 : 409;

      return res.status(status).json({
        success: false,
        error: error.message,
        ...(error.message === "CLUE_LOCKED" && "lockedUntil" in error
          ? { lockedUntil: (error as Error & { lockedUntil?: string }).lockedUntil }
          : {}),
      });
    }

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}
