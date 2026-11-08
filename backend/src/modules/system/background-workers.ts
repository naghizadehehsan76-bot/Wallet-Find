import { ensureMvpActiveContest } from "../contest/mvp-contest-seed.service.js";
import { startContestScheduler } from "../contest/contest-scheduler.service.js";
import { startPrizePayoutProcessor } from "../contest/prize-payout.service.js";
import { startPrizeSettlementProcessor } from "../contest/prize-settlement-runner.service.js";
import { startWalletChainDepositScanner } from "../wallet/wallet-chain-deposit-scanner.service.js";
import { startWalletChainWithdrawalReconciler } from "../wallet/wallet-chain-withdrawal-reconciler.service.js";
import { startTurnkeyWebhookDepositProcessor } from "../wallet/turnkey-webhook-processor.service.js";
import { startPolygonTreasuryDepositScanner } from "../wallet/polygon-treasury-scanner-runner.service.js";

export type BackgroundWorkersHandle = {
  stop: () => void;
};

/**
 * Start all durable background processors. This is shared by the backwards-
 * compatible all-in-one server and the future Render Worker service.
 */
export async function startBackgroundWorkers(): Promise<BackgroundWorkersHandle> {
  const timers: Array<ReturnType<typeof setInterval>> = [];

  const register = (timer: ReturnType<typeof setInterval> | null | undefined) => {
    if (timer) timers.push(timer);
  };

  register(startWalletChainDepositScanner());
  register(startWalletChainWithdrawalReconciler());
  register(startTurnkeyWebhookDepositProcessor());
  register(startPolygonTreasuryDepositScanner());
  register(startPrizeSettlementProcessor());
  register(startPrizePayoutProcessor());

  // Keep the API health endpoint independent of initial source generation.
  // A dedicated Worker can safely await this before its own readiness.
  try {
    await ensureMvpActiveContest();
  } catch (error) {
    console.error("Failed to ensure a playable MVP contest; scheduler will retry", error);
  }

  register(startContestScheduler());

  return {
    stop: () => {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
