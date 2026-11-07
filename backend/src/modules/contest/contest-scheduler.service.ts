import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS, hasCompleteClueSequence } from "./contest.logic.js";
import { ensureMvpActiveContest, ensureScheduledMvpContest } from "./mvp-contest-seed.service.js";
import { CHALLENGE_LANGUAGES } from "./supported-languages.js";
import { reserveRoundPrizeAllocation, settlePrizePool } from "./prize-pool.service.js";

/**
 * The scheduler manages round activation/expiry only. Clues are no longer
 * released on a global interval: each participant sees the next clue as soon
 * as their previous answer is accepted as correct.
 */
export async function runContestScheduler(now = new Date()) {
  const scheduled = await prisma.contest.findMany({
    where: { status: "SCHEDULED" },
    select: { id: true, language: true, startsAt: true, endsAt: true },
  });

  for (const contest of scheduled) {
    if (!contest.startsAt || now < contest.startsAt) continue;
    const endsAt = contest.endsAt ?? new Date(contest.startsAt.getTime() + CONTEST_DURATION_MS);
    if (now >= endsAt) {
      await prisma.contest.update({ where: { id: contest.id }, data: { status: "FINISHED", endsAt } });
      continue;
    }

    const clueSequences = await prisma.contestClue.findMany({
      where: { contestId: contest.id },
      select: { sequence: true },
      orderBy: { sequence: "asc" },
    });
    if (!hasCompleteClueSequence(clueSequences.map((clue) => clue.sequence))) continue;

    const anotherActive = await prisma.contest.findFirst({
      where: {
        status: "ACTIVE",
        language: contest.language,
        id: { not: contest.id },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (anotherActive) continue;

    await prisma.contest.update({ where: { id: contest.id }, data: { status: "ACTIVE", endsAt } });
    await prisma.auditLog.create({
      data: {
        action: "CONTEST_AUTO_ACTIVATED",
        entity: "Contest",
        entityId: contest.id,
        metadata: { scheduledAt: contest.startsAt, endsAt },
      },
    });
  }

  const active = await prisma.contest.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, startsAt: true, endsAt: true },
  });

  for (const contest of active) {
    if (!contest.startsAt) continue;
    const endsAt = contest.endsAt ?? new Date(contest.startsAt.getTime() + CONTEST_DURATION_MS);
    if (now < endsAt) {
      if (!contest.endsAt) {
        await prisma.contest.update({ where: { id: contest.id }, data: { endsAt } });
      }
      continue;
    }

    await prisma.contest.update({ where: { id: contest.id }, data: { status: "FINISHED", endsAt } });
    await prisma.auditLog.create({
      data: {
        action: "CONTEST_AUTO_FINISHED",
        entity: "Contest",
        entityId: contest.id,
        metadata: { finishedAt: now, endsAt },
      },
    });
  }

  // Reserve each active round's fixed allocation exactly once. A zero fund
  // creates a zero-value pool and cannot produce a payable award.
  const activeForAllocation = await prisma.contest.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  for (const contest of activeForAllocation) {
    try {
      await reserveRoundPrizeAllocation(contest.id, now);
    } catch (error) {
      console.error("Round prize allocation could not be reserved", { contestId: contest.id, error });
    }
  }

  // Settle only finished rounds that actually reserved real funds. Historical
  // zero-value pools are deliberately left untouched.
  const fundedFinished = await prisma.contest.findMany({
    where: {
      status: "FINISHED",
      prizePool: { is: { seededMicro: { gt: 0n }, status: "OPEN" } },
    },
    select: { id: true },
    take: 100,
  });
  for (const contest of fundedFinished) {
    try {
      await settlePrizePool(contest.id, null);
    } catch (error) {
      console.error("Finished round prize settlement failed", { contestId: contest.id, error });
    }
  }

  const languageResults: Record<string, { activeReady: boolean; scheduled: unknown }> = {};
  for (const language of CHALLENGE_LANGUAGES) {
    let activeReady = false;
    try {
      await ensureMvpActiveContest(language);
      activeReady = true;
    } catch (error) {
      console.warn(`The ${language} challenge could not be initialized; scheduler will retry.`, error);
    }
    const scheduledRound = await ensureScheduledMvpContest(now, language);
    languageResults[language] = { activeReady, scheduled: scheduledRound };
  }

  return {
    scheduledChecked: scheduled.length,
    languageResults,
    now: now.toISOString(),
  };
}

export function startContestScheduler() {
  const intervalMs = Number.parseInt(process.env.CONTEST_SCHEDULER_INTERVAL_MS ?? "10000", 10);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs >= 5_000 ? intervalMs : 10_000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runContestScheduler();
    } catch (error) {
      console.error("Contest scheduler error", error);
    } finally {
      running = false;
    }
  };

  void tick();
  return setInterval(() => { void tick(); }, safeInterval);
}
