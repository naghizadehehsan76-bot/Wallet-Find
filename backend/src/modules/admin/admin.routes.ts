import { Router } from "express";

import {
  requireAuth,
  requireAdmin,
} from "../../middleware/auth.middleware.js";

import {
  getSystemSettingsHandler,
  upsertSystemSettingHandler,
  getContestSettingsHandler,
  updateContestSettingsHandler,
  getAuditLogsHandler,
} from "./admin.controller.js";
import {
  activateContestHandler,
  finishContestHandler,
} from "./contest-management.controller.js";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/settings", getSystemSettingsHandler);
router.post("/settings", upsertSystemSettingHandler);

router.get(
  "/contest-settings/:contestId",
  getContestSettingsHandler,
);

router.put(
  "/contest-settings/:contestId",
  updateContestSettingsHandler,
);

router.post(
  "/contests/:contestId/activate",
  activateContestHandler,
);

router.post(
  "/contests/:contestId/finish",
  finishContestHandler,
);

router.get("/audit-logs", getAuditLogsHandler);

export default router;
