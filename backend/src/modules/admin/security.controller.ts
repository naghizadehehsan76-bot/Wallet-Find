import type { Response } from "express";
import prisma from "../../config/prisma.js";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";

export async function getSecurityFlagsHandler(_req: AuthenticatedRequest, res: Response) {
  try {
    const flags = await prisma.securityFlag.findMany({
      take: 200,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            contestParticipationBlocked: true,
            contestParticipationBlockedAt: true,
            contestParticipationBlockReason: true,
          },
        },
        contest: { select: { id: true, title: true, language: true, startsAt: true, endsAt: true } },
      },
    });
    return res.json({
      success: true,
      data: flags.map((flag) => ({
        id: flag.id,
        userId: flag.userId,
        contestId: flag.contestId,
        reason: flag.reason,
        completionTimeMs: Number(flag.completionTimeMs),
        createdAt: flag.createdAt,
        user: flag.user,
        contest: flag.contest,
      })),
    });
  } catch (error) {
    console.error("Failed to load anti-fraud flags", error);
    return res.status(503).json({ success: false, error: "SECURITY_REPORT_UNAVAILABLE" });
  }
}

export async function updateContestRestrictionHandler(req: AuthenticatedRequest, res: Response) {
  const userId = String(req.params.userId ?? "");
  const blocked = req.body?.blocked;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";

  if (!userId || typeof blocked !== "boolean") {
    return res.status(400).json({ success: false, error: "INVALID_INPUT" });
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true, contestParticipationBlocked: true },
    });
    if (!target) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
    if (target.role === "ADMIN") {
      return res.status(409).json({ success: false, error: "CANNOT_RESTRICT_ADMIN" });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        contestParticipationBlocked: blocked,
        contestParticipationBlockedAt: blocked ? new Date() : null,
        contestParticipationBlockedById: blocked ? (req.user?.userId ?? null) : null,
        contestParticipationBlockReason: blocked ? (reason || "Restricted by administrator after security review") : null,
      },
      select: { id: true, username: true, contestParticipationBlocked: true, contestParticipationBlockedAt: true, contestParticipationBlockReason: true },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user?.userId ?? null,
        action: blocked ? "CONTEST_PARTICIPATION_RESTRICTED" : "CONTEST_PARTICIPATION_RESTORED",
        entity: "User",
        entityId: userId,
        metadata: { targetUsername: target.username, reason: blocked ? (reason || null) : null },
      },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Failed to update contest participation restriction", error);
    return res.status(503).json({ success: false, error: "SECURITY_RESTRICTION_UPDATE_FAILED" });
  }
}
