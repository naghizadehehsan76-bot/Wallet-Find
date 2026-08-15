import prisma from "../../config/prisma.js";
import { getContestLeaderboard } from "../contest/leaderboard.service.js";

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      createdAt: true,
      submissions: {
        select: {
          contestId: true,
          clueId: true,
          isCorrect: true,
        },
      },
    },
  });

  if (!user) throw new Error("USER_NOT_FOUND");

  const contestIds = new Set(user.submissions.map((s) => s.contestId));
  const solvedClues = new Set(
    user.submissions
      .filter((s) => s.isCorrect)
      .map((s) => `${s.contestId}:${s.clueId}`),
  );
  const completedContestIds = new Set<string>();

  for (const contestId of contestIds) {
    const solved = [...solvedClues].filter((key) =>
      key.startsWith(`${contestId}:`),
    ).length;
    if (solved >= 12) completedContestIds.add(contestId);
  }

  let bestRank: number | null = null;

  for (const contestId of completedContestIds) {
    try {
      const leaderboard = await getContestLeaderboard(contestId);
      const entry = leaderboard.entries.find(
        (candidate) => candidate.userId === userId,
      );

      if (entry && (bestRank === null || entry.rank < bestRank)) {
        bestRank = entry.rank;
      }
    } catch {
      // Keep the rest of the profile available if an old leaderboard is unavailable.
    }
  }

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    contestsParticipated: contestIds.size,
    completedContests: completedContestIds.size,
    solvedKeys: solvedClues.size,
    incorrectAttempts: user.submissions.filter((s) => !s.isCorrect).length,
    bestRank,
  };
}
