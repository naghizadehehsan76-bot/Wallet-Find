import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import { getPrizePool, settlePrizePool, testFundPrizePool } from "./prize-pool.service.js";

function paramContestId(req: AuthenticatedRequest, res: Response): string | null {
  const value = req.params.contestId;
  if (!value || Array.isArray(value)) {
    res.status(400).json({ success: false, error: "INVALID_CONTEST_ID" });
    return null;
  }
  return value;
}

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "INTERNAL_SERVER_ERROR";
  const clientErrors = new Set([
    "CONTEST_NOT_FOUND",
    "INVALID_TEST_FUNDING_AMOUNT",
    "PRIZE_POOL_ALREADY_SETTLED",
    "CONTEST_NOT_FINISHED",
  ]);
  const status = message === "CONTEST_NOT_FOUND" ? 404 : clientErrors.has(message) ? 409 : 500;
  if (status === 500) console.error("Prize pool operation failed", error);
  return res.status(status).json({ success: false, error: status === 500 ? "INTERNAL_SERVER_ERROR" : message });
}

export async function getPrizePoolHandler(req: AuthenticatedRequest, res: Response) {
  const contestId = paramContestId(req, res);
  if (!contestId) return;
  try {
    return res.json({ success: true, data: await getPrizePool(contestId) });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function testFundPrizePoolHandler(req: AuthenticatedRequest, res: Response) {
  const contestId = paramContestId(req, res);
  if (!contestId) return;
  try {
    const pool = await testFundPrizePool(contestId, req.body?.amount, req.user?.userId);
    return res.status(201).json({ success: true, data: { pool } });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function settlePrizePoolHandler(req: AuthenticatedRequest, res: Response) {
  const contestId = paramContestId(req, res);
  if (!contestId) return;
  try {
    const result = await settlePrizePool(contestId, req.user?.userId);
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
}
