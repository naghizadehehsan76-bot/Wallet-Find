import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Chain,
  type PublicClient,
} from "viem";
import { arbitrum, bsc, mainnet, optimism, polygon } from "viem/chains";
import type {
  AdapterAddress,
  AdapterAsset,
  IncomingChainTransfer,
  WalletChainAdapter,
} from "./types.js";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const EVM_NETWORKS: Record<number, { chain: Chain; rpcEnv: string }> = {
  1: { chain: mainnet, rpcEnv: "ETHEREUM_RPC_URL" },
  10: { chain: optimism, rpcEnv: "OPTIMISM_RPC_URL" },
  56: { chain: bsc, rpcEnv: "BSC_RPC_URL" },
  137: { chain: polygon, rpcEnv: "POLYGON_RPC_URL" },
  42161: { chain: arbitrum, rpcEnv: "ARBITRUM_RPC_URL" },
};

function getClient(chainId: number): PublicClient {
  const config = EVM_NETWORKS[chainId];
  if (!config) throw new Error("EVM_NETWORK_NOT_SUPPORTED_BY_ADAPTER");
  const rpcUrl = process.env[config.rpcEnv]?.trim();
  if (!rpcUrl) throw new Error("CHAIN_RPC_NOT_CONFIGURED");
  return createPublicClient({
    chain: config.chain,
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }),
  });
}

function assertPosition(position: string): bigint {
  if (!/^\d+$/.test(position)) throw new Error("INVALID_EVM_BLOCK_POSITION");
  return BigInt(position);
}

export function createEvmWalletChainAdapter(input: {
  networkId: string;
  chainId: number;
}): WalletChainAdapter {
  const client = getClient(input.chainId);

  return {
    networkId: input.networkId,
    family: "EVM",

    async getLatestPosition() {
      return (await client.getBlockNumber()).toString();
    },

    async getSafePosition(finalityDepth) {
      const latest = await client.getBlockNumber();
      const depth = BigInt(Math.max(1, Math.trunc(finalityDepth)));
      return (latest > depth ? latest - depth : 0n).toString();
    },

    async getPositionHash(position) {
      const block = await client.getBlock({ blockNumber: assertPosition(position) });
      return block.hash ?? null;
    },

    async getIncomingTransfers(args: {
      asset: AdapterAsset;
      addresses: readonly AdapterAddress[];
      fromPosition: string;
      toPosition: string;
    }): Promise<IncomingChainTransfer[]> {
      if (args.asset.assetType !== "TOKEN" || !args.asset.contractAddress) {
        // Native-coin deposits require chain-specific transaction/trace parsing.
        // Never silently treat an ERC-20 event scanner as a native-asset scanner.
        throw new Error("EVM_NATIVE_ASSET_SCANNING_NOT_IMPLEMENTED");
      }
      if (args.asset.decimals < 0 || args.asset.decimals > 255 ||
          !Number.isInteger(args.asset.decimals)) {
        throw new Error("INVALID_ASSET_DECIMALS");
      }

      const contract = args.asset.contractAddress as Address;
      const fromBlock = assertPosition(args.fromPosition);
      const toBlock = assertPosition(args.toPosition);
      if (fromBlock > toBlock) return [];

      const recipients = Array.from(new Set(
        args.addresses.map((item) => item.address.toLowerCase()),
      )) as Address[];
      const transfers: IncomingChainTransfer[] = [];

      // Keep each topic filter small enough for common RPC provider limits.
      for (let offset = 0; offset < recipients.length; offset += 100) {
        const batch = recipients.slice(offset, offset + 100);
        const logs = await client.getLogs({
          address: contract,
          event: TRANSFER_EVENT,
          args: { to: batch },
          fromBlock,
          toBlock,
        });

        for (const log of logs) {
          if (!log.args.from || !log.args.to || log.args.value === undefined ||
              log.logIndex === null || log.blockNumber === null ||
              !log.blockHash || !log.transactionHash) continue;

          transfers.push({
            transactionReference: log.transactionHash,
            eventIndex: log.logIndex,
            position: log.blockNumber.toString(),
            blockHash: log.blockHash,
            fromAddress: log.args.from.toLowerCase(),
            toAddress: log.args.to.toLowerCase(),
            rawAmount: log.args.value.toString(),
            // ERC-20 Transfer.value is already denominated in the token's
            // smallest atomic unit; do not divide by 10^decimals.
            amountAtomic: log.args.value.toString(),
          });
        }
      }

      return transfers;
    },
  };
}

export function isSupportedEvmChainId(chainId: number): boolean {
  return Object.hasOwn(EVM_NETWORKS, chainId);
}
