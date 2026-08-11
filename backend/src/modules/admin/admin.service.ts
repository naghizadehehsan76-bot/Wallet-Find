import prisma from "../../config/prisma.js";

import type {
  UpsertSystemSettingInput,
  UpdateContestSettingInput,
} from "./admin.schema.js";

export async function getSystemSettings() {
  return prisma.systemSetting.findMany({
    orderBy: {
      key: "asc",
    },
  });
}

export async function upsertSystemSetting(
  data: UpsertSystemSettingInput,
  userId?: string
) {
  const setting = await prisma.systemSetting.upsert({
    where: {
      key: data.key,
    },
    update: {
      value: data.value,
    },
    create: {
      key: data.key,
      value: data.value,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: userId ?? null,
      action: "SYSTEM_SETTING_UPDATED",
      entity: "SystemSetting",
      entityId: setting.key,
      metadata: {
        key: setting.key,
      },
    },
  });

  return setting;
}

export async function getContestSettings(
  contestId: string
) {
  return prisma.contestSetting.findUnique({
    where: {
      contestId,
    },
  });
}

export async function updateContestSettings(
  contestId: string,
  data: UpdateContestSettingInput,
  userId?: string
) {
  const existingContest =
    await prisma.contest.findUnique({
      where: {
        id: contestId,
      },
      select: {
        id: true,
      },
    });

  if (!existingContest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  const updateData: Record<string, unknown> = {};

  if (data.clueCount !== undefined) {
    updateData.clueCount = data.clueCount;
  }

  if (data.publishIntervalMinutes !== undefined) {
    updateData.publishIntervalMinutes =
      data.publishIntervalMinutes;
  }

  if (data.firstPrizePercent !== undefined) {
    updateData.firstPrizePercent =
      data.firstPrizePercent;
  }

  if (data.secondPrizePercent !== undefined) {
    updateData.secondPrizePercent =
      data.secondPrizePercent;
  }

  if (data.thirdPrizePercent !== undefined) {
    updateData.thirdPrizePercent =
      data.thirdPrizePercent;
  }

  if (data.maxParticipants !== undefined) {
    updateData.maxParticipants =
      data.maxParticipants;
  }

  const setting =
    await prisma.contestSetting.upsert({
      where: {
        contestId,
      },
      update: updateData,
      create: {
        contestId,
        clueCount: data.clueCount ?? 12,
        publishIntervalMinutes:
          data.publishIntervalMinutes ?? 15,
        firstPrizePercent:
          data.firstPrizePercent ?? 70,
        secondPrizePercent:
          data.secondPrizePercent ?? 20,
        thirdPrizePercent:
          data.thirdPrizePercent ?? 10,
        maxParticipants:
          data.maxParticipants ?? null,
      },
    });

  await prisma.auditLog.create({
    data: {
      userId: userId ?? null,
      action: "CONTEST_SETTING_UPDATED",
      entity: "ContestSetting",
      entityId: setting.id,
      metadata: {
        contestId,
      },
    },
  });

  return setting;
}

export async function getAuditLogs(
  limit = 100
) {
  return prisma.auditLog.findMany({
    take: limit,
    orderBy: {
      createdAt: "desc",
    },
  });
}