import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
export declare function getSystemSettingsHandler(_req: AuthenticatedRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function upsertSystemSettingHandler(req: AuthenticatedRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getContestSettingsHandler(req: AuthenticatedRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateContestSettingsHandler(req: AuthenticatedRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getAuditLogsHandler(_req: AuthenticatedRequest, res: Response): Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=admin.controller.d.ts.map