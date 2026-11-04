import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { CHALLENGE_INTERVAL_MS } from "./challenge-schedule.js";
import { getLanguageParticipationBlock } from "./language-participation.js";
import { CHALLENGE_LANGUAGES } from "./supported-languages.js";
import { updateLanguagePreferences } from "../profile/profile.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);
const scheduleKey = "challenge_schedule_anchor_global";

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("all ten language variants share one completion guard and account locale preferences persist", {
  skip: !shouldRun,
}, async () => {
  const suffix = randomUUID();
  const userId = "ci-language-user-" + suffix;
  const contestIds: string[] = [];
  const originalAnchor = await prisma.systemSetting.findUnique({ where: { key: scheduleKey } });
  const startsAtMs = Math.floor((Date.now() - CHALLENGE_INTERVAL_MS * 2) / CHALLENGE_INTERVAL_MS) * CHALLENGE_INTERVAL_MS;
  const startsAt = new Date(startsAtMs);

  try {
    await prisma.systemSetting.upsert({
      where: { key: scheduleKey },
      create: { key: scheduleKey, value: JSON.stringify({ challengeNumber: 1, startsAt: startsAt.toISOString() }) },
      update: { value: JSON.stringify({ challengeNumber: 1, startsAt: startsAt.toISOString() }) },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: userId + "@example.invalid",
        username: userId,
        passwordHash: "ci-only-not-a-real-password",
      },
    });

    for (const language of CHALLENGE_LANGUAGES) {
      const contest = await prisma.contest.create({
        data: {
          title: "CI " + language + " challenge",
          language,
          status: "FINISHED",
          startsAt,
          endsAt: new Date(startsAt.getTime() + CHALLENGE_INTERVAL_MS),
        },
        select: { id: true },
      });
      contestIds.push(contest.id);
    }

    const completedContestId = contestIds[0];
    assert.ok(completedContestId);
    const clues = await prisma.contestClue.createMany({
      data: Array.from({ length: 12 }, (_value, index) => ({
        contestId: completedContestId,
        sequence: index + 1,
        content: "CI multilingual clue " + (index + 1),
        correctAnswer: "answer" + (index + 1),
      })),
    });
    assert.equal(clues.count, 12);

    const clueRows = await prisma.contestClue.findMany({
      where: { contestId: completedContestId },
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true },
    });
    await prisma.submission.createMany({
      data: clueRows.map((clue) => ({
        userId,
        contestId: completedContestId,
        clueId: clue.id,
        answer: "answer" + clue.sequence,
        isCorrect: true,
        submittedAt: new Date(startsAt.getTime() + clue.sequence * 1000),
      })),
    });

    const completedLanguage = CHALLENGE_LANGUAGES[0];
    assert.equal(completedLanguage, "fa");
    for (let index = 0; index < CHALLENGE_LANGUAGES.length; index += 1) {
      const language = CHALLENGE_LANGUAGES[index];
      const contestId = contestIds[index];
      assert.ok(language && contestId);
      const block = await getLanguageParticipationBlock(userId, {
        id: contestId,
        language,
        startsAt,
      });
      if (language === completedLanguage) {
        assert.equal(block, null);
      } else {
        assert.equal(block?.completedLanguage, completedLanguage);
        assert.equal(block?.challengeNumber, 1);
      }
    }

    const saved = await updateLanguagePreferences(userId, "de", "zh-CN");
    assert.deepEqual(saved, { uiLanguage: "de", challengeLanguage: "zh-CN" });
  } finally {
    if (contestIds.length) await prisma.contest.deleteMany({ where: { id: { in: contestIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    if (originalAnchor) {
      await prisma.systemSetting.upsert({
        where: { key: scheduleKey },
        create: { key: scheduleKey, value: originalAnchor.value },
        update: { value: originalAnchor.value },
      });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: scheduleKey } });
    }
  }
});
