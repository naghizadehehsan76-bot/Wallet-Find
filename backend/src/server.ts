import "dotenv/config";
import app from "./app.js";
import { startContestScheduler } from "./modules/contest/contest-scheduler.service.js";
import { ensureMvpActiveContest } from "./modules/contest/mvp-contest-seed.service.js";
import { startPolygonDepositScanner } from "./modules/wallet/polygon-deposit-scanner.service.js";
import { startWalletChainDepositScanner } from "./modules/wallet/wallet-chain-deposit-scanner.service.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startPolygonDepositScanner();
  startWalletChainDepositScanner();

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
