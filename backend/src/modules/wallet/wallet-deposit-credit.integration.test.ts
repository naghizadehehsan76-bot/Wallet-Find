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

test("confirmed chain deposit is detected and credited once across scanner retries", {
  skip: !shouldRun,
  timeout: 120_000,
}, async () => {
  const suffix = randomUUID();
  const userId = "ci-deposit-credit-" + suffix;
  const networkId = "ci-deposit-credit-network-" + suffix;
  const assetId = "ci-deposit-credit-asset-" + suffix;
  const receivingAddress = "0x" + "2".repeat(40);
  const txHash = "0x" + "ab".repeat(32);
  const oldReady = process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY;

  const adapter: WalletChainAdapter = {
    networkId,
    family: "EVM",
    async getLatestPosition() { return "105"; },
    async getSafePosition() { return "105"; },
    async getPositionHash(position: string) { return "hash-" + position; },
    async getIncomingTransfers() {
      return [{
        transactionReference: txHash,
        eventIndex: 0,
        position: "101",
        blockHash: "hash-101",
        fromAddress: "0x" + "3".repeat(40),
        toAddress: receivingAddress,
        rawAmount: "1000000000000000000",
        amountAtomic: "1000000000000000000",
      }];
    },
  };

  try {
    await prisma.walletNetwork.create({
      data: {
        id: networkId,
        family: "EVM",
        chainId: null,
        networkKey: networkId,
        displayName: "CI deposit credit network",
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
        displayName: "CI deposit credit asset",
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
      data: { userId, address: receivingAddress, status: "ACTIVE" },
      select: { id: true },
    });
    const address = await prisma.walletAddress.create({
      data: {
        walletAccountId: account.id,
        networkId,
        address: receivingAddress,
        addressType: "EVM",
        status: "ACTIVE",
        isPrimary: true,
      },
      select: { id: true },
    });
    await prisma.walletNetworkScanCursor.create({
      data: { networkId, cursorPosition: "100", cursorHash: "hash-100" },
    });

    process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY = "true";
    const first = await scanWalletNetworkDepositsOnce(networkId, () => adapter);
    assert.equal(first.detected, 1);
    assert.equal(first.credited, 1);

    const second = await scanWalletNetworkDepositsOnce(networkId, () => adapter);
    assert.equal(second.credited, 0);

    const deposit = await prisma.walletChainDeposit.findUniqueOrThrow({
      where: {
        networkId_transactionReference_eventIndex: {
          networkId,
          transactionReference: txHash,
          eventIndex: 0,
        },
      },
    });
    assert.equal(deposit.status, "CREDITED");
    assert.ok(deposit.creditedJournalId);

    const referenceKey = "wallet-chain-deposit:" + deposit.id;
    assert.equal(await prisma.walletJournal.count({ where: { referenceKey } }), 1);
    const credit = await prisma.walletJournalPosting.aggregate({
      where: {
        journal: { referenceKey },
        account: "USER_AVAILABLE",
        direction: "CREDIT",
      },
      _sum: { amountAtomic: true },
    });
    assert.equal(credit._sum.amountAtomic?.toFixed(0), "1000000000000000000");

    const cursor = await prisma.walletNetworkScanCursor.findUniqueOrThrow({ where: { networkId } });
    assert.equal(cursor.cursorPosition, "105");
    assert.equal(cursor.leaseOwner, null);
  } finally {
    if (oldReady === undefined) delete process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY;
    else process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY = oldReady;
  }
});
