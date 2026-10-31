import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import { getWallet, requestWalletDeposit, requestWalletWithdrawal } from "./wallet.service.js";
function getUserId(req: AuthenticatedRequest, res: Response): string | null {
  if (!req.user?.userId) { res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" }); return null; }
  return req.user.userId;
}
function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
  const known = new Set([
    "INVALID_WALLET_AMOUNT", "INSUFFICIENT_WALLET_BALANCE", "INVALID_DESTINATION_ADDRESS",
    "WITHDRAWALS_DISABLED", "WALLET_NOT_ACTIVE", "EMAIL_NOT_VERIFIED",
    "TURNKEY_NOT_CONFIGURED", "TURNKEY_ENCRYPTION_KEY_NOT_CONFIGURED",
    "USER_NOT_FOUND", "TURNKEY_SUB_ORGANIZATION_CREATION_REQUIRES_REVIEW",
  ]);
  if (!known.has(message)) console.error("Wallet request failed", error);
  const status =
    message === "INSUFFICIENT_WALLET_BALANCE" || message === "TURNKEY_SUB_ORGANIZATION_CREATION_REQUIRES_REVIEW" ? 409 :
    message === "WITHDRAWALS_DISABLED" || message === "TURNKEY_NOT_CONFIGURED" || message === "TURNKEY_ENCRYPTION_KEY_NOT_CONFIGURED" ? 503 :
    message === "WALLET_NOT_ACTIVE" || message === "EMAIL_NOT_VERIFIED" ? 403 :
    message === "USER_NOT_FOUND" ? 404 :
    known.has(message) ? 400 : 500;
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
  try { return res.status(201).json({ success: true, data: await requestWalletWithdrawal(id, req.body?.amount, req.body?.destinationAddress) }); } catch (error) { return sendError(res, error); }
}

export async function getAdminWithdrawalRequestsHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getAdminWithdrawalRequests } = await import("./wallet.service.js");
    return res.json({ success: true, data: await getAdminWithdrawalRequests() });
  } catch (error) {
    console.error("Admin withdrawal request listing failed", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}

export async function reviewAdminWithdrawalHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  const decision = req.body?.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return res.status(400).json({ success: false, error: "INVALID_WITHDRAWAL_DECISION" });
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
  try {
    const { reviewWalletWithdrawal } = await import("./wallet.service.js");
    const result = await reviewWalletWithdrawal(String(req.params.withdrawalId), decision, adminUserId, reason);
    return res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    if (message === "WITHDRAWAL_NOT_FOUND") return res.status(404).json({ success: false, error: message });
    if (message === "WITHDRAWAL_ALREADY_REVIEWED") return res.status(409).json({ success: false, error: message });
    console.error("Admin withdrawal review failed", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}

export async function getAdminWalletsHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getAdminWallets } = await import("./wallet.service.js");
    return res.json({ success: true, data: await getAdminWallets() });
  } catch (error) {
    console.error("Admin wallet listing failed", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}


export async function getPrizeTreasuryWalletHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getPrizeTreasuryWallet } = await import("./turnkey.service.js");
    return res.json({ success: true, data: await getPrizeTreasuryWallet() });
  } catch (error) {
    console.error("Prize treasury lookup failed", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}

export async function provisionPrizeTreasuryWalletHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { provisionPrizeTreasuryWallet } = await import("./turnkey.service.js");
    const data = await provisionPrizeTreasuryWallet();
    return res.status(data.created ? 201 : 200).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    if (message === "TURNKEY_NOT_CONFIGURED") return res.status(503).json({ success: false, error: message });
    if (message === "TREASURY_CREATION_IN_PROGRESS" || message === "TREASURY_CREATION_REQUIRES_REVIEW") {
      return res.status(409).json({ success: false, error: message });
    }
    console.error("Prize treasury provisioning failed", error);
    return res.status(502).json({ success: false, error: "TREASURY_PROVISIONING_FAILED" });
  }
}


export async function getTreasuryPrizeFundingHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getTreasuryPrizeFundingSnapshot } = await import("./wallet.service.js");
    return res.json({ success: true, data: await getTreasuryPrizeFundingSnapshot() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = ["TREASURY_RPC_NOT_CONFIGURED", "TREASURY_NOT_READY", "TREASURY_ACCOUNTING_MISMATCH"];
    return res.status(known.includes(message) ? 503 : 502).json({ success: false, error: known.includes(message) ? message : "TREASURY_BALANCE_UNAVAILABLE" });
  }
}

export async function allocateTreasuryPrizeFundHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { allocateTreasuryToPrizeFund } = await import("./wallet.service.js");
    return res.json({ success: true, data: await allocateTreasuryToPrizeFund(req.body?.amount, adminUserId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = ["INVALID_ALLOCATION_AMOUNT", "INSUFFICIENT_TREASURY_BALANCE", "INSUFFICIENT_UNALLOCATED_TREASURY_BALANCE", "TREASURY_RPC_NOT_CONFIGURED", "TREASURY_NOT_READY"];
    return res.status(message === "TREASURY_ACCOUNTING_MISMATCH" ? 409 : known.includes(message) ? 400 : 502).json({ success: false, error: known.includes(message) ? message : "TREASURY_ALLOCATION_FAILED" });
  }
}


export async function reconcileTreasuryAccountingHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { reconcileTreasuryAccounting } = await import("./wallet.service.js");
    const data = await reconcileTreasuryAccounting(adminUserId);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = ["TREASURY_RPC_NOT_CONFIGURED", "TREASURY_NOT_READY"];
    console.error("Treasury accounting reconciliation failed", error);
    return res.status(known.includes(message) ? 503 : 502).json({
      success: false,
      error: known.includes(message) ? message : "TREASURY_RECONCILIATION_FAILED",
    });
  }
}

export async function getLatestTreasuryReconciliationHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getLatestTreasuryAccountingReconciliation } = await import("./wallet.service.js");
    return res.json({ success: true, data: await getLatestTreasuryAccountingReconciliation() });
  } catch (error) {
    console.error("Latest treasury reconciliation lookup failed", error);
    return res.status(503).json({ success: false, error: "TREASURY_RECONCILIATION_UNAVAILABLE" });
  }
}
