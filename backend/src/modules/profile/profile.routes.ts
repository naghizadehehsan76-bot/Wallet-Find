import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { deleteOwnAccountHandler, getProfileHandler, updateProfileAvatarHandler } from "./profile.controller.js";

const router = Router();
router.get("/me", requireAuth, getProfileHandler);
router.post("/avatar", requireAuth, updateProfileAvatarHandler);
router.delete("/me", requireAuth, deleteOwnAccountHandler);

export default router;
