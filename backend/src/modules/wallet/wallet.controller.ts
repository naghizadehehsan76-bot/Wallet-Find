import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import { getWallet, requestWalletDeposit } from "./wallet.service.js";
function getUserId(req: AuthenticatedRequest, res: Response): string | null {
  if (!req.user?.userId) { res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" }); return null; }
  return req.user.userId;
}
function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
  const known = new Set([
    "INVALID_WALLET_AMOUNT", "INSUFFICIENT_WALLET_BALANCE", "INVALID_DESTINATION_ADDRESS", "INVALID_WALLET_ASSET_SELECTION", "WALLET_ASSET_NOT_AVAILABLE", "DEPOSITS_DISABLED", "DEPOSITS_NOT_PRODUCTION_READY", "WALLET_ADDRESS_NOT_READY",
    "WITHDRAWALS_DISABLED", "WALLET_NOT_ACTIVE", "EMAIL_NOT_VERIFIED",
    "TURNKEY_NOT_CONFIGURED", "TURNKEY_ENCRYPTION_KEY_NOT_CONFIGURED",
    "USER_NOT_FOUND", "TURNKEY_SUB_ORGANIZATION_CREATION_REQUIRES_REVIEW", "TURNKEY_PROVISIONING_IN_PROGRESS", "TURNKEY_PROVISIONING_REQUIRES_REVIEW",
    "GENERIC_WITHDRAWALS_NOT_PRODUCTION_READY", "WALLET_GLOBAL_EMERGENCY_PAUSE_ACTIVE", "WALLET_WITHDRAWAL_IDEMPOTENCY_KEY_REQUIRED",
    "WALLET_WITHDRAWAL_IDEMPOTENCY_CONFLICT", "INSUFFICIENT_NATIVE_FEE_BALANCE",
    "INSUFFICIENT_WALLET_BALANCE_FOR_AMOUNT_AND_NETWORK_FEE", "WALLET_NETWORK_WITHDRAWAL_ADAPTER_NOT_READY",
    "WALLET_NATIVE_FEE_ASSET_NOT_CONFIGURED", "INVALID_WITHDRAWAL_FEE_QUOTE", "EVM_WITHDRAWAL_FEE_MODEL_NOT_SUPPORTED",
    "EVM_WITHDRAWAL_FEE_QUOTE_UNAVAILABLE", "WALLET_WITHDRAWAL_FEE_QUOTE_MISSING", "WALLET_ASSET_NOT_AVAILABLE",
    "ONCHAIN_NATIVE_BALANCE_INSUFFICIENT", "ONCHAIN_TOKEN_BALANCE_INSUFFICIENT",
    "ONCHAIN_NATIVE_FEE_BALANCE_INSUFFICIENT", "TURNKEY_SIGNER_ADDRESS_MISMATCH",
    "WALLET_WITHDRAWAL_REQUIRES_MANUAL_RECONCILIATION", "WALLET_WITHDRAWAL_FEE_QUOTE_EXPIRED",
    "INSUFFICIENT_NATIVE_FEE_BALANCE_FOR_UPDATED_QUOTE",
  ]);
  if (!known.has(message)) console.error("Wallet request failed", error);
  const status =
    message.includes("INSUFFICIENT_") || message.includes("IDEMPOTENCY_CONFLICT") || message === "TURNKEY_SUB_ORGANIZATION_CREATION_REQUIRES_REVIEW" ? 409 :
    message.includes("NOT_PRODUCTION_READY") || message === "DEPOSITS_DISABLED" || message === "WITHDRAWALS_DISABLED" || message === "TURNKEY_NOT_CONFIGURED" || message === "TURNKEY_ENCRYPTION_KEY_NOT_CONFIGURED" ? 503 :
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
  try { return res.status(200).json({ success: true, data: await requestWalletDeposit(id, req.body?.networkId, req.body?.assetId) }); } catch (error) { return sendError(res, error); }
}
export async function requestWithdrawalHandler(req: AuthenticatedRequest, res: Response) {
  const id = getUserId(req, res); if (!id) return;
  try {
    const { requestChainWalletWithdrawal } = await import("./wallet-chain-withdrawal.service.js");
    const data = await requestChainWalletWithdrawal({
      userId: id,
      networkId: req.body?.networkId,
      assetId: req.body?.assetId,
      amount: req.body?.amount,
      destinationAddress: req.body?.destinationAddress,
      idempotencyKey: req.body?.idempotencyKey,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) { return sendError(res, error); }
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
    const known = ["TREASURY_RPC_NOT_CONFIGURED", "TREASURY_NOT_READY"];
    return res.status(known.includes(message) ? 503 : 502).json({ success: false, error: known.includes(message) ? message : "TREASURY_BALANCE_UNAVAILABLE" });
  }
}

export async function getAdminTreasuryDepositsHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getAdminTreasuryDeposits } = await import("./wallet.service.js");
    return res.json({ success: true, data: await getAdminTreasuryDeposits() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = ["TREASURY_NOT_READY"];
    return res.status(known.includes(message) ? 503 : 500).json({
      success: false,
      error: known.includes(message) ? message : "TREASURY_DEPOSITS_UNAVAILABLE",
    });
  }
}

export async function getAdminTreasuryLedgerHistoryHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getAdminTreasuryLedgerHistory } = await import("./wallet.service.js");
    return res.json({ success: true, data: await getAdminTreasuryLedgerHistory() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = ["TREASURY_NOT_READY"];
    return res.status(known.includes(message) ? 503 : 500).json({
      success: false,
      error: known.includes(message) ? message : "TREASURY_LEDGER_HISTORY_UNAVAILABLE",
    });
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
    const known = ["INVALID_ALLOCATION_AMOUNT", "INSUFFICIENT_TREASURY_BALANCE", "INSUFFICIENT_UNALLOCATED_TREASURY_BALANCE", "TREASURY_RPC_NOT_CONFIGURED", "TREASURY_NOT_READY", "TREASURY_ACCOUNTING_MISMATCH"];
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

export async function executeAdminWalletWithdrawalHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { executeApprovedWalletWithdrawal } = await import("./wallet.service.js");
    return res.json({ success: true, data: await executeApprovedWalletWithdrawal(String(req.params.withdrawalId), adminUserId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = ["REAL_WITHDRAWAL_EXECUTION_DISABLED", "WITHDRAWAL_NOT_FOUND", "WITHDRAWAL_NOT_APPROVED", "WITHDRAWAL_ALREADY_PROCESSING", "WITHDRAWALS_DISABLED", "WALLET_NOT_ACTIVE", "INSUFFICIENT_ONCHAIN_USDT0", "INSUFFICIENT_POLYGON_POL_FOR_GAS", "POLYGON_RPC_NOT_CONFIGURED", "TURNKEY_NOT_CONFIGURED", "TURNKEY_ENCRYPTION_KEY_NOT_CONFIGURED", "TURNKEY_USER_ORGANIZATION_NOT_FOUND"];
    if (!known.includes(message)) console.error("Admin withdrawal execution failed; request may require manual review", error);
    const status = message === "REAL_WITHDRAWAL_EXECUTION_DISABLED" || message === "WITHDRAWALS_DISABLED" ? 503 :
      message === "WITHDRAWAL_NOT_FOUND" ? 404 :
      message === "WITHDRAWAL_NOT_APPROVED" || message === "WITHDRAWAL_ALREADY_PROCESSING" ? 409 :
      known.includes(message) ? 400 : 502;
    return res.status(status).json({ success: false, error: known.includes(message) ? message : "WITHDRAWAL_EXECUTION_REQUIRES_REVIEW" });
  }
}

export async function reconcileAdminWalletWithdrawalHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { reconcileBroadcastWalletWithdrawal } = await import("./wallet.service.js");
    return res.json({ success: true, data: await reconcileBroadcastWalletWithdrawal(String(req.params.withdrawalId), adminUserId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "WITHDRAWAL_NOT_FOUND") return res.status(404).json({ success: false, error: message });
    if (message === "WITHDRAWAL_NOT_BROADCAST") return res.status(409).json({ success: false, error: message });
    console.error("Admin withdrawal confirmation check failed", error);
    return res.status(502).json({ success: false, error: message === "WITHDRAWAL_RECEIPT_NOT_CANONICAL" ? message : "WITHDRAWAL_CONFIRMATION_CHECK_FAILED" });
  }
}




export async function getAdminWalletNetworkRegistryHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getWalletNetworkRegistryForAdmin } = await import("./wallet-admin.service.js");
    return res.json({ success: true, data: await getWalletNetworkRegistryForAdmin() });
  } catch (error) {
    console.error("Wallet network registry lookup failed", error);
    return res.status(500).json({ success: false, error: "WALLET_NETWORK_REGISTRY_UNAVAILABLE" });
  }
}

export async function updateAdminWalletNetworkHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { updateWalletNetworkByAdmin } = await import("./wallet-admin.service.js");
    const data = await updateWalletNetworkByAdmin(
      adminUserId,
      String(req.params.networkId),
      req.body ?? {},
      req.body?.reason,
    );
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    const conflict = [
      "WALLET_NETWORK_MUST_BE_ENABLED",
      "GENERIC_DEPOSITS_NOT_PRODUCTION_READY",
      "GENERIC_WITHDRAWALS_NOT_PRODUCTION_READY",
      "WALLET_NETWORK_SCANNER_NOT_READY",
    ];
    const badRequest = [
      "INVALID_WALLET_NETWORK_ID",
      "INVALID_NETWORK_ENABLED_FLAG",
      "INVALID_NETWORK_DEPOSIT_FLAG",
      "INVALID_NETWORK_WITHDRAWAL_FLAG",
      "INVALID_NETWORK_FINALITY_DEPTH",
      "EMPTY_WALLET_NETWORK_UPDATE",
      "WALLET_ADMIN_CHANGE_REASON_REQUIRED",
    ];
    if (!conflict.includes(message) && !badRequest.includes(message) && message !== "WALLET_NETWORK_NOT_FOUND") {
      console.error("Admin wallet network update failed", error);
    }
    return res.status(
      message === "WALLET_NETWORK_NOT_FOUND" ? 404 :
      conflict.includes(message) ? 409 :
      badRequest.includes(message) ? 400 : 500,
    ).json({ success: false, error: message });
  }
}

export async function updateAdminWalletAssetHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { updateWalletAssetByAdmin } = await import("./wallet-admin.service.js");
    const data = await updateWalletAssetByAdmin(
      adminUserId,
      String(req.params.assetId),
      req.body ?? {},
      req.body?.reason,
    );
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    const conflict = [
      "GENERIC_DEPOSITS_NOT_PRODUCTION_READY",
      "GENERIC_WITHDRAWALS_NOT_PRODUCTION_READY",
      "WALLET_ASSET_NOT_VERIFIED",
      "WALLET_NETWORK_DEPOSITS_DISABLED",
      "WALLET_NETWORK_WITHDRAWALS_DISABLED",
      "WALLET_NETWORK_SCANNER_NOT_READY",
    ];
    const badRequest = [
      "INVALID_WALLET_ASSET_ID",
      "INVALID_ASSET_DEPOSIT_FLAG",
      "INVALID_ASSET_WITHDRAWAL_FLAG",
      "INVALID_ASSET_CONFIRMATION_COUNT",
      "INVALID_ASSET_MINIMUM_DEPOSIT",
      "ASSET_AMOUNT_PRECISION_EXCEEDED",
      "ASSET_MINIMUM_DEPOSIT_EXCEEDS_STORAGE_RANGE",
      "INVALID_ASSET_AMOUNT",
      "EMPTY_WALLET_ASSET_UPDATE",
      "WALLET_ADMIN_CHANGE_REASON_REQUIRED",
      "INVALID_ASSET_DECIMALS",
    ];
    if (!conflict.includes(message) && !badRequest.includes(message) && message !== "WALLET_ASSET_NOT_FOUND") {
      console.error("Admin wallet asset update failed", error);
    }
    return res.status(
      message === "WALLET_ASSET_NOT_FOUND" ? 404 :
      conflict.includes(message) ? 409 :
      badRequest.includes(message) ? 400 : 500,
    ).json({ success: false, error: message });
  }
}



export async function getAdminChainWithdrawalRequestsHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const { getAdminChainWalletWithdrawals } = await import("./wallet-chain-withdrawal.service.js");
    return res.json({ success: true, data: await getAdminChainWalletWithdrawals() });
  } catch (error) {
    console.error("Generic wallet withdrawal listing failed", error);
    return res.status(500).json({ success: false, error: "WALLET_WITHDRAWALS_UNAVAILABLE" });
  }
}

export async function reviewAdminChainWithdrawalHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  const decision = req.body?.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return res.status(400).json({ success: false, error: "INVALID_WITHDRAWAL_DECISION" });
  }
  try {
    const { reviewChainWalletWithdrawal } = await import("./wallet-chain-withdrawal.service.js");
    const data = await reviewChainWalletWithdrawal(
      String(req.params.withdrawalId),
      decision,
      adminUserId,
      req.body?.reason,
    );
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    const status =
      message === "WALLET_WITHDRAWAL_NOT_FOUND" ? 404 :
      message === "WALLET_WITHDRAWAL_ALREADY_REVIEWED" ? 409 :
      message === "WALLET_WITHDRAWAL_REVIEW_REASON_REQUIRED" ? 400 : 500;
    if (status === 500) console.error("Generic wallet withdrawal review failed", error);
    return res.status(status).json({ success: false, error: message });
  }
}

export async function executeAdminChainWithdrawalHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { executeChainWalletWithdrawal } = await import("./wallet-chain-withdrawal.service.js");
    return res.json({
      success: true,
      data: await executeChainWalletWithdrawal(String(req.params.withdrawalId), adminUserId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    const known = [
      "GENERIC_WITHDRAWALS_NOT_PRODUCTION_READY",
      "WALLET_GLOBAL_EMERGENCY_PAUSE_ACTIVE",
      "WALLET_WITHDRAWAL_NOT_FOUND",
      "WALLET_WITHDRAWAL_NOT_APPROVED",
      "WALLET_WITHDRAWAL_ALREADY_PROCESSING",
      "WALLET_NETWORK_WITHDRAWAL_ADAPTER_NOT_READY",
      "EVM_WITHDRAWAL_FEE_MODEL_NOT_SUPPORTED",
      "WITHDRAWALS_DISABLED",
      "WALLET_WITHDRAWAL_FEE_QUOTE_MISSING",
      "WALLET_WITHDRAWAL_FEE_QUOTE_EXPIRED",
      "WALLET_NATIVE_FEE_ASSET_NOT_CONFIGURED",
      "INSUFFICIENT_NATIVE_FEE_BALANCE_FOR_UPDATED_QUOTE",
      "ONCHAIN_NATIVE_BALANCE_INSUFFICIENT",
      "ONCHAIN_TOKEN_BALANCE_INSUFFICIENT",
      "ONCHAIN_NATIVE_FEE_BALANCE_INSUFFICIENT",
      "TURNKEY_SIGNER_ADDRESS_MISMATCH",
      "INVALID_TOKEN_ASSET_CONFIGURATION",
    ];
    if (!known.includes(message)) {
      console.error("Generic wallet withdrawal execution requires review", error);
    }
    const status = message.includes("NOT_PRODUCTION_READY") ? 503 :
      message.includes("NOT_FOUND") ? 404 :
      message.includes("NOT_APPROVED") || message.includes("ALREADY_PROCESSING") ? 409 :
      known.includes(message) ? 400 : 502;
    return res.status(status).json({
      success: false,
      error: known.includes(message) ? message : "WALLET_WITHDRAWAL_REQUIRES_MANUAL_RECONCILIATION",
    });
  }
}

export async function reconcileAdminChainWithdrawalHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { reconcileChainWalletWithdrawal } = await import("./wallet-chain-withdrawal.service.js");
    return res.json({
      success: true,
      data: await reconcileChainWalletWithdrawal(String(req.params.withdrawalId), adminUserId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    const known = ["WALLET_WITHDRAWAL_NOT_FOUND", "WALLET_WITHDRAWAL_NOT_BROADCAST", "WALLET_WITHDRAWAL_FEE_ASSET_MISSING"];
    if (!known.includes(message)) console.error("Generic withdrawal reconciliation failed", error);
    const status = message === "WALLET_WITHDRAWAL_NOT_FOUND" ? 404 :
      message === "WALLET_WITHDRAWAL_NOT_BROADCAST" ? 409 : known.includes(message) ? 400 : 502;
    return res.status(status).json({ success: false, error: known.includes(message) ? message : "WALLET_WITHDRAWAL_RECONCILIATION_FAILED" });
  }
}


export async function emergencyPauseWalletOperationsHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { emergencyPauseAllWalletOperations } = await import("./wallet-admin.service.js");
    const data = await emergencyPauseAllWalletOperations(adminUserId, req.body?.reason);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    if (message === "WALLET_ADMIN_CHANGE_REASON_REQUIRED") {
      return res.status(400).json({ success: false, error: message });
    }
    console.error("Global wallet emergency pause failed", error);
    return res.status(500).json({ success: false, error: "WALLET_EMERGENCY_PAUSE_FAILED" });
  }
}

export async function resumeWalletOperationsHandler(req: AuthenticatedRequest, res: Response) {
  const adminUserId = req.user?.userId;
  if (!adminUserId) return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  try {
    const { resumeWalletOperationsByAdmin } = await import("./wallet-admin.service.js");
    const data = await resumeWalletOperationsByAdmin(adminUserId, req.body?.reason);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
    if (message === "WALLET_ADMIN_CHANGE_REASON_REQUIRED") {
      return res.status(400).json({ success: false, error: message });
    }
    if (message === "WALLET_GLOBAL_EMERGENCY_PAUSE_NOT_ACTIVE") {
      return res.status(409).json({ success: false, error: message });
    }
    console.error("Global wallet emergency pause release failed", error);
    return res.status(500).json({ success: false, error: "WALLET_EMERGENCY_PAUSE_RELEASE_FAILED" });
  }
}
