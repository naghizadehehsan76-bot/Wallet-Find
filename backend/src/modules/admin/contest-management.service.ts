import prisma from "../../config/prisma.js";

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

  const clueCount = await prisma.contestClue.count({
    where: { contestId },
  });

  if (clueCount !== 12) {
    throw new Error("CONTEST_REQUIRES_12_CLUES");
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

  const now = new Date();

  if (contest.endsAt && now >= contest.endsAt) {
    throw new Error("CONTEST_END_ALREADY_PASSED");
  }

  const updated = await prisma.contest.update({
    where: { id: contestId },
    data: {
      status: "ACTIVE",
      startsAt: contest.startsAt ?? now,
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
      metadata: null,
    },
  });

  return updated;
}
