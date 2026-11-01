import prisma from "../../config/prisma.js";
import {
  canonicalizeWalletJournalPostings,
  validateBalancedWalletJournalPostings,
  type WalletJournalPostingInput,
} from "./wallet-journal.validation.js";

export type WalletJournalEntryType =
  | "DEPOSIT_CREDIT"
  | "DEPOSIT_REVERSAL"
  | "WITHDRAWAL_RESERVE"
  | "WITHDRAWAL_RELEASE"
  | "WITHDRAWAL_SETTLEMENT"
  | "NETWORK_FEE"
  | "INTERNAL_TRANSFER"
  | "MANUAL_ADJUSTMENT";

export type PostWalletJournalInput = {
  userId?: string | null;
  networkId: string;
  walletAssetId: string;
  entryType: WalletJournalEntryType;
  referenceKey: string;
  note: string;
  postings: readonly WalletJournalPostingInput[];
  reversalOfId?: string | null;
};

function validateJournalInput(input: PostWalletJournalInput) {
  if (!input.referenceKey?.trim() || input.referenceKey.length > 256) {
    throw new Error("INVALID_WALLET_JOURNAL_REFERENCE");
  }
  if (!input.networkId?.trim() || !input.walletAssetId?.trim()) {
    throw new Error("INVALID_WALLET_JOURNAL_DIMENSION");
  }
  if (!input.note?.trim() || input.note.length > 2000) {
    throw new Error("INVALID_WALLET_JOURNAL_NOTE");
  }
  if (input.userId !== undefined && input.userId !== null &&
      (typeof input.userId !== "string" || input.userId.length > 128)) {
    throw new Error("INVALID_WALLET_JOURNAL_USER");
  }
  return {
    postings: validateBalancedWalletJournalPostings(input.postings),
    reversalOfId: input.reversalOfId ?? null,
  };
}

function samePayload(
  left: {
    userId: string | null;
    networkId: string;
    walletAssetId: string;
    entryType: string;
    note: string;
    reversalOfId: string | null;
    postings: readonly {
      account: string;
      direction: string;
      amountAtomic: { toString(): string };
      accountReference: string | null;
    }[];
  },
  input: PostWalletJournalInput,
  postings: ReturnType<typeof validateBalancedWalletJournalPostings>,
): boolean {
  const leftPostings = canonicalizeWalletJournalPostings(left.postings.map((posting) => ({
    account: posting.account as WalletJournalPostingInput["account"],
    direction: posting.direction as WalletJournalPostingInput["direction"],
    amountAtomic: posting.amountAtomic.toString(),
    accountReference: posting.accountReference,
  })));
  const rightPostings = canonicalizeWalletJournalPostings(postings);
  const checks = {
    user: left.userId === (input.userId ?? null),
    network: left.networkId === input.networkId,
    asset: left.walletAssetId === input.walletAssetId,
    entryType: left.entryType === input.entryType,
    reversal: left.reversalOfId === (input.reversalOfId ?? null),
    postingCount: left.postings.length === postings.length,
    postings: JSON.stringify(leftPostings) === JSON.stringify(rightPostings),
  };
  const matches = Object.values(checks).every(Boolean);
  if (!matches) {
    console.warn("WALLET_JOURNAL_IDEMPOTENCY_PAYLOAD_MISMATCH", checks);
  }
  return matches;
}

/**
 * Persist one journal inside a caller-owned transaction. Use this when a
 * business operation must atomically reserve/settle more than one asset.
 */
export async function postWalletJournalInTransaction(tx: any, input: PostWalletJournalInput) {
  const { postings, reversalOfId } = validateJournalInput(input);

  await tx.$queryRawUnsafe(
    "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
    "wallet-journal:" + input.referenceKey,
  );

  const existing = await tx.walletJournal.findUnique({
    where: { referenceKey: input.referenceKey },
    include: { postings: true },
  });
  if (existing) {
    if (!samePayload(existing, input, postings)) {
      throw new Error("WALLET_JOURNAL_IDEMPOTENCY_CONFLICT");
    }
    return existing;
  }

  const asset = await tx.walletAsset.findUnique({
    where: { id: input.walletAssetId },
    select: { networkId: true },
  });
  if (!asset || asset.networkId !== input.networkId) {
    throw new Error("WALLET_JOURNAL_ASSET_NETWORK_MISMATCH");
  }

  if (reversalOfId) {
    const original = await tx.walletJournal.findUnique({
      where: { id: reversalOfId },
      include: { postings: true },
    });
    if (!original) throw new Error("WALLET_JOURNAL_REVERSAL_SOURCE_NOT_FOUND");
    if (original.networkId !== input.networkId ||
        original.walletAssetId !== input.walletAssetId ||
        original.userId !== (input.userId ?? null)) {
      throw new Error("WALLET_JOURNAL_REVERSAL_DIMENSION_MISMATCH");
    }

    const inverse = original.postings.map((posting: any) => ({
      account: posting.account,
      direction: posting.direction === "DEBIT" ? "CREDIT" as const : "DEBIT" as const,
      amountAtomic: posting.amountAtomic.toString(),
      accountReference: posting.accountReference,
    }));
    const expected = canonicalizeWalletJournalPostings(validateBalancedWalletJournalPostings(inverse));
    const actual = canonicalizeWalletJournalPostings(postings);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error("WALLET_JOURNAL_REVERSAL_MUST_BE_EXACT_INVERSE");
    }
  }

  return tx.walletJournal.create({
    data: {
      userId: input.userId ?? null,
      networkId: input.networkId,
      walletAssetId: input.walletAssetId,
      entryType: input.entryType,
      referenceKey: input.referenceKey,
      note: input.note,
      reversalOfId,
      postings: {
        create: postings.map((posting) => ({
          account: posting.account,
          direction: posting.direction,
          amountAtomic: posting.amountAtomic,
          accountReference: posting.accountReference,
        })),
      },
    },
    include: { postings: true },
  });
}

/** Standalone convenience wrapper for single-journal events. */
export async function postWalletJournal(input: PostWalletJournalInput) {
  validateJournalInput(input);
  return prisma.$transaction(
    (tx) => postWalletJournalInTransaction(tx, input),
    { isolationLevel: "Serializable" },
  );
}
