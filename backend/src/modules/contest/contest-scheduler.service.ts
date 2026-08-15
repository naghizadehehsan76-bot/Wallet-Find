import prisma from "../../config/prisma.js";

const DEFAULT_PUBLISH_INTERVAL_MINUTES = 15;

function getIntervalMinutes(value: number | null | undefined): number {
  if (!value || value < 1) {
    return DEFAULT_PUBLISH_INTERVAL_MINUTES;
  }

  return value;
}

async function scheduleContestClues(contestId: string, startsAt: Date) {
  const setting = await prisma.contestSetting.findUnique({
    where: { contestId },
    select: { publishIntervalMinutes: true },
  });

  const intervalMinutes = getIntervalMinutes(
    setting?.publishIntervalMinutes,
  );

  const clues = await prisma.contestClue.findMany({
    where: { contestId },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, publishedAt: true },
  });

  if (clues.length === 0) {
    throw new Error("CONTEST_REQUIRES_CLUES");
  }

  for (const clue of clues) {
    const publishedAt =
      clue.sequence === 1
        ? startsAt
        : new Date(
            startsAt.getTime() +
              (clue.sequence - 1) * intervalMinutes * 60_000,
          );

    if (
      !clue.publishedAt ||
      clue.publishedAt.getTime() !== publishedAt.getTime()
    ) {
      await prisma.contestClue.update({
        where: { id: clue.id },
        data: { publishedAt },
      });
    }
  }
}

export async function runContestScheduler(now = new Date()) {
  const scheduled = await prisma.contest.findMany({
    where: { status: "SCHEDULED" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
    },
  });

  for (const contest of scheduled) {
    if (!contest.startsAt || now < contest.startsAt) {
      continue;
    }

    if (contest.endsAt && now >= contest.endsAt) {
      await prisma.contest.update({
        where: { id: contest.id },
        data: { status: "FINISHED" },
      });

      continue;
    }

    const clueCount = await prisma.contestClue.count({
      where: { contestId: contest.id },
    });

    if (clueCount !== 12) {
      continue;
    }

    const anotherActive = await prisma.contest.findFirst({
      where: {
        status: "ACTIVE",
        id: { not: contest.id },
      },
      select: { id: true },
    });

    if (anotherActive) {
      continue;
    }

    await scheduleContestClues(contest.id, contest.startsAt);

    await prisma.contest.update({
      where: { id: contest.id },
      data: { status: "ACTIVE" },
    });

    await prisma.auditLog.create({
      data: {
        action: "CONTEST_AUTO_ACTIVATED",
        entity: "Contest",
        entityId: contest.id,
        metadata: { scheduledAt: contest.startsAt },
      },
    });
  }

  const active = await prisma.contest.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      endsAt: true,
    },
  });

  for (const contest of active) {
    if (!contest.endsAt || now < contest.endsAt) {
      continue;
    }

    await prisma.contest.update({
      where: { id: contest.id },
      data: { status: "FINISHED" },
    });

    await prisma.auditLog.create({
      data: {
        action: "CONTEST_AUTO_FINISHED",
        entity: "Contest",
        entityId: contest.id,
        metadata: { finishedAt: now },
      },
    });
  }

  return {
    scheduledChecked: scheduled.length,
    now: now.toISOString(),
  };
}

export function startContestScheduler() {
  const intervalMs = Number.parseInt(
    process.env.CONTEST_SCHEDULER_INTERVAL_MS ?? "30000",
    10,
  );

  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs >= 5_000
      ? intervalMs
      : 30_000;

  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

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

  return setInterval(() => {
    void tick();
  }, safeInterval);
}
