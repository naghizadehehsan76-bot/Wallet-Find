import { Router } from "express";
import { requireAuth, requireAdmin, } from "../../middleware/auth.middleware.js";
import { createContestHandler, createClueHandler, submitAnswerHandler, } from "./contest.controller.js";
const router = Router();
router.post("/", requireAuth, requireAdmin, createContestHandler);
router.post("/:contestId/clues", requireAuth, requireAdmin, createClueHandler);
router.post("/:contestId/submit", requireAuth, submitAnswerHandler);
export default router;
//# sourceMappingURL=contest.routes.js.map