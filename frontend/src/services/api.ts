const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "/api";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
};

const SESSION_INVALIDATION_ERRORS = new Set([
  "TOKEN_EXPIRED",
  "INVALID_TOKEN",
  "INVALID_AUTHORIZATION_HEADER",
  "AUTHENTICATION_REQUIRED",
]);

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

export type PublicSiteStats = {
  onlineUsers: number;
  totalUsers: number;
  updatedAt: string;
};

export async function getPublicSiteStats(): Promise<PublicSiteStats> {
  return request<PublicSiteStats>("/stats/site");
}

export type PublicPrizePoolStats = {
  totalPool: string;
  currentRoundPool: string;
  totalRoundAllocations: string;
  totalPrizesAwarded: string;
  currency: "USDT";
  updatedAt: string;
};

export async function getPublicPrizePoolStats(language: "fa" | "en"): Promise<PublicPrizePoolStats> {
  return request<PublicPrizePoolStats>(`/stats/prize-pools?language=${language}`);
}

export async function sendOnlineHeartbeat(): Promise<{ recorded: boolean }> {
  return request<{ recorded: boolean }>("/stats/heartbeat", { method: "POST" }, true);
}

export type LanguageParticipationBlock = {
  challengeNumber: number;
  completedLanguage: "fa" | "en";
  retryAt: string;
};

export type ActiveContest = {
  id: string;
  challengeNumber?: number;
  title: string;
  description: string | null;
  status: string;
  language?: string;
  startsAt: string | null;
  endsAt: string | null;
  serverTime?: string;
  participationBlock?: LanguageParticipationBlock | null;
};

export type CurrentClueResult = {
  status: "READY" | "WAITING_FOR_CLUE" | "CONTEST_COMPLETED" | "LANGUAGE_BLOCKED";
  participationBlock?: LanguageParticipationBlock | null;
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

export type LeaderboardHistoryEntry = LeaderboardEntry & {
  prizeEarned: string;
  totalPrizeEarned: string;
  prizeStatus: string | null;
};

export type LeaderboardRound = {
  id: string;
  number: number;
  title: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  entries: LeaderboardHistoryEntry[];
};

export async function getLeaderboardHistory(): Promise<{ rounds: LeaderboardRound[] }> {
  return request<{ rounds: LeaderboardRound[] }>("/contests/leaderboard-history", {}, true);
}

export type ProfileResult = {
  id: string;
  email: string;
  username: string;
  role: string;
  createdAt: string;
  avatarDataUrl: string | null;
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
    const errorCode = result.error ?? "REQUEST_FAILED";
    const isCurrentSessionFailure =
      authenticated &&
      Boolean(token) &&
      localStorage.getItem("walletFindToken") === token &&
      response.status === 401 &&
      SESSION_INVALIDATION_ERRORS.has(errorCode);

    if (isCurrentSessionFailure) {
      localStorage.removeItem("walletFindToken");
      localStorage.removeItem("walletFindUser");
      window.dispatchEvent(new Event("wallet-find:session-expired"));
    }

    throw new Error(errorCode);
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
  language: "fa" | "en" = "en",
): Promise<{ email: string; verificationRequired: boolean }> {
  return request<{ email: string; verificationRequired: boolean }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password, language }),
  });
}

export async function verifyEmail(email: string, code: string): Promise<AuthResult> {
  return request<AuthResult>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function resendVerification(email: string, language: "fa" | "en" = "en"): Promise<{ requested: boolean }> {
  return request<{ requested: boolean }>("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email, language }),
  });
}

export async function forgotPassword(email: string, language: "fa" | "en" = "en"): Promise<{ requested: boolean }> {
  return request<{ requested: boolean }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email, language }),
  });
}

export async function resetPassword(email: string, code: string, password: string): Promise<{ passwordReset: boolean }> {
  return request<{ passwordReset: boolean }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ email, code, password }),
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

