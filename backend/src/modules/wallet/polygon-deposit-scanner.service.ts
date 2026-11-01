// Backward-compatible module path. Deposit discovery now runs through the
// asset-aware multi-chain EVM scanner so all enabled assets on one chain share
// one cursor and cannot advance past one another.
export {
  scanEvmDepositsOnce,
  startEvmDepositScanners,
  scanPolygonUsdtDepositsOnce,
  startPolygonDepositScanner,
} from "./evm-deposit-scanner.service.js";
