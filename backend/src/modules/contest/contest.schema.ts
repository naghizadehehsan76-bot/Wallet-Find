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