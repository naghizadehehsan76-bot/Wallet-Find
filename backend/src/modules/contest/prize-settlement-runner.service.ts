import prisma from "../../config/prisma.js";
import { reserveRoundPrizeAllocation, settlePrizePool } from "./prize-pool.service.js";
import { runWithSystemJobLease } from "../system/system-job-lease.service.js";

export async function runPrizeSettlementProcessorOnce() {
  const now = new Date();
  const activeRounds = await prisma.contest.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  // Do not open a serializable transaction for every active language/round
  // when the global fund cannot cover even one complete 0.1 USDT0 allocation.
  const globalFund = await prisma.globalPrizeFund.findUnique({
    where: { id: "global" },
    select: { balanceMicro: true },
  });
  if (BigInt(globalFund?.balanceMicro ?? 0n) >= 100_000n) {
    for (const round of activeRounds) {
      try {
        await reserveRoundPrizeAllocation(round.id, now);
      } catch (error) {
        console.error("Round prize allocation could not be reserved", { contestId: round.id, error });
      }
    }
  }

  const finishedRounds = await prisma.contest.findMany({
    where: {
      status: "FINISHED",
      prizePool: { is: { seededMicro: { gt: 0n }, status: "OPEN" } },
    },
    select: { id: true },
    take: 100,
  });

  for (const round of finishedRounds) {
    try {
      await settlePrizePool(round.id, null);
    } catch (error) {
      console.error("Finished round prize settlement failed", { contestId: round.id, error });
    }
  }

  return { activeRounds: activeRounds.length, finishedRounds: finishedRounds.length };
}

export function startPrizeSettlementProcessor() {
  const configured = Number.parseInt(process.env.PRIZE_SETTLEMENT_INTERVAL_MS ?? "15000", 10);
  const intervalMs = Math.max(5_000, Number.isFinite(configured) ? configured : 15_000);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runWithSystemJobLease("prize-settlement", runPrizeSettlementProcessorOnce, { leaseMs: 180_000 });
    } catch (error) {
      // This processor is intentionally isolated from challenge scheduling and
      // retries on its next tick without blocking challenge start/end handling.
      console.error("Prize settlement processor error; it will retry", error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  return timer;
}
