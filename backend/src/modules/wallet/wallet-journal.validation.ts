export const WALLET_LEDGER_ACCOUNTS = [
  "USER_AVAILABLE",
  "USER_RESERVED",
  "CUSTODY_ASSET",
  "EXTERNAL_COUNTERPARTY",
  "NETWORK_FEE_EXPENSE",
  "SYSTEM_CLEARING",
] as const;

export const WALLET_LEDGER_DIRECTIONS = ["DEBIT", "CREDIT"] as const;

export type WalletLedgerAccountCode = (typeof WALLET_LEDGER_ACCOUNTS)[number];
export type WalletLedgerDirectionCode = (typeof WALLET_LEDGER_DIRECTIONS)[number];

export type WalletJournalPostingInput = {
  account: WalletLedgerAccountCode;
  direction: WalletLedgerDirectionCode;
  /** Positive integer represented as a base-10 string in the asset's atomic unit. */
  amountAtomic: string;
  accountReference?: string | null;
};

export type ValidatedWalletJournalPosting = {
  account: WalletLedgerAccountCode;
  direction: WalletLedgerDirectionCode;
  amountAtomic: string;
  accountReference: string | null;
};

const MAX_ATOMIC_DIGITS = 78;

/**
 * Validate and canonicalize a journal's debit/credit postings. The journal is
 * denominated in one asset on one network; callers must not mix dimensions.
 */
export function validateBalancedWalletJournalPostings(
  postings: readonly WalletJournalPostingInput[],
): ValidatedWalletJournalPosting[] {
  if (!Array.isArray(postings) || postings.length < 2 || postings.length > 100) {
    throw new Error("WALLET_JOURNAL_REQUIRES_TWO_TO_ONE_HUNDRED_POSTINGS");
  }

  let debits = 0n;
  let credits = 0n;

  const result = postings.map((posting) => {
    if (!WALLET_LEDGER_ACCOUNTS.includes(posting.account)) {
      throw new Error("INVALID_WALLET_LEDGER_ACCOUNT");
    }
    if (!WALLET_LEDGER_DIRECTIONS.includes(posting.direction)) {
      throw new Error("INVALID_WALLET_LEDGER_DIRECTION");
    }
    if (typeof posting.amountAtomic !== "string" ||
        posting.amountAtomic.length > MAX_ATOMIC_DIGITS ||
        !/^[1-9]\d*$/.test(posting.amountAtomic)) {
      throw new Error("INVALID_WALLET_JOURNAL_AMOUNT");
    }

    const amount = BigInt(posting.amountAtomic);
    if (posting.direction === "DEBIT") debits += amount;
    else credits += amount;

    const accountReference = posting.accountReference?.trim() || null;
    if (accountReference && accountReference.length > 256) {
      throw new Error("INVALID_WALLET_JOURNAL_ACCOUNT_REFERENCE");
    }

    return {
      account: posting.account,
      direction: posting.direction,
      amountAtomic: amount.toString(),
      accountReference,
    };
  });

  if (debits !== credits) throw new Error("UNBALANCED_WALLET_JOURNAL");
  return result;
}

export function canonicalizeWalletJournalPostings(
  postings: readonly ValidatedWalletJournalPosting[],
): string[] {
  return postings
    .map((posting) => [
      posting.account,
      posting.direction,
      posting.amountAtomic,
      posting.accountReference ?? "",
    ].join("|"))
    .sort();
}
