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

export async function getPrizeTreasuryPaymentHistoryHandler(
  _req: AuthenticatedRequest,
  res: Response,
) {
  try {
    const [awards, fundingRows, fundingAuditRows] = await Promise.all([
      prisma.prizeAward.findMany({
        orderBy: [{ createdAt: "desc" }],
        take: 500,
        select: {
          id: true, contestId: true, userId: true, username: true, rank: true,
          amountMicro: true, status: true, destinationAddress: true,
          transactionHash: true, broadcastAt: true, confirmedAt: true,
          failureCode: true, createdAt: true,
          contest: { select: { title: true, language: true, startsAt: true, endsAt: true } },
        },
      }),
      prisma.globalPrizeLedger.findMany({
        where: { type: "TREASURY_FUNDING" },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
        take: 200,
        select: { id: true, amountMicro: true, effectiveAt: true, createdAt: true, referenceKey: true, note: true },
      }),
      prisma.auditLog.findMany({
        where: { action: "TREASURY_PRIZE_FUND_ALLOCATION" },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { user: { select: { username: true, email: true } } },
      }),
    ]);

    const journalRows = awards.length ? await prisma.walletJournal.findMany({
      where: { referenceKey: { in: awards.map((award) => "prize-award:" + award.id) } },
      select: {
        id: true, referenceKey: true, entryType: true, note: true, createdAt: true,
        postings: { select: { account: true, direction: true, amountAtomic: true, accountReference: true } },
      },
    }) : [];
    const journalByReference = new Map(journalRows.map((row) => [row.referenceKey, row]));
    const formatMicro = (value: bigint) => (value / 1_000_000n).toString() + "." + (value % 1_000_000n).toString().padStart(6, "0");
    const auditByTime = [...fundingAuditRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const allocations = fundingRows.map((row) => {
      const amount = BigInt(row.amountMicro);
      const audit = auditByTime.find((item) => {
        const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {};
        return metadata.amountMicro === amount.toString() && Math.abs(item.createdAt.getTime() - row.effectiveAt.getTime()) < 120_000;
      });
      return {
        id: row.id, amount: formatMicro(amount), effectiveAt: row.effectiveAt,
        createdAt: row.createdAt, referenceKey: row.referenceKey, note: row.note,
        allocatedBy: audit?.user?.username ?? null,
        allocatedByEmail: audit?.user?.email ?? null,
        auditLogId: audit?.id ?? null,
      };
    });

    const payments = awards.map((award) => {
      const journal = journalByReference.get("prize-award:" + award.id);
      const availableCredit = journal?.postings.find((posting) => posting.account === "USER_AVAILABLE" && posting.direction === "CREDIT");
      return {
        id: award.id, contestId: award.contestId, challengeTitle: award.contest.title,
        language: award.contest.language, challengeStartsAt: award.contest.startsAt,
        challengeEndsAt: award.contest.endsAt, userId: award.userId, username: award.username,
        rank: award.rank, amount: formatMicro(BigInt(award.amountMicro)), status: award.status,
        paymentMode: journal ? "INTERNAL_WALLET_CREDIT" : award.transactionHash ? "ON_CHAIN" : "NOT_CREDITED",
        creditedAt: journal?.createdAt ?? award.confirmedAt,
        journalId: journal?.id ?? null, journalReference: journal?.referenceKey ?? null,
        ledgerEntryType: journal?.entryType ?? null,
        creditedAccount: availableCredit?.account ?? null,
        creditedAccountReference: availableCredit?.accountReference ?? null,
        destinationAddress: award.destinationAddress, transactionHash: award.transactionHash,
        broadcastAt: award.broadcastAt, confirmedAt: award.confirmedAt,
        failureCode: award.failureCode, awardCreatedAt: award.createdAt,
        note: journal?.note ?? null,
      };
    });

    const totalFundedMicro = fundingRows.reduce((sum, row) => sum + BigInt(row.amountMicro), 0n);
    const totalPaidMicro = awards.filter((award) => award.status === "PAID").reduce((sum, award) => sum + BigInt(award.amountMicro), 0n);
    const pendingMicro = awards.filter((award) => award.status !== "PAID" && award.status !== "INELIGIBLE").reduce((sum, award) => sum + BigInt(award.amountMicro), 0n);
    return res.json({ success: true, data: {
      summary: { totalFunded: formatMicro(totalFundedMicro), totalPaid: formatMicro(totalPaidMicro), pending: formatMicro(pendingMicro), awardCount: awards.length, paidCount: awards.filter((award) => award.status === "PAID").length },
      allocations, payments, generatedAt: new Date().toISOString(),
      accountingNote: "Prize awards are credited to users' internal Wallet-Find balances from the shared Polygon prize treasury ledger. These credits are not on-chain USDT0 transfers unless an explicit transaction hash is present.",
    } });
  } catch (error) {
    console.error("Failed to load prize treasury payment history", error);
    return res.status(503).json({ success: false, error: "PRIZE_TREASURY_PAYMENT_HISTORY_UNAVAILABLE" });
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
      partnerConfirmedVisits,
      pendingExternalVerificationVisits,
      notConfiguredExternalVerificationVisits,
      rejectedExternalVerificationVisits,
      advertiserAttributedClicks,
      uniqueVisitorRows,
      advertiserUniqueVisitorRows,
      recentVisits,
      advertiserGroups,
      destinationGroups,
      destinationVisitorPairs,
    ] = await Promise.all([
      prisma.contestSourceVisit.count(),
      prisma.contestSourceVisit.count({ where: { externalVerificationStatus: "CONFIRMED" } }),
      prisma.contestSourceVisit.count({ where: { externalVerificationStatus: "PENDING" } }),
      prisma.contestSourceVisit.count({ where: { externalVerificationStatus: "NOT_CONFIGURED" } }),
      prisma.contestSourceVisit.count({ where: { externalVerificationStatus: "REJECTED" } }),
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
          externalVerificationStatus: true,
          externalConfirmedAt: true,
          externalVerificationProvider: true,
          externalReferenceId: true,
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
          partnerConfirmedVisits,
          pendingExternalVerificationVisits,
          notConfiguredExternalVerificationVisits,
          rejectedExternalVerificationVisits,
        },
        advertiserPerformance,
        destinationPerformance,
        recentVisits,
        recentVisitsLimit: 500,
        generatedAt: new Date().toISOString(),
        proofNote: "Wallet-Find click records prove an authenticated outbound click only. An external landing is confirmed only after an advertiser integration verifies the click token; unconfigured, pending, and rejected records are not confirmed landings.",
        verificationNote: "Do not treat unconfigured, pending, or rejected records as verified external visits. The partner connector must validate the advertiser API response or authenticated callback before marking a record CONFIRMED.",
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
