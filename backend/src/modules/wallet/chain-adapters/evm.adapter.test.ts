import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, PublicClient } from "viem";
import {
  createEvmWalletChainAdapter,
  isEvmWithdrawalFeeModelSupported,
  isSupportedEvmChainId,
} from "./evm.adapter.js";

const FROM = "0x1111111111111111111111111111111111111111" as Address;
const TO = "0x2222222222222222222222222222222222222222" as Address;
const CONTRACT = "0x3333333333333333333333333333333333333333" as Address;
const BLOCK_HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;
const TX_HASH = ("0x" + "cd".repeat(32)) as `0x${string}`;

function makeClient(overrides: Record<string, unknown> = {}): PublicClient {
  return {
    getChainId: async () => 56,
    getBlockNumber: async () => 100n,
    getBlock: async () => ({
      number: 100n,
      hash: BLOCK_HASH,
      transactions: [],
    }),
    getLogs: async () => [],
    getTransactionReceipt: async () => ({ status: "success", blockHash: BLOCK_HASH }),
    ...overrides,
  } as unknown as PublicClient;
}

test("lists only configured EVM chain adapters", () => {
  for (const chainId of [1, 10, 56, 137, 42161]) {
    assert.equal(isSupportedEvmChainId(chainId), true);
  }
  for (const chainId of [0, 97, 8453, 999999]) {
    assert.equal(isSupportedEvmChainId(chainId), false);
  }
});

test("withdrawal fee model is deliberately limited to reviewed EVM networks", () => {
  assert.equal(isEvmWithdrawalFeeModelSupported(1), true);
  assert.equal(isEvmWithdrawalFeeModelSupported(56), true);
  assert.equal(isEvmWithdrawalFeeModelSupported(137), true);
  assert.equal(isEvmWithdrawalFeeModelSupported(10), false);
  assert.equal(isEvmWithdrawalFeeModelSupported(42161), false);
});

test("refuses an RPC connected to the wrong EVM chain", async () => {
  const adapter = createEvmWalletChainAdapter({
    networkId: "eip155:56",
    chainId: 56,
    client: makeClient({ getChainId: async () => 137 }),
  });
  await assert.rejects(
    () => adapter.getLatestPosition(),
    /EVM_RPC_CHAIN_ID_MISMATCH/,
  );
});

test("computes a finality-safe position using integer block arithmetic", async () => {
  const adapter = createEvmWalletChainAdapter({
    networkId: "eip155:56",
    chainId: 56,
    client: makeClient(),
  });
  assert.equal(await adapter.getSafePosition(32), "68");
  assert.equal(await adapter.getSafePosition(200), "0");
});

test("extracts ERC-20 transfers in exact atomic units for 18-decimal tokens", async () => {
  const adapter = createEvmWalletChainAdapter({
    networkId: "eip155:56",
    chainId: 56,
    client: makeClient({
      getLogs: async () => [{
        args: { from: FROM, to: TO, value: 1000000000000000001n },
        logIndex: 7,
        blockNumber: 99n,
        blockHash: BLOCK_HASH,
        transactionHash: TX_HASH,
      }],
    }),
  });

  const transfers = await adapter.getIncomingTransfers({
    asset: {
      id: "bsc:test-token",
      assetType: "TOKEN",
      contractAddress: CONTRACT,
      decimals: 18,
    },
    addresses: [{
      id: "address-1",
      address: TO,
      walletAccountId: "wallet-1",
      userId: "user-1",
    }],
    fromPosition: "90",
    toPosition: "100",
  });

  assert.equal(transfers.length, 1);
  assert.equal(transfers[0]?.amountAtomic, "1000000000000000001");
  assert.equal(transfers[0]?.rawAmount, "1000000000000000001");
  assert.equal(transfers[0]?.eventIndex, 7);
  assert.equal(transfers[0]?.position, "99");
});

test("extracts direct native-coin transfers from EVM blocks", async () => {
  const adapter = createEvmWalletChainAdapter({
    networkId: "eip155:56",
    chainId: 56,
    client: makeClient({
      getBlock: async () => ({
        number: 100n,
        hash: BLOCK_HASH,
        transactions: [
          {
            hash: TX_HASH,
            from: FROM,
            to: TO,
            value: 1234567890123456789n,
          },
          {
            hash: ("0x" + "ef".repeat(32)) as `0x${string}`,
            from: FROM,
            to: "0x4444444444444444444444444444444444444444" as Address,
            value: 10n,
          },
        ],
      }),
    }),
  });

  const transfers = await adapter.getIncomingTransfers({
    asset: {
      id: "bsc:native",
      assetType: "NATIVE",
      contractAddress: null,
      decimals: 18,
    },
    addresses: [{
      id: "address-1",
      address: TO,
      walletAccountId: "wallet-1",
      userId: "user-1",
    }],
    fromPosition: "100",
    toPosition: "100",
  });

  assert.equal(transfers.length, 1);
  assert.equal(transfers[0]?.amountAtomic, "1234567890123456789");
  assert.equal(transfers[0]?.eventIndex, -1);
  assert.equal(transfers[0]?.blockHash, BLOCK_HASH);
});

test("does not credit a reverted direct native transfer", async () => {
  const adapter = createEvmWalletChainAdapter({
    networkId: "eip155:137",
    chainId: 137,
    client: makeClient({
      getBlock: async () => ({
        number: 100n,
        hash: BLOCK_HASH,
        transactions: [{ hash: TX_HASH, from: FROM, to: TO, value: 1_000_000_000_000_000_000n }],
      }),
      getTransactionReceipt: async () => ({ status: "reverted", blockHash: BLOCK_HASH }),
    }),
  });
  const transfers = await adapter.getIncomingTransfers({
    asset: { id: "polygon:native", assetType: "NATIVE", contractAddress: null, decimals: 18 },
    addresses: [{ id: "address-1", address: TO, walletAccountId: "wallet-1", userId: "user-1" }],
    fromPosition: "100",
    toPosition: "100",
  });
  assert.equal(transfers.length, 0);
});
test("rejects native-asset configurations with a token contract", async () => {
  const adapter = createEvmWalletChainAdapter({
    networkId: "eip155:56",
    chainId: 56,
    client: makeClient(),
  });
  await assert.rejects(
    () => adapter.getIncomingTransfers({
      asset: {
        id: "bsc:bad-native",
        assetType: "NATIVE",
        contractAddress: CONTRACT,
        decimals: 18,
      },
      addresses: [],
      fromPosition: "1",
      toPosition: "1",
    }),
    /INVALID_NATIVE_ASSET_CONFIGURATION/,
  );
});

test("rejects malformed block positions instead of coercing them", async () => {
  const adapter = createEvmWalletChainAdapter({
    networkId: "eip155:56",
    chainId: 56,
    client: makeClient(),
  });
  await assert.rejects(
    () => adapter.getIncomingTransfers({
      asset: {
        id: "bsc:native",
        assetType: "NATIVE",
        contractAddress: null,
        decimals: 18,
      },
      addresses: [],
      fromPosition: "1e3",
      toPosition: "1000",
    }),
    /INVALID_EVM_BLOCK_POSITION/,
  );
});
