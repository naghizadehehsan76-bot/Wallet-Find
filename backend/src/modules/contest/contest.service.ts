import prisma from "../../config/prisma.js";
import { CHALLENGE_INTERVAL_MS, getChallengeNumberAt } from "./challenge-schedule.js";
import { getLanguageParticipationBlock } from "./language-participation.js";

import type {
  CreateContestInput,
  CreateClueInput,
  SubmitAnswerInput,
} from "./contest.schema.js";
import {
  calculateResponseTimeMs,
  getContestProgress,
  hasCompleteClueSequence,
  normalizeAnswer,
  REQUIRED_CLUE_COUNT,
  CONTEST_DURATION_MS,
  WRONG_ANSWER_LOCK_MS,
} from "./contest.logic.js";

export async function createContest(
  data: CreateContestInput
) {
  const requestedStart = data.startsAt ? new Date(data.startsAt) : null;
  const ROUND_INTERVAL_MS = CHALLENGE_INTERVAL_MS;
  const startsAt = requestedStart
    ? new Date(Math.ceil(Math.max(requestedStart.getTime(), Date.now()) / ROUND_INTERVAL_MS) * ROUND_INTERVAL_MS)
    : null;
  const endsAt = startsAt ? new Date(startsAt.getTime() + CONTEST_DURATION_MS) : null;

  return prisma.contest.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      status: startsAt ? "SCHEDULED" : "DRAFT",
      startsAt,
      endsAt,
    },

    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
    },
  });
}

