import { Router } from "express";

import { requireAuth } from "../../middleware/auth.middleware.js";
import {
  getPublicSiteStatsHandler,
  getPublicPrizePoolStatsHandler,
  recordOnlineHeartbeatHandler,
} from "./stats.controller.js";

const router = Router();

router.get("/site", getPublicSiteStatsHandler);
router.get("/prize-pools", getPublicPrizePoolStatsHandler);
router.post("/heartbeat", requireAuth, recordOnlineHeartbeatHandler);

export default router;
