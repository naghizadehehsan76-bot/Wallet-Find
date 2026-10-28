import type { Response } from "express";
import prisma from "../../config/prisma.js";
import { getProjectProfitPoolAdminSnapshot } from "../contest/prize-pool.service.js";

import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";

import {
  upsertSystemSettingSchema,
  updateContestSettingSchema,
} from "./admin.schema.js";

import {
  getSystemSettings,
  upsertSystemSetting,
  getContestSettings,
  updateContestSettings,
  getAuditLogs,
  getAdminUsers,
} from "./admin.service.js";

export async function getAdminOverviewHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  const [
    users,
    contests,
    activeContests,
    submissions,
    advertiserOrders,
    pendingAdPayments,
    recentAuditLogs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.contest.count(),
    prisma.contest.count({ where: { status: "ACTIVE" } }),
    prisma.submission.count(),
    prisma.advertisementOrder.count(),
    prisma.advertisementPayment.count({ where: { status: "PENDING" } }),
    prisma.auditLog.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { username: true, email: true } } },
    }),
  ]);

  return res.json({
    success: true,
    data: {
      users,
      contests,
      activeContests,
      submissions,
      advertiserOrders,
      pendingAdPayments,
      recentAuditLogs,
      generatedAt: new Date().toISOString(),
      note: "Statistics are read-only summaries of current database records.",
    },
  });
}

export async function getSystemSettingsHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  const settings = await getSystemSettings();

  return res.json({
    success: true,
    data: settings,
  });
}

export async function upsertSystemSettingHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  const parsed = upsertSystemSettingSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  const setting = await upsertSystemSetting(parsed.data, req.user?.userId);

  return res.json({
    success: true,
    data: setting,
  });
}

export async function getContestSettingsHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  const contestId = String(req.params.contestId);
  const settings = await getContestSettings(contestId);

  return res.json({
    success: true,
    data: settings,
  });
}

export async function updateContestSettingsHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  const contestId = String(req.params.contestId);
  const parsed = updateContestSettingSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: parsed.error.flatten(),
    });
  }

  try {
    const settings = await updateContestSettings(
      contestId,
      parsed.data,
      req.user?.userId
    );

    return res.json({
      success: true,
      data: settings,
    });
  } catch {
    return res.status(404).json({
      success: false,
      error: "CONTEST_NOT_FOUND",
    });
  }
}

export async function getAuditLogsHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  const logs = await getAuditLogs();
  return res.json({ success: true, data: logs });
}

export async function getAdminUsersHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  try {
    const users = await getAdminUsers();
    return res.json({ success: true, data: users });
  } catch (error) {
    console.error("Admin user listing failed", error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}

export async function getProjectProfitPoolAdminHandler(
  _req: AuthenticatedRequest,
  res: Response
) {
  try {
    const snapshot = await getProjectProfitPoolAdminSnapshot();
    return res.json({ success: true, data: snapshot });
  } catch (error) {
    console.error("Failed to load project dividend fund", error);
    return res.status(503).json({ success: false, error: "PROJECT_PROFIT_POOL_UNAVAILABLE" });
  }
}

export async function getContestSourceVisitReportHandler(
  _req: AuthenticatedRequest,
  res: Response,
) {
  try {
    const [
      totalClicks,
      advertiserAttributedClicks,
      uniqueVisitorRows,
      advertiserUniqueVisitorRows,
      recentVisits,
      advertiserGroups,
      destinationGroups,
      destinationVisitorPairs,
    ] = await Promise.all([
      prisma.contestSourceVisit.count(),
      prisma.contestSourceVisit.count({ where: { advertisementOrderId: { not: null } } }),
      prisma.contestSourceVisit.findMany({
        where: { userId: { not: null } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.contestSourceVisit.findMany({
        where: { userId: { not: null }, advertisementOrderId: { not: null } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.contestSourceVisit.findMany({
        take: 500,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          userId: true,
          username: true,
          contestId: true,
          contestTitle: true,
          contestLanguage: true,
          contestStartsAt: true,
          clueId: true,
          clueSequence: true,
          sourceUrl: true,
          sourceHostname: true,
          advertiserContentId: true,
          advertiserContentTitle: true,
          advertiserName: true,
          advertisementOrderId: true,
          createdAt: true,
        },
      }),
      prisma.contestSourceVisit.groupBy({
        by: ["advertisementOrderId"],
        where: { advertisementOrderId: { not: null } },
        _count: { _all: true },
      }),
      prisma.contestSourceVisit.groupBy({
        by: ["sourceUrl", "sourceHostname"],
        _count: { _all: true },
      }),
      prisma.contestSourceVisit.findMany({
        where: { userId: { not: null } },
        distinct: ["sourceUrl", "userId"],
        select: { sourceUrl: true, userId: true },
      }),
    ]);

    const advertiserOrderIds = advertiserGroups
      .map((group) => group.advertisementOrderId)
      .filter((id): id is string => Boolean(id));

    const [advertiserOrders, advertiserUniquePairs] = await Promise.all([
      advertiserOrderIds.length
        ? prisma.advertisementOrder.findMany({
            where: { id: { in: advertiserOrderIds } },
            select: {
              id: true,
              status: true,
              advertiser: { select: { username: true } },
              content: { select: { title: true, url: true } },
            },
          })
        : Promise.resolve([]),
      prisma.contestSourceVisit.findMany({
        where: { userId: { not: null }, advertisementOrderId: { not: null } },
        distinct: ["advertisementOrderId", "userId"],
        select: { advertisementOrderId: true, userId: true },
      }),
    ]);

    const visitorsByDestination = new Map<string, number>();
    for (const row of destinationVisitorPairs) {
      visitorsByDestination.set(
        row.sourceUrl,
        (visitorsByDestination.get(row.sourceUrl) ?? 0) + 1,
      );
    }
    const destinationPerformance = destinationGroups
      .map((group) => ({
        sourceUrl: group.sourceUrl,
        sourceHostname: group.sourceHostname,
        clickCount: group._count._all,
        uniqueVisitors: visitorsByDestination.get(group.sourceUrl) ?? 0,
      }))
      .sort((a, b) => b.clickCount - a.clickCount);

    const orderById = new Map<string, (typeof advertiserOrders)[number]>();
    for (const order of advertiserOrders) {
      orderById.set(order.id, order);
    }
    const visitorsByOrder = new Map<string, number>();
    for (const row of advertiserUniquePairs) {
      if (!row.advertisementOrderId) continue;
      visitorsByOrder.set(
        row.advertisementOrderId,
        (visitorsByOrder.get(row.advertisementOrderId) ?? 0) + 1,
      );
    }

    const advertiserPerformance = advertiserGroups
      .filter((group) => Boolean(group.advertisementOrderId))
      .map((group) => {
        const orderId = group.advertisementOrderId as string;
        const order = orderById.get(orderId);
        const lastVisit = recentVisits.find((visit) => visit.advertisementOrderId === orderId);
        return {
          advertisementOrderId: orderId,
          advertiserName: order?.advertiser.username ?? lastVisit?.advertiserName ?? "—",
          contentTitle: order?.content.title ?? lastVisit?.advertiserContentTitle ?? null,
          destinationUrl: order?.content.url ?? lastVisit?.sourceUrl ?? null,
          clickCount: group._count._all,
          uniqueVisitors: visitorsByOrder.get(orderId) ?? 0,
          orderStatus: order?.status ?? "DELETED",
        };
      })
      .sort((a, b) => b.clickCount - a.clickCount);

    return res.json({
      success: true,
      data: {
        summary: {
          totalClicks,
          uniqueVisitors: uniqueVisitorRows.length,
          advertiserAttributedClicks,
          advertiserUniqueVisitors: advertiserUniqueVisitorRows.length,
        },
        advertiserPerformance,
        destinationPerformance,
        recentVisits,
        recentVisitsLimit: 500,
        generatedAt: new Date().toISOString(),
        proofNote: "Records prove a logged, authenticated click on a challenge source link. They do not independently prove that the external destination finished loading or that the user viewed it.",
      },
    });
  } catch (error) {
    console.error("Failed to load source visit report", error);
    return res.status(503).json({
      success: false,
      error: "SOURCE_VISIT_REPORT_UNAVAILABLE",
    });
  }
}
