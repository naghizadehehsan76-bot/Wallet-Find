import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS, hasCompleteClueSequence } from "./contest.logic.js";
import { ensureMvpActiveContest, ensureScheduledMvpContest } from "./mvp-contest-seed.service.js";
import { CHALLENGE_LANGUAGES } from "./supported-languages.js";
import { runWithSystemJobLease } from "../system/system-job-lease.service.js";

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

  const languageResults: Record<string, { activeReady: boolean; scheduled: unknown }> = {};
  for (const language of CHALLENGE_LANGUAGES) {
    let activeReady = false;
    try {
      await ensureMvpActiveContest(language);
      activeReady = true;
    } catch (error) {
      console.warn(`The ${language} challenge could not be initialized; scheduler will retry.`, error);
    }
    let scheduledRound: unknown = null;
    try {
      scheduledRound = await ensureScheduledMvpContest(now, language);
    } catch (error) {
      // One unavailable source must never abort scheduling for the remaining languages.
      console.warn(`The ${language} next challenge could not be scheduled; scheduler will retry.`, error);
      scheduledRound = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
      await runWithSystemJobLease("contest-scheduler", () => runContestScheduler(), { leaseMs: 180_000 });
    } catch (error) {
      console.error("Contest scheduler error", error);
    } finally {
      running = false;
    }
  };

  void tick();
  return setInterval(() => { void tick(); }, safeInterval);
}
