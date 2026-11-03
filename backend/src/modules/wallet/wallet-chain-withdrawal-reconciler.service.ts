import prisma from "../../config/prisma.js";
import { executeChainWalletWithdrawal, reconcileChainWalletWithdrawal } from "./wallet-chain-withdrawal.service.js";

const INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically reconciles broadcast chain withdrawals against canonical RPC
 * receipts. The reconciliation service owns per-withdrawal DB locking and
 * idempotent journal settlement; this worker only discovers pending rows.
 */
export function startWalletChainWithdrawalReconciler(): void {
  if (process.env.WALLET_CHAIN_WITHDRAWAL_RECONCILER_ENABLED === "false" || timer) return;

  const run = async () => {
    if (running) return;
    running = true;
    try {
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
}
