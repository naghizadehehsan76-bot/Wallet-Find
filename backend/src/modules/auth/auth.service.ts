import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import prisma from "../../config/prisma.js";
import type {
  RegisterInput,
  LoginInput,
  VerifyEmailInput,
  ResendVerificationInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "./auth.schema.js";

const CODE_TTL_MINUTES = 10;
const RESET_CODE_TTL_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const MIN_RESEND_INTERVAL_MS = 60_000;
const MAX_CODES_PER_DAY = 5;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");
  return secret;
}

function createToken(userId: string, role: string): string {
  return jwt.sign({ userId, role }, getJwtSecret(), { expiresIn: "7d" });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashCode(code: string): string {
  return createHmac("sha256", getJwtSecret()).update(code).digest("hex");
}

function codeMatches(code: string, storedHash: string): boolean {
  const actual = Buffer.from(hashCode(code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createCode(): string {
  return String(randomInt(100000, 1_000_000));
}

async function sendAuthEmail(
  email: string,
  code: string,
  purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
  language: "fa" | "en" = "en",
) {
  const apiKey = process.env.EPOSTIX_API_KEY;
  if (!apiKey) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");

  const isReset = purpose === "PASSWORD_RESET";
  const isPersian = language === "fa";
  const subject = isPersian
    ? (isReset ? "بازیابی رمز عبور Wallet-Find" : "تأیید ایمیل Wallet-Find")
    : (isReset ? "Reset your Wallet-Find password" : "Verify your Wallet-Find email");
  const title = isPersian
    ? (isReset ? "کد بازیابی رمز عبور" : "کد تأیید ایمیل")
    : (isReset ? "Password reset code" : "Email verification code");
  const action = isPersian
    ? (isReset ? "از این کد برای تنظیم رمز عبور جدید Wallet-Find استفاده کن." : "از این کد برای تأیید نشانی ایمیل Wallet-Find استفاده کن.")
    : (isReset ? "Use this code to reset your Wallet-Find password." : "Use this code to verify your Wallet-Find email address.");
  const expires = isReset ? RESET_CODE_TTL_MINUTES : CODE_TTL_MINUTES;
  const expiryText = isPersian ? `این کد تا ${expires} دقیقه اعتبار دارد.` : `This code expires in ${expires} minutes.`;
  const ignoreText = isPersian
    ? "اگر این درخواست را ثبت نکرده‌ای، این ایمیل را نادیده بگیر."
    : "If you did not request this, you can ignore this email.";
  const text = `${title}\n\n${action}\n\n${isPersian ? "کد شما:" : "Your code:"} ${code}\n\n${expiryText}\n${ignoreText}\nWallet-Find`;
  const html = `<!doctype html><html lang="${isPersian ? "fa" : "en"}"><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.7;direction:${isPersian ? "rtl" : "ltr"}"><h2>${title}</h2><p>${action}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;direction:ltr">${code}</p><p>${expiryText}</p><p>${ignoreText}</p><p>Wallet-Find</p></body></html>`;

  let response: Response;
  try {
    response = await fetch("https://api.epostix.com/v1/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EPOSTIX_FROM?.trim() || "Wallet-Find <verify@mail.wallet-find.com>",
        to: [email],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    console.error("Epostix request failed", error instanceof Error ? error.name : "unknown");
    throw new Error("EMAIL_SEND_FAILED");
  }

  if (!response.ok) {
    let providerType = "unknown";
    try {
      const body = await response.json() as { type?: string };
      providerType = body.type ?? providerType;
    } catch {
      // Never log email contents, credentials, or verification codes.
    }
    console.error("Epostix rejected email", response.status, providerType);
    throw new Error("EMAIL_SEND_FAILED");
  }
}

async function issueCode(email: string, purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET", language: "fa" | "en" = "en") {
  const now = new Date();
  const sinceDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentCount = await prisma.authChallenge.count({
    where: { email, purpose, createdAt: { gte: sinceDay } },
  });
  if (recentCount >= MAX_CODES_PER_DAY) throw new Error("CODE_RESEND_LIMIT");

  const latest = await prisma.authChallenge.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: "desc" },
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < MIN_RESEND_INTERVAL_MS) {
    throw new Error("CODE_RESEND_TOO_SOON");
  }

  await prisma.authChallenge.deleteMany({
    where: { email, purpose, usedAt: null },
  });

  const code = createCode();
  const expiresAt = new Date(
    now.getTime() + (purpose === "PASSWORD_RESET" ? RESET_CODE_TTL_MINUTES : CODE_TTL_MINUTES) * 60_000,
  );
  const challenge = await prisma.authChallenge.create({
    data: { email, purpose, tokenHash: hashCode(code), expiresAt },
  });

  try {
    await sendAuthEmail(email, code, purpose, language);
  } catch (error) {
    await prisma.authChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    throw error;
  }
}

async function getValidChallenge(email: string, purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET", code: string) {
  const challenge = await prisma.authChallenge.findFirst({
    where: { email, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
    throw new Error("INVALID_OR_EXPIRED_CODE");
  }
  if (challenge.attempts >= MAX_CODE_ATTEMPTS) {
    throw new Error("CODE_TOO_MANY_ATTEMPTS");
  }
  if (!codeMatches(code, challenge.tokenHash)) {
    const nextAttempts = challenge.attempts + 1;
    await prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    if (nextAttempts >= MAX_CODE_ATTEMPTS) throw new Error("CODE_TOO_MANY_ATTEMPTS");
    throw new Error("INVALID_OR_EXPIRED_CODE");
  }
  return challenge;
}

export async function registerUser(input: RegisterInput) {
  const email = normalizeEmail(input.email);
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { username: input.username },
      ],
    },
  });
  if (existingUser) throw new Error("EMAIL_OR_USERNAME_ALREADY_EXISTS");

  const passwordHash = await bcrypt.hash(input.password, 12);
  await prisma.user.create({
    data: {
      email,
      username: input.username,
      passwordHash,
      emailVerifiedAt: null,
    },
    select: { id: true },
  });

  await issueCode(email, "EMAIL_VERIFICATION", input.language);
  return { email, verificationRequired: true };
}

export async function resendVerification(input: ResendVerificationInput) {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) return;
  await issueCode(user.email, "EMAIL_VERIFICATION", input.language);
}

export async function verifyEmail(input: VerifyEmailInput) {
  const email = normalizeEmail(input.email);
  const challenge = await getValidChallenge(email, "EMAIL_VERIFICATION", input.code);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_CODE_ATTEMPTS } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new Error("INVALID_OR_EXPIRED_CODE");
    const updated = await tx.user.updateMany({
      where: { email: { equals: email, mode: "insensitive" }, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    if (updated.count !== 1) throw new Error("EMAIL_ALREADY_VERIFIED_OR_NOT_FOUND");
  });

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, username: true, role: true, createdAt: true },
  });
  if (!user) throw new Error("EMAIL_ALREADY_VERIFIED_OR_NOT_FOUND");
  return { user, token: createToken(user.id, user.role) };
}

export async function loginUser(input: LoginInput) {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (!user) throw new Error("EMAIL_NOT_REGISTERED");

  const passwordValid = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordValid) throw new Error("INVALID_PASSWORD");
  if (!user.emailVerifiedAt) throw new Error("EMAIL_NOT_VERIFIED");

  const token = createToken(user.id, user.role);
  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
    },
    token,
  };
}

export async function requestPasswordReset(input: ForgotPasswordInput) {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, emailVerifiedAt: { not: null } },
    select: { email: true },
  });
  if (!user) return;

  try {
    await issueCode(user.email, "PASSWORD_RESET", input.language);
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_SEND_FAILED") return;
    // Keep the same public response for unknown, throttled and known addresses.
    if (error instanceof Error && (error.message === "CODE_RESEND_TOO_SOON" || error.message === "CODE_RESEND_LIMIT")) return;
    throw error;
  }
}

export async function resetPassword(input: ResetPasswordInput) {
  const email = normalizeEmail(input.email);
  const challenge = await getValidChallenge(email, "PASSWORD_RESET", input.code);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, emailVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (!user) throw new Error("INVALID_OR_EXPIRED_CODE");

  const passwordHash = await bcrypt.hash(input.password, 12);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_CODE_ATTEMPTS } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new Error("INVALID_OR_EXPIRED_CODE");
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.authChallenge.updateMany({
      where: { email, purpose: "PASSWORD_RESET", usedAt: null },
      data: { usedAt: new Date() },
    });
  });
  return { passwordReset: true };
}
