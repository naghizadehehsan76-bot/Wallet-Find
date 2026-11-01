export type AssetLedgerBalance = {
  balance: bigint;
  pendingWithdrawals: bigint;
};

export type WalletLedgerRecord = {
  type: string;
  status: string;
  amountMicro: bigint | number | string;
  currency?: string | null;
  chainAssetId?: string | null;
};

export function formatAssetUnits(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("INVALID_ASSET_DECIMALS");
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = decimals === 0
    ? ""
    : (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return (negative ? "-" : "") + whole.toString() + (fraction ? "." + fraction : "");
}

/**
 * Aggregates accounting entries independently by ChainAsset ID. Legacy rows
 * without an asset relation remain segregated by their historical currency
 * label and must be migrated/reconciled before being treated as chain funds.
 */
export function aggregateWalletLedger(rows: WalletLedgerRecord[]): Map<string, AssetLedgerBalance> {
  const totals = new Map<string, AssetLedgerBalance>();
  for (const row of rows) {
    const key = row.chainAssetId ?? "legacy:" + (row.currency || "USDT");
    const current = totals.get(key) ?? { balance: 0n, pendingWithdrawals: 0n };
    const amount = BigInt(row.amountMicro);
    if (row.status === "COMPLETED") {
      if (row.type === "DEPOSIT") current.balance += amount;
      if (row.type === "DEPOSIT_REVERSAL" || row.type === "WITHDRAWAL" || row.type === "NETWORK_FEE") current.balance -= amount;
    }
    if (row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING") {
      current.pendingWithdrawals += amount;
    }
    totals.set(key, current);
  }
  return totals;
}
