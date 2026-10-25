import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import { getWallet, requestWalletDeposit, requestWalletWithdrawal } from "./wallet.service.js";
function getUserId(req: AuthenticatedRequest, res: Response): string | null {
  if (!req.user?.userId) { res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" }); return null; }
  return req.user.userId;
}
function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
  const known = new Set(["INVALID_WALLET_AMOUNT", "INSUFFICIENT_WALLET_BALANCE"]);
  if (!known.has(message)) console.error("Wallet request failed", error);
  const status = message === "INSUFFICIENT_WALLET_BALANCE" ? 409 : known.has(message) ? 400 : 500;
  return res.status(status).json({ success: false, error: known.has(message) ? message : "INTERNAL_SERVER_ERROR" });
}
export async function getWalletHandler(req: AuthenticatedRequest, res: Response) {
  const id = getUserId(req, res); if (!id) return;
  try { return res.json({ success: true, data: await getWallet(id) }); } catch (error) { return sendError(res, error); }
}
export async function requestDepositHandler(req: AuthenticatedRequest, res: Response) {
  const id = getUserId(req, res); if (!id) return;
  try { return res.status(201).json({ success: true, data: await requestWalletDeposit(id, req.body?.amount) }); } catch (error) { return sendError(res, error); }
}
export async function requestWithdrawalHandler(req: AuthenticatedRequest, res: Response) {
  const id = getUserId(req, res); if (!id) return;
  try { return res.status(201).json({ success: true, data: await requestWalletWithdrawal(id, req.body?.amount) }); } catch (error) { return sendError(res, error); }
}
