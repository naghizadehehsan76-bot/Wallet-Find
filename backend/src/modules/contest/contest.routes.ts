import { Router } from "express";

import {
  requireAuth,
  requireAdmin,
} from "../../middleware/auth.middleware.js";

import {
  createContestHandler,
} from "./contest.controller.js";

const router = Router();

router.post(
  "/",
  requireAuth,
  requireAdmin,
  createContestHandler
);

export default router;