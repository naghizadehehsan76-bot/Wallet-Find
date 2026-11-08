export type PrizeRankEntry = {
  userId: string;
  rank: number;
  elapsedMs: number;
};

export type PrizeAllocation = {
  userId: string;
  rank: number;
  amountMicro: bigint;
};

const PODIUM_BASIS_POINTS = [5_000n, 2_000n, 1_000n] as const;
const FOURTH_AND_BELOW_BASIS_POINTS = 2_000n;
const BASIS_POINTS_DENOMINATOR = 10_000n;
const WEIGHT_SCALE = 1_000_000_000_000_000_000n;

function distribute(
  total: bigint,
  entries: readonly PrizeRankEntry[],
  weights: readonly bigint[],
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  if (total <= 0n || entries.length === 0) return result;
  if (entries.length !== weights.length || weights.some((weight) => weight <= 0n)) {
    throw new Error("INVALID_PRIZE_DISTRIBUTION_WEIGHTS");
  }

  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
  const remainders: Array<{ userId: string; remainder: bigint }> = [];
  let distributed = 0n;

  entries.forEach((entry, index) => {
    const numerator = total * weights[index]!;
    const amount = numerator / weightTotal;
    result.set(entry.userId, amount);
    distributed += amount;
    remainders.push({ userId: entry.userId, remainder: numerator % weightTotal });
  });

  let leftover = total - distributed;
  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.userId.localeCompare(b.userId);
  });
  for (let index = 0; leftover > 0n; index = (index + 1) % remainders.length) {
    const userId = remainders[index]!.userId;
    result.set(userId, (result.get(userId) ?? 0n) + 1n);
    leftover -= 1n;
  }
  return result;
}

/**
 * Allocates fixed 50% / 20% / 10% shares to ranks 1 / 2 / 3.
 * The remaining 20% is distributed among rank 4+ finishers by inverse
 * server-measured completion time. Missing podium shares remain unused.
 * Exact ties at a podium rank split that rank's fixed share equally.
 */
export function calculatePrizeAllocations(
  poolMicro: bigint,
  rankedEntries: readonly PrizeRankEntry[],
): PrizeAllocation[] {
  if (poolMicro < 0n) throw new Error("INVALID_PRIZE_POOL_AMOUNT");
  const completed = rankedEntries
    .filter((entry) => entry.userId && Number.isInteger(entry.rank) && entry.rank > 0
      && Number.isFinite(entry.elapsedMs) && entry.elapsedMs > 0)
    .slice()
    .sort((a, b) => a.rank - b.rank || a.elapsedMs - b.elapsedMs || a.userId.localeCompare(b.userId));

  if (poolMicro === 0n || completed.length === 0) return [];

  const amounts = new Map<string, bigint>();
  const podiumGroups = new Map<number, PrizeRankEntry[]>();
  for (const entry of completed) {
    if (entry.rank > 3) continue;
    const group = podiumGroups.get(entry.rank) ?? [];
    group.push(entry);
    podiumGroups.set(entry.rank, group);
  }

  for (const [rank, group] of podiumGroups) {
    const basisPoints = PODIUM_BASIS_POINTS[rank - 1];
    if (basisPoints === undefined) continue;
    const share = poolMicro * basisPoints / BASIS_POINTS_DENOMINATOR;
    const equalShares = distribute(share, group, group.map(() => 1n));
    for (const [userId, amount] of equalShares) {
      amounts.set(userId, (amounts.get(userId) ?? 0n) + amount);
    }
  }

  const fourthAndBelow = completed.filter((entry) => entry.rank >= 4);
  if (fourthAndBelow.length > 0) {
    const weightedPool = poolMicro * FOURTH_AND_BELOW_BASIS_POINTS / BASIS_POINTS_DENOMINATOR;
    const weights = fourthAndBelow.map((entry) => WEIGHT_SCALE / BigInt(Math.max(1, Math.trunc(entry.elapsedMs))));
    const weightedShares = distribute(weightedPool, fourthAndBelow, weights);
    for (const [userId, amount] of weightedShares) {
      amounts.set(userId, (amounts.get(userId) ?? 0n) + amount);
    }
  }

  return completed.flatMap((entry) => {
    const amountMicro = amounts.get(entry.userId) ?? 0n;
    return amountMicro > 0n ? [{ userId: entry.userId, rank: entry.rank, amountMicro }] : [];
  });
}
