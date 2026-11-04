import prisma from "../../config/prisma.js";
import { CHALLENGE_INTERVAL_MS, challengeNumberAt, getChallengeScheduleAnchor } from "./challenge-schedule.js";
import { isChallengeLanguage, type ChallengeLanguage } from "./supported-languages.js";

export type { ChallengeLanguage } from "./supported-languages.js";

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
 * A user may complete only one language variant of a scheduled challenge
 * number. The restriction applies to every supported language, not just the
 * original Persian/English pair, and is checked against server-side progress.
 */
export async function getLanguageParticipationBlock(
  userId: string,
  targetContest: TargetContest,
): Promise<LanguageParticipationBlock | null> {
  const targetStartsAt = targetContest.startsAt;
  if (!targetStartsAt || !isChallengeLanguage(targetContest.language)) return null;

  const targetLanguage = targetContest.language;
  const scheduleAnchor = await getChallengeScheduleAnchor();
  const targetChallengeNumber = challengeNumberAt(targetStartsAt, scheduleAnchor);

  const correctSubmissions = await prisma.submission.findMany({
    where: { userId, isCorrect: true },
    select: {
      contestId: true,
      clue: { select: { sequence: true } },
      contest: { select: { language: true, startsAt: true } },
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
    progress.language !== targetLanguage &&
    isChallengeLanguage(progress.language) &&
    progress.startsAt !== null &&
    challengeNumberAt(progress.startsAt, scheduleAnchor) === targetChallengeNumber &&
    requiredSequences.every((sequence) => progress.sequences.has(sequence))
  );

  if (!completedOtherLanguage) return null;

  const completedLanguage = contestProgress.get(completedOtherLanguage[0])?.language;
  if (!isChallengeLanguage(completedLanguage)) return null;

  return {
    challengeNumber: targetChallengeNumber,
    completedLanguage,
    retryAt: new Date(targetStartsAt.getTime() + CHALLENGE_INTERVAL_MS).toISOString(),
  };
}
