import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";

import { createContestSchema } from "./contest.schema.js";
import { createContest } from "./contest.service.js";

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