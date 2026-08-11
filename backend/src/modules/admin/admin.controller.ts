import type { Response } from "express";

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
} from "./admin.service.js";

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
  const parsed =
    upsertSystemSettingSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  const setting = await upsertSystemSetting(
    parsed.data,
    req.user?.userId
  );

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

  const settings =
    await getContestSettings(contestId);

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

  const parsed =
    updateContestSettingSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  try {
    const settings =
      await updateContestSettings(
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

  return res.json({
    success: true,
    data: logs,
  });
}