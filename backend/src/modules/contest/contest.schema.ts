import { z } from "zod";

export const createContestSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "Title must be at least 3 characters")
      .max(200),

    description: z
      .string()
      .trim()
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
  })
  .superRefine((data, context) => {
    if (
      data.startsAt &&
      data.endsAt &&
      new Date(data.endsAt).getTime() <= new Date(data.startsAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "END_TIME_MUST_BE_AFTER_START_TIME",
      });
    }
  });

export type CreateContestInput =
  z.infer<typeof createContestSchema>;

export const createClueSchema = z.object({
  sequence: z
    .number()
    .int()
    .min(1)
    .max(12),

  content: z
    .string()
    .trim()
    .min(1)
    .max(10_000),

  correctAnswer: z
    .string()
    .trim()
    .min(1)
    .max(2_000),

  sourceUrl: z
    .string()
    .trim()
    .url()
    .max(2_000),

  hintAnchor: z
    .string()
    .trim()
    .min(25, "HINT_ANCHOR_TOO_SHORT")
    .max(1_000),

  type: z
    .enum([
      "TEXT",
      "IMAGE",
      "PDF",
      "AUDIO",
      "VIDEO",
      "WEB_PAGE",
    ])
    .default("TEXT"),
});

export type CreateClueInput =
  z.infer<typeof createClueSchema>;

export const submitAnswerSchema = z.object({
  clueId: z
    .string()
    .min(1),

  answer: z
    .string()
    .trim()
    .min(1)
    .max(2000),
});

export type SubmitAnswerInput =
  z.infer<typeof submitAnswerSchema>;