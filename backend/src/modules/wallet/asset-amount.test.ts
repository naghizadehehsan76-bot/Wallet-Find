import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAssetUnits, parseAssetUnits } from "./asset-amount.js";

test("parses six-decimal USDT amounts exactly", () => {
  assert.equal(parseAssetUnits("123.456789", 6), 123456789n);
  assert.equal(parseAssetUnits("0.000001", 6), 1n);
});

test("parses eighteen-decimal token amounts beyond Number precision", () => {
  assert.equal(parseAssetUnits("1.000000000000000001", 18), 1000000000000000001n);
});

test("formats arbitrary asset precision without floating point", () => {
  assert.equal(formatAssetUnits(1000000000000000001n, 18), "1.000000000000000001");
  assert.equal(formatAssetUnits(1200000n, 6), "1.2");
  assert.equal(formatAssetUnits(0n, 18), "0");
});

test("formats negative ledger adjustments exactly", () => {
  assert.equal(formatAssetUnits(-1000001n, 6), "-1.000001");
});

test("supports assets with zero decimals", () => {
  assert.equal(parseAssetUnits("42", 0), 42n);
  assert.equal(formatAssetUnits(42n, 0), "42");
});

test("rejects invalid amounts and excess fractional precision", () => {
  for (const value of ["", "-1", "+1", "1e-6", "1,000", ".5", "1."]) {
    assert.throws(() => parseAssetUnits(value, 6));
  }
  assert.throws(() => parseAssetUnits("1.0000001", 6), /ASSET_AMOUNT_PRECISION_EXCEEDED/);
});

test("rejects invalid decimal metadata", () => {
  for (const decimals of [-1, 1.5, 256, Number.NaN]) {
    assert.throws(() => parseAssetUnits("1", decimals), /INVALID_ASSET_DECIMALS/);
  }
});
