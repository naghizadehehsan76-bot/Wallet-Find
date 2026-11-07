import assert from "node:assert/strict";
import { test } from "node:test";
import { requiresWalletScannerCursorOnlyMode } from "./wallet-chain-deposit-scanner.service.js";

const ready = {
  networkEnabled: true,
  legacyPolygonScannerActive: false,
  depositEnabled: true,
  depositsProductionReady: true,
  verifiedEnabledAssetCount: 1,
  activeAddressCount: 1,
};

test("disabled network advances cursor without scanning deposits", () => {
  assert.equal(requiresWalletScannerCursorOnlyMode({ ...ready, networkEnabled: false }), true);
});

test("generic scanner can process native POL while legacy scanner owns USDT0", () => {
  assert.equal(requiresWalletScannerCursorOnlyMode({ ...ready, legacyPolygonScannerActive: true }), false);
});

test("legacy-only Polygon scanner keeps generic scanner cursor-only when no generic asset remains", () => {
  assert.equal(requiresWalletScannerCursorOnlyMode({
    ...ready,
    legacyPolygonScannerActive: true,
    verifiedEnabledAssetCount: 0,
  }), true);
});

test("asset-level pause keeps the cursor moving but does not detect transfers", () => {
  assert.equal(requiresWalletScannerCursorOnlyMode({ ...ready, depositEnabled: false }), true);
});

test("production readiness gate keeps cursor-only mode until enabled", () => {
  assert.equal(requiresWalletScannerCursorOnlyMode({ ...ready, depositsProductionReady: false }), true);
});

test("no verified asset or receiving address cannot process deposits", () => {
  assert.equal(requiresWalletScannerCursorOnlyMode({ ...ready, verifiedEnabledAssetCount: 0 }), true);
  assert.equal(requiresWalletScannerCursorOnlyMode({ ...ready, activeAddressCount: 0 }), true);
});

test("ready network with verified assets and addresses may scan deposits", () => {
  assert.equal(requiresWalletScannerCursorOnlyMode(ready), false);
});
