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

export function getEvmPublicClient(chainId: number): PublicClient {
  return getClient(chainId);
}

export async function assertEvmRpcChainIdentity(
  client: PublicClient,
  expectedChainId: number,
): Promise<void> {
  const actualChainId = await client.getChainId();
  if (actualChainId !== expectedChainId) {
    throw new Error("EVM_RPC_CHAIN_ID_MISMATCH");
  }
}

export function isEvmWithdrawalFeeModelSupported(chainId: number): boolean {
  // Optimism and Arbitrum require additional L1 data-fee accounting.
  return chainId === 1 || chainId === 56 || chainId === 137;
}

function assertPosition(position: string): bigint {
  if (!/^\d+$/.test(position)) throw new Error("INVALID_EVM_BLOCK_POSITION");
  return BigInt(position);
}

export function createEvmWalletChainAdapter(input: {
  networkId: string;
  chainId: number;
  client?: PublicClient;
}): WalletChainAdapter {
  const client = input.client ?? getClient(input.chainId);

  return {
    networkId: input.networkId,
    family: "EVM",

    async getLatestPosition() {
      await assertEvmRpcChainIdentity(client, input.chainId);
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
      if (args.asset.decimals < 0 || args.asset.decimals > 255 ||
          !Number.isInteger(args.asset.decimals)) {
        throw new Error("INVALID_ASSET_DECIMALS");
      }

      const fromBlock = assertPosition(args.fromPosition);
      const toBlock = assertPosition(args.toPosition);
      if (fromBlock > toBlock) return [];

      const recipientSet = new Set(args.addresses.map((item) => item.address.toLowerCase()));
      const transfers: IncomingChainTransfer[] = [];

      if (args.asset.assetType === "NATIVE") {
        if (args.asset.contractAddress !== null) {
          throw new Error("INVALID_NATIVE_ASSET_CONFIGURATION");
        }

        // Native EVM transfers are found in transaction values, not ERC-20
        // Transfer logs. Keep this scan window bounded because full blocks
        // contain transaction objects and are more expensive for RPC providers.
        const maxNativeBlocks = BigInt(Number.parseInt(
          process.env.EVM_NATIVE_DEPOSIT_MAX_BLOCKS_PER_BATCH ?? "250",
          10,
        ) || 250);
        if (toBlock - fromBlock + 1n > maxNativeBlocks) {
          throw new Error("EVM_NATIVE_DEPOSIT_SCAN_RANGE_TOO_LARGE");
        }

        for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber++) {
          const block = await client.getBlock({
            blockNumber,
            includeTransactions: true,
          });
          if (!block.hash) continue;

          for (const transaction of block.transactions) {
            if (typeof transaction === "string" || !transaction.to ||
                transaction.value <= 0n ||
                !recipientSet.has(transaction.to.toLowerCase())) continue;

            // A transaction included in a block can still have reverted.
            // Credit native value only when its receipt succeeded and belongs
            // to the same canonical block currently being scanned.
            const receipt = await client.getTransactionReceipt({ hash: transaction.hash });
            if (receipt.status !== "success" || !receipt.blockHash ||
                receipt.blockHash.toLowerCase() !== block.hash.toLowerCase()) continue;

            transfers.push({
              transactionReference: transaction.hash,
              // Negative index keeps native value distinct from ERC-20 log 0
              // if one transaction also emits a token Transfer event.
              eventIndex: -1,
              position: block.number.toString(),
              blockHash: block.hash,
              fromAddress: transaction.from.toLowerCase(),
              toAddress: transaction.to.toLowerCase(),
              rawAmount: transaction.value.toString(),
              amountAtomic: transaction.value.toString(),
            });
          }
        }

        return transfers;
      }

      if (!args.asset.contractAddress) {
        throw new Error("INVALID_TOKEN_ASSET_CONFIGURATION");
      }

      const contract = args.asset.contractAddress as Address;
      const recipients = Array.from(recipientSet) as Address[];

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
