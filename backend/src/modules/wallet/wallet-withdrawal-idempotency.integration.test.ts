import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { requestChainWalletWithdrawal } from "./wallet-chain-withdrawal.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("withdrawal retries reuse the original request and reject changed payloads before external signing", {
  skip: !shouldRun,
  timeout: 60_000,
}, async () => {
  const suffix = randomUUID();
  const userId = "ci-withdrawal-retry-" + suffix;
  const networkId = "ci-withdrawal-network-" + suffix;
  const tokenAssetId = "ci-withdrawal-token-" + suffix;
  const feeAssetId = "ci-withdrawal-native-" + suffix;
  const idempotencyKey = "ci-withdrawal-idempotency-" + suffix;
  const address = "0x" + "0".repeat(8) + suffix.replace(/-/g, "");
  const destinationAddress = "0x0000000000000000000000000000000000000002";
  const oldEnabled = process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED;
  const oldReady = process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY;

  try {
    await prisma.walletNetwork.create({
      data: {
        id: networkId,
        family: "EVM",
        chainId: null,
        networkKey: networkId,
        displayName: "CI withdrawal idempotency network",
        nativeAssetSymbol: "TST",
        nativeAssetDecimals: 18,
        finalityDepth: 1,
        isEnabled: false,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    });
    await prisma.walletAsset.createMany({
      data: [
        {
          id: tokenAssetId,
          networkId,
          assetType: "TOKEN",
          assetReference: "ci-token",
          symbol: "TST",
          displayName: "CI token",
          decimals: 6,
          issuerClassification: "CI_ONLY",
          verificationStatus: "VERIFIED",
          confirmationCount: 1,
          depositEnabled: false,
          withdrawalEnabled: false,
        },
        {
          id: feeAssetId,
          networkId,
          assetType: "NATIVE",
          assetReference: "native",
          symbol: "GAS",
          displayName: "CI gas asset",
          decimals: 18,
          issuerClassification: "CI_ONLY",
          verificationStatus: "VERIFIED",
          confirmationCount: 1,
          depositEnabled: false,
          withdrawalEnabled: false,
        },
      ],
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: userId + "@example.invalid",
        username: userId,
        passwordHash: "ci-only-not-a-real-password",
      },
    });
    const wallet = await prisma.walletAccount.create({
      data: { userId, address },
      select: { id: true },
    });
    const walletAddress = await prisma.walletAddress.create({
      data: {
        walletAccountId: wallet.id,
        networkId,
        address,
        addressType: "EVM",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    const original = await prisma.walletChainWithdrawal.create({
      data: {
        userId,
        walletAccountId: wallet.id,
        walletAddressId: walletAddress.id,
        networkId,
        walletAssetId: tokenAssetId,
        feeAssetId,
        destinationAddress,
        amountAtomic: 1_230_000n,
        feeAtomic: 10_000n,
        idempotencyKey,
        status: "APPROVED",
      },
      select: { id: true },
    });

    process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED = "true";
    process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY = "true";

    const retry = await requestChainWalletWithdrawal({
      userId,
      networkId,
      assetId: tokenAssetId,
      amount: "1.23",
      destinationAddress,
      idempotencyKey,
    });
    assert.equal(retry.reused, true);
    assert.equal(retry.id, original.id);

    await assert.rejects(
      requestChainWalletWithdrawal({
        userId,
        networkId,
        assetId: tokenAssetId,
        amount: "1.24",
        destinationAddress,
        idempotencyKey,
      }),
      /WALLET_WITHDRAWAL_IDEMPOTENCY_CONFLICT/,
    );

    assert.equal(await prisma.walletChainWithdrawal.count({ where: { idempotencyKey } }), 1);
  } finally {
    if (oldEnabled === undefined) delete process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED;
    else process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED = oldEnabled;
    if (oldReady === undefined) delete process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY;
    else process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY = oldReady;

    await prisma.walletChainWithdrawal.deleteMany({ where: { idempotencyKey } });
    await prisma.walletAddress.deleteMany({ where: { walletAccount: { userId } } });
    await prisma.walletAccount.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.walletAsset.deleteMany({ where: { id: { in: [tokenAssetId, feeAssetId] } } });
    await prisma.walletNetwork.deleteMany({ where: { id: networkId } });
  }
});
