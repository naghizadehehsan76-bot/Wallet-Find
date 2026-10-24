import { createHash, randomInt } from "node:crypto";
import jwt from "jsonwebtoken";
import prisma from "../../config/prisma.js";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");
  return secret;
}

function createToken(userId: string, role: string): string {
  return jwt.sign({ userId, role }, getJwtSecret(), { expiresIn: "7d" });
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function sendLoginCode(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("EMAIL_DELIVERY_NOT_CONFIGURED");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Wallet Find sign-in code",
      text: `Your Wallet Find sign-in code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px"><h2>Wallet Find</h2><p>Use this code to sign in:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p></div>`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Email provider rejected login email:", response.status, detail);
    throw new Error("EMAIL_DELIVERY_FAILED");
  }
}

export async function requestEmailLoginCode(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });

  // Avoid revealing whether an email address has an account.
  if (!user) return { message: "If this email is registered, a sign-in code has been sent." };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.emailLoginCode.updateMany({
    where: { email, usedAt: null },
    data: { usedAt: new Date() },
  });

  const savedCode = await prisma.emailLoginCode.create({
    data: { email, codeHash, expiresAt },
  });

  try {
    await sendLoginCode(email, code);
  } catch (error) {
    await prisma.emailLoginCode.delete({ where: { id: savedCode.id } }).catch(() => undefined);
    throw error;
  }

  return { message: "If this email is registered, a sign-in code has been sent." };
}

export async function verifyEmailLoginCode(emailInput: string, codeInput: string) {
  const email = normalizeEmail(emailInput);
  const code = codeInput.trim();
  const record = await prisma.emailLoginCode.findFirst({
    where: {
      email,
      usedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) throw new Error("INVALID_OR_EXPIRED_CODE");

  if (record.codeHash !== hashCode(code)) {
    await prisma.emailLoginCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new Error("INVALID_OR_EXPIRED_CODE");
  }

  const consumed = await prisma.emailLoginCode.updateMany({
    where: { id: record.id, usedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) throw new Error("INVALID_OR_EXPIRED_CODE");

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      createdAt: true,
    },
  });
  if (!user) throw new Error("INVALID_OR_EXPIRED_CODE");

  return {
    user,
    token: createToken(user.id, user.role),
  };
}
