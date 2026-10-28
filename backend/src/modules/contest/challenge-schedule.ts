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
 * On the first run, use the earliest known started round as challenge #1.
 * From that fixed date, every 15-minute time slot has a stable number, even if
 * a server outage means no database row was created for some slots. If there
 * are no started rounds yet, use the current fixed 15-minute boundary as #1.
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
  const earliestStarted = await prisma.contest.findFirst({
    where: {
      language,
      status: { not: "CANCELLED" },
      startsAt: { lte: now },
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    select: { startsAt: true },
  });

  let anchor: ChallengeScheduleAnchor;
  if (earliestStarted?.startsAt) {
    anchor = {
      challengeNumber: 1,
      startsAt: earliestStarted.startsAt.toISOString(),
    };
  } else {
    const currentBoundary = Math.floor(now.getTime() / CHALLENGE_INTERVAL_MS) * CHALLENGE_INTERVAL_MS;
    anchor = {
      challengeNumber: 1,
      startsAt: new Date(currentBoundary).toISOString(),
    };
  }

  if (saved) {
    // Repair a malformed internal setting rather than making challenge loading fail.
    const latest = await prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const latestAnchor = parseAnchor(latest?.value);
    if (latestAnchor) return latestAnchor;
    await prisma.systemSetting.update({
      where: { key },
      data: { value: JSON.stringify(anchor) },
    });
    return anchor;
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
