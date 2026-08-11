import type { UpsertSystemSettingInput, UpdateContestSettingInput } from "./admin.schema.js";
export declare function getSystemSettings(): Promise<{
    key: string;
    value: string;
    createdAt: Date;
    updatedAt: Date;
}[]>;
export declare function upsertSystemSetting(data: UpsertSystemSettingInput, userId?: string): Promise<{
    key: string;
    value: string;
    createdAt: Date;
    updatedAt: Date;
}>;
export declare function getContestSettings(contestId: string): Promise<{
    id: string;
    contestId: string;
    clueCount: number;
    publishIntervalMinutes: number;
    firstPrizePercent: number;
    secondPrizePercent: number;
    thirdPrizePercent: number;
    maxParticipants: number | null;
    createdAt: Date;
    updatedAt: Date;
} | null>;
export declare function updateContestSettings(contestId: string, data: UpdateContestSettingInput, userId?: string): Promise<{
    id: string;
    contestId: string;
    clueCount: number;
    publishIntervalMinutes: number;
    firstPrizePercent: number;
    secondPrizePercent: number;
    thirdPrizePercent: number;
    maxParticipants: number | null;
    createdAt: Date;
    updatedAt: Date;
}>;
export declare function getAuditLogs(limit?: number): Promise<{
    id: string;
    userId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    metadata: import("@prisma/client/runtime/client").JsonValue | null;
    createdAt: Date;
}[]>;
//# sourceMappingURL=admin.service.d.ts.map