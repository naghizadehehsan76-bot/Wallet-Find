import assert from "node:assert/strict";
import { test } from "node:test";
import { meetsMinimumDeposit, minimumDepositAtomic } from "./deposit-minimum.js";

test("Polygon POL minimum is 0.01 POL", () => {
  assert.equal(minimumDepositAtomic({ chainId: 137, symbol: "POL", decimals: 18 }), 10_000_000_000_000_000n);
  assert.equal(meetsMinimumDeposit({ chainId: 137, symbol: "POL", decimals: 18, amountAtomic: 9_999_999_999_999_999n }), false);
  assert.equal(meetsMinimumDeposit({ chainId: 137, symbol: "POL", decimals: 18, amountAtomic: 10_000_000_000_000_000n }), true);
});

test("Polygon USDT0 minimum is 0.01 USDT0", () => {
  assert.equal(minimumDepositAtomic({ chainId: 137, symbol: "USDT0", decimals: 6 }), 10_000n);
  assert.equal(meetsMinimumDeposit({ chainId: 137, symbol: "USDT0", decimals: 6, amountAtomic: 9_999n }), false);
  assert.equal(meetsMinimumDeposit({ chainId: 137, symbol: "USDT0", decimals: 6, amountAtomic: 10_000n }), true);
});

test("explicit asset registry minimum overrides defaults", () => {
  assert.equal(minimumDepositAtomic({ chainId: 137, symbol: "POL", decimals: 18, configuredMinimum: "250" }), 250n);
});

test("other assets without a configured minimum keep zero as their minimum", () => {
  assert.equal(minimumDepositAtomic({ chainId: 1, symbol: "ETH", decimals: 18 }), 0n);
});
