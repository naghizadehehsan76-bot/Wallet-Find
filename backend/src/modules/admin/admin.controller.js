import { upsertSystemSettingSchema, updateContestSettingSchema, } from "./admin.schema.js";
import { getSystemSettings, upsertSystemSetting, getContestSettings, updateContestSettings, getAuditLogs, } from "./admin.service.js";
export async function getSystemSettingsHandler(_req, res) {
    const settings = await getSystemSettings();
    return res.json({
        success: true,
        data: settings,
    });
}
export async function upsertSystemSettingHandler(req, res) {
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
export async function getContestSettingsHandler(req, res) {
    const contestId = String(req.params.contestId);
    const settings = await getContestSettings(contestId);
    return res.json({
        success: true,
        data: settings,
    });
}
export async function updateContestSettingsHandler(req, res) {
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
        const settings = await updateContestSettings(contestId, parsed.data, req.user?.userId);
        return res.json({
            success: true,
            data: settings,
        });
    }
    catch {
        return res.status(404).json({
            success: false,
            error: "CONTEST_NOT_FOUND",
        });
    }
}
export async function getAuditLogsHandler(_req, res) {
    const logs = await getAuditLogs();
    return res.json({
        success: true,
        data: logs,
    });
}
//# sourceMappingURL=admin.controller.js.map