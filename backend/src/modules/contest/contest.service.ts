import prisma from "../../config/prisma.js";

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
} from "./contest.logic.js";

export async function createContest(
  data: CreateContestInput
) {
  const startsAt = data.startsAt
    ? new Date(data.startsAt)
    : null;

  return prisma.contest.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      status: startsAt ? "SCHEDULED" : "DRAFT",
      startsAt,
      endsAt: data.endsAt
        ? new Date(data.endsAt)
        : null,
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

export async function getActiveContest() {
  const contest = await prisma.contest.findFirst({
    where: {
      status: "ACTIVE",
    },
    orderBy: [
      { startsAt: "asc" },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!contest) {
    throw new Error("ACTIVE_CONTEST_NOT_FOUND");
  }

  const now = new Date();

  if (contest.startsAt && now < contest.startsAt) {
    throw new Error("CONTEST_NOT_STARTED");
  }

  if (contest.endsAt && now >= contest.endsAt) {
    throw new Error("CONTEST_FINISHED");
  }

  return contest;
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
      startsAt: true,
      endsAt: true,
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  if (contest.status !== "ACTIVE") {
    throw new Error("CONTEST_NOT_ACTIVE");
  }

  const now = new Date();

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

  if (progress.completed || !progress.currentClue) {
    return {
      status: "CONTEST_COMPLETED" as const,
      contest,
      clue: null,
      currentSequence: null,
      solvedCount: progress.solvedCount,
      solvedAnswers,
    };
  }

  const currentClue = progress.currentClue;

  if (
    currentClue.publishedAt &&
    now < currentClue.publishedAt
  ) {
    return {
      status: "WAITING_FOR_CLUE" as const,
      contest,
      clue: null,
      currentSequence: currentClue.sequence,
      solvedCount: progress.solvedCount,
      solvedAnswers,
      publishedAt: currentClue.publishedAt,
    };
  }

  return {
    status: "READY" as const,
    contest,
    clue: {
      id: currentClue.id,
      sequence: currentClue.sequence,
      type: currentClue.type,
      content: currentClue.content,
      publishedAt: currentClue.publishedAt,
      sourceUrl: currentClue.sourceUrl,
      hintAnchor: currentClue.hintAnchor,
      options: Array.isArray(currentClue.options)
        ? currentClue.options.filter((option): option is string => typeof option === "string")
        : [],
    },
    currentSequence: currentClue.sequence,
    solvedCount: progress.solvedCount,
    solvedAnswers,
  };
}

export async function submitAnswer(
  userId: string,
  contestId: string,
  data: SubmitAnswerInput
) {
  const contest = await prisma.contest.findUnique({
    where: {
      id: contestId,
    },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  if (contest.status !== "ACTIVE") {
    throw new Error("CONTEST_NOT_ACTIVE");
  }

  const now = new Date();

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
      content: true,
      correctAnswer: true,
      publishedAt: true,
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
    select: {
      clueId: true,
    },
  });

  const solvedClueIds = new Set(
    correctSubmissions.map((submission) => submission.clueId),
  );
  const progress = getContestProgress(clues, solvedClueIds);

  if (progress.completed || !progress.currentClue) {
    return {
      status: "CONTEST_COMPLETED" as const,
      isCorrect: true,
      responseTimeMs: 0,
      currentSequence: REQUIRED_CLUE_COUNT,
      nextSequence: null,
    };
  }

  const currentClue = progress.currentClue;

  if (data.clueId !== currentClue.id) {
    throw new Error("CLUE_NOT_CURRENT");
  }

  if (
    currentClue.publishedAt &&
    now < currentClue.publishedAt
  ) {
    throw new Error("CLUE_NOT_PUBLISHED");
  }

  const existingCorrectSubmission = await prisma.submission.findFirst({
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

  let previousCorrectSubmittedAt: Date | null = null;

  if (currentClue.sequence > 1) {
    const previousClue = await prisma.contestClue.findUnique({
      where: {
        contestId_sequence: {
          contestId,
          sequence: currentClue.sequence - 1,
        },
      },
      select: { id: true },
    });

    if (previousClue) {
      const previousCorrectSubmission = await prisma.submission.findFirst({
        where: {
          userId,
          contestId,
          clueId: previousClue.id,
          isCorrect: true,
        },
        select: { submittedAt: true },
        orderBy: { submittedAt: "asc" },
      });

      previousCorrectSubmittedAt =
        previousCorrectSubmission?.submittedAt ?? null;
    }
  }

  const responseTimeMs = calculateResponseTimeMs(now, [
    currentClue.publishedAt,
    currentClue.sequence === 1 ? contest.startsAt : null,
    previousCorrectSubmittedAt,
  ]);

  await prisma.submission.create({
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
    return {
      status: "CONTEST_COMPLETED" as const,
      isCorrect: true,
      responseTimeMs,
      currentSequence: currentClue.sequence,
      nextSequence: null,
    };
  }

  return {
    status: "CORRECT" as const,
    isCorrect: true,
    responseTimeMs,
    currentSequence: currentClue.sequence,
    nextSequence: nextClue.sequence,
  };
}
