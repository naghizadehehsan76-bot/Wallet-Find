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
          data.publishIntervalMinutes ?? 2,
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

const ADMIN_MICRO = 1_000_000n;
function formatAdminMicro(value: bigint): string {
  const whole = value / ADMIN_MICRO;
  const fraction = (value % ADMIN_MICRO).toString().padStart(6, "0");
  return whole.toString() + "." + fraction;
}

export async function getAdminUsers() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      createdAt: true,
      walletTransactions: { select: { type: true, status: true, amountMicro: true } },
      submissions: {
        select: {
          contestId: true,
          isCorrect: true,
          submittedAt: true,
          clue: { select: { sequence: true } },
          contest: { select: { startsAt: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return users.map((user) => {
    let balance = 0n;
    let pendingWithdrawals = 0n;
    for (const row of user.walletTransactions) {
      const amount = BigInt(row.amountMicro);
      if (row.status === "COMPLETED") {
        if (row.type === "PRIZE_CREDIT" || row.type === "DEPOSIT") balance += amount;
        if (row.type === "WITHDRAWAL") balance -= amount;
      }
      if (row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING") pendingWithdrawals += amount;
    }

    const contests = new Map<string, { startsAt: Date | null; correctBySequence: Map<number, Date> }>();
    for (const submission of user.submissions) {
      let contest = contests.get(submission.contestId);
      if (!contest) {
        contest = { startsAt: submission.contest.startsAt, correctBySequence: new Map<number, Date>() };
        contests.set(submission.contestId, contest);
      }
      if (submission.isCorrect) {
        const sequence = submission.clue.sequence;
        const previous = contest.correctBySequence.get(sequence);
        if (!previous || submission.submittedAt < previous) {
          contest.correctBySequence.set(sequence, submission.submittedAt);
        }
      }
    }

    let bestCompletionTimeMs: number | null = null;
    for (const contest of contests.values()) {
      if (contest.correctBySequence.size < 12 || !contest.startsAt) continue;
      const lastAnswerAt = contest.correctBySequence.get(12);
      if (!lastAnswerAt) continue;
      const duration = lastAnswerAt.getTime() - contest.startsAt.getTime();
      if (duration < 0) continue;
      if (bestCompletionTimeMs === null || duration < bestCompletionTimeMs) bestCompletionTimeMs = duration;
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      walletBalance: formatAdminMicro(balance),
      availableBalance: formatAdminMicro(balance - pendingWithdrawals),
      contestsParticipated: contests.size,
      completedContests: [...contests.values()].filter((contest) => contest.correctBySequence.size >= 12).length,
      bestCompletionTimeMs,
    };
  });
}
