import prisma from "../../config/prisma.js";
import { isChallengeLanguage } from "../contest/supported-languages.js";

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      createdAt: true,
      avatarDataUrl: true,
      uiLanguage: true,
      challengeLanguage: true,
      submissions: {
        select: {
          contestId: true,
          clueId: true,
          isCorrect: true,
          responseTimeMs: true,
          submittedAt: true,
        },
      },
    },
  });

  if (!user) throw new Error("USER_NOT_FOUND");

  const contestIds = new Set(user.submissions.map((s) => s.contestId));
  const solvedClues = new Set(
    user.submissions.filter((s) => s.isCorrect).map((s) => `${s.contestId}:${s.clueId}`),
  );
  const completedContestIds = new Set<string>();

  for (const contestId of contestIds) {
    const solved = [...solvedClues].filter((key) => key.startsWith(`${contestId}:`)).length;
    if (solved >= 12) completedContestIds.add(contestId);
  }

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    avatarDataUrl: user.avatarDataUrl,
    contestsParticipated: contestIds.size,
    completedContests: completedContestIds.size,
    solvedKeys: solvedClues.size,
    incorrectAttempts: user.submissions.filter((s) => !s.isCorrect).length,
    bestRank: null,
  };
}

export async function updateLanguagePreferences(
  userId: string,
  uiLanguage: string,
  challengeLanguage: string,
) {
  if (!isChallengeLanguage(uiLanguage) || !isChallengeLanguage(challengeLanguage)) {
    throw new Error("UNSUPPORTED_LANGUAGE");
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { uiLanguage, challengeLanguage },
    select: { uiLanguage: true, challengeLanguage: true },
  });
  return user;
}
