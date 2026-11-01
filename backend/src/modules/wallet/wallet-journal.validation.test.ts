import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeWalletJournalPostings,
  validateBalancedWalletJournalPostings,
} from "./wallet-journal.validation.js";

test("accepts a balanced journal with large atomic integer amounts", () => {
  const amount = "100000000000000000000000000000000000000000000000";
  const postings = validateBalancedWalletJournalPostings([
    { account: "CUSTODY_ASSET", direction: "DEBIT", amountAtomic: amount },
    { account: "USER_AVAILABLE", direction: "CREDIT", amountAtomic: amount },
  ]);
  assert.equal(postings[0]?.amountAtomic, amount);
});

test("rejects unbalanced journals", () => {
  assert.throws(() => validateBalancedWalletJournalPostings([
    { account: "CUSTODY_ASSET", direction: "DEBIT", amountAtomic: "100" },
    { account: "USER_AVAILABLE", direction: "CREDIT", amountAtomic: "99" },
  ]), /UNBALANCED_WALLET_JOURNAL/);
});

test("rejects non-integer, signed, zero, and oversized amounts", () => {
  for (const amountAtomic of ["0", "-1", "+1", "1.2", "1e6", "1".repeat(79)]) {
    assert.throws(() => validateBalancedWalletJournalPostings([
      { account: "CUSTODY_ASSET", direction: "DEBIT", amountAtomic },
      { account: "USER_AVAILABLE", direction: "CREDIT", amountAtomic },
    ]), /INVALID_WALLET_JOURNAL_AMOUNT/);
  }
});

test("rejects mixed directions and fewer than two postings", () => {
  assert.throws(() => validateBalancedWalletJournalPostings([
    { account: "CUSTODY_ASSET", direction: "DEBIT", amountAtomic: "1" },
  ]), /WALLET_JOURNAL_REQUIRES_TWO_TO_ONE_HUNDRED_POSTINGS/);
});

test("canonical posting comparison ignores posting order", () => {
  const left = validateBalancedWalletJournalPostings([
    { account: "CUSTODY_ASSET", direction: "DEBIT", amountAtomic: "10" },
    { account: "USER_AVAILABLE", direction: "CREDIT", amountAtomic: "10", accountReference: "user-1" },
  ]);
  const right = validateBalancedWalletJournalPostings([
    { account: "USER_AVAILABLE", direction: "CREDIT", amountAtomic: "10", accountReference: "user-1" },
    { account: "CUSTODY_ASSET", direction: "DEBIT", amountAtomic: "10" },
  ]);
  assert.deepEqual(canonicalizeWalletJournalPostings(left), canonicalizeWalletJournalPostings(right));
});
