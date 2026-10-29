import { Router } from "express";

import {
  requireAuth,
  requireAdmin,
} from "../../middleware/auth.middleware.js";

import {
  createContestHandler,
  createClueHandler,
  getActiveContestHandler,
  startNextContestHandler,
  getCurrentClueHandler,
  submitAnswerHandler,
} from "./contest.controller.js";
import { getLeaderboardHandler } from "./leaderboard.controller.js";
import { getLeaderboardHistoryHandler } from "./leaderboard-history.controller.js";
import { getPublicPrizePoolHandler } from "./prize-pool.controller.js";

const router = Router();

router.post(
  "/",
  requireAuth,
  requireAdmin,
  createContestHandler,
);

router.get(
  "/leaderboard-history",
  requireAuth,
  getLeaderboardHistoryHandler,
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

router.post(
  "/:contestId/next",
  requireAuth,
  startNextContestHandler,
);

// Sponsor click tracking is temporarily disabled; the source-visit endpoint is not registered.

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

router.get(
  "/:contestId/prize-pool",
  requireAuth,
  getPublicPrizePoolHandler,
);

router.post(
  "/:contestId/submit",
  requireAuth,
  submitAnswerHandler,
);

export default router;
