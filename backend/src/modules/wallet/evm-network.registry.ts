import type { Chain } from "viem";
import { arbitrum, avalanche, base, bsc, mainnet, optimism, polygon } from "viem/chains";

/**
 * Shared EVM network registry. A chain is scanned only when its scanner flag,
 * RPC URL, start block, asset registry rows, and eligible wallet accounts exist.
 * Adding a network means adding one descriptor here; asset-specific logic stays
 * in the generic scanner.
 */
export type EvmNetworkConfig = {
  chain: Chain;
  chainId: number;
  networkKey: string;
  displayName: string;
  scannerEnabledEnv: string;
  depositsEnabledEnv: string;
  rpcEnv: string;
  startBlockEnv: string;
  confirmationsEnv: string;
  chunkSizeEnv: string;
  reorgLookbackEnv: string;
  defaultConfirmations: number;
};

export const EVM_NETWORKS: EvmNetworkConfig[] = [
  {
    chain: mainnet, chainId: 1, networkKey: "ethereum", displayName: "Ethereum",
    scannerEnabledEnv: "ETHEREUM_DEPOSIT_SCANNER_ENABLED",
    depositsEnabledEnv: "ETHEREUM_DEPOSITS_ENABLED",
    rpcEnv: "ETHEREUM_RPC_URL", startBlockEnv: "ETHEREUM_DEPOSIT_START_BLOCK",
    confirmationsEnv: "ETHEREUM_DEPOSIT_CONFIRMATIONS",
    chunkSizeEnv: "ETHEREUM_SCAN_BLOCK_CHUNK", reorgLookbackEnv: "ETHEREUM_REORG_LOOKBACK_BLOCKS",
    defaultConfirmations: 64,
  },
  {
    chain: optimism, chainId: 10, networkKey: "optimism", displayName: "Optimism",
    scannerEnabledEnv: "OPTIMISM_DEPOSIT_SCANNER_ENABLED",
    depositsEnabledEnv: "OPTIMISM_DEPOSITS_ENABLED",
    rpcEnv: "OPTIMISM_RPC_URL", startBlockEnv: "OPTIMISM_DEPOSIT_START_BLOCK",
    confirmationsEnv: "OPTIMISM_DEPOSIT_CONFIRMATIONS",
    chunkSizeEnv: "OPTIMISM_SCAN_BLOCK_CHUNK", reorgLookbackEnv: "OPTIMISM_REORG_LOOKBACK_BLOCKS",
    defaultConfirmations: 64,
  },
  {
    chain: bsc, chainId: 56, networkKey: "bsc", displayName: "BNB Smart Chain",
    scannerEnabledEnv: "BSC_DEPOSIT_SCANNER_ENABLED",
    depositsEnabledEnv: "BSC_DEPOSITS_ENABLED",
    rpcEnv: "BSC_RPC_URL", startBlockEnv: "BSC_DEPOSIT_START_BLOCK",
    confirmationsEnv: "BSC_DEPOSIT_CONFIRMATIONS",
    chunkSizeEnv: "BSC_SCAN_BLOCK_CHUNK", reorgLookbackEnv: "BSC_REORG_LOOKBACK_BLOCKS",
    defaultConfirmations: 32,
  },
  {
    chain: polygon, chainId: 137, networkKey: "polygon", displayName: "Polygon PoS",
    scannerEnabledEnv: "POLYGON_DEPOSIT_SCANNER_ENABLED",
    depositsEnabledEnv: "POLYGON_DEPOSITS_ENABLED",
    rpcEnv: "POLYGON_RPC_URL", startBlockEnv: "POLYGON_DEPOSIT_START_BLOCK",
    confirmationsEnv: "POLYGON_USDT_CONFIRMATIONS",
    chunkSizeEnv: "POLYGON_SCAN_BLOCK_CHUNK", reorgLookbackEnv: "POLYGON_REORG_LOOKBACK_BLOCKS",
    defaultConfirmations: 128,
  },
  {
    chain: arbitrum, chainId: 42161, networkKey: "arbitrum", displayName: "Arbitrum One",
    scannerEnabledEnv: "ARBITRUM_DEPOSIT_SCANNER_ENABLED",
    depositsEnabledEnv: "ARBITRUM_DEPOSITS_ENABLED",
    rpcEnv: "ARBITRUM_RPC_URL", startBlockEnv: "ARBITRUM_DEPOSIT_START_BLOCK",
    confirmationsEnv: "ARBITRUM_DEPOSIT_CONFIRMATIONS",
    chunkSizeEnv: "ARBITRUM_SCAN_BLOCK_CHUNK", reorgLookbackEnv: "ARBITRUM_REORG_LOOKBACK_BLOCKS",
    defaultConfirmations: 64,
  },
  {
    chain: base, chainId: 8453, networkKey: "base", displayName: "Base",
    scannerEnabledEnv: "BASE_DEPOSIT_SCANNER_ENABLED",
    depositsEnabledEnv: "BASE_DEPOSITS_ENABLED",
    rpcEnv: "BASE_RPC_URL", startBlockEnv: "BASE_DEPOSIT_START_BLOCK",
    confirmationsEnv: "BASE_DEPOSIT_CONFIRMATIONS",
    chunkSizeEnv: "BASE_SCAN_BLOCK_CHUNK", reorgLookbackEnv: "BASE_REORG_LOOKBACK_BLOCKS",
    defaultConfirmations: 64,
  },
  {
    chain: avalanche, chainId: 43114, networkKey: "avalanche", displayName: "Avalanche C-Chain",
    scannerEnabledEnv: "AVALANCHE_DEPOSIT_SCANNER_ENABLED",
    depositsEnabledEnv: "AVALANCHE_DEPOSITS_ENABLED",
    rpcEnv: "AVALANCHE_RPC_URL", startBlockEnv: "AVALANCHE_DEPOSIT_START_BLOCK",
    confirmationsEnv: "AVALANCHE_DEPOSIT_CONFIRMATIONS",
    chunkSizeEnv: "AVALANCHE_SCAN_BLOCK_CHUNK", reorgLookbackEnv: "AVALANCHE_REORG_LOOKBACK_BLOCKS",
    defaultConfirmations: 64,
  },
];

export function isEvmScannerEnabled(network: EvmNetworkConfig): boolean {
  return process.env[network.scannerEnabledEnv] === "true";
}

export function getEnabledEvmNetworks(): EvmNetworkConfig[] {
  return EVM_NETWORKS.filter(isEvmScannerEnabled);
}