export async function getActiveContest(language?: "fa" | "en"): Promise<ActiveContest> {
  const selectedLanguage = language ?? (localStorage.getItem("walletFindContestLanguage") === "fa" ? "fa" : "en");
  return request<ActiveContest>(`/contests/active?language=${selectedLanguage}`, {}, true);
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

export type ContestSourceVisitResult = {
  visitId: string;
  trackingToken: string;
  sourceUrl: string;
  recordedAt: string;
  advertiserAttributed: boolean;
  alreadyRecorded: boolean;
};

export async function recordContestSourceVisit(
  contestId: string,
  clueId: string,
): Promise<ContestSourceVisitResult> {
  return request<ContestSourceVisitResult>(
    `/contests/${encodeURIComponent(contestId)}/clues/${encodeURIComponent(clueId)}/source-visit`,
    { method: "POST", body: JSON.stringify({}) },
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

export async function uploadProfileAvatar(avatarDataUrl: string): Promise<{ avatarDataUrl: string }> {
  return request<{ avatarDataUrl: string }>("/profile/avatar", {
    method: "POST",
    body: JSON.stringify({ avatarDataUrl }),
  }, true);
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
  projectProfit: string;
  rolloverOut: string;
  available: string;
  unused: string;
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


export type AdminSourceVisit = {
  id: string;
  userId: string | null;
  username: string;
  contestId: string | null;
  contestTitle: string;
  contestLanguage: string;
  contestStartsAt: string | null;
  clueId: string | null;
  clueSequence: number;
  sourceUrl: string;
  sourceHostname: string;
  advertiserContentId: string | null;
  advertiserContentTitle: string | null;
  advertiserName: string | null;
  advertisementOrderId: string | null;
  externalVerificationStatus: "NOT_CONFIGURED" | "PENDING" | "CONFIRMED" | "REJECTED";
  externalConfirmedAt: string | null;
  externalVerificationProvider: string | null;
  externalReferenceId: string | null;
  createdAt: string;
};

export type AdminAdvertiserPerformance = {
  advertisementOrderId: string;
  advertiserName: string;
  contentTitle: string | null;
  destinationUrl: string | null;
  clickCount: number;
  uniqueVisitors: number;
  orderStatus: string;
};

export type AdminDestinationPerformance = {
  sourceUrl: string;
  sourceHostname: string;
  clickCount: number;
  uniqueVisitors: number;
};

export type AdminSourceVisitReport = {
  summary: {
    totalClicks: number;
    uniqueVisitors: number;
    advertiserAttributedClicks: number;
    advertiserUniqueVisitors: number;
    partnerConfirmedVisits: number;
    pendingExternalVerificationVisits: number;
    notConfiguredExternalVerificationVisits: number;
    rejectedExternalVerificationVisits: number;
  };
  advertiserPerformance: AdminAdvertiserPerformance[];
  destinationPerformance: AdminDestinationPerformance[];
  recentVisits: AdminSourceVisit[];
  recentVisitsLimit: number;
  generatedAt: string;
  proofNote: string;
  verificationNote: string;
};

export async function getAdminSourceVisitReport(): Promise<AdminSourceVisitReport> {
  return request<AdminSourceVisitReport>("/admin/source-visit-report", {}, true);
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

export type AdminProjectProfitPool = {
  balance: string;
  totalContributed: string;
  currency: "USDT";
  updatedAt: string;
  ledger: Array<{
    id: string;
    type: string;
    amount: string;
    effectiveAt: string;
    note: string;
    createdAt: string;
  }>;
};

export async function getAdminProjectProfitPool(): Promise<AdminProjectProfitPool> {
  return request<AdminProjectProfitPool>("/admin/project-profit-pool", {}, true);
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

export type WalletAssetView = {
  id: string;
  symbol: string;
  displayName: string;
  assetType: "NATIVE" | "TOKEN";
  assetReference: string;
  contractAddress: string | null;
  decimals: number;
  issuerClassification: string;
  verificationStatus: "PENDING_VERIFICATION" | "VERIFIED" | "REVIEW_REQUIRED" | "REJECTED";
  minDeposit: string | null;
  confirmationCount: number;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  balance: string;
  availableBalance: string;
  reservedBalance: string;
};

export type WalletNetworkView = {
  id: string;
  family: "EVM" | "BITCOIN" | "SOLANA";
  chainId: number | null;
  networkKey: string;
  displayName: string;
  nativeAssetSymbol: string;
  nativeAssetDecimals: number;
  explorerTransactionUrlTemplate: string | null;
  finalityDepth: number;
  isEnabled: boolean;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  address: string | null;
  assets: WalletAssetView[];
};

export type WalletChainActivity = {
  id: string;
  type: "DEPOSIT" | "WITHDRAWAL";
  networkId: string;
  network: string;
  asset: string;
  amount: string;
  status: string;
  transactionHash: string | null;
  explorerUrl: string | null;
  confirmationCount: number;
  detectedAt?: string;
  requestedAt?: string;
  creditedAt?: string | null;
  confirmedAt?: string | null;
  estimatedFee?: string | null;
  actualFee?: string | null;
  feeAsset?: string | null;
  reviewReason?: string | null;
  failureCode?: string | null;
};

export type WalletResult = {
  currency: string;
  balance: string;
  availableBalance: string;
  legacyBalance: string;
  legacyAvailableBalance: string;
  walletAddress?: string | null;
  turnkeyConfigured?: boolean;
  supportedNetworks?: Array<{
    chainId: number;
    networkKey: string;
    depositEnabled: boolean;
    withdrawalEnabled: boolean;
  }>;
  networks: WalletNetworkView[];
  onChainDeposits: WalletChainActivity[];
  onChainWithdrawals: WalletChainActivity[];
  transactions: WalletTransaction[];
};

export type WalletDepositDetails = {
  networkId: string;
  network: string;
  family: "EVM" | "BITCOIN" | "SOLANA";
  chainId: number | null;
  assetId: string;
  asset: string;
  displayName: string;
  assetType: "NATIVE" | "TOKEN";
  contractAddress: string | null;
  decimals: number;
  depositAddress: string;
  minDeposit: string | null;
  confirmationsRequired: number;
  status: string;
  message: string;
};

export async function getWallet(): Promise<WalletResult> {
  return request<WalletResult>("/wallet/me", {}, true);
}

export async function requestWalletDeposit(networkId: string, assetId: string): Promise<WalletDepositDetails> {
  return request<WalletDepositDetails>("/wallet/deposit", {
    method: "POST",
    body: JSON.stringify({ networkId, assetId }),
  }, true);
}

export type WalletWithdrawalRequestResult = {
  id: string;
  status: string;
  amount: string;
  fee: string | null;
  reused: boolean;
  idempotencyKey: string;
  transactionReference?: string | null;
};

export async function requestWalletWithdrawal(input: {
  networkId: string;
  assetId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
}): Promise<WalletWithdrawalRequestResult> {
  return request<WalletWithdrawalRequestResult>("/wallet/withdraw", {
    method: "POST",
    body: JSON.stringify(input),
  }, true);
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

export type AdminWalletAsset = {
  id: string;
  symbol: string;
  displayName: string;
  assetType: "NATIVE" | "TOKEN";
  contractAddress: string | null;
  decimals: number;
  issuerClassification: string;
  verificationStatus: string;
  minDepositAtomic: string | null;
  confirmationCount: number;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
};

export type AdminWalletNetwork = {
  id: string;
  family: "EVM" | "BITCOIN" | "SOLANA";
  chainId: number | null;
  networkKey: string;
  displayName: string;
  nativeAssetSymbol: string;
  nativeAssetDecimals: number;
  isEnabled: boolean;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  finalityDepth: number;
  assets: AdminWalletAsset[];
  scanner: {
    cursorPosition: string;
    cursorHash: string | null;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    heartbeatAt: string | null;
    lastSuccessfulScanAt: string | null;
  } | null;
  counts: { addresses: number; deposits: number; withdrawals: number };
};

export type AdminWalletNetworkRegistry = {
  networks: AdminWalletNetwork[];
  provisioning: Array<{ status: string; count: number }>;
  generatedAt: string;
  activationGates: { depositsReady: boolean; withdrawalsReady: boolean };
};

export async function getAdminWalletNetworkRegistry(): Promise<AdminWalletNetworkRegistry> {
  return request<AdminWalletNetworkRegistry>("/admin/wallet-networks", {}, true);
}

export async function updateAdminWalletNetwork(
  networkId: string,
  patch: {
    isEnabled?: boolean;
    depositEnabled?: boolean;
    withdrawalEnabled?: boolean;
    finalityDepth?: number;
    reason: string;
  },
): Promise<AdminWalletNetwork> {
  return request<AdminWalletNetwork>("/admin/wallet-networks/" + encodeURIComponent(networkId), {
    method: "PATCH",
    body: JSON.stringify(patch),
  }, true);
}

export async function updateAdminWalletAsset(
  assetId: string,
  patch: {
    depositEnabled?: boolean;
    withdrawalEnabled?: boolean;
    confirmationCount?: number;
    minDeposit?: string | null;
    reason: string;
  },
): Promise<AdminWalletAsset> {
  return request<AdminWalletAsset>("/admin/wallet-assets/" + encodeURIComponent(assetId), {
    method: "PATCH",
    body: JSON.stringify(patch),
  }, true);
}

export type AdminChainWalletWithdrawal = {
  id: string;
  userId: string;
  username: string;
  email: string;
  networkId: string;
  network: string;
  chainId: number | null;
  assetId: string;
  asset: string;
  decimals: number;
  feeAsset: string | null;
  feeDecimals: number | null;
  destinationAddress: string;
  amount: string;
  estimatedFee: string | null;
  actualFee: string | null;
  status: string;
  failureCode: string | null;
  reviewReason: string | null;
  transactionHash: string | null;
  confirmationCount: number;
  requestedAt: string;
  reviewedAt: string | null;
  broadcastAt: string | null;
  confirmedAt: string | null;
  lastCheckedAt: string | null;
};

export async function getAdminChainWalletWithdrawals(): Promise<AdminChainWalletWithdrawal[]> {
  return request<AdminChainWalletWithdrawal[]>("/admin/wallet-chain-withdrawals", {}, true);
}

export async function reviewAdminChainWalletWithdrawal(
  id: string,
  decision: "APPROVE" | "REJECT",
  reason: string,
): Promise<unknown> {
  return request("/admin/wallet-chain-withdrawals/" + encodeURIComponent(id) + "/review", {
    method: "POST",
    body: JSON.stringify({ decision, reason }),
  }, true);
}

export async function executeAdminChainWalletWithdrawal(id: string): Promise<unknown> {
  return request("/admin/wallet-chain-withdrawals/" + encodeURIComponent(id) + "/execute", {
    method: "POST",
    body: JSON.stringify({}),
  }, true);
}

export async function reconcileAdminChainWalletWithdrawal(id: string): Promise<unknown> {
  return request("/admin/wallet-chain-withdrawals/" + encodeURIComponent(id) + "/reconcile", {
    method: "POST",
    body: JSON.stringify({}),
  }, true);
}

export async function getAdminWallets(): Promise<AdminWalletSummary[]> {
  return request<AdminWalletSummary[]>("/admin/wallets", {}, true);
}

export type PrizeTreasuryProvisionResult = {
  created: boolean;
  walletId: string;
  address: string;
  chainId: number;
  networkKey: string;
  status: string;
};

export async function getPrizeTreasuryWallet(): Promise<PrizeTreasuryProvisionResult | null> {
  return request<PrizeTreasuryProvisionResult | null>("/admin/treasury-wallet", {}, true);
}

export async function provisionPrizeTreasuryWallet(): Promise<PrizeTreasuryProvisionResult> {
  return request<PrizeTreasuryProvisionResult>("/admin/treasury-wallet/provision", {
    method: "POST",
    body: JSON.stringify({}),
  }, true);
}


export type AdminUserSummary = {
  id: string;
  email: string;
  username: string;
  role: string;
  createdAt: string;
  walletBalance: string;
  availableBalance: string;
  contestsParticipated: number;
  completedContests: number;
  bestCompletionTimeMs: number | null;
};

export async function getAdminUsers(): Promise<AdminUserSummary[]> {
  return request<AdminUserSummary[]>("/admin/users", {}, true);
}


export type AdminWalletWithdrawal = {
  id: string;
  userId: string;
  username: string;
  email: string;
  network: string;
  asset: string;
  destinationAddress: string;
  amount: string;
  fee: string;
  status: "REQUESTED" | "APPROVED" | "SIGNING" | "BROADCAST" | "CONFIRMED" | "FAILED" | "CANCELLED";
  requestedAt: string;
  transactionHash: string | null;
};

export async function getAdminWalletWithdrawals(): Promise<AdminWalletWithdrawal[]> {
  return request<AdminWalletWithdrawal[]>("/admin/wallet-withdrawals", {}, true);
}

export async function reviewAdminWalletWithdrawal(
  withdrawalId: string,
  decision: "APPROVE" | "REJECT",
  reason?: string,
): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(
    `/admin/wallet-withdrawals/${encodeURIComponent(withdrawalId)}/review`,
    { method: "POST", body: JSON.stringify({ decision, reason }) },
    true,
  );
}


export type TreasuryPrizeFundingSnapshot = {
  treasuryAddress: string;
  chainId: number;
  asset: string;
  onChainBalance: string;
  treasuryLedgerBalance: string;
  accountingDifference: string;
  accountingStatus: "MATCH" | "MISMATCH";
  snapshotBlockNumber: string;
  snapshotBlockHash: string;
  allocatedToPrizeFund: string;
  unallocatedTreasuryBalance: string;
  prizeFundBalance: string;
  updatedAt: string;
};

export type AdminTreasuryDeposit = {
  id: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  amount: string | null;
  status: "DETECTED" | "CONFIRMING" | "CONFIRMED" | "CREDITED" | "REORGED" | "IGNORED";
  confirmationCount: number;
  detectedAt: string;
  confirmedAt: string | null;
  creditedAt: string | null;
};

export type AdminTreasuryDepositsResult = {
  treasuryAddress: string;
  chainId: number;
  deposits: AdminTreasuryDeposit[];
  generatedAt: string;
};

export async function getAdminTreasuryDeposits(): Promise<AdminTreasuryDepositsResult> {
  return request<AdminTreasuryDepositsResult>("/admin/treasury-wallet/deposits", {}, true);
}

export type AdminTreasuryLedgerEntry = {
  id: string;
  type: "DEPOSIT_CREDIT" | "DEPOSIT_REVERSAL" | "WITHDRAWAL_DEBIT" | "WITHDRAWAL_REVERSAL" | "GAS_EXPENSE" | "MANUAL_ADJUSTMENT";
  amount: string;
  transactionHash: string | null;
  referenceKey: string;
  note: string;
  effectiveAt: string;
  createdAt: string;
};

export type AdminTreasuryLedgerHistoryResult = {
  treasuryAddress: string;
  chainId: number;
  transactions: AdminTreasuryLedgerEntry[];
  generatedAt: string;
};

export async function getAdminTreasuryLedgerHistory(): Promise<AdminTreasuryLedgerHistoryResult> {
  return request<AdminTreasuryLedgerHistoryResult>("/admin/treasury-wallet/ledger-history", {}, true);
}

export async function getTreasuryPrizeFunding(): Promise<TreasuryPrizeFundingSnapshot> {
  return request<TreasuryPrizeFundingSnapshot>("/admin/treasury-wallet/prize-funding", {}, true);
}

export async function allocateTreasuryPrizeFunding(amount: string): Promise<TreasuryPrizeFundingSnapshot & { amount: string }> {
  return request<TreasuryPrizeFundingSnapshot & { amount: string }>("/admin/treasury-wallet/allocate-prize-fund", {
    method: "POST", body: JSON.stringify({ amount }),
  }, true);
}

export type TreasuryReconciliationResult = {
  id: string;
  treasuryAddress: string;
  chainId: number;
  asset: string;
  blockNumber: string;
  blockHash: string;
  onChainBalance: string;
  ledgerBalance: string;
  difference: string;
  status: "MATCH" | "MISMATCH";
  checkedAt: string;
  note: string;
};

export async function reconcileTreasuryAccounting(): Promise<TreasuryReconciliationResult> {
  return request<TreasuryReconciliationResult>("/admin/treasury-wallet/reconciliation", {
    method: "POST",
  }, true);
}

export type AdminWalletWithdrawalExecution = {
  id: string;
  status: string;
  transactionHash?: string;
  chainId?: number;
  asset?: string;
  amount?: string;
  estimatedGasCostPOLWei?: string;
  confirmations?: number;
  confirmationsRequired?: number;
};

export async function executeAdminWalletWithdrawal(withdrawalId: string): Promise<AdminWalletWithdrawalExecution> {
  return request<AdminWalletWithdrawalExecution>(
    `/admin/wallet-withdrawals/${encodeURIComponent(withdrawalId)}/execute`,
    { method: "POST" },
    true,
  );
}

export async function reconcileAdminWalletWithdrawal(withdrawalId: string): Promise<AdminWalletWithdrawalExecution> {
  return request<AdminWalletWithdrawalExecution>(
    `/admin/wallet-withdrawals/${encodeURIComponent(withdrawalId)}/reconcile`,
    { method: "POST" },
    true,
  );
}
