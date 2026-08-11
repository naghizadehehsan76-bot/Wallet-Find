import { z } from "zod";
export const upsertSystemSettingSchema = z.object({
    key: z
        .string()
        .min(1)
        .max(100),
    value: z
        .string()
        .min(1)
        .max(10000),
});
export const updateContestSettingSchema = z.object({
    clueCount: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional(),
    publishIntervalMinutes: z
        .number()
        .int()
        .min(1)
        .max(1440)
        .optional(),
    firstPrizePercent: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional(),
    secondPrizePercent: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional(),
    thirdPrizePercent: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional(),
    maxParticipants: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional(),
});
//# sourceMappingURL=admin.schema.js.map