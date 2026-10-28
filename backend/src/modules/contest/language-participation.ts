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
  now = new Date(),
): Promise<LanguageParticipationBlock | null> {
  if (
    !targetContest.startsAt ||
    (targetContest.language !== "en" && targetContest.language !== "fa")
  ) {
    return null;
  }

  const targetLanguage = targetContest.language as ChallengeLanguage;
  const otherLanguage: ChallengeLanguage = targetLanguage === "en" ? "fa" : "en";
  const scheduleAnchor = await getChallengeScheduleAnchor();
  const targetChallengeNumber = challengeNumberAt(targetContest.startsAt, scheduleAnchor);

  const finalCorrectSubmissions = await prisma.submission.findMany({
    where: {
      userId,
      isCorrect: true,
      clue: { sequence: 12 },
    },
    select: {
      contestId: true,
      contest: {
        select: {
          language: true,
          startsAt: true,
        },
      },
    },
  });

  const candidateContestIds = [...new Set(
    finalCorrectSubmissions
      .filter((submission) =>
        submission.contestId !== targetContest.id &&
        submission.contest.language === otherLanguage &&
        submission.contest.startsAt !== null &&
        challengeNumberAt(submission.contest.startsAt, scheduleAnchor) === targetChallengeNumber
      )
      .map((submission) => submission.contestId),
  )];

  if (candidateContestIds.length === 0) return null;

  // A correct answer on cell 12 normally implies that the earlier cells were
  // solved in order. Verify the complete 1..12 set as a defensive check before
  // enforcing the cross-language block.
  const correctSubmissions = await prisma.submission.findMany({
    where: {
      userId,
      contestId: { in: candidateContestIds },
      isCorrect: true,
    },
    select: {
      contestId: true,
      clue: { select: { sequence: true } },
    },
  });

  const solvedByContest = new Map<string, Set<number>>();
  for (const submission of correctSubmissions) {
    let sequences = solvedByContest.get(submission.contestId);
    if (!sequences) {
      sequences = new Set<number>();
      solvedByContest.set(submission.contestId, sequences);
    }
    sequences.add(submission.clue.sequence);
  }

  const completedOtherLanguage = finalCorrectSubmissions.find((submission) => {
    if (!candidateContestIds.includes(submission.contestId)) return false;
    const sequences = solvedByContest.get(submission.contestId);
    return Boolean(sequences && Array.from({ length: 12 }, (_value, index) => index + 1)
      .every((sequence) => sequences.has(sequence)));
  });

  if (!completedOtherLanguage) return null;

  return {
    challengeNumber: targetChallengeNumber,
    completedLanguage: otherLanguage,
    retryAt: new Date(targetContest.startsAt.getTime() + CHALLENGE_INTERVAL_MS).toISOString(),
  };
}
