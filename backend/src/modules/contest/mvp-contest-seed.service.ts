import prisma from "../../config/prisma.js";
import { hasCompleteClueSequence } from "./contest.logic.js";

const MVP_CLUES = [
  { content: "عدد بعدی در این دنباله چیست؟ 2، 4، 6، 8، ؟", correctAnswer: "10" },
  { content: "کدام سیاره به نام سیاره سرخ شناخته می‌شود؟", correctAnswer: "مریخ" },
  { content: "یک هفته چند روز دارد؟", correctAnswer: "7" },
  { content: "حاصل 5 ضربدر 3 چند است؟", correctAnswer: "15" },
  { content: "کدام جانور به عنوان پادشاه جنگل شناخته می‌شود؟", correctAnswer: "شیر" },
  { content: "آب در فشار معمولی در چند درجه سانتی‌گراد یخ می‌زند؟", correctAnswer: "0" },
  { content: "حرف بعدی در الگوی الف، ب، پ، ت چیست؟", correctAnswer: "ث" },
  { content: "یک مثلث چند ضلع دارد؟", correctAnswer: "3" },
  { content: "بزرگ‌ترین اقیانوس زمین کدام است؟", correctAnswer: "اقیانوس آرام" },
  { content: "حاصل 12 منهای 5 چند است؟", correctAnswer: "7" },
  { content: "کدام ستاره به زمین نزدیک‌تر است؟", correctAnswer: "خورشید" },
  { content: "در یک ساعت چند دقیقه وجود دارد؟", correctAnswer: "60" },
] as const;

/**
 * Keep a playable MVP contest available without requiring an admin to seed it.
 * Safe to call on every server start: it reuses an existing playable active contest.
 */
export async function ensureMvpActiveContest() {
  const activeContests = await prisma.contest.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      clues: { select: { sequence: true } },
    },
  });

  const now = new Date();
  const playableContest = activeContests.find((contest) =>
    hasCompleteClueSequence(contest.clues.map((clue) => clue.sequence)) &&
    (!contest.startsAt || contest.startsAt <= now) &&
    (!contest.endsAt || contest.endsAt > now),
  );

  if (playableContest) {
    console.log("MVP contest ready:", playableContest.id);
    return playableContest.id;
  }

  // Retire broken/incomplete active records so the player API cannot select one.
  if (activeContests.length > 0) {
    await prisma.contest.updateMany({
      where: {
        id: { in: activeContests.map((contest) => contest.id) },
        status: "ACTIVE",
      },
      data: { status: "FINISHED" },
    });
  }

  const contest = await prisma.contest.create({
    data: {
      title: "مسابقه آزمایشی Wallet Find",
      description: "مسابقه آزمایشی MVP؛ هر ۱۲ سرنخ را به ترتیب حل کن.",
      status: "ACTIVE",
      startsAt: now,
      clues: {
        create: MVP_CLUES.map((clue, index) => ({
          sequence: index + 1,
          type: "TEXT",
          source: "SYSTEM",
          content: clue.content,
          correctAnswer: clue.correctAnswer,
        })),
      },
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      action: "MVP_CONTEST_AUTO_CREATED",
      entity: "Contest",
      entityId: contest.id,
      metadata: { clueCount: MVP_CLUES.length, createdAt: now.toISOString() },
    },
  });

  console.log("Created playable MVP contest:", contest.id);
  return contest.id;
}
