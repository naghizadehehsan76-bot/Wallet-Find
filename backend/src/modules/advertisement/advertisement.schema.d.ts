import { z } from "zod";
export declare const createAdvertisementSchema: z.ZodObject<{
    type: z.ZodEnum<{
        AUDIO: "AUDIO";
        FILE: "FILE";
        IMAGE: "IMAGE";
        LINK: "LINK";
        PDF: "PDF";
        TEXT: "TEXT";
        VIDEO: "VIDEO";
    }>;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    textContent: z.ZodOptional<z.ZodString>;
    fileName: z.ZodOptional<z.ZodString>;
    filePath: z.ZodOptional<z.ZodString>;
    mimeType: z.ZodOptional<z.ZodString>;
    contestId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateAdvertisementInput = z.infer<typeof createAdvertisementSchema>;
//# sourceMappingURL=advertisement.schema.d.ts.map