import prisma from "../../config/prisma.js";

export const CHALLENGE_INTERVAL_MS = 15 * 60_000;

export type ChallengeScheduleAnchor = {
  challengeNumber: number;
  startsAt: string;
};

function anchorSettingKey(language: "en" | "fa"): string {
  return `challenge_schedule_anchor_${language}`;
}

function parseAnchor(value: string | undefined): ChallengeScheduleAnchor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const anchor = parsed as Partial<ChallengeScheduleAnchor>;
    const timestamp = typeof anchor.startsAt === "string" ? Date.parse(anchor.startsAt) : Number.NaN;
    if (
      !Number.isSafeInteger(anchor.challengeNumber) ||
      Number(anchor.challengeNumber) < 1 ||
      !Number.isFinite(timestamp)
    ) return null;
    return {
      challengeNumber: Number(anchor.challengeNumber),
      startsAt: new Date(timestamp).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Get a persisted time-based numbering anchor for one language.
 *
 * On the first run after this change, retain the old count-based number for
 * the latest known round, then use elapsed 15-minute slots for all future and
 * historical round numbers. If the database has no started rounds yet, slot
 * the current server time down to its fixed 15-minute boundary and use #1.
 * The saved anchor survives restarts and Render sleeping.
 */
export async function getChallengeScheduleAnchor(
  language: "en" | "fa",
): Promise<ChallengeScheduleAnchor> {
  const key = anchorSettingKey(language);
  const saved = await prisma.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  const savedAnchor = parseAnchor(saved?.value);
  if (savedAnchor) return savedAnchor;

  const now = new Date();
  const latestStarted = await prisma.contest.findFirst({
    where: {
      language,
      status: { not: "CANCELLED" },
      startsAt: { lte: now },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    select: { startsAt: true },
  });

  let anchor: ChallengeScheduleAnchor;
  if (latestStarted?.startsAt) {
    // Preserve the number users currently see before switching the future
    // schedule to a durable clock-based sequence.
    const existingNumber = await prisma.contest.count({
      where: {
        language,
        status: { not: "CANCELLED" },
        startsAt: { lte: latestStarted.startsAt },
      },
    });
    anchor = {
      challengeNumber: Math.max(1, existingNumber),
      startsAt: latestStarted.startsAt.toISOString(),
    };
  } else {
    const currentBoundary = Math.floor(now.getTime() / CHALLENGE_INTERVAL_MS) * CHALLENGE_INTERVAL_MS;
    anchor = {
      challengeNumber: 1,
      startsAt: new Date(currentBoundary).toISOString(),
    };
  }

  try {
    await prisma.systemSetting.create({
      data: { key, value: JSON.stringify(anchor) },
    });
    return anchor;
  } catch (error) {
    // Concurrent startup requests may initialize the same language together.
    // Use the first persisted anchor rather than overwriting it with another.
    const winner = await prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const winnerAnchor = parseAnchor(winner?.value);
    if (winnerAnchor) return winnerAnchor;
    throw error;
  }
}

export function challengeNumberAt(
  startsAt: Date | string | null | undefined,
  anchor: ChallengeScheduleAnchor,
): number {
  if (!startsAt) return anchor.challengeNumber;
  const timestamp = startsAt instanceof Date ? startsAt.getTime() : Date.parse(startsAt);
  const anchorTimestamp = Date.parse(anchor.startsAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(anchorTimestamp)) {
    return anchor.challengeNumber;
  }
  const slots = Math.round((timestamp - anchorTimestamp) / CHALLENGE_INTERVAL_MS);
  return Math.max(1, anchor.challengeNumber + slots);
}

export async function getChallengeNumberAt(
  language: "en" | "fa",
  startsAt: Date | string | null | undefined,
): Promise<number> {
  const anchor = await getChallengeScheduleAnchor(language);
  return challengeNumberAt(startsAt, anchor);
}
