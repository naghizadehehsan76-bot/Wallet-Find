import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { postWalletJournal } from "./wallet-journal.service.js";
import { reserveChainWithdrawalFunds } from "./wallet-chain-withdrawal.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("concurrent withdrawals cannot reserve more than the available ledger balance", {
  skip: !shouldRun,
  timeout: 120_000,
}, async () => {
  const suffix = randomUUID();
  const userId = "ci-withdrawal-race-" + suffix;
  const networkId = "ci-withdrawal-race-network-" + suffix;
  const assetId = "ci-withdrawal-race-asset-" + suffix;
  const openingReference = "ci-withdrawal-race-opening-" + suffix;

  try {
    await prisma.walletNetwork.create({
      data: {
        id: networkId,
        family: "EVM",
        chainId: null,
        networkKey: networkId,
        displayName: "CI withdrawal race network",
        nativeAssetSymbol: "TST",
        nativeAssetDecimals: 6,
        finalityDepth: 1,
        isEnabled: false,
        depositEnabled: false,
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
        displayName: "CI withdrawal race asset",
        decimals: 6,
        issuerClassification: "CI_ONLY",
        verificationStatus: "VERIFIED",
        confirmationCount: 1,
        depositEnabled: false,
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

    await postWalletJournal({
      userId,
      networkId,
      walletAssetId: assetId,
      entryType: "MANUAL_ADJUSTMENT",
      referenceKey: openingReference,
      note: "Synthetic opening balance for withdrawal concurrency test",
      postings: [
        { account: "CUSTODY_ASSET", direction: "DEBIT", amountAtomic: "100", accountReference: "ci-custody" },
        { account: "USER_AVAILABLE", direction: "CREDIT", amountAtomic: "100", accountReference: userId },
      ],
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 2 }, (_, index) =>
        prisma.$transaction(
          (tx) => reserveChainWithdrawalFunds(tx, {
            id: "ci-withdrawal-" + suffix + "-" + index,
            userId,
            networkId,
            assetId,
            feeAssetId: assetId,
            amount: 70n,
            reservedFeeAmount: 0n,
            feeQuoteAtomic: 0n,
            useTurnkeySponsorship: false,
            fundingSource: "USER_WALLET",
            isPolygonUsdt0: false,
          }),
          { isolationLevel: "ReadCommitted", maxWait: 15_000, timeout: 30_000 },
        ),
      ),
    );

    const successes = attempts.filter((item) => item.status === "fulfilled");
    const failures = attempts.filter((item) => item.status === "rejected");
    assert.equal(successes.length, 1, "only one 70-unit withdrawal may reserve against 100 units");
    assert.equal(failures.length, 1);
    if (failures[0]?.status === "rejected") {
      assert.match(String(failures[0].reason), /INSUFFICIENT_WALLET_BALANCE/);
    }

    const postings = await prisma.walletJournalPosting.findMany({
      where: { journal: { userId, networkId, walletAssetId: assetId } },
      select: { account: true, direction: true, amountAtomic: true },
    });
    const balanceFor = (account: string) => postings
      .filter((posting) => posting.account === account)
      .reduce((sum, posting) => {
        const amount = BigInt(posting.amountAtomic.toFixed(0));
        return sum + (posting.direction === "CREDIT" ? amount : -amount);
      }, 0n);

    assert.equal(balanceFor("USER_AVAILABLE"), 30n);
    assert.equal(balanceFor("USER_RESERVED"), 70n);
    assert.equal(await prisma.walletJournal.count({
      where: { userId, networkId, walletAssetId: assetId, entryType: "WITHDRAWAL_RESERVE" },
    }), 1);
  } finally {
    // CI database is disposable; immutable journals are retained for audit.
  }
});
