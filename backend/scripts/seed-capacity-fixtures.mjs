import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "../dist/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
const prisma = new PrismaClient({ adapter });

try {
  const prefix = "capacity-" + randomUUID().replaceAll("-", "").slice(0, 12);
  const now = new Date();
  const startsAt = new Date(now.getTime() - 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() - 45 * 60 * 1000);

  const contest = await prisma.contest.create({
    data: {
      title: "CI capacity fixture",
      description: "Temporary synthetic data for isolated CI load testing.",
      status: "FINISHED",
      language: "en",
      startsAt,
      endsAt,
    },
  });

  await prisma.contestClue.createMany({
    data: Array.from({ length: 12 }, (_, index) => ({
      contestId: contest.id,
      sequence: index + 1,
      type: "TEXT",
      source: "SYSTEM",
      content: "Synthetic capacity-test clue " + (index + 1),
      correctAnswer: "answer-" + (index + 1),
      publishedAt: startsAt,
    })),
  });

  await prisma.user.createMany({
    data: Array.from({ length: 80 }, (_, index) => ({
      email: `${prefix}-${index}@capacity.invalid`,
      username: `${prefix}_${index}`,
      passwordHash: "ci-only-not-a-real-password-hash",
      role: "USER",
      uiLanguage: "en",
      challengeLanguage: "en",
    })),
  });

  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
    orderBy: { email: "asc" },
  });
  const clues = await prisma.contestClue.findMany({
    where: { contestId: contest.id },
    select: { id: true, sequence: true },
    orderBy: { sequence: "asc" },
  });

  const submissions = [];
  for (let userIndex = 0; userIndex < users.length; userIndex += 1) {
    for (const clue of clues) {
      submissions.push({
        userId: users[userIndex].id,
        contestId: contest.id,
        clueId: clue.id,
        answer: "answer-" + clue.sequence,
        isCorrect: true,
        submittedAt: new Date(startsAt.getTime() + userIndex * 1000 + clue.sequence * 100),
        responseTimeMs: BigInt(userIndex * 1000 + clue.sequence * 100),
      });
    }
  }
  await prisma.submission.createMany({ data: submissions });

  const token = jwt.sign(
    { userId: users[0].id, role: "USER" },
    process.env.JWT_SECRET,
    { expiresIn: "20m" },
  );
  const envFile = process.env.GITHUB_ENV;
  if (!envFile) throw new Error("GITHUB_ENV is not available");
  await appendFile(
    envFile,
    `CAPACITY_TOKEN=${token}\nCAPACITY_CONTEST_ID=${contest.id}\nCAPACITY_USER_PREFIX=${prefix}\n`,
  );

  console.log(JSON.stringify({
    fixture: "created",
    participants: users.length,
    clues: clues.length,
    submissions: submissions.length,
    contestId: contest.id,
  }));
} finally {
  await prisma.$disconnect();
}
