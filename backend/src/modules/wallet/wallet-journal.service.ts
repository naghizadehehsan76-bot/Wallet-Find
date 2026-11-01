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
  /** When set, this journal must be an exact inverse of the original journal. */
  reversalOfId?: string | null;
};

function samePayload(
  left: { userId: string | null; networkId: string; walletAssetId: string; entryType: string; note: string; reversalOfId: string | null; postings: readonly { account: string; direction: string; amountAtomic: { toString(): string }; accountReference: string | null }[] },
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
  return left.userId === (input.userId ?? null)
    && left.networkId === input.networkId
    && left.walletAssetId === input.walletAssetId
    && left.entryType === input.entryType
    && left.note === input.note
    && left.reversalOfId === (input.reversalOfId ?? null)
    && JSON.stringify(leftPostings) === JSON.stringify(rightPostings);
}

/**
 * Create an immutable, balanced, asset-scoped journal. Posting amounts are
 * exact atomic-unit decimal strings and are persisted as NUMERIC(78,0).
 *
 * The reference key is the idempotency boundary. Reusing it with different
 * financial content is rejected instead of silently returning another entry.
 */
export async function postWalletJournal(input: PostWalletJournalInput) {
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

  const postings = validateBalancedWalletJournalPostings(input.postings);
  const reversalOfId = input.reversalOfId ?? null;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`wallet-journal:${input.referenceKey}`}))) AS journal_lock`;

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

      const inverse = original.postings.map((posting) => ({
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
  }, { isolationLevel: "Serializable" });
}
