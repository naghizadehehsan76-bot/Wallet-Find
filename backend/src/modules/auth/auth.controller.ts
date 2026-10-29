import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import {
  loginSchema,
  registerSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.schema.js";
import {
  loginUser,
  registerUser,
  verifyEmail,
  resendVerification,
  requestPasswordReset,
  resetPassword as resetUserPassword,
} from "./auth.service.js";

function sendInputError(res: Response, details: unknown) {
  return res.status(400).json({ success: false, error: "INVALID_INPUT", details });
}

function sendAuthError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "EMAIL_OR_USERNAME_ALREADY_EXISTS") {
    return res.status(409).json({ success: false, error: message });
  }
  if (message === "EMAIL_NOT_REGISTERED" || message === "INVALID_PASSWORD") {
    return res.status(401).json({ success: false, error: message });
  }
  if (message === "EMAIL_NOT_VERIFIED") {
    return res.status(403).json({ success: false, error: message });
  }
  if (message === "INVALID_OR_EXPIRED_CODE" || message === "CODE_TOO_MANY_ATTEMPTS" ||
      message === "CODE_RESEND_TOO_SOON" || message === "CODE_RESEND_LIMIT") {
    return res.status(400).json({ success: false, error: message });
  }
  if (message === "EMAIL_SEND_FAILED" || message === "EMAIL_PROVIDER_NOT_CONFIGURED") {
    return res.status(503).json({ success: false, error: "EMAIL_SEND_FAILED" });
  }
  console.error("Authentication request failed", message || "unknown error");
  return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
}

export async function register(req: AuthenticatedRequest, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return sendInputError(res, parsed.error.flatten());
  try {
    const result = await registerUser(parsed.data);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return sendAuthError(res, error);
  }
}

export async function login(req: AuthenticatedRequest, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return sendInputError(res, parsed.error.flatten());
  try {
    const result = await loginUser(parsed.data);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return sendAuthError(res, error);
  }
}

export async function verifyEmailCode(req: AuthenticatedRequest, res: Response) {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) return sendInputError(res, parsed.error.flatten());
  try {
    const result = await verifyEmail(parsed.data);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return sendAuthError(res, error);
  }
}

export async function resendVerificationCode(req: AuthenticatedRequest, res: Response) {
  const parsed = resendVerificationSchema.safeParse(req.body);
  if (!parsed.success) return sendInputError(res, parsed.error.flatten());
  try {
    await resendVerification(parsed.data);
    return res.status(200).json({ success: true, data: { requested: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "CODE_RESEND_TOO_SOON" || message === "CODE_RESEND_LIMIT" ||
        message === "EMAIL_SEND_FAILED" || message === "EMAIL_PROVIDER_NOT_CONFIGURED") {
      // Keep the response identical for known, unknown, throttled, and failed addresses.
      return res.status(200).json({ success: true, data: { requested: true } });
    }
    return sendAuthError(res, error);
  }
}

export async function forgotPassword(req: AuthenticatedRequest, res: Response) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return sendInputError(res, parsed.error.flatten());
  try {
    await requestPasswordReset(parsed.data);
    // Deliberately identical whether or not the email exists.
    return res.status(200).json({ success: true, data: { requested: true } });
  } catch (error) {
    return sendAuthError(res, error);
  }
}

export async function resetPassword(req: AuthenticatedRequest, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return sendInputError(res, parsed.error.flatten());
  try {
    const result = await resetUserPassword(parsed.data);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return sendAuthError(res, error);
  }
}

export async function me(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  }

  try {
    const user = await import("../../config/prisma.js").then(({ default: prisma }) =>
      prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );

    if (!user) {
      return res.status(401).json({ success: false, error: "USER_NOT_FOUND" });
    }
    return res.status(200).json({ success: true, data: { user } });
  } catch (error) {
    console.error("Could not load authenticated user", error instanceof Error ? error.message : "unknown error");
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}
