import assert from "node:assert/strict";
import test from "node:test";
import { aggregateWalletLedger, formatAssetUnits } from "./asset-amount.utils.js";

test("asset amount formatting honors token precision without floating point rounding", () => {
  assert.equal(formatAssetUnits(1_234_567n, 6), "1.234567");
  assert.equal(formatAssetUnits(1_234_567_890_123_456_789n, 18), "1.234567890123456789");
  assert.equal(formatAssetUnits(1_000_000_000_000_000_000n, 18), "1");
  assert.equal(formatAssetUnits(-1_250_000n, 6), "-1.25");
  assert.equal(formatAssetUnits(42n, 0), "42");
});

test("asset amount formatting rejects invalid precision", () => {
  assert.throws(() => formatAssetUnits(1n, -1), { message: "INVALID_ASSET_DECIMALS" });
  assert.throws(() => formatAssetUnits(1n, 37), { message: "INVALID_ASSET_DECIMALS" });
});

test("same-ticker assets on different chains remain separate ledger balances", () => {
  const totals = aggregateWalletLedger([
    { type: "DEPOSIT", status: "COMPLETED", amountMicro: 125_000_000n, currency: "USDT", chainAssetId: "asset-ethereum-usdt" },
    { type: "DEPOSIT", status: "COMPLETED", amountMicro: 250_000_000n, currency: "USDT", chainAssetId: "asset-polygon-usdt0" },
  ]);

  assert.equal(totals.get("asset-ethereum-usdt")?.balance, 125_000_000n);
  assert.equal(totals.get("asset-polygon-usdt0")?.balance, 250_000_000n);
  assert.equal(totals.size, 2);
});

test("reversals reduce only the matching asset and pending withdrawals reduce availability only", () => {
  const totals = aggregateWalletLedger([
    { type: "DEPOSIT", status: "COMPLETED", amountMicro: 10_000_000n, currency: "USDT0", chainAssetId: "asset-polygon-usdt0" },
    { type: "DEPOSIT_REVERSAL", status: "COMPLETED", amountMicro: 2_000_000n, currency: "USDT0", chainAssetId: "asset-polygon-usdt0" },
    { type: "WITHDRAWAL_REQUEST", status: "PENDING", amountMicro: 3_000_000n, currency: "USDT0", chainAssetId: "asset-polygon-usdt0" },
    { type: "DEPOSIT", status: "COMPLETED", amountMicro: 7_000_000n, currency: "USDT0", chainAssetId: "asset-another-chain-usdt" },
  ]);

  const polygon = totals.get("asset-polygon-usdt0");
  assert.equal(polygon?.balance, 8_000_000n);
  assert.equal(polygon?.pendingWithdrawals, 3_000_000n);
  assert.equal(polygon!.balance - polygon!.pendingWithdrawals, 5_000_000n);
  assert.equal(totals.get("asset-another-chain-usdt")?.balance, 7_000_000n);
});

test("legacy currency rows stay isolated when no ChainAsset ID is available", () => {
  const totals = aggregateWalletLedger([
    { type: "DEPOSIT", status: "COMPLETED", amountMicro: 1_000_000n, currency: "USDT" },
    { type: "DEPOSIT", status: "COMPLETED", amountMicro: 2_000_000n, currency: "POL" },
  ]);
  assert.equal(totals.get("legacy:USDT")?.balance, 1_000_000n);
  assert.equal(totals.get("legacy:POL")?.balance, 2_000_000n);
});
