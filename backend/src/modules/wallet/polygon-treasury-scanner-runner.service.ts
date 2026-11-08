import { scanPolygonUsdtDepositsOnce } from "./polygon-deposit-scanner.service.js";
import { runWithSystemJobLease } from "../system/system-job-lease.service.js";

const DEFAULT_INTERVAL_MS = 30_000;

export function startPolygonTreasuryDepositScanner() {
  if (process.env.POLYGON_DEPOSIT_SCANNER_ENABLED !== "true") {
    console.log("Polygon treasury deposit scanner remains disabled by configuration");
    return null;
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const lease = await runWithSystemJobLease("polygon-treasury-deposit-scanner", scanPolygonUsdtDepositsOnce, { leaseMs: 180_000 });
      if (lease.acquired) console.log("Polygon treasury deposit scan completed", lease.value);
    } catch (error) {
      console.error("Polygon treasury deposit scan failed", {
        error: error instanceof Error ? error.message : "UNKNOWN_POLYGON_SCANNER_ERROR",
      });
    } finally {
      running = false;
    }
  };

  void tick();
  return setInterval(() => { void tick(); }, DEFAULT_INTERVAL_MS);
}
