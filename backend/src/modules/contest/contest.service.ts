import prisma from "../../config/prisma.js";
import type { CreateContestInput } from "./contest.schema.js";

export async function createContest(
  data: CreateContestInput
) {
  return prisma.contest.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      startsAt: data.startsAt
        ? new Date(data.startsAt)
        : null,
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
import type { CreateClueInput } from "./contest.schema.js";

export async function createClue(
  contestId: string,
  data: CreateClueInput
) {
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