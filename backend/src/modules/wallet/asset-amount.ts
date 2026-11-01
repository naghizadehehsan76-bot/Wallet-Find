/**
 * Exact asset-unit conversion helpers.
 *
 * These functions intentionally accept decimal strings instead of JavaScript
 * numbers. Token amounts must never pass through floating-point arithmetic.
 * The returned bigint is the asset's smallest on-chain unit (not a fixed
 * six-decimal "micro" unit).
 */

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("INVALID_ASSET_DECIMALS");
  }
}

function scaleFor(decimals: number): bigint {
  assertDecimals(decimals);
  return 10n ** BigInt(decimals);
}

/**
 * Convert a human-readable decimal amount into the asset's smallest unit.
 * Examples: parseAssetUnits("1.25", 6) => 1250000n;
 *           parseAssetUnits("1.000000000000000001", 18) => 1000000000000000001n.
 */
export function parseAssetUnits(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (typeof value !== "string") throw new TypeError("ASSET_AMOUNT_MUST_BE_STRING");

  const input = value.trim();
  if (!input || input.length > 512 || !/^\d+(?:\.\d+)?$/.test(input)) {
    throw new Error("INVALID_ASSET_AMOUNT");
  }

  const [wholePart, fractionPart = ""] = input.split(".");
  if (fractionPart.length > decimals) {
    throw new Error("ASSET_AMOUNT_PRECISION_EXCEEDED");
  }

  const scale = scaleFor(decimals);
  const whole = BigInt(wholePart!);
  const fraction = fractionPart.length === 0
    ? 0n
    : BigInt(fractionPart.padEnd(decimals, "0"));

  return whole * scale + fraction;
}

/**
 * Format an amount in the asset's smallest unit without losing precision.
 * Trailing fractional zeroes are removed; negative values are supported for
 * ledger reversals and reconciliation differences.
 */
export function formatAssetUnits(amount: bigint, decimals: number): string {
  const scale = scaleFor(decimals);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;

  if (decimals === 0) return (negative ? "-" : "") + absolute.toString();

  const padded = absolute.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  const result = fraction ? `${whole}.${fraction}` : whole;

  return (negative ? "-" : "") + result;
}
