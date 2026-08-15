const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "/api";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
};

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string;
  createdAt: string;
};

export type AuthResult = {
  user: AuthUser;
  token: string;
};

export type ActiveContest = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type CurrentClueResult = {
  status: "READY" | "WAITING_FOR_CLUE" | "CONTEST_COMPLETED";
  contest: ActiveContest;
  clue: {
    id: string;
    sequence: number;
    type: string;
    content: string;
    publishedAt: string | null;
  } | null;
  currentSequence: number | null;
  solvedCount: number;
  publishedAt?: string;
};

export type SubmitAnswerResult = {
  status: "CORRECT" | "INCORRECT" | "CONTEST_COMPLETED";
  isCorrect: boolean;
  responseTimeMs: number;
  currentSequence: number;
  nextSequence: number | null;
};

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  username: string;
  solvedCount: number;
  totalResponseTimeMs: number;
  incorrectAttempts: number;
  completed: boolean;
};

export type LeaderboardResult = {
  contestId: string;
  entries: LeaderboardEntry[];
};

export type ProfileResult = {
  id: string;
  email: string;
  username: string;
  role: string;
  createdAt: string;
  contestsParticipated: number;
  completedContests: number;
  solvedKeys: number;
  incorrectAttempts: number;
  bestRank: number | null;
};

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  authenticated = false,
): Promise<T> {
  const token = localStorage.getItem("walletFindToken");
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (authenticated && token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  let result: ApiResponse<T>;
  try {
    result = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new Error("INVALID_SERVER_RESPONSE");
  }

  if (!response.ok || !result.success) {
    throw new Error(result.error ?? "REQUEST_FAILED");
  }

  if (result.data === undefined) {
    throw new Error("MISSING_RESPONSE_DATA");
  }

  return result.data;
}

export async function register(
  email: string,
  username: string,
  password: string,
): Promise<AuthResult> {
  return request<AuthResult>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResult> {
  return request<AuthResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getActiveContest(): Promise<ActiveContest> {
  return request<ActiveContest>("/contests/active", {}, true);
}

export async function getCurrentClue(
  contestId: string,
): Promise<CurrentClueResult> {
  return request<CurrentClueResult>(
    `/contests/${encodeURIComponent(contestId)}/current-clue`,
    {},
    true,
  );
}

export async function submitAnswer(
  contestId: string,
  clueId: string,
  answer: string,
): Promise<SubmitAnswerResult> {
  return request<SubmitAnswerResult>(
    `/contests/${encodeURIComponent(contestId)}/submit`,
    {
      method: "POST",
      body: JSON.stringify({ clueId, answer }),
    },
    true,
  );
}

export async function getLeaderboard(
  contestId: string,
): Promise<LeaderboardResult> {
  return request<LeaderboardResult>(
    `/contests/${encodeURIComponent(contestId)}/leaderboard`,
    {},
    true,
  );
}

export async function getProfile(): Promise<ProfileResult> {
  return request<ProfileResult>("/profile/me", {}, true);
}
