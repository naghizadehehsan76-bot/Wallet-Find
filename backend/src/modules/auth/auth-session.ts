import { createHash, randomBytes } from "node:crypto";
import prisma from "../../config/prisma.js";

export const AUTH_SESSION_COOKIE = "__Host-wf_session";
export const REMEMBERED_IDLE_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;
export const REMEMBERED_ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
export const STANDARD_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const STANDARD_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAuthSession(userId: string, rememberMe = true) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const absoluteLifetime = rememberMe
    ? REMEMBERED_ABSOLUTE_TIMEOUT_MS
    : STANDARD_ABSOLUTE_TIMEOUT_MS;

  await prisma.authSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      rememberMe,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + absoluteLifetime),
    },
  });

  return { token, rememberMe };
}

export async function revokeAuthSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.authSession.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
