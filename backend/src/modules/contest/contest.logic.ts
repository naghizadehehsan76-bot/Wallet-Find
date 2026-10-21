export const REQUIRED_CLUE_COUNT = 12;

export type SequencedClue = {
  id: string;
  sequence: number;
};

/**
 * A contest is playable only when its twelve unique positions are present.
 * The database has a unique (contestId, sequence) constraint, but this helper
 * also protects lifecycle code from legacy or manually inserted data.
 */
export function hasCompleteClueSequence(
  sequences: readonly number[],
): boolean {
  if (sequences.length !== REQUIRED_CLUE_COUNT) {
    return false;
  }

  const ordered = [...sequences].sort((a, b) => a - b);
  return ordered.every((sequence, index) => sequence === index + 1);
}

/**
 * Normalize common formatting and Arabic/Persian spelling variants without
 * changing the stored answer. This is used only for server-side comparison.
 */
export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Count only a contiguous solved prefix. Any unexpected later solved clue
 * must not make the UI show skipped positions as completed.
 */
export function getContestProgress<T extends SequencedClue>(
  clues: readonly T[],
  solvedClueIds: ReadonlySet<string>,
): {
  solvedCount: number;
  currentClue: T | null;
  completed: boolean;
} {
  const ordered = [...clues].sort((a, b) => a.sequence - b.sequence);
  let solvedCount = 0;

  while (solvedCount < ordered.length) {
    const clue = ordered[solvedCount];
    if (!clue || !solvedClueIds.has(clue.id)) {
      break;
    }
    solvedCount += 1;
  }

  return {
    solvedCount,
    currentClue: ordered[solvedCount] ?? null,
    completed: solvedCount === REQUIRED_CLUE_COUNT,
  };
}

/**
 * The publication schedule is shared by every participant in a contest.
 * Unless an exact publication timestamp was stored, clue 1 begins at the
 * contest start and each later clue follows at the configured interval.
 */
export function calculateCluePublicationTime(
  sequence: number,
  contestStartsAt: Date | null | undefined,
  intervalMinutes: number,
): Date | null {
  if (!contestStartsAt || !Number.isFinite(contestStartsAt.getTime())) {
    return null;
  }

  const safeInterval =
    Number.isFinite(intervalMinutes) && intervalMinutes >= 1
      ? intervalMinutes
      : 2;

  return new Date(
    contestStartsAt.getTime() + Math.max(0, sequence - 1) * safeInterval * 60_000,
  );
}

/**
 * Measure elapsed time from the latest authoritative start timestamp.
 * For an individual clue, pass only that clue's global publication time.
 */
export function calculateResponseTimeMs(
  now: Date,
  referenceTimes: readonly (Date | null | undefined)[],
): number {
  let latestReference = Number.NEGATIVE_INFINITY;

  for (const referenceTime of referenceTimes) {
    if (!referenceTime) continue;

    const timestamp = referenceTime.getTime();
    if (Number.isFinite(timestamp)) {
      latestReference = Math.max(latestReference, timestamp);
    }
  }

  if (!Number.isFinite(latestReference)) {
    return 0;
  }

  return Math.max(0, now.getTime() - latestReference);
}
