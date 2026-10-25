import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS, hasCompleteClueSequence } from "./contest.logic.js";
import { ensureScheduledMvpContest } from "./mvp-contest-seed.service.js";
import { settlePrizePool } from "./prize-pool.service.js";

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

  // Retry any finished round whose prize ledger is still open or missing.
  // Settlement is idempotent; settled pools are excluded from this query.
  const awaitingSettlement = await prisma.contest.findMany({
    where: {
      status: "FINISHED",
      endsAt: { lte: now },
      OR: [
        { prizePool: { is: null } },
        { prizePool: { is: { status: "OPEN" } } },
      ],
    },
    select: { id: true },
  });
  for (const contest of awaitingSettlement) {
    try {
      await settlePrizePool(contest.id);
    } catch (error) {
      console.error("Automatic prize settlement failed; it will be retried.", contest.id, error);
    }
  }

  const nextRound = await ensureScheduledMvpContest(now, "en");
  const nextPersianRound = await ensureScheduledMvpContest(now, "fa");
  return {
    scheduledChecked: scheduled.length,
    settlementsChecked: awaitingSettlement.length,
    nextRound,
    nextPersianRound,
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
