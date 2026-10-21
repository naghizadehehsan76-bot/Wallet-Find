import prisma from "../../config/prisma.js";
import { calculateCluePublishedAt, hasCompleteClueSequence } from "../contest/contest.logic.js";

export async function activateContest(
  contestId: string,
  userId?: string,
) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  if (contest.status === "ACTIVE") {
    throw new Error("CONTEST_ALREADY_ACTIVE");
  }

  if (contest.status === "FINISHED" || contest.status === "CANCELLED") {
    throw new Error("CONTEST_CANNOT_BE_ACTIVATED");
  }

  const now = new Date();

  if (contest.startsAt && now < contest.startsAt) {
    throw new Error("CONTEST_SCHEDULED_FOR_FUTURE");
  }

  if (contest.endsAt && now >= contest.endsAt) {
    throw new Error("CONTEST_END_ALREADY_PASSED");
  }

  const clues = await prisma.contestClue.findMany({
    where: { contestId },
    select: { id: true, sequence: true },
    orderBy: { sequence: "asc" },
  });

  if (!hasCompleteClueSequence(clues.map((clue) => clue.sequence))) {
    throw new Error(
      clues.length === 12
        ? "CONTEST_CLUES_MUST_BE_SEQUENTIAL"
        : "CONTEST_REQUIRES_12_CLUES",
    );
  }

  const existingActive = await prisma.contest.findFirst({
    where: {
      status: "ACTIVE",
      id: { not: contestId },
    },
    select: { id: true },
  });

  if (existingActive) {
    throw new Error("ANOTHER_CONTEST_ALREADY_ACTIVE");
  }

  const clueCount = clues.length;
  const startsAt = contest.startsAt ?? now;
  const setting = await prisma.contestSetting.findUnique({
    where: { contestId },
    select: { publishIntervalMinutes: true },
  });
  const intervalMinutes = setting?.publishIntervalMinutes ?? 2;

  // Manual activation uses the same shared publication schedule as the
  // automatic scheduler. Every participant therefore gets the same start time
  // for each clue, regardless of when they solved the previous clue.
  await Promise.all(
    clues.map((clue) => {
      const publishedAt = calculateCluePublishedAt(
        clue.sequence,
        startsAt,
        intervalMinutes,
      );

      if (!publishedAt) {
        throw new Error("CLUE_PUBLICATION_TIME_MISSING");
      }

      return prisma.contestClue.update({
        where: { id: clue.id },
        data: { publishedAt },
      });
    }),
  );

  const updated = await prisma.contest.update({
    where: { id: contestId },
    data: {
      status: "ACTIVE",
      startsAt,
    },
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: userId ?? null,
      action: "CONTEST_ACTIVATED",
      entity: "Contest",
      entityId: contestId,
      metadata: { clueCount },
    },
  });

  return updated;
}

export async function finishContest(
  contestId: string,
  userId?: string,
) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: {
      id: true,
      status: true,
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  if (contest.status !== "ACTIVE") {
    throw new Error("CONTEST_NOT_ACTIVE");
  }

  const updated = await prisma.contest.update({
    where: { id: contestId },
    data: {
      status: "FINISHED",
    },
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: userId ?? null,
      action: "CONTEST_FINISHED",
      entity: "Contest",
      entityId: contestId,
      metadata: {},
    },
  });

  return updated;
}
