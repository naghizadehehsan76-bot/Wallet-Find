import { Router } from "express";

import {
  requireAuth,
  requireAdmin,
} from "../../middleware/auth.middleware.js";

import {
  getAdminOverviewHandler,
  getSystemSettingsHandler,
  upsertSystemSettingHandler,
  getContestSettingsHandler,
  updateContestSettingsHandler,
  getAuditLogsHandler,
  getAdminUsersHandler,
  getProjectProfitPoolAdminHandler,
  getContestSourceVisitReportHandler,
} from "./admin.controller.js";
import {
  activateContestHandler,
  finishContestHandler,
} from "./contest-management.controller.js";
import { getAdminWalletsHandler, getAdminWithdrawalRequestsHandler, reviewAdminWithdrawalHandler, provisionPrizeTreasuryWalletHandler, getPrizeTreasuryWalletHandler, getTreasuryPrizeFundingHandler, getAdminTreasuryDepositsHandler, getAdminTreasuryLedgerHistoryHandler, allocateTreasuryPrizeFundHandler, reconcileTreasuryAccountingHandler, getLatestTreasuryReconciliationHandler, executeAdminWalletWithdrawalHandler, reconcileAdminWalletWithdrawalHandler, getAdminWalletNetworkRegistryHandler, updateAdminWalletNetworkHandler, updateAdminWalletAssetHandler, getAdminChainWithdrawalRequestsHandler, reviewAdminChainWithdrawalHandler, executeAdminChainWithdrawalHandler, reconcileAdminChainWithdrawalHandler } from "../wallet/wallet.controller.js";
import {
  getPrizePoolHandler,
} from "../contest/prize-pool.controller.js";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/overview", getAdminOverviewHandler);
router.get("/users", getAdminUsersHandler);
router.get("/settings", getSystemSettingsHandler);
router.post("/settings", upsertSystemSettingHandler);

router.get("/contest-settings/:contestId", getContestSettingsHandler);
router.put("/contest-settings/:contestId", updateContestSettingsHandler);

router.post("/contests/:contestId/activate", activateContestHandler);
router.post("/contests/:contestId/finish", finishContestHandler);

router.get("/audit-logs", getAuditLogsHandler);
router.get("/source-visit-report", getContestSourceVisitReportHandler);
router.get("/wallets", getAdminWalletsHandler);
router.get("/wallet-networks", getAdminWalletNetworkRegistryHandler);
router.patch("/wallet-networks/:networkId", updateAdminWalletNetworkHandler);
router.patch("/wallet-assets/:assetId", updateAdminWalletAssetHandler);
router.get("/wallet-chain-withdrawals", getAdminChainWithdrawalRequestsHandler);
router.post("/wallet-chain-withdrawals/:withdrawalId/review", reviewAdminChainWithdrawalHandler);
router.post("/wallet-chain-withdrawals/:withdrawalId/execute", executeAdminChainWithdrawalHandler);
router.post("/wallet-chain-withdrawals/:withdrawalId/reconcile", reconcileAdminChainWithdrawalHandler);
router.get("/treasury-wallet", getPrizeTreasuryWalletHandler);
router.post("/treasury-wallet/provision", provisionPrizeTreasuryWalletHandler);
router.get("/treasury-wallet/prize-funding", getTreasuryPrizeFundingHandler);
router.get("/treasury-wallet/deposits", getAdminTreasuryDepositsHandler);
router.get("/treasury-wallet/ledger-history", getAdminTreasuryLedgerHistoryHandler);
router.get("/treasury-wallet/reconciliation", getLatestTreasuryReconciliationHandler);
router.post("/treasury-wallet/reconciliation", reconcileTreasuryAccountingHandler);
router.post("/treasury-wallet/allocate-prize-fund", allocateTreasuryPrizeFundHandler);
router.get("/wallet-withdrawals", getAdminWithdrawalRequestsHandler);
router.post("/wallet-withdrawals/:withdrawalId/review", reviewAdminWithdrawalHandler);
router.post("/wallet-withdrawals/:withdrawalId/execute", executeAdminWalletWithdrawalHandler);
router.post("/wallet-withdrawals/:withdrawalId/reconcile", reconcileAdminWalletWithdrawalHandler);
router.get("/project-profit-pool", getProjectProfitPoolAdminHandler);
router.get("/prize-pool/:contestId", getPrizePoolHandler);

export default router;
