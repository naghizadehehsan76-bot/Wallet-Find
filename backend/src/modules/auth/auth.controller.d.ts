import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
export declare function register(req: AuthenticatedRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function login(req: AuthenticatedRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function me(req: AuthenticatedRequest, res: Response): Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=auth.controller.d.ts.map