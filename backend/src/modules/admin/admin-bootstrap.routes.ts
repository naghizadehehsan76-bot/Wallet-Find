import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import prisma from "../../config/prisma.js";

const router = Router();

router.post("/bootstrap", async (req, res) => {
  const configuredSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  const suppliedSecret = typeof req.body?.setupSecret === "string" ? req.body.setupSecret : "";

  if (!configuredSecret || configuredSecret.length < 32) {
    return res.status(503).json({ success: false, error: "ADMIN_BOOTSTRAP_NOT_CONFIGURED" });
  }

  const expected = Buffer.from(configuredSecret);
  const supplied = Buffer.from(suppliedSecret);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return res.status(403).json({ success: false, error: "INVALID_SETUP_SECRET" });
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[A-Za-z0-9_-]{3,30}$/.test(username) ||
      password.length < 12 || password.length > 128) {
    return res.status(400).json({
      success: false,
      error: "INVALID_ADMIN_DETAILS",
      message: "Use a valid email, a 3–30 character username, and a password of 12–128 characters."
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existingAdmin = await tx.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
      if (existingAdmin) throw new Error("ADMIN_ALREADY_CONFIGURED");

      const duplicate = await tx.user.findFirst({
        where: { OR: [{ email: { equals: email, mode: "insensitive" } }, { username }] },
        select: { id: true }
      });
      if (duplicate) throw new Error("EMAIL_OR_USERNAME_ALREADY_EXISTS");

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await tx.user.create({
        data: { email, username, passwordHash, role: "ADMIN" },
        select: { id: true, email: true, username: true, role: true, createdAt: true }
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "ADMIN_BOOTSTRAPPED",
          entity: "User",
          entityId: user.id,
          metadata: { method: "one-time bootstrap" }
        }
      });
      return user;
    });

    return res.status(201).json({
      success: true,
      data: { user: result },
      message: "Administrator created. Remove ADMIN_BOOTSTRAP_SECRET from the service environment after successful setup."
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_ALREADY_CONFIGURED") {
      return res.status(409).json({ success: false, error: error.message });
    }
    if (error instanceof Error && error.message === "EMAIL_OR_USERNAME_ALREADY_EXISTS") {
      return res.status(409).json({ success: false, error: error.message });
    }
    console.error("Admin bootstrap failed:", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

export default router;
