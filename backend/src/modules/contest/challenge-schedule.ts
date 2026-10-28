import prisma from "../../config/prisma.js";

export const CHALLENGE_INTERVAL_MS = 15 * 60_000;

const CHALLENGE_SCHEDULE_ANCHOR_KEY = "challenge_schedule_anchor_global";
const LEGACY_CHALLENGE_SCHEDULE_ANCHOR_KEYS = [
  "challenge_schedule_anchor_en",
  "challenge_schedule_anchor_fa",
] as const;

export type ChallengeScheduleAnchor = {
  challengeNumber: number;
  startsAt: string;
};

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
 * Persist one shared numbering anchor for both challenge languages.
 *
 * The earliest known started round is challenge #1. Every following 15-minute
 * slot has a stable number, even if a server outage means no row was created
 * for some slots. This makes the number a function of time, not row count.
 * The saved anchor survives restarts and Render sleeping.
 */
export async function getChallengeScheduleAnchor(): Promise<ChallengeScheduleAnchor> {
  const saved = await prisma.systemSetting.findUnique({
    where: { key: CHALLENGE_SCHEDULE_ANCHOR_KEY },
    select: { value: true },
  });
  const savedAnchor = parseAnchor(saved?.value);
  if (savedAnchor) return savedAnchor;

  const now = new Date();
  const [earliestStarted, legacySettings] = await Promise.all([
    prisma.contest.findFirst({
      where: {
        status: { not: "CANCELLED" },
        startsAt: { lte: now },
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      select: { startsAt: true },
    }),
    prisma.systemSetting.findMany({
      where: { key: { in: [...LEGACY_CHALLENGE_SCHEDULE_ANCHOR_KEYS] } },
      select: { value: true },
    }),
  ]);

  const possibleAnchorTimes = [
    earliestStarted?.startsAt?.getTime(),
    ...legacySettings.map((setting) => parseAnchor(setting.value)?.startsAt)
      .map((value) => value ? Date.parse(value) : Number.NaN),
  ].filter((timestamp): timestamp is number =>
    typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp <= now.getTime()
  );

  let anchor: ChallengeScheduleAnchor;
  if (possibleAnchorTimes.length > 0) {
    anchor = {
      challengeNumber: 1,
      startsAt: new Date(Math.min(...possibleAnchorTimes)).toISOString(),
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
      where: { key: CHALLENGE_SCHEDULE_ANCHOR_KEY },
      select: { value: true },
    });
    const latestAnchor = parseAnchor(latest?.value);
    if (latestAnchor) return latestAnchor;
    await prisma.systemSetting.update({
      where: { key: CHALLENGE_SCHEDULE_ANCHOR_KEY },
      data: { value: JSON.stringify(anchor) },
    });
    return anchor;
  }

  try {
    await prisma.systemSetting.create({
      data: { key: CHALLENGE_SCHEDULE_ANCHOR_KEY, value: JSON.stringify(anchor) },
    });
    return anchor;
  } catch (error) {
    // Concurrent startup requests may initialize the shared anchor together.
    // Use the first persisted anchor rather than overwriting it with another.
    const winner = await prisma.systemSetting.findUnique({
      where: { key: CHALLENGE_SCHEDULE_ANCHOR_KEY },
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
  startsAt: Date | string | null | undefined,
): Promise<number> {
  const anchor = await getChallengeScheduleAnchor();
  return challengeNumberAt(startsAt, anchor);
}
