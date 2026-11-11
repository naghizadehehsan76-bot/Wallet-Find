import prisma from "../../config/prisma.js";
import { executeChainWalletWithdrawal, reconcileChainWalletWithdrawal, recoverKnownPreBroadcastTurnkeyFailure } from "./wallet-chain-withdrawal.service.js";
import { runWithSystemJobLease } from "../system/system-job-lease.service.js";

const INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically reconciles broadcast chain withdrawals against canonical RPC
 * receipts. The reconciliation service owns per-withdrawal DB locking and
 * idempotent journal settlement; this worker only discovers pending rows.
 */
export function startWalletChainWithdrawalReconciler(): ReturnType<typeof setInterval> | null {
  if (process.env.WALLET_CHAIN_WITHDRAWAL_RECONCILER_ENABLED === "false") return null;
  if (timer) return timer;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runWithSystemJobLease("wallet-chain-withdrawal-reconciler", async () => {
      // Recover only the two specifically audited requests whose Turnkey
      // rejection is independently known to have happened before a status ID
      // or transaction hash was created. Never retry an ambiguous broadcast.
      const verifiedPreBroadcastFailures = await prisma.walletChainWithdrawal.findMany({
        where: {
          id: { in: [
            "ab79dd7e-fa69-4c16-8a5d-b7eb3ebee5a1",
            "c778a886-6b2a-4fd1-8f43-eec992c9170d",
          ] },
          status: "SIGNING",
          failureCode: "SIGNING_OR_BROADCAST_OUTCOME_UNCERTAIN",
          transactionReference: null,
          broadcastAt: null,
          signerActivityId: null,
        },
        select: { id: true, userId: true },
        take: 2,
      });

      for (const row of verifiedPreBroadcastFailures) {
        try {
          await recoverKnownPreBroadcastTurnkeyFailure(
            row.id,
            row.userId,
            "Automatic recovery of a specifically audited Turnkey rejection before any transaction status ID or broadcast existed.",
          );
          // Continue in the same worker pass: recovered requests are now
          // APPROVED and are sent through the normal idempotent execution path.
          await executeChainWalletWithdrawal(row.id, row.userId);
        } catch (error) {
          console.error("Automatic verified pre-broadcast withdrawal recovery failed", {
            withdrawalId: row.id,
            error,
          });
        }
      }

      const awaitingBroadcast = await prisma.walletChainWithdrawal.findMany({
        where: { status: "APPROVED", transactionReference: null },
        select: { id: true, userId: true },
        orderBy: { requestedAt: "asc" },
        take: BATCH_SIZE,
      });

      for (const row of awaitingBroadcast) {
        try {
          await executeChainWalletWithdrawal(row.id, row.userId);
        } catch (error) {
          console.error("Automatic chain withdrawal execution attempt failed", {
            withdrawalId: row.id,
            error,
          });
        }
      }

      const pending = await prisma.walletChainWithdrawal.findMany({
        where: {
          status: "BROADCAST",
          transactionReference: { not: null },
        },
        select: { id: true },
        orderBy: { broadcastAt: "asc" },
        take: BATCH_SIZE,
      });

      for (const row of pending) {
        try {
          await reconcileChainWalletWithdrawal(row.id, null);
        } catch (error) {
          // A transient RPC or database error must not mutate the withdrawal
          // into a failed state. It will be retried on the next pass.
          console.error("Chain withdrawal reconciliation attempt failed", {
            withdrawalId: row.id,
            error,
          });
        }
      }
      }, { leaseMs: 180_000 });
    } catch (error) {
      console.error("Chain withdrawal reconciliation scan failed", error);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => { void run(); }, INTERVAL_MS);
  timer.unref?.();
  // First pass shortly after startup; avoid delaying reconciliation for one
  // full interval after a cold start.
  setTimeout(() => { void run(); }, 5_000).unref?.();
  return timer;
}
