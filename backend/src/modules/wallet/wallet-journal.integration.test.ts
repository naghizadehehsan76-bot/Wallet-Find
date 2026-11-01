import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { postWalletJournal } from "./wallet-journal.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("PostgreSQL enforces balanced, immutable and reversible wallet journals", {
  skip: !shouldRun,
}, async () => {
  const suffix = randomUUID();
  const networkId = "ci-ledger-" + suffix;
  const assetId = "ci-asset-" + suffix;
  const referenceKey = "ci-journal-" + suffix;

  await prisma.walletNetwork.create({
    data: {
      id: networkId,
      family: "EVM",
      chainId: null,
      networkKey: networkId,
      displayName: "CI ledger test network",
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
      displayName: "CI test asset",
      decimals: 6,
      issuerClassification: "CI_ONLY",
      verificationStatus: "VERIFIED",
      confirmationCount: 1,
      depositEnabled: false,
      withdrawalEnabled: false,
    },
  });

  const postings = [
    {
      account: "CUSTODY_ASSET" as const,
      direction: "DEBIT" as const,
      amountAtomic: "123456789012345678901234567890",
      accountReference: "ci-custody",
    },
    {
      account: "USER_AVAILABLE" as const,
      direction: "CREDIT" as const,
      amountAtomic: "123456789012345678901234567890",
      accountReference: "ci-user",
    },
  ];

  const first = await postWalletJournal({
    networkId,
    walletAssetId: assetId,
    entryType: "MANUAL_ADJUSTMENT",
    referenceKey,
    note: "CI balanced journal",
    postings,
  });
  const repeated = await postWalletJournal({
    networkId,
    walletAssetId: assetId,
    entryType: "MANUAL_ADJUSTMENT",
    referenceKey,
    note: "CI balanced journal",
    postings,
  });

  assert.equal(repeated.id, first.id);
  await assert.rejects(
    () => postWalletJournal({
      networkId,
      walletAssetId: assetId,
      entryType: "MANUAL_ADJUSTMENT",
      referenceKey,
      note: "Conflicting replay",
      postings: [
        { ...postings[0]!, amountAtomic: "1" },
        { ...postings[1]!, amountAtomic: "1" },
      ],
    }),
    /WALLET_JOURNAL_IDEMPOTENCY_CONFLICT/,
  );

  const reversalPostings = [
    {
      account: "CUSTODY_ASSET" as const,
      direction: "CREDIT" as const,
      amountAtomic: postings[0]!.amountAtomic,
      accountReference: postings[0]!.accountReference,
    },
    {
      account: "USER_AVAILABLE" as const,
      direction: "DEBIT" as const,
      amountAtomic: postings[1]!.amountAtomic,
      accountReference: postings[1]!.accountReference,
    },
  ];
  const reversal = await postWalletJournal({
    networkId,
    walletAssetId: assetId,
    entryType: "DEPOSIT_REVERSAL",
    referenceKey: referenceKey + ":reversal",
    note: "CI exact inverse reversal",
    reversalOfId: first.id,
    postings: reversalPostings,
  });
  assert.equal(reversal.reversalOfId, first.id);

  await assert.rejects(
    () => prisma.$transaction(async (tx) => tx.walletJournal.create({
      data: {
        networkId,
        walletAssetId: assetId,
        entryType: "MANUAL_ADJUSTMENT",
        referenceKey: referenceKey + ":unbalanced",
        note: "Must fail at the database constraint trigger",
        postings: {
          create: [{
            account: "USER_AVAILABLE",
            direction: "CREDIT",
            amountAtomic: "1",
            accountReference: "ci-user",
          }],
        },
      },
    })),
    /WALLET_JOURNAL_NOT_BALANCED/,
  );

  await assert.rejects(
    () => prisma.walletJournal.update({
      where: { id: first.id },
      data: { note: "Mutation must be rejected" },
    }),
    /WALLET_JOURNAL_IS_IMMUTABLE/,
  );
});
