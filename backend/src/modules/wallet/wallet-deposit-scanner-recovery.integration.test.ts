import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { scanWalletNetworkDepositsOnce } from "./wallet-chain-deposit-scanner.service.js";
import type { WalletChainAdapter } from "./chain-adapters/types.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("RPC interruption leaves the deposit cursor unchanged and releases the scanner lease", {
  skip: !shouldRun,
  timeout: 90_000,
}, async () => {
  const suffix = randomUUID();
  const userId = "ci-scanner-outage-" + suffix;
  const networkId = "ci-scanner-outage-network-" + suffix;
  const assetId = "ci-scanner-outage-asset-" + suffix;
  const walletAddress = "0x" + "1".repeat(40);
  const oldReady = process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY;

  const failingAdapter: WalletChainAdapter = {
    networkId,
    family: "EVM",
    async getLatestPosition() { return "105"; },
    async getSafePosition() { return "105"; },
    async getPositionHash(position: string) { return "hash-" + position; },
    async getIncomingTransfers() {
      throw new Error("CI_INJECTED_RPC_OUTAGE");
    },
  };

  try {
    await prisma.walletNetwork.create({
      data: {
        id: networkId,
        family: "EVM",
        chainId: null,
        networkKey: networkId,
        displayName: "CI scanner outage network",
        nativeAssetSymbol: "TST",
        nativeAssetDecimals: 18,
        finalityDepth: 1,
        isEnabled: true,
        depositEnabled: true,
        withdrawalEnabled: false,
      },
    });
    await prisma.walletAsset.create({
      data: {
        id: assetId,
        networkId,
        assetType: "NATIVE",
        assetReference: "native",
        contractAddress: null,
        symbol: "TST",
        displayName: "CI scanner outage asset",
        decimals: 18,
        issuerClassification: "CI_ONLY",
        verificationStatus: "VERIFIED",
        confirmationCount: 1,
        depositEnabled: true,
        withdrawalEnabled: false,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: userId + "@example.invalid",
        username: userId,
        passwordHash: "ci-only-not-a-real-password",
      },
    });
    const account = await prisma.walletAccount.create({
      data: { userId, address: walletAddress, status: "ACTIVE" },
      select: { id: true },
    });
    await prisma.walletAddress.create({
      data: {
        walletAccountId: account.id,
        networkId,
        address: walletAddress,
        addressType: "EVM",
        status: "ACTIVE",
        isPrimary: true,
      },
    });
    await prisma.walletNetworkScanCursor.create({
      data: {
        networkId,
        cursorPosition: "100",
        cursorHash: "hash-100",
      },
    });

    process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY = "true";
    await assert.rejects(
      scanWalletNetworkDepositsOnce(networkId, () => failingAdapter),
      /CI_INJECTED_RPC_OUTAGE/,
    );

    const cursor = await prisma.walletNetworkScanCursor.findUniqueOrThrow({ where: { networkId } });
    assert.equal(cursor.cursorPosition, "100", "cursor must not move past an unscanned block range");
    assert.equal(cursor.leaseOwner, null, "scanner lease must be released after the failed pass");
    assert.equal(await prisma.walletChainDeposit.count({ where: { networkId } }), 0);
  } finally {
    if (oldReady === undefined) delete process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY;
    else process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY = oldReady;
    await prisma.walletNetworkScanCursor.deleteMany({ where: { networkId } });
    await prisma.walletAddress.deleteMany({ where: { networkId } });
    await prisma.walletAccount.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.walletAsset.deleteMany({ where: { id: assetId } });
    await prisma.walletNetwork.deleteMany({ where: { id: networkId } });
  }
});
