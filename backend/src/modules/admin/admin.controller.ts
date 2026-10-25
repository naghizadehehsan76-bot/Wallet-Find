import type { Response } from "express";
import prisma from "../../config/prisma.js";

import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";

import {
  upsertSystemSettingSchema,
  updateContestSettingSchema,
} from "./admin.schema.js";

import {
  getSystemSettings,
  upsertSystemSetting,
  getContestSettings,
  updateContestSettings,
  getAuditLogs,
  getAdminUsers,
} from "./admin.service.js";

export async function getAdminOverviewHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  const [
    users,
    contests,
    activeContests,
    submissions,
    advertiserOrders,
    pendingAdPayments,
    recentAuditLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.contest.count(),
    prisma.contest.count({ where: { status: "ACTIVE" } }),
    prisma.submission.count(),
    prisma.advertisementOrder.count(),
    prisma.advertisementPayment.count({ where: { status: "PENDING" } }),
    prisma.auditLog.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { username: true, email: true } } },
    }),
  ]);

  return res.json({
    success: true,
    data: {
      users,
      contests,
      activeContests,
      submissions,
      advertiserOrders,
      pendingAdPayments,
      recentAuditLogs,
      generatedAt: new Date().toISOString(),
      note: "Statistics are read-only summaries of current database records.",
    },
  });
}

export async function getSystemSettingsHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  const settings = await getSystemSettings();

  return res.json({
    success: true,
    data: settings,
  });
}

export async function upsertSystemSettingHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  const parsed = upsertSystemSettingSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  const setting = await upsertSystemSetting(parsed.data, req.user?.userId);

  return res.json({
    success: true,
    data: setting,
  });
}

export async function getContestSettingsHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  const contestId = String(req.params.contestId);
  const settings = await getContestSettings(contestId);

  return res.json({
    success: true,
    data: settings,
  });
}

export async function updateContestSettingsHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  const contestId = String(req.params.contestId);
  const parsed = updateContestSettingSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  try {
    const settings = await updateContestSettings(
      contestId,
      parsed.data,
      req.user?.userId
    );

    return res.json({
      success: true,
      data: settings,
    });
  } catch {
    return res.status(404).json({
      success: false,
      error: "CONTEST_NOT_FOUND",
    });
  }
}

export async function getAuditLogsHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  const logs = await getAuditLogs();
  return res.json({ success: true, data: logs });
}

export async function getAdminUsersHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  try {
    const users = await getAdminUsers();
    return res.json({ success: true, data: users });
  } catch (error) {
    console.error("Admin user listing failed", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}
