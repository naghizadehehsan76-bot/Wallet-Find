import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { getProfileHandler } from "./profile.controller.js";

const router = Router();
router.get("/me", requireAuth, getProfileHandler);

export default router;
