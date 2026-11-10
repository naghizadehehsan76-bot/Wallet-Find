import prisma from "../../config/prisma.js";
import { returnSettledPrizePoolUnusedToGlobal, settlePrizePool } from "./prize-pool.service.js";
import { runWithSystemJobLease } from "../system/system-job-lease.service.js";

export async function runPrizeSettlementProcessorOnce() {
  const now = new Date();
  const activeRounds = await prisma.contest.count({ where: { status: "ACTIVE" } });

  // Process both newly finished rounds and older finalized USDT0 rounds
  // whose unpaid remainder has not yet been returned to the global fund.
  // Settle every finished language round against the same global fund.
  // Legacy pools with a pre-existing reservation are still finalized and repaired.
  const finishedRounds = await prisma.contest.findMany({
    where: {
      status: "FINISHED",
      OR: [
        { prizePool: { is: null } },
        { prizePool: { is: { currency: "USDT0", testOnly: false, status: "OPEN" } } },
        {
          prizePool: {
            is: {
              currency: "USDT0",
              testOnly: false,
              seededMicro: { gte: 100_000n },
              returnedToGlobalMicro: 0n,
              status: { in: ["SETTLED", "PAYOUT_PENDING"] },
              awardedMicro: { lt: 100_000n },
            },
          },
        },
      ],
    },
    orderBy: [{ endsAt: "asc" }, { startsAt: "asc" }, { id: "asc" }],
    select: { id: true },
    take: 100,
  });

  for (const round of finishedRounds) {
    try {
      const result = await settlePrizePool(round.id, null);
      if (result.status !== "WAITING_FOR_GLOBAL_FUNDS") {
        await returnSettledPrizePoolUnusedToGlobal(round.id);
      }
    } catch (error) {
      console.error("Finished round prize settlement/rollover failed", { contestId: round.id, error });
    }
  }

  return { activeRounds, finishedRounds: finishedRounds.length };
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