export async function createClue(
  contestId: string,
  data: CreateClueInput
) {
  const contest = await prisma.contest.findUnique({
    where: {
      id: contestId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  if (
    contest.status === "ACTIVE" ||
    contest.status === "FINISHED" ||
    contest.status === "CANCELLED"
  ) {
    throw new Error("CONTEST_CLUES_LOCKED");
  }

  // Upsert makes the admin's sequential "save all clues" action safely retryable.
  return prisma.contestClue.upsert({
    where: {
      contestId_sequence: {
        contestId,
        sequence: data.sequence,
      },
    },
    update: {
      content: data.content,
      correctAnswer: data.correctAnswer,
      sourceUrl: data.sourceUrl,
      hintAnchor: data.hintAnchor,
      type: data.type,
    },
    create: {
      contestId,
      sequence: data.sequence,
      content: data.content,
      correctAnswer: data.correctAnswer,
      sourceUrl: data.sourceUrl,
      hintAnchor: data.hintAnchor,
      type: data.type,
    },
    select: {
      id: true,
      contestId: true,
      sequence: true,
      type: true,
      content: true,
      sourceUrl: true,
      hintAnchor: true,
      publishedAt: true,
      createdAt: true,
    },
  });
}

export async function getActiveContest(language: "en" | "fa" = "en") {
  const now = new Date();
  const active = await prisma.contest.findFirst({
    where: {
      status: "ACTIVE",
      language,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, title: true, description: true, status: true, language: true, startsAt: true, endsAt: true },
  });
  if (active) {
    const challengeNumber = await getChallengeNumberAt(active.startsAt);
    return { ...active, challengeNumber };
  }

  const due = await prisma.contest.findFirst({
    where: {
      status: "SCHEDULED",
      language,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, title: true, description: true, status: true, language: true, startsAt: true, endsAt: true },
  });
  if (due) {
    await prisma.contest.update({ where: { id: due.id }, data: { status: "ACTIVE" } });
    const challengeNumber = await getChallengeNumberAt(due.startsAt);
    return { ...due, status: "ACTIVE" as const, challengeNumber };
  }

  // Do not return the next future round as if it were the current one.
  // If no round is active, the controller invokes recovery to restore a
  // playable round for the current fixed 15-minute window.
  throw new Error("ACTIVE_CONTEST_NOT_FOUND");
}

export async function getCurrentClue(
  userId: string,
  contestId: string
) {
  const contest = await prisma.contest.findUnique({
    where: {
      id: contestId,
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      language: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  const userRestriction = await prisma.user.findUnique({
    where: { id: userId },
    select: { contestParticipationBlocked: true },
  });
  if (userRestriction?.contestParticipationBlocked) {
    throw new Error("CONTEST_PARTICIPATION_BLOCKED");
  }

  const now = new Date();
  const participationBlock = await getLanguageParticipationBlock(userId, contest);
  if (participationBlock) {
    return {
      status: "LANGUAGE_BLOCKED" as const,
      contest,
      serverTime: now,
      participationBlock,
      clue: null,
      currentSequence: null,
      solvedCount: 0,
      solvedAnswers: [],
      lockedUntil: null,
      lockRemainingMs: 0,
    };
  }

  const scheduledRoundIsLive = contest.status === "SCHEDULED"
    && Boolean(contest.startsAt && now >= contest.startsAt)
    && Boolean(!contest.endsAt || now < contest.endsAt);
  if (scheduledRoundIsLive) {
    await prisma.contest.update({ where: { id: contestId }, data: { status: "ACTIVE" } });
  }

  if (contest.status === "SCHEDULED" && contest.startsAt && now < contest.startsAt) {
    return {
      status: "WAITING_FOR_CLUE" as const,
      contest,
      serverTime: now,
      clue: null,
      currentSequence: null,
      solvedCount: 0,
      solvedAnswers: [],
      availableAt: contest.startsAt,
      lockedUntil: null,
      lockRemainingMs: 0,
    };
  }

  if (contest.status !== "ACTIVE" && !scheduledRoundIsLive) {
    throw new Error("CONTEST_NOT_ACTIVE");
  }

  if (contest.startsAt && now < contest.startsAt) {
    throw new Error("CONTEST_NOT_STARTED");
  }

  if (contest.endsAt && now >= contest.endsAt) {
    throw new Error("CONTEST_FINISHED");
  }

  const clues = await prisma.contestClue.findMany({
    where: {
      contestId,
    },
    orderBy: {
      sequence: "asc",
    },
    select: {
      id: true,
      sequence: true,
      type: true,
      content: true,
      publishedAt: true,
      sourceUrl: true,
      hintAnchor: true,
      options: true,
    },
  });

  if (!hasCompleteClueSequence(clues.map((clue) => clue.sequence))) {
    throw new Error("CONTEST_REQUIRES_12_CLUES");
  }

  const correctSubmissions = await prisma.submission.findMany({
    where: {
      userId,
      contestId,
      isCorrect: true,
    },
    orderBy: {
      submittedAt: "asc",
    },
    select: {
      clueId: true,
      answer: true,
      submittedAt: true,
    },
  });

  const solvedClueIds = new Set(
    correctSubmissions.map((submission) => submission.clueId),
  );
  const progress = getContestProgress(clues, solvedClueIds);
  const sequenceByClueId = new Map(clues.map((clue) => [clue.id, clue.sequence]));
  const seenSolvedSequences = new Set<number>();
  const solvedAnswers = correctSubmissions.flatMap((submission) => {
    const sequence = sequenceByClueId.get(submission.clueId);
    if (sequence === undefined || seenSolvedSequences.has(sequence)) return [];
    seenSolvedSequences.add(sequence);
    return [{ sequence, answer: submission.answer }];
  });

  const finalCorrectSubmission = correctSubmissions.find(
    (submission) => sequenceByClueId.get(submission.clueId) === REQUIRED_CLUE_COUNT,
  );

  if (progress.completed || !progress.currentClue) {
    return {
      status: "CONTEST_COMPLETED" as const,
      contest,
      serverTime: now,
      completedAt: finalCorrectSubmission?.submittedAt ?? null,
      clue: null,
      currentSequence: null,
      solvedCount: progress.solvedCount,
      solvedAnswers,
    };
  }

  const currentClue = progress.currentClue;
  const previousClue = clues.find((clue) => clue.sequence === currentClue.sequence - 1);
  const clueAvailableAt = currentClue.sequence === 1
    ? contest.startsAt
    : correctSubmissions.find((submission) => submission.clueId === previousClue?.id)?.submittedAt
      ?? contest.startsAt;
  const latestWrongAttempt = await prisma.submission.findFirst({
    where: { userId, contestId, clueId: currentClue.id, isCorrect: false },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    select: { submittedAt: true },
  });
  const lockedUntil = latestWrongAttempt
    ? new Date(latestWrongAttempt.submittedAt.getTime() + WRONG_ANSWER_LOCK_MS)
    : null;

  return {
    status: "READY" as const,
    contest,
    serverTime: now,
    clue: {
      id: currentClue.id,
      sequence: currentClue.sequence,
      type: currentClue.type,
      content: currentClue.content,
      publishedAt: currentClue.publishedAt ?? clueAvailableAt,
      availableAt: clueAvailableAt,
      sourceUrl: currentClue.sourceUrl,
      hintAnchor: currentClue.hintAnchor,
      options: Array.isArray(currentClue.options)
        ? currentClue.options.filter((option): option is string => typeof option === "string")
        : [],
    },
    currentSequence: currentClue.sequence,
    solvedCount: progress.solvedCount,
    solvedAnswers,
    availableAt: clueAvailableAt,
    lockedUntil: lockedUntil && lockedUntil > now ? lockedUntil : null,
    lockRemainingMs: lockedUntil && lockedUntil > now ? lockedUntil.getTime() - now.getTime() : 0,
  };
}

export async function submitAnswer(
  userId: string,
  contestId: string,
  data: SubmitAnswerInput
) {
  // Serialize all submissions by this user, not only submissions to one round.
  // This prevents parallel requests to different language variants of the same
  // scheduled challenge from bypassing the one-language participation rule.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))) AS advisory_lock`;

  
    // Capture the server-side submission timestamp immediately on entry.
    const now = new Date();
    const contest = await tx.contest.findUnique({
      where: {
        id: contestId,
      },
      select: {
        id: true,
        status: true,
        language: true,
        startsAt: true,
        endsAt: true,
      },
    });
  
    if (!contest) {
      throw new Error("CONTEST_NOT_FOUND");
    }

    const userRestriction = await tx.user.findUnique({
      where: { id: userId },
      select: { contestParticipationBlocked: true },
    });
    if (userRestriction?.contestParticipationBlocked) {
      throw new Error("CONTEST_PARTICIPATION_BLOCKED");
    }
  
    const participationBlock = await getLanguageParticipationBlock(userId, contest);
    if (participationBlock) {
      throw new Error("LANGUAGE_CHALLENGE_ALREADY_COMPLETED");
    }
  
    const scheduledRoundIsLive = contest.status === "SCHEDULED"
      && Boolean(contest.startsAt && now >= contest.startsAt)
      && Boolean(!contest.endsAt || now < contest.endsAt);
    if (scheduledRoundIsLive) {
      await tx.contest.update({ where: { id: contestId }, data: { status: "ACTIVE" } });
    }
  
    if (contest.status !== "ACTIVE" && !scheduledRoundIsLive) {
      throw new Error("CONTEST_NOT_ACTIVE");
    }
  
    if (
      contest.startsAt &&
      now < contest.startsAt
    ) {
      throw new Error("CONTEST_NOT_STARTED");
    }
  
    if (
      contest.endsAt &&
      now >= contest.endsAt
    ) {
      throw new Error("CONTEST_FINISHED");
    }
  
    const clues = await tx.contestClue.findMany({
      where: {
        contestId,
      },
      orderBy: {
        sequence: "asc",
      },
      select: {
        id: true,
        sequence: true,
        content: true,
        correctAnswer: true,
        publishedAt: true,
      },
    });
  
    if (!hasCompleteClueSequence(clues.map((clue) => clue.sequence))) {
      throw new Error("CONTEST_REQUIRES_12_CLUES");
    }
  
    const correctSubmissions = await tx.submission.findMany({
      where: {
        userId,
        contestId,
        isCorrect: true,
      },
      select: {
        clueId: true,
        submittedAt: true,
      },
    });
  
    const solvedClueIds = new Set(
      correctSubmissions.map((submission) => submission.clueId),
    );
    const progress = getContestProgress(clues, solvedClueIds);
  
    if (progress.completed || !progress.currentClue) {
      const finalCorrectSubmission = correctSubmissions.find((submission) =>
        clues.find((clue) => clue.id === submission.clueId)?.sequence === REQUIRED_CLUE_COUNT
      );
      return {
        status: "CONTEST_COMPLETED" as const,
        isCorrect: true,
        responseTimeMs: 0,
        currentSequence: REQUIRED_CLUE_COUNT,
        nextSequence: null,
        completedAt: finalCorrectSubmission?.submittedAt ?? now,
      };
    }
  
    const currentClue = progress.currentClue;
    const previousClue = clues.find((clue) => clue.sequence === currentClue.sequence - 1);
    const clueAvailableAt = currentClue.sequence === 1
      ? contest.startsAt
      : correctSubmissions.find((submission) => submission.clueId === previousClue?.id)?.submittedAt
        ?? contest.startsAt;
  
    if (data.clueId !== currentClue.id) {
      throw new Error("CLUE_NOT_CURRENT");
    }
  
    const latestWrongAttempt = await tx.submission.findFirst({
      where: { userId, contestId, clueId: currentClue.id, isCorrect: false },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      select: { submittedAt: true },
    });
    const lockedUntil = latestWrongAttempt
      ? new Date(latestWrongAttempt.submittedAt.getTime() + WRONG_ANSWER_LOCK_MS)
      : null;
    if (lockedUntil && now < lockedUntil) {
      const error = new Error("CLUE_LOCKED") as Error & { lockedUntil?: string };
      error.lockedUntil = lockedUntil.toISOString();
      throw error;
    }
  
    const existingCorrectSubmission = await tx.submission.findFirst({
      where: {
        userId,
        contestId,
        clueId: currentClue.id,
        isCorrect: true,
      },
      select: {
        id: true,
      },
    });
  
    if (existingCorrectSubmission) {
      throw new Error("CLUE_ALREADY_SOLVED");
    }
  
    const isCorrect =
      normalizeAnswer(data.answer) ===
      normalizeAnswer(currentClue.correctAnswer);
  
    const responseTimeMs = calculateResponseTimeMs(now, [clueAvailableAt]);
  
    await tx.submission.create({
      data: {
        userId,
        contestId,
        clueId: currentClue.id,
        answer: data.answer,
        isCorrect,
        submittedAt: now,
        responseTimeMs: BigInt(responseTimeMs),
      },
    });
  
    if (!isCorrect) {
      return {
        status: "INCORRECT" as const,
        isCorrect: false,
        responseTimeMs,
        currentSequence: currentClue.sequence,
        nextSequence: currentClue.sequence,
      };
    }
  
    const nextClue =
      clues.find(
        (clue) =>
          clue.sequence >
          currentClue.sequence &&
          clue.sequence ===
            currentClue.sequence + 1
      );
  
    if (!nextClue) {
      const firstAttempt = await tx.submission.findFirst({
        where: { userId, contestId },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        select: { submittedAt: true },
      });
      const completionTimeMs = firstAttempt
        ? Math.max(0, now.getTime() - firstAttempt.submittedAt.getTime())
        : 0;
      const suspiciousFastCompletion = completionTimeMs < 120_000;
      if (suspiciousFastCompletion) {
        await tx.securityFlag.upsert({
          where: { userId_contestId: { userId, contestId } },
          update: { completionTimeMs: BigInt(completionTimeMs), reason: "COMPLETED_12_CLUES_UNDER_2_MINUTES" },
          create: {
            userId,
            contestId,
            completionTimeMs: BigInt(completionTimeMs),
            reason: "COMPLETED_12_CLUES_UNDER_2_MINUTES",
          },
        });
      }
      return {
        status: "CONTEST_COMPLETED" as const,
        isCorrect: true,
        responseTimeMs,
        currentSequence: currentClue.sequence,
        nextSequence: null,
        completedAt: now,
        suspiciousFastCompletion,
        completionTimeMs,
      };
    }
  
    return {
      status: "CORRECT" as const,
      isCorrect: true,
      responseTimeMs,
      currentSequence: currentClue.sequence,
      nextSequence: nextClue.sequence,
    };
  
  });
}
