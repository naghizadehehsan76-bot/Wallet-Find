import { Router } from "express";

import {
  requireAuth,
  requireAdmin,
} from "../../middleware/auth.middleware.js";

import {
  createContestHandler,
  createClueHandler,
  getActiveContestHandler,
  getCurrentClueHandler,
  submitAnswerHandler,
} from "./contest.controller.js";
import { getLeaderboardHandler } from "./leaderboard.controller.js";

const router = Router();

router.post(
  "/",
  requireAuth,
  requireAdmin,
  createContestHandler,
);

router.get(
  "/active",
  requireAuth,
  getActiveContestHandler,
);

router.post(
  "/:contestId/clues",
  requireAuth,
  requireAdmin,
  createClueHandler,
);

router.get(
  "/:contestId/current-clue",
  requireAuth,
  getCurrentClueHandler,
);

router.get(
  "/:contestId/leaderboard",
  requireAuth,
  getLeaderboardHandler,
);

router.post(
  "/:contestId/submit",
  requireAuth,
  submitAnswerHandler,
);

export default router;
