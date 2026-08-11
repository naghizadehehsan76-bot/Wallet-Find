import { z } from "zod";
export const createAdvertisementSchema = z.object({
    type: z.enum([
        "TEXT",
        "LINK",
        "FILE",
        "IMAGE",
        "PDF",
        "AUDIO",
        "VIDEO",
    ]),
    title: z
        .string()
        .min(3, "Title must be at least 3 characters")
        .max(200)
        .optional(),
    description: z
        .string()
        .max(2000)
        .optional(),
    url: z
        .string()
        .url()
        .optional(),
    textContent: z
        .string()
        .max(10000)
        .optional(),
    fileName: z
        .string()
        .max(255)
        .optional(),
    filePath: z
        .string()
        .max(1000)
        .optional(),
    mimeType: z
        .string()
        .max(200)
        .optional(),
    contestId: z
        .string()
        .optional(),
});
//# sourceMappingURL=advertisement.schema.js.map