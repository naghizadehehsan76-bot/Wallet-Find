import { Router } from "express";
import {
  register,
  login,
  me,
  verifyEmailCode,
  resendVerificationCode,
  forgotPassword,
  resetPassword,
} from "./auth.controller.js";
import { requireAuth } from "../../middleware/auth.middleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-email", verifyEmailCode);
router.post("/resend-verification", resendVerificationCode);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", requireAuth, me);

export default router;
