import prisma from "../../config/prisma.js";
import { postWalletJournalInTransaction } from "../wallet/wallet-journal.service.js";

const POLYGON_NETWORK_ID = "eip155:137";
const POLYGON_USDT0_ASSET_ID = "eip155:137/erc20:0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
const PRIZE_TREASURY_ACCOUNT_REFERENCE = "PRIZE_TREASURY";
const BATCH_SIZE = 20;

function payoutsEnabled(): boolean {
  return process.env.PRIZE_PAYOUTS_ENABLED === "true"
    && process.env.PRIZE_PAYOUTS_PRODUCTION_READY === "true";
}

async function creditPendingAward(awardId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
      "internal-prize-award:" + awardId,
    );

    const award = await tx.prizeAward.findUnique({
      where: { id: awardId },
      include: { contest: { include: { prizePool: true } } },
    });
    if (!award) throw new Error("PRIZE_AWARD_NOT_FOUND");
    if (award.status === "PAID") return { id: award.id, status: "PAID", reused: true };
    if (award.status !== "PENDING_PAYMENT") return { id: award.id, status: award.status, skipped: true };

    const pool = award.contest.prizePool;
    const amount = BigInt(award.amountMicro);
    if (!pool || pool.status !== "PAYOUT_PENDING") throw new Error("PRIZE_POOL_NOT_PAYABLE");
    if (amount <= 0n || amount > BigInt(pool.awardedMicro) || amount > BigInt(pool.seededMicro)) {
      throw new Error("PRIZE_AMOUNT_EXCEEDS_ROUND_ALLOCATION");
    }

    const [network, asset] = await Promise.all([
      tx.walletNetwork.findUnique({
        where: { id: POLYGON_NETWORK_ID },
        select: { id: true, isEnabled: true },
      }),
      tx.walletAsset.findUnique({
        where: { id: POLYGON_USDT0_ASSET_ID },
        select: { id: true, networkId: true, symbol: true, decimals: true, verificationStatus: true },
      }),
    ]);
    if (!network?.isEnabled || !asset || asset.networkId !== POLYGON_NETWORK_ID
        || asset.symbol !== "USDT0" || asset.decimals !== 6
        || asset.verificationStatus !== "VERIFIED") {
      throw new Error("PRIZE_WALLET_ASSET_NOT_READY");
    }

    const claimed = await tx.prizeAward.updateMany({
      where: { id: award.id, status: "PENDING_PAYMENT", transactionHash: null },
      data: { status: "SIGNING", failureCode: null },
    });
    if (claimed.count !== 1) throw new Error("PRIZE_AWARD_ALREADY_PROCESSING");

    // This journal entry moves the prize allocation into the winner's internal
    // available balance. The custody asset remains in the shared prize treasury:
    // no Turnkey signing, RPC broadcast, token transfer, or network fee occurs.
    await postWalletJournalInTransaction(tx, {
      userId: award.userId,
      networkId: POLYGON_NETWORK_ID,
      walletAssetId: POLYGON_USDT0_ASSET_ID,
      entryType: "INTERNAL_TRANSFER",
      referenceKey: "prize-award:" + award.id,
      note: "Challenge prize credited to the winner's Wallet-Find balance",
      postings: [
        {
          account: "CUSTODY_ASSET",
          direction: "DEBIT",
          amountAtomic: amount.toString(),
          accountReference: "polygon-prize-treasury",
        },
        {
          account: "USER_AVAILABLE",
          direction: "CREDIT",
          amountAtomic: amount.toString(),
          accountReference: PRIZE_TREASURY_ACCOUNT_REFERENCE,
        },
      ],
    });

    await tx.prizeAward.update({
      where: { id: award.id },
      data: {
        status: "PAID",
        destinationAddress: null,
        transactionHash: null,
        broadcastAt: null,
        confirmedAt: new Date(),
        failureCode: null,
      },
    });

    const remaining = await tx.prizeAward.count({
      where: { contestId: award.contestId, status: { not: "PAID" } },
    });
    if (remaining === 0) {
      await tx.prizePool.updateMany({
        where: { contestId: award.contestId, status: "PAYOUT_PENDING" },
        data: { status: "SETTLED", settledAt: new Date() },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: award.userId,
        action: "PRIZE_AWARD_CREDITED_INTERNAL",
        entity: "PrizeAward",
        entityId: award.id,
        metadata: {
          contestId: award.contestId,
          amountMicro: amount.toString(),
          currency: "USDT0",
          rank: award.rank,
          payoutMode: "INTERNAL_WALLET_LEDGER",
          transactionHash: null,
          blockchainTransfer: false,
        },
      },
    });

    return { id: award.id, status: "PAID", amountMicro: amount.toString(), payoutMode: "INTERNAL_WALLET_LEDGER" };
  }, { isolationLevel: "Serializable" });
}

export async function runPrizePayoutProcessorOnce() {
  if (!payoutsEnabled()) return { skipped: "PRIZE_PAYOUTS_NOT_ENABLED" };

  const emergencyPause = await prisma.systemSetting.findUnique({
    where: { key: "wallet_global_emergency_pause" },
    select: { value: true },
  });
  if (emergencyPause?.value === "true") return { skipped: "WALLET_GLOBAL_EMERGENCY_PAUSE_ACTIVE" };

  const pending = await prisma.prizeAward.findMany({
    where: {
      status: "PENDING_PAYMENT",
      amountMicro: { gt: 0n },
      contest: { prizePool: { is: { status: "PAYOUT_PENDING" } } },
    },
    orderBy: [{ createdAt: "asc" }, { rank: "asc" }],
    take: BATCH_SIZE,
    select: { id: true },
  });

  let credited = 0;
  const failures: Array<{ awardId: string; code: string }> = [];
  for (const item of pending) {
    try {
      const result = await creditPendingAward(item.id);
      if (result.status === "PAID") credited++;
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 180) : "INTERNAL_PRIZE_CREDIT_FAILED";
      failures.push({ awardId: item.id, code });
      await prisma.prizeAward.updateMany({
        where: { id: item.id, status: "PENDING_PAYMENT", transactionHash: null },
        data: { failureCode: code },
      }).catch(() => undefined);
      console.error("Internal prize credit failed; award remains pending", { awardId: item.id, code });
    }
  }

  return { processed: pending.length, credited, failures };
}

export function startPrizePayoutProcessor() {
  const intervalMs = Math.max(15_000, Number.parseInt(process.env.PRIZE_PAYOUT_INTERVAL_MS ?? "30000", 10) || 30_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runPrizePayoutProcessorOnce();
      if (result.skipped && result.skipped !== "PRIZE_PAYOUTS_NOT_ENABLED") {
        console.warn("Prize payout processor skipped", result);
      }
    } catch (error) {
      console.error("Internal prize payout processor error", error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  return timer;
}
