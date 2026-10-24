import { Router } from "express";
import {
  register,
  login,
  me,
  requestLoginCode,
  verifyLoginCode,
} from "./auth.controller.js";
import { requireAuth } from "../../middleware/auth.middleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/login/request-code", requestLoginCode);
router.post("/login/verify-code", verifyLoginCode);
router.get("/me", requireAuth, me);

export default router;