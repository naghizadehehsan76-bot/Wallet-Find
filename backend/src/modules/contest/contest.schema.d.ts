import { z } from "zod";
export declare const createContestSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    startsAt: z.ZodOptional<z.ZodString>;
    endsAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateContestInput = z.infer<typeof createContestSchema>;
export declare const createClueSchema: z.ZodObject<{
    sequence: z.ZodNumber;
    content: z.ZodString;
    correctAnswer: z.ZodString;
    type: z.ZodDefault<z.ZodEnum<{
        AUDIO: "AUDIO";
        IMAGE: "IMAGE";
        PDF: "PDF";
        TEXT: "TEXT";
        VIDEO: "VIDEO";
        WEB_PAGE: "WEB_PAGE";
    }>>;
}, z.core.$strip>;
export type CreateClueInput = z.infer<typeof createClueSchema>;
export declare const submitAnswerSchema: z.ZodObject<{
    clueId: z.ZodString;
    answer: z.ZodString;
}, z.core.$strip>;
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
//# sourceMappingURL=contest.schema.d.ts.map