import prisma from "../../config/prisma.js";
import { CHALLENGE_INTERVAL_MS, challengeNumberAt, getChallengeScheduleAnchor } from "./challenge-schedule.js";

export type ChallengeLanguage = "en" | "fa";

export type LanguageParticipationBlock = {
  challengeNumber: number;
  completedLanguage: ChallengeLanguage;
  retryAt: string;
};

type TargetContest = {
  id: string;
  language: string;
  startsAt: Date | null;
};

/**
 * A user may finish only one language variant of a scheduled challenge number.
 * The check is based on the shared server-side schedule number, not the URL,
 * client storage, or the contest record count.
 */
export async function getLanguageParticipationBlock(
  userId: string,
  targetContest: TargetContest,
): Promise<LanguageParticipationBlock | null> {
  const targetStartsAt = targetContest.startsAt;
  if (
    !targetStartsAt ||
    (targetContest.language !== "en" && targetContest.language !== "fa")
  ) {
    return null;
  }

  const targetLanguage = targetContest.language as ChallengeLanguage;
  const otherLanguage: ChallengeLanguage = targetLanguage === "en" ? "fa" : "en";
  const scheduleAnchor = await getChallengeScheduleAnchor();
  const targetChallengeNumber = challengeNumberAt(targetStartsAt, scheduleAnchor);

  const correctSubmissions = await prisma.submission.findMany({
    where: { userId, isCorrect: true },
    select: {
      contestId: true,
      clue: { select: { sequence: true } },
      contest: {
        select: {
          language: true,
          startsAt: true,
        },
      },
    },
  });

  const contestProgress = new Map<string, {
    language: string;
    startsAt: Date | null;
    sequences: Set<number>;
  }>();
  for (const submission of correctSubmissions) {
    let progress = contestProgress.get(submission.contestId);
    if (!progress) {
      progress = {
        language: submission.contest.language,
        startsAt: submission.contest.startsAt,
        sequences: new Set<number>(),
      };
      contestProgress.set(submission.contestId, progress);
    }
    progress.sequences.add(submission.clue.sequence);
  }

  const requiredSequences = Array.from({ length: 12 }, (_value, index) => index + 1);
  const completedOtherLanguage = [...contestProgress.entries()].find(([contestId, progress]) =>
    contestId !== targetContest.id &&
    progress.language === otherLanguage &&
    progress.startsAt !== null &&
    challengeNumberAt(progress.startsAt, scheduleAnchor) === targetChallengeNumber &&
    requiredSequences.every((sequence) => progress.sequences.has(sequence))
  );

  if (!completedOtherLanguage) return null;

  return {
    challengeNumber: targetChallengeNumber,
    completedLanguage: otherLanguage,
    retryAt: new Date(targetStartsAt.getTime() + CHALLENGE_INTERVAL_MS).toISOString(),
  };
}
