import "dotenv/config";
import app from "./app.js";
import { startContestScheduler } from "./modules/contest/contest-scheduler.service.js";
import { ensureMvpActiveContest } from "./modules/contest/mvp-contest-seed.service.js";
import { startWalletChainDepositScanner } from "./modules/wallet/wallet-chain-deposit-scanner.service.js";
import { startWalletChainWithdrawalReconciler } from "./modules/wallet/wallet-chain-withdrawal-reconciler.service.js";
import { startTurnkeyWebhookDepositProcessor } from "./modules/wallet/turnkey-webhook-processor.service.js";
import { startPolygonTreasuryDepositScanner } from "./modules/wallet/polygon-treasury-scanner-runner.service.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startWalletChainDepositScanner();
  startWalletChainWithdrawalReconciler();
  startTurnkeyWebhookDepositProcessor();
  startPolygonTreasuryDepositScanner();

  // Keep /health responsive while contest data is prepared. Start the
  // scheduler only after the initial seed attempt settles so it cannot race
  // the startup seed and trigger a second source-generation run.
  void ensureMvpActiveContest()
    .catch((error) => {
      console.error("Failed to ensure a playable MVP contest", error);
    })
    .finally(() => {
      startContestScheduler();
    });
});
