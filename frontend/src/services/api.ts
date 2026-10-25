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
    availableAt?: string | null;
    sourceUrl: string | null;
    hintAnchor: string | null;
    options: string[];
  } | null;
  currentSequence: number | null;
  solvedCount: number;
  solvedAnswers: { sequence: number; answer: string }[];
  publishedAt?: string | null;
  availableAt?: string | null;
  serverTime?: string;
  completedAt?: string | null;
  lockedUntil?: string | null;
  lockRemainingMs?: number;
};

export type SubmitAnswerResult = {
  status: "CORRECT" | "INCORRECT" | "CONTEST_COMPLETED";
  isCorrect: boolean;
  responseTimeMs: number;
  currentSequence: number;
  nextSequence: number | null;
  completedAt?: string | null;
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

export type AdminContest = ActiveContest & {
  createdAt: string;
};

export type AdminClueInput = {
  sequence: number;
  content: string;
  correctAnswer: string;
  sourceUrl: string;
  hintAnchor: string;
  type?: "TEXT" | "IMAGE" | "PDF" | "AUDIO" | "VIDEO" | "WEB_PAGE";
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

export async function startNextContest(
  completedContestId: string,
): Promise<ActiveContest> {
  return request<ActiveContest>(
    `/contests/${encodeURIComponent(completedContestId)}/next`,
    { method: "POST" },
    true,
  );
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

export async function createContest(input: {
  title: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
}): Promise<{ contest: AdminContest }> {
  return request<{ contest: AdminContest }>("/contests", {
    method: "POST",
    body: JSON.stringify(input),
  }, true);
}

export async function createClue(
  contestId: string,
  input: AdminClueInput,
): Promise<{ clue: { id: string; sequence: number } }> {
  return request<{ clue: { id: string; sequence: number } }>(
    `/contests/${encodeURIComponent(contestId)}/clues`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    true,
  );
}

export async function activateContest(
  contestId: string,
): Promise<{ contest: AdminContest }> {
  return request<{ contest: AdminContest }>(
    `/admin/contests/${encodeURIComponent(contestId)}/activate`,
    { method: "POST" },
    true,
  );
}

export async function finishContest(
  contestId: string,
): Promise<{ contest: AdminContest }> {
  return request<{ contest: AdminContest }>(
    `/admin/contests/${encodeURIComponent(contestId)}/finish`,
    { method: "POST" },
    true,
  );
}


export type PrizePoolView = {
  contestId: string;
  currency: string;
  testOnly: boolean;
  status: string;
  seeded: string;
  rolloverIn: string;
  total: string;
  awarded: string;
  rolloverOut: string;
  available: string;
  settledAt: string | null;
};

export type PrizePoolLedgerEntry = {
  id: string;
  type: string;
  amount: string;
  note: string;
  createdAt: string;
};

export type PrizePoolAward = {
  username: string;
  rank: number;
  amount: string;
  status: string;
};

export type PrizePoolResult = {
  pool: PrizePoolView;
  ledger: PrizePoolLedgerEntry[];
  awards: PrizePoolAward[];
};

export async function getPrizePool(contestId: string): Promise<PrizePoolResult> {
  return request<PrizePoolResult>(
    `/admin/prize-pool/${encodeURIComponent(contestId)}`,
    {},
    true,
  );
}

export async function testFundPrizePool(
  contestId: string,
  amount: string,
): Promise<{ pool: PrizePoolView }> {
  return request<{ pool: PrizePoolView }>(
    `/admin/prize-pool/${encodeURIComponent(contestId)}/test-fund`,
    { method: "POST", body: JSON.stringify({ amount }) },
    true,
  );
}

export async function settlePrizePool(
  contestId: string,
): Promise<{
  alreadySettled: boolean;
  pool: PrizePoolView;
  completedParticipants?: number;
  awards: PrizePoolAward[];
}> {
  return request<{
    alreadySettled: boolean;
    pool: PrizePoolView;
    completedParticipants?: number;
    awards: PrizePoolAward[];
  }>(
    `/admin/prize-pool/${encodeURIComponent(contestId)}/settle`,
    { method: "POST", body: JSON.stringify({}) },
    true,
  );
}

export async function getContestPrizePool(contestId: string): Promise<{
  pool: PrizePoolView;
  awards: PrizePoolAward[];
}> {
  return request<{
    pool: PrizePoolView;
    awards: PrizePoolAward[];
  }>(
    `/contests/${encodeURIComponent(contestId)}/prize-pool`,
    {},
    true,
  );
}


export type AdminAuditLog = {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  user?: { username: string; email: string } | null;
};

export type AdminOverview = {
  users: number;
  contests: number;
  activeContests: number;
  submissions: number;
  advertiserOrders: number;
  pendingAdPayments: number;
  recentAuditLogs: AdminAuditLog[];
  generatedAt: string;
  note: string;
};

export type SystemSettingRecord = {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

export async function bootstrapAdmin(input: {
  setupSecret: string;
  email: string;
  username: string;
  password: string;
}): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("/admin-bootstrap/bootstrap", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getAdminOverview(): Promise<AdminOverview> {
  return request<AdminOverview>("/admin/overview", {}, true);
}

export async function getSystemSettings(): Promise<SystemSettingRecord[]> {
  return request<SystemSettingRecord[]>("/admin/settings", {}, true);
}

export async function saveSystemSetting(
  key: string,
  value: string,
): Promise<SystemSettingRecord> {
  return request<SystemSettingRecord>(
    "/admin/settings",
    { method: "POST", body: JSON.stringify({ key, value }) },
    true,
  );
}

export async function getAdminAuditLogs(): Promise<AdminAuditLog[]> {
  return request<AdminAuditLog[]>("/admin/audit-logs", {}, true);
}


export type WalletTransaction = {
  id: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  note: string;
  contestId: string | null;
  createdAt: string;
};

export type WalletResult = {
  currency: string;
  simulatedOnly: boolean;
  balance: string;
  availableBalance: string;
  transactions: WalletTransaction[];
};

export async function getWallet(): Promise<WalletResult> {
  return request<WalletResult>("/wallet/me", {}, true);
}

export async function requestWalletDeposit(amount: string): Promise<{ transaction: WalletTransaction; message: string }> {
  return request("/wallet/deposit", { method: "POST", body: JSON.stringify({ amount }) }, true);
}

export async function requestWalletWithdrawal(amount: string): Promise<{ transaction: WalletTransaction; message: string }> {
  return request("/wallet/withdraw", { method: "POST", body: JSON.stringify({ amount }) }, true);
}


export type AdminWalletSummary = {
  userId: string;
  username: string;
  email: string;
  balance: string;
  availableBalance: string;
  pendingDepositRequests: number;
  pendingWithdrawalRequests: number;
};

export async function getAdminWallets(): Promise<AdminWalletSummary[]> {
  return request<AdminWalletSummary[]>("/admin/wallets", {}, true);
}
