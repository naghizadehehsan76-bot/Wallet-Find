/**
 * Minimum external deposit thresholds for Wallet-Find's enabled Polygon assets.
 * Values are atomic units: POL has 18 decimals; USDT0 has 6 decimals.
 * An explicit registry value takes precedence; null uses the safe product default.
 */
export function minimumDepositAtomic(input: {
  chainId: number | null;
  symbol: string;
  decimals: number;
  configuredMinimum?: string | null;
}): bigint {
  if (input.configuredMinimum !== null && input.configuredMinimum !== undefined) {
    const value = input.configuredMinimum.trim();
    if (!/^\d+$/.test(value)) throw new Error("INVALID_MINIMUM_DEPOSIT_CONFIGURATION");
    return BigInt(value);
  }
  if (input.chainId === 137 && input.symbol === "POL" && input.decimals === 18) {
    return 10_000_000_000_000_000n; // 0.01 POL
  }
  if (input.chainId === 137 && input.symbol === "USDT0" && input.decimals === 6) {
    return 10_000n; // 0.01 USDT0
  }
  return 0n;
}

export function meetsMinimumDeposit(input: {
  chainId: number | null;
  symbol: string;
  decimals: number;
  amountAtomic: bigint;
  configuredMinimum?: string | null;
}): boolean {
  return input.amountAtomic >= minimumDepositAtomic(input);
}
