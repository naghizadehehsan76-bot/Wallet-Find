import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { postWalletJournal } from "./wallet-journal.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("concurrent identical ledger events are idempotent and distinct events remain balanced", {
  skip: !shouldRun,
  timeout: 120_000,
}, async () => {
  const suffix = randomUUID();
  const networkId = "ci-journal-concurrency-network-" + suffix;
  const assetId = "ci-journal-concurrency-asset-" + suffix;
  const duplicateReference = "ci-journal-concurrency-duplicate-" + suffix;

  try {
    await prisma.walletNetwork.create({
      data: {
        id: networkId,
        family: "EVM",
        chainId: null,
        networkKey: networkId,
        displayName: "CI journal concurrency network",
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
        displayName: "CI journal concurrency asset",
        decimals: 6,
        issuerClassification: "CI_ONLY",
        verificationStatus: "VERIFIED",
        confirmationCount: 1,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
    });

    const duplicateInput = {
      networkId,
      walletAssetId: assetId,
      entryType: "MANUAL_ADJUSTMENT" as const,
      referenceKey: duplicateReference,
      note: "Concurrent idempotency replay",
      postings: [
        { account: "CUSTODY_ASSET" as const, direction: "DEBIT" as const, amountAtomic: "700", accountReference: "ci-custody" },
        { account: "USER_AVAILABLE" as const, direction: "CREDIT" as const, amountAtomic: "700", accountReference: "ci-user" },
      ],
    };

    const duplicateResults = await Promise.allSettled(
      Array.from({ length: 24 }, () => postWalletJournal(duplicateInput)),
    );
    const duplicateFailures = duplicateResults.filter((result) => result.status === "rejected");
    assert.deepEqual(duplicateFailures, [], "all identical concurrent replays must resolve successfully");
    const duplicateIds = new Set(duplicateResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.id] : [],
    ));
    assert.equal(duplicateIds.size, 1);
    assert.equal(await prisma.walletJournal.count({ where: { referenceKey: duplicateReference } }), 1);

    const distinctInputs = Array.from({ length: 24 }, (_, index) => ({
      ...duplicateInput,
      referenceKey: duplicateReference + ":distinct:" + index,
      note: "Independent concurrent event " + index,
      postings: duplicateInput.postings.map((posting) => ({ ...posting, amountAtomic: String(index + 1) })),
    }));
    const distinctResults = await Promise.allSettled(distinctInputs.map(postWalletJournal));
    assert.deepEqual(
      distinctResults.filter((result) => result.status === "rejected"),
      [],
      "independent concurrent ledger events must not be lost",
    );

    const journalCount = await prisma.walletJournal.count({ where: { networkId, walletAssetId: assetId } });
    assert.equal(journalCount, 25);
    const postings = await prisma.walletJournalPosting.findMany({
      where: { journal: { networkId, walletAssetId: assetId } },
      select: { direction: true, amountAtomic: true },
    });
    const debit = postings.filter((posting) => posting.direction === "DEBIT")
      .reduce((sum, posting) => sum + BigInt(posting.amountAtomic.toFixed(0)), 0n);
    const credit = postings.filter((posting) => posting.direction === "CREDIT")
      .reduce((sum, posting) => sum + BigInt(posting.amountAtomic.toFixed(0)), 0n);
    assert.equal(debit, credit);
  } finally {
    // The CI database is disposable; journal immutability intentionally prevents
    // deleting posted ledger history as part of fixture cleanup.
  }
});
