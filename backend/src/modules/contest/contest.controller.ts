import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";

import {
  createContestSchema,
  createClueSchema,
} from "./contest.schema.js";

import {
  createContest,
  createClue,
} from "./contest.service.js";

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
      data: {
        contest,
      },
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
    const clue = await createClue(
      contestId,
      parsed.data
    );

    return res.status(201).json({
      success: true,
      data: {
        clue,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}