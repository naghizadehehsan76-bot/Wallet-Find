import prisma from "../../config/prisma.js";

import type {
  CreateContestInput,
  CreateClueInput,
  SubmitAnswerInput,
} from "./contest.schema.js";

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

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
    },
  });

  if (!contest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  return prisma.contestClue.create({
    data: {
      contestId,
      sequence: data.sequence,
      content: data.content,
      correctAnswer: data.correctAnswer,
      type: data.type,
    },

    select: {
      id: true,
      contestId: true,
      sequence: true,
      type: true,
      content: true,
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

  if (contest.endsAt && now > contest.endsAt) {
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

  if (contest.endsAt && now > contest.endsAt) {
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
    },
  });

  if (clues.length === 0) {
    throw new Error("NO_CLUES_AVAILABLE");
  }

  const correctSubmissions =
    await prisma.submission.findMany({
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
    correctSubmissions.map(
      (submission) => submission.clueId
    )
  );

  const currentClue = clues.find(
    (clue) => !solvedClueIds.has(clue.id)
  );

  if (!currentClue) {
    return {
      status: "CONTEST_COMPLETED" as const,
      contest,
      clue: null,
      currentSequence: null,
      solvedCount: clues.length,
    };
  }

  if (
    currentClue.publishedAt &&
    now < currentClue.publishedAt
  ) {
    return {
      status: "WAITING_FOR_CLUE" as const,
      contest,
      clue: null,
      currentSequence: currentClue.sequence,
      solvedCount: solvedClueIds.size,
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
    },
    currentSequence: currentClue.sequence,
    solvedCount: solvedClueIds.size,
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
    now > contest.endsAt
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

  if (clues.length === 0) {
    throw new Error("NO_CLUES_AVAILABLE");
  }

  const correctSubmissions =
    await prisma.submission.findMany({
      where: {
        userId,
        contestId,
        isCorrect: true,
      },
      select: {
        clueId: true,
        submittedAt: true,
      },
      orderBy: {
        submittedAt: "desc",
      },
    });

  const solvedClueIds = new Set(
    correctSubmissions.map(
      (submission) => submission.clueId
    )
  );

  const currentClue = clues.find(
    (clue) => !solvedClueIds.has(clue.id)
  );

  if (!currentClue) {
    return {
      status: "CONTEST_COMPLETED" as const,
      isCorrect: true,
      responseTimeMs: 0,
      currentSequence: 12,
      nextSequence: null,
    };
  }

  if (data.clueId !== currentClue.id) {
    throw new Error("CLUE_NOT_CURRENT");
  }

  if (
    currentClue.publishedAt &&
    now < currentClue.publishedAt
  ) {
    throw new Error("CLUE_NOT_PUBLISHED");
  }

  const existingCorrectSubmission =
    await prisma.submission.findFirst({
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

  let referenceTime =
    currentClue.publishedAt ??
    contest.startsAt ??
    now;

  if (currentClue.sequence > 1) {
    const previousClue =
      await prisma.contestClue.findUnique({
        where: {
          contestId_sequence: {
            contestId,
            sequence: currentClue.sequence - 1,
          },
        },
        select: {
          id: true,
        },
      });

    if (previousClue) {
      const previousCorrectSubmission =
        await prisma.submission.findFirst({
          where: {
            userId,
            contestId,
            clueId: previousClue.id,
            isCorrect: true,
          },
          select: {
            submittedAt: true,
          },
          orderBy: {
            submittedAt: "asc",
          },
        });

      if (previousCorrectSubmission) {
        referenceTime =
          previousCorrectSubmission.submittedAt;
      }
    }
  }

  const responseTimeMs =
    Math.max(
      0,
      now.getTime() -
        referenceTime.getTime()
    );

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
