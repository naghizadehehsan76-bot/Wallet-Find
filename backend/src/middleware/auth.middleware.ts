import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import {
  AUTH_SESSION_COOKIE,
  REMEMBERED_IDLE_TIMEOUT_MS,
  STANDARD_IDLE_TIMEOUT_MS,
  hashSessionToken,
} from "../modules/auth/auth-session.js";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");
  return secret;
}

export interface AuthenticatedRequest extends Request {
  user?: { userId: string; role: string };
  authSessionId?: string;
  authSessionToken?: string;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const sessionToken = readCookie(req, AUTH_SESSION_COOKIE);
    if (sessionToken) {
      const session = await prisma.authSession.findUnique({
        where: { tokenHash: hashSessionToken(sessionToken) },
        select: {
          id: true, userId: true, rememberMe: true, lastSeenAt: true,
          expiresAt: true, revokedAt: true,
          user: { select: { role: true } },
        },
      });
      const now = Date.now();
      const idleLimit = session?.rememberMe ? REMEMBERED_IDLE_TIMEOUT_MS : STANDARD_IDLE_TIMEOUT_MS;
      const invalid = !session || session.revokedAt !== null ||
        session.expiresAt.getTime() <= now ||
        session.lastSeenAt.getTime() + idleLimit <= now;

      if (invalid) {
        if (session && !session.revokedAt) {
          await prisma.authSession.updateMany({
            where: { id: session.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        res.clearCookie(AUTH_SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
        return res.status(401).json({ success: false, error: "SESSION_EXPIRED" });
      }

      req.user = { userId: session.userId, role: session.user.role };
      req.authSessionId = session.id;
      req.authSessionToken = sessionToken;
      if (now - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
        void prisma.authSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { lastSeenAt: new Date(now) },
        }).catch((error) => console.warn("Could not refresh auth session activity", error));
      }
      return next();
    }

    // Compatibility only for previously issued seven-day JWTs and trusted automation clients.
    // The browser no longer stores or sends bearer tokens.
    const authorization = req.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const decoded = jwt.verify(authorization.substring(7).trim(), getJwtSecret());
      if (typeof decoded === "object" && decoded !== null &&
          typeof decoded.userId === "string" && typeof decoded.role === "string") {
        req.user = { userId: decoded.userId, role: decoded.role };
        return next();
      }
    }
    return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
    }
    console.error("Authentication middleware failed", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  }
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ success: false, error: "ADMIN_ACCESS_REQUIRED" });
  }
  next();
}
