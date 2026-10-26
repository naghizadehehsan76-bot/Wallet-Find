import { Router } from "express";

import { requireAuth } from "../../middleware/auth.middleware.js";
import {
  getPublicSiteStatsHandler,
  recordOnlineHeartbeatHandler,
} from "./stats.controller.js";

const router = Router();

router.get("/site", getPublicSiteStatsHandler);
router.post("/heartbeat", requireAuth, recordOnlineHeartbeatHandler);

export default router;
