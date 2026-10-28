import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { getProfileHandler, updateProfileAvatarHandler } from "./profile.controller.js";

const router = Router();
router.get("/me", requireAuth, getProfileHandler);
router.post("/avatar", requireAuth, updateProfileAvatarHandler);

export default router;
