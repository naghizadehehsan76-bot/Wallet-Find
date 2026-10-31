import { Router } from "express";

import {
  requireAuth,
  requireAdmin,
} from "../../middleware/auth.middleware.js";

import {
  getAdminOverviewHandler,
  getSystemSettingsHandler,
  upsertSystemSettingHandler,
  getContestSettingsHandler,
  updateContestSettingsHandler,
  getAuditLogsHandler,
  getAdminUsersHandler,
  getProjectProfitPoolAdminHandler,
  getContestSourceVisitReportHandler,
} from "./admin.controller.js";
import {
  activateContestHandler,
  finishContestHandler,
} from "./contest-management.controller.js";
import { getAdminWalletsHandler } from "../wallet/wallet.controller.js";
import {
  getPrizePoolHandler,
} from "../contest/prize-pool.controller.js";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/overview", getAdminOverviewHandler);
router.get("/users", getAdminUsersHandler);
router.get("/settings", getSystemSettingsHandler);
router.post("/settings", upsertSystemSettingHandler);

router.get("/contest-settings/:contestId", getContestSettingsHandler);
router.put("/contest-settings/:contestId", updateContestSettingsHandler);

router.post("/contests/:contestId/activate", activateContestHandler);
router.post("/contests/:contestId/finish", finishContestHandler);

router.get("/audit-logs", getAuditLogsHandler);
router.get("/source-visit-report", getContestSourceVisitReportHandler);
router.get("/wallets", getAdminWalletsHandler);
router.get("/project-profit-pool", getProjectProfitPoolAdminHandler);
router.get("/prize-pool/:contestId", getPrizePoolHandler);

export default router;
