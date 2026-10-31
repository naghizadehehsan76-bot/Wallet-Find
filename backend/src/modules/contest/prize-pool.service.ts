import prisma from "../../config/prisma.js";

const MICRO = 1_000_000n;
const ROUND_ALLOCATION_MICRO = MICRO;

function formatMicro(value: bigint) {
  const safe = value > 0n ? value : 0n;
  return `${safe / MICRO}.${(safe % MICRO).toString().padStart(6, "0")}`;
}

/**
 * Reserves up to 1 USDT from the verified global-fund balance.
 * This function is intentionally not called by the contest scheduler.
 * Only a separately verified real-deposit process may increase the fund.
 */
async function ensurePool(tx: any, contestId: string, now = new Date()) {
  const contest = await tx.contest.findUnique({
    where: { id: contestId },
    select: { id: true, startsAt: true },
  });
  if (!contest) throw new Error("CONTEST_NOT_FOUND");

  await tx.globalPrizeFund.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });

  let pool = await tx.prizePool.upsert({
    where: { contestId },
    update: {},
    create: { contestId, currency: "USDT", testOnly: false },
  });
  if (pool.status !== "OPEN" || !contest.startsAt || contest.startsAt > now) return pool;

  const allocationKey = "round-allocation:" + contestId;
  const existing = await tx.globalPrizeLedger.findUnique({ where: { referenceKey: allocationKey } });
  if (existing) return pool;

  const fund = await tx.globalPrizeFund.findUnique({ where: { id: "global" } });
  const available = BigInt(fund?.balanceMicro ?? 0n);
  const amount = available < ROUND_ALLOCATION_MICRO ? available : ROUND_ALLOCATION_MICRO;

  await tx.globalPrizeLedger.create({
    data: {
      id: "round-allocation-" + contestId,
      type: "ROUND_ALLOCATION",
      amountMicro: amount,
      contestId,
      effectiveAt: contest.startsAt,
      referenceKey: allocationKey,
      note: "Reservation from confirmed real USDT global prize fund",
    },
  });
  await tx.globalPrizeFund.update({
    where: { id: "global" },
    data: {
      balanceMicro: { decrement: amount },
      totalAllocatedMicro: { increment: amount },
      updatedAt: now,
    },
  });
  pool = await tx.prizePool.update({
    where: { contestId },
    data: {
      seededMicro: amount,
      rolloverInMicro: 0n,
      rolloverOutMicro: 0n,
      awardedMicro: 0n,
      projectProfitMicro: 0n,
      testOnly: false,
    },
  });
  await tx.prizeLedger.create({
    data: {
      contestId,
      type: "GLOBAL_ALLOCATION",
      amountMicro: amount,
      note: "Confirmed real USDT allocation from global prize fund",
      referenceKey: "round-real-allocation:" + contestId,
    },
  });
  return pool;
}

function responsePool(pool: any) {
  const total = BigInt(pool.seededMicro) + BigInt(pool.rolloverInMicro);
  const awarded = BigInt(pool.awardedMicro);
  const remaining = total > awarded ? total - awarded : 0n;
  return {
    contestId: pool.contestId,
    currency: "USDT",
    testOnly: false,
    status: pool.status,
    seeded: formatMicro(BigInt(pool.seededMicro)),
    rolloverIn: "0.000000",
    total: formatMicro(total),
    awarded: formatMicro(awarded),
    projectProfit: "0.000000",
    rolloverOut: "0.000000",
    returnedToGlobal: "0.000000",
    available: formatMicro(pool.status === "SETTLED" ? 0n : remaining),
    unused: formatMicro(pool.status === "SETTLED" ? remaining : 0n),
    settledAt: pool.settledAt,
  };
}

export async function getGlobalPrizePoolSnapshot(now = new Date()) {
  const fund = await prisma.globalPrizeFund.findUnique({ where: { id: "global" } });
  return {
    totalPool: formatMicro(BigInt(fund?.balanceMicro ?? 0n)),
    dailyContribution: "0.000000",
    totalDailyFunding: "0.000000",
    totalRoundAllocations: formatMicro(BigInt(fund?.totalAllocatedMicro ?? 0n)),
    currency: "USDT" as const,
    simulatedOnly: false as const,
    updatedAt: now.toISOString(),
  };
}

export async function getProjectProfitPoolAdminSnapshot(now = new Date()) {
  const [fund, ledger] = await Promise.all([
    prisma.projectProfitFund.findUnique({ where: { id: "project" } }),
    prisma.projectProfitLedger.findMany({
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, type: true, amountMicro: true, effectiveAt: true, note: true, createdAt: true },
    }),
  ]);
  return {
    balance: formatMicro(BigInt(fund?.balanceMicro ?? 0n)),
    totalContributed: formatMicro(BigInt(fund?.totalContributedMicro ?? 0n)),
    currency: "USDT" as const,
    simulatedOnly: false as const,
    ledger: ledger.map((row) => ({
      id: row.id, type: row.type, amount: formatMicro(BigInt(row.amountMicro)),
      effectiveAt: row.effectiveAt, note: row.note, createdAt: row.createdAt,
    })),
    updatedAt: now.toISOString(),
  };
}

export async function getPrizePool(contestId: string) {
  const pool = await prisma.$transaction((tx) => ensurePool(tx, contestId));
  const [ledger, awards] = await Promise.all([
    prisma.prizeLedger.findMany({
      where: { contestId }, orderBy: { createdAt: "asc" },
      select: { id: true, type: true, amountMicro: true, note: true, createdAt: true },
    }),
    prisma.prizeAward.findMany({
      where: { contestId }, orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
      select: { username: true, rank: true, amountMicro: true, status: true },
    }),
  ]);
  return {
    pool: responsePool(pool),
    ledger: ledger.map((row) => ({ ...row, amount: formatMicro(BigInt(row.amountMicro)), amountMicro: undefined })),
    awards: awards.map((row) => ({ ...row, amount: formatMicro(BigInt(row.amountMicro)), amountMicro: undefined })),
  };
}

export async function getPublicPrizePool(contestId: string) {
  const result = await getPrizePool(contestId);
  return { pool: result.pool, awards: result.awards };
}

export async function testFundPrizePool(): Promise<never> {
  throw new Error("TEST_FUNDING_REMOVED");
}

export async function settlePrizePool(): Promise<never> {
  throw new Error("REAL_PAYOUT_PROCESSING_NOT_CONFIGURED");
}
