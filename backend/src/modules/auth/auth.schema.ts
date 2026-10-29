import { z } from "zod";

const emailSchema = z.string().trim().email().max(254);
const codeSchema = z.string().trim().regex(/^\d{6}$/);\nconst languageSchema = z.enum(["fa", "en"]).optional();

export const registerSchema = z.object({
  email: emailSchema,
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(100),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(100),
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: codeSchema,
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  password: z.string().min(8).max(100),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
