import { z } from "zod";

export const createContestSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(200),

  description: z
    .string()
    .max(2000)
    .optional(),

  startsAt: z
    .string()
    .datetime()
    .optional(),

  endsAt: z
    .string()
    .datetime()
    .optional(),
});

export type CreateContestInput =
  z.infer<typeof createContestSchema>;
  export const createClueSchema = z.object({
  contestId: z.string().min(1),

  sequence: z.number().int().min(1).max(12),

  content: z.string().min(1),

  correctAnswer: z.string().min(1),

  type: z.enum([
    "TEXT",
    "IMAGE",
    "PDF",
    "AUDIO",
    "VIDEO",
    "WEB_PAGE",
  ]).default("TEXT"),
});

export type CreateClueInput =
  z.infer<typeof createClueSchema>;