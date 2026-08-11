import { z } from "zod";
export declare const upsertSystemSettingSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodString;
}, z.core.$strip>;
export declare const updateContestSettingSchema: z.ZodObject<{
    clueCount: z.ZodOptional<z.ZodNumber>;
    publishIntervalMinutes: z.ZodOptional<z.ZodNumber>;
    firstPrizePercent: z.ZodOptional<z.ZodNumber>;
    secondPrizePercent: z.ZodOptional<z.ZodNumber>;
    thirdPrizePercent: z.ZodOptional<z.ZodNumber>;
    maxParticipants: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>;
export type UpsertSystemSettingInput = z.infer<typeof upsertSystemSettingSchema>;
export type UpdateContestSettingInput = z.infer<typeof updateContestSettingSchema>;
//# sourceMappingURL=admin.schema.d.ts.map