import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import {
  loginSchema,
  registerSchema,
} from "./auth.schema.js";
import { z } from "zod";
import { requestEmailLoginCode, verifyEmailLoginCode } from "./email-code.service.js";

const loginCodeRequestSchema = z.object({ email: z.string().trim().email() });
const loginCodeVerifySchema = z.object({ email: z.string().trim().email(), code: z.string().regex(/^\d{6}$/) });
import {
  loginUser,
  registerUser,
} from "./auth.service.js";

export async function register(
  req: AuthenticatedRequest,
  res: Response
) {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await registerUser(parsed.data);

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "EMAIL_OR_USERNAME_ALREADY_EXISTS"
    ) {
      return res.status(409).json({
        success: false,
        error: error.message,
      });
    }

    console.error(error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function login(
  req: AuthenticatedRequest,
  res: Response
) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await loginUser(parsed.data);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "EMAIL_NOT_REGISTERED" ||
        error.message === "INVALID_PASSWORD")
    ) {
      return res.status(401).json({
        success: false,
        error: error.message,
      });
    }

    console.error(error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}

export async function requestLoginCode(
  req: AuthenticatedRequest,
  res: Response
) {
  const parsed = loginCodeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "INVALID_INPUT" });
  }
  try {
    const result = await requestEmailLoginCode(parsed.data.email);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_DELIVERY_NOT_CONFIGURED") {
      return res.status(503).json({ success: false, error: error.message });
    }
    if (error instanceof Error && error.message === "EMAIL_DELIVERY_FAILED") {
      return res.status(502).json({ success: false, error: error.message });
    }
    console.error(error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}

export async function verifyLoginCode(
  req: AuthenticatedRequest,
  res: Response
) {
  const parsed = loginCodeVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "INVALID_INPUT" });
  }
  try {
    const result = await verifyEmailLoginCode(parsed.data.email, parsed.data.code);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_OR_EXPIRED_CODE") {
      return res.status(401).json({ success: false, error: error.message });
    }
    console.error(error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}

export async function me(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "AUTHENTICATION_REQUIRED",
    });
  }

  try {
    const user = await import("../../config/prisma.js").then(
      ({ default: prisma }) =>
        prisma.user.findUnique({
          where: {
            id: req.user!.userId,
          },
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        })
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "USER_NOT_FOUND",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
  }
}