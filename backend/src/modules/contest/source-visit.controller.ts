import type { Response } from "express";
import prisma from "../../config/prisma.js";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";

type ActiveAdOrder = {
  id: string;
  contestId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
};

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === code;
}

function canonicalDestination(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin.toLowerCase()}${pathname}`;
  } catch {
    return null;
  }
}

function isOrderInWindow(order: ActiveAdOrder, now: Date, contestId: string): boolean {
  return (
    (order.contestId === null || order.contestId === contestId) &&
    (!order.startsAt || order.startsAt.getTime() <= now.getTime()) &&
    (!order.endsAt || order.endsAt.getTime() > now.getTime())
  );
}

export async function recordContestSourceVisitHandler(
  req: AuthenticatedRequest,
  res: Response,
) {
  const contestId = req.params.contestId;
  const clueId = req.params.clueId;

  if (!req.user) {
    return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  }
  if (!contestId || Array.isArray(contestId) || !clueId || Array.isArray(clueId)) {
    return res.status(400).json({ success: false, error: "INVALID_INPUT" });
  }

  const userId = req.user.userId;
  const now = new Date();

  try {
    const clue = await prisma.contestClue.findFirst({
      where: { id: clueId, contestId },
      select: {
        id: true,
        sequence: true,
        source: true,
        sourceUrl: true,
        advertiserContentId: true,
        contest: {
          select: {
            id: true,
            title: true,
            language: true,
            status: true,
            startsAt: true,
            endsAt: true,
          },
        },
        advertiserContent: {
          select: {
            id: true,
            title: true,
            url: true,
            advertiser: { select: { username: true } },
            advertisementOrders: {
              where: { status: "ACTIVE" },
              select: {
                id: true,
                contestId: true,
                startsAt: true,
                endsAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 25,
            },
          },
        },
      },
    });

    if (!clue || !clue.sourceUrl) {
      return res.status(404).json({ success: false, error: "SOURCE_LINK_NOT_FOUND" });
    }

    const targetUrl = canonicalDestination(clue.sourceUrl);
    if (!targetUrl) {
      return res.status(400).json({ success: false, error: "INVALID_SOURCE_URL" });
    }

    if (clue.contest.status !== "ACTIVE") {
      return res.status(409).json({ success: false, error: "CONTEST_NOT_ACTIVE" });
    }
    if (clue.contest.startsAt && clue.contest.startsAt.getTime() > now.getTime()) {
      return res.status(409).json({ success: false, error: "CONTEST_NOT_STARTED" });
    }
    if (clue.contest.endsAt && clue.contest.endsAt.getTime() <= now.getTime()) {
      return res.status(409).json({ success: false, error: "CONTEST_FINISHED" });
    }

    // Only the current unsolved clue is eligible for a tracked outbound click.
    const solvedRows = await prisma.submission.findMany({
      where: { userId, contestId, isCorrect: true },
      select: { clue: { select: { sequence: true } } },
    });
    const solvedSequences = new Set(solvedRows.map((row) => row.clue.sequence));
    let currentSequence = 1;
    while (currentSequence <= 12 && solvedSequences.has(currentSequence)) currentSequence += 1;
    if (clue.sequence !== currentSequence || currentSequence > 12) {
      return res.status(409).json({ success: false, error: "CLUE_NOT_CURRENT" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) {
      return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
    }

    // Attribute a click only when the destination matches registered advertiser
    // content and has an active order for this contest or a general campaign.
    // A clue may be scheduled from an advertiser URL without having the optional
    // advertiserContentId relation set, so fall back to matching registered URLs.
    let advertiserContents = clue.advertiserContent ? [clue.advertiserContent] : [];
    const hasLinkedDestination = advertiserContents.some(
      (content) => canonicalDestination(content.url) === targetUrl,
    );
    if (!hasLinkedDestination) {
      const registeredAdvertiserContents = await prisma.advertiserContent.findMany({
        where: {
          url: { not: null },
          advertisementOrders: { some: { status: "ACTIVE" } },
        },
        select: {
          id: true,
          title: true,
          url: true,
          advertiser: { select: { username: true } },
          advertisementOrders: {
            where: { status: "ACTIVE" },
            select: {
              id: true,
              contestId: true,
              startsAt: true,
              endsAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 25,
          },
        },
      });
      advertiserContents = [...advertiserContents, ...registeredAdvertiserContents];
    }

    const advertiserContent = advertiserContents.find(
      (content) => canonicalDestination(content.url) === targetUrl,
    ) ?? null;
    const activeOrders = (advertiserContent?.advertisementOrders ?? [])
      .filter((order) => isOrderInWindow(order, now, contestId))
      .sort((a, b) => {
        const aSpecific = a.contestId === contestId ? 1 : 0;
        const bSpecific = b.contestId === contestId ? 1 : 0;
        return bSpecific - aSpecific || b.createdAt.getTime() - a.createdAt.getTime();
      });
    const advertiserOrder = activeOrders[0] ?? null;

    // One recorded visit per authenticated user per clue avoids inflated click
    // totals from repeated refreshes or repeated clicks on the same link.
    const existing = await prisma.contestSourceVisit.findFirst({
      where: { userId, clueId },
      select: { id: true, createdAt: true, advertisementOrderId: true },
    });
    if (existing) {
      return res.status(200).json({
        success: true,
        data: {
          visitId: existing.id,
          sourceUrl: clue.sourceUrl,
          recordedAt: existing.createdAt.toISOString(),
          advertiserAttributed: Boolean(existing.advertisementOrderId),
          alreadyRecorded: true,
        },
      });
    }

    const visit = await prisma.$transaction(async (tx) => {
      const row = await tx.contestSourceVisit.create({
        data: {
          userId: user.id,
          username: user.username,
          contestId: clue.contest.id,
          contestTitle: clue.contest.title,
          contestLanguage: clue.contest.language,
          contestStartsAt: clue.contest.startsAt,
          clueId: clue.id,
          clueSequence: clue.sequence,
          sourceUrl: clue.sourceUrl as string,
          sourceHostname: new URL(clue.sourceUrl as string).hostname.toLowerCase(),
          advertiserContentId: advertiserOrder ? advertiserContent?.id ?? null : null,
          advertiserContentTitle: advertiserOrder ? advertiserContent?.title ?? null : null,
          advertiserName: advertiserOrder ? advertiserContent?.advertiser.username ?? null : null,
          advertisementOrderId: advertiserOrder?.id ?? null,
        },
      });

      if (advertiserOrder) {
        await tx.advertisementMetric.create({
          data: {
            advertisementOrderId: advertiserOrder.id,
            type: "CLICK",
            value: 1,
            userId: user.id,
          },
        });
      }

      return row;
    });

    return res.status(200).json({
      success: true,
      data: {
        visitId: visit.id,
        sourceUrl: clue.sourceUrl,
        recordedAt: visit.createdAt.toISOString(),
        advertiserAttributed: Boolean(advertiserOrder),
        alreadyRecorded: false,
      },
    });
  } catch (error) {
    // A second simultaneous click can race the initial existence check. The
    // unique database key ensures the same user/clue is still counted once.
    if (isErrorWithCode(error, "P2002")) {
      const existing = await prisma.contestSourceVisit.findFirst({
        where: { userId, clueId },
        select: { id: true, createdAt: true, advertisementOrderId: true },
      });
      if (existing) {
        const clue = await prisma.contestClue.findFirst({
          where: { id: clueId, contestId },
          select: { sourceUrl: true },
        });
        if (clue?.sourceUrl && canonicalDestination(clue.sourceUrl)) {
          return res.status(200).json({
            success: true,
            data: {
              visitId: existing.id,
              sourceUrl: clue.sourceUrl,
              recordedAt: existing.createdAt.toISOString(),
              advertiserAttributed: Boolean(existing.advertisementOrderId),
              alreadyRecorded: true,
            },
          });
        }
      }
    }
    console.error("Failed to record challenge source visit", error);
    return res.status(500).json({ success: false, error: "SOURCE_VISIT_TRACKING_FAILED" });
  }
}
