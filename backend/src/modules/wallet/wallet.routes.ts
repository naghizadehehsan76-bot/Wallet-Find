import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { getWalletHandler, requestDepositHandler, requestWithdrawalHandler } from "./wallet.controller.js";
const router = Router();
router.use(requireAuth);
router.get("/me", getWalletHandler);
router.post("/deposit", requestDepositHandler);
router.post("/withdraw", requestWithdrawalHandler);
export default router;
