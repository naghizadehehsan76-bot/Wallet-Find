import {
  createPublicClient,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";
import { polygon } from "viem/chains";
import prisma from "../../config/prisma.js";
import { createParentTurnkeySigner } from "../wallet/turnkey.service.js";
import { reconcileTreasuryAccounting } from "../wallet/wallet.service.js";

const USDT0_ADDRESS = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" as Address;
const USDT0_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const TREASURY_ID = "polygon-prize-treasury";
const BATCH_SIZE = 10;

function payoutsEnabled(): boolean {
  return process.env.PRIZE_PAYOUTS_ENABLED === "true"
    && process.env.PRIZE_PAYOUTS_PRODUCTION_READY === "true";
}

function polygonClient() {
  const rpcUrl = process.env.POLYGON_RPC_URL?.trim();
  if (!rpcUrl) throw new Error("POLYGON_RPC_NOT_CONFIGURED");
  return createPublicClient({
    chain: polygon,
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }),
  });
}

function requiredConfirmations(): number {
  const configured = Number.parseInt(process.env.POLYGON_USDT_CONFIRMATIONS ?? "128", 10);
  return Number.isFinite(configured) ? Math.max(32, configured) : 128;
}

async function setNeedsReview(awardId: string, failureCode: string) {
  const award = await prisma.prizeAward.findUnique({
    where: { id: awardId },
    select: { contestId: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.prizeAward.updateMany({
      where: { id: awardId, status: { in: ["SIGNING", "BROADCAST"] } },
      data: { status: "NEEDS_REVIEW", failureCode: failureCode.slice(0, 180) },
    });
    if (award) {
      await tx.prizePool.updateMany({
        where: { contestId: award.contestId, status: "PAYOUT_PENDING" },
        data: { status: "PAYOUT_REVIEW" },
      });
    }
  });
}

async function reconcileBroadcastAward(award: {
  id: string;
  contestId: string;
  userId: string;
  amountMicro: bigint;
  destinationAddress: string | null;
  transactionHash: string | null;
}) {
  if (!award.transactionHash || !award.destinationAddress) {
    await setNeedsReview(award.id, "BROADCAST_RECORD_INCOMPLETE");
    return;
  }

  const client = polygonClient();
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: award.transactionHash as Hash });
  } catch {
    // The transaction may still be propagating or not yet mined. Never send it again.
    return;
  }

  const latestBlock = await client.getBlockNumber();
  const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (!canonicalBlock.hash || canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    return;
  }

  if (receipt.status !== "success") {
    await setNeedsReview(award.id, "PRIZE_TRANSFER_REVERTED");
    return;
  }

  const treasury = await prisma.treasuryWallet.findUnique({
    where: { id: TREASURY_ID },
    select: { address: true },
  });
  if (!treasury?.address) {
    await setNeedsReview(award.id, "PRIZE_TREASURY_ADDRESS_MISSING");
    return;
  }

  const transferEvents = parseEventLogs({
    abi: USDT0_ABI,
    logs: receipt.logs,
    eventName: "Transfer",
    strict: false,
  });
  const verifiedTransfer = transferEvents.some((event) =>
    event.args.from?.toLowerCase() === treasury.address!.toLowerCase()
    && event.args.to?.toLowerCase() === award.destinationAddress!.toLowerCase()
    && event.args.value === award.amountMicro
  );
  if (!verifiedTransfer) {
    await setNeedsReview(award.id, "PRIZE_TRANSFER_EVENT_MISMATCH");
    return;
  }

  const confirmations = Number(latestBlock - receipt.blockNumber + 1n);
  if (confirmations < requiredConfirmations()) return;

  await prisma.$transaction(async (tx) => {
    const current = await tx.prizeAward.findUnique({ where: { id: award.id } });
    if (!current || current.status === "PAID") return;
    if (current.status !== "BROADCAST" || current.transactionHash !== award.transactionHash) {
      throw new Error("PRIZE_PAYOUT_STATE_CHANGED");
    }

    await tx.treasuryLedger.create({
      data: {
        treasuryWalletId: TREASURY_ID,
        type: "WITHDRAWAL_DEBIT",
        amountMicro: -award.amountMicro,
        currency: "USDT0",
        transactionHash: award.transactionHash,
        referenceKey: "prize-payout:" + award.id,
        note: "Confirmed Polygon USDT0 prize payout to challenge winner",
        effectiveAt: new Date(),
      },
    });

    await tx.prizeAward.update({
      where: { id: award.id },
      data: { status: "PAID", confirmedAt: new Date(), failureCode: null },
    });

    const remaining = await tx.prizeAward.count({
      where: { contestId: award.contestId, status: { not: "PAID" } },
    });
    if (remaining === 0) {
      await tx.prizePool.updateMany({
        where: { contestId: award.contestId, status: "PAYOUT_PENDING" },
        data: { status: "SETTLED" },
      });
    }

    await tx.auditLog.create({
      data: {
        action: "PRIZE_PAYOUT_CONFIRMED",
        entity: "PrizeAward",
        entityId: award.id,
        metadata: {
          contestId: award.contestId,
          userId: award.userId,
          amountMicro: award.amountMicro.toString(),
          transactionHash: award.transactionHash,
          destinationAddress: award.destinationAddress,
          confirmations,
        },
      },
    });
  }, { isolationLevel: "Serializable" });

  // Refresh the immutable treasury reconciliation after recording the debit.
  const reconciliation = await reconcileTreasuryAccounting(null);
  if (reconciliation.status !== "MATCH") {
    console.error("Treasury reconciliation mismatch after confirmed prize payout", {
      awardId: award.id,
      transactionHash: award.transactionHash,
      difference: reconciliation.difference,
    });
  }
}

async function executePendingAward(awardId: string) {
  const claimed = await prisma.prizeAward.updateMany({
    where: { id: awardId, status: "PENDING_PAYMENT", transactionHash: null },
    data: { status: "SIGNING", failureCode: null },
  });
  if (claimed.count !== 1) return;

  let broadcastAttempted = false;
  let knownTransactionHash: Hash | null = null;
  let knownDestinationAddress: Address | null = null;
  try {
    const emergencyPause = await prisma.systemSetting.findUnique({
      where: { key: "wallet_global_emergency_pause" },
      select: { value: true },
    });
    if (emergencyPause?.value === "true") throw new Error("WALLET_GLOBAL_EMERGENCY_PAUSE_ACTIVE");

    const award = await prisma.prizeAward.findUnique({
      where: { id: awardId },
      include: {
        contest: { include: { prizePool: true } },
      },
    });
    if (!award || award.status !== "SIGNING") throw new Error("PRIZE_AWARD_NOT_READY");
    const amount = BigInt(award.amountMicro);
    if (amount <= 0n || !award.contest.prizePool || amount > BigInt(award.contest.prizePool.seededMicro)) {
      throw new Error("PRIZE_AMOUNT_EXCEEDS_ROUND_ALLOCATION");
    }
    if (award.contest.prizePool.status !== "PAYOUT_PENDING") throw new Error("PRIZE_POOL_NOT_PAYABLE");

    const userWallet = await prisma.walletAccount.findUnique({ where: { userId: award.userId } });
    if (!userWallet || userWallet.status !== "ACTIVE" || !userWallet.address) {
      throw new Error("WINNER_WALLET_NOT_ACTIVE");
    }
    const destinationAddress = userWallet.address.toLowerCase() as Address;
    knownDestinationAddress = destinationAddress;

    const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID } });
    if (!treasury || treasury.status !== "ACTIVE" || !treasury.address || !treasury.turnkeyWalletId) {
      throw new Error("PRIZE_TREASURY_NOT_READY");
    }
    const treasuryAddress = treasury.address.toLowerCase() as Address;

    // A fresh chain-vs-ledger reconciliation is mandatory before each new send.
    const reconciliation = await reconcileTreasuryAccounting(null);
    if (reconciliation.status !== "MATCH") throw new Error("TREASURY_ACCOUNTING_MISMATCH");

    // Preserve every other round's reservation and the still-unallocated global
    // fund. Only the physically backed, already-reserved prize amount may leave.
    const [globalFund, allPools, paidAwards] = await Promise.all([
      prisma.globalPrizeFund.findUnique({ where: { id: "global" } }),
      prisma.prizePool.aggregate({ _sum: { seededMicro: true } }),
      prisma.prizeAward.aggregate({
        where: { status: "PAID" },
        _sum: { amountMicro: true },
      }),
    ]);
    const globalBalance = BigInt(globalFund?.balanceMicro ?? 0n);
    const outstandingRoundReserve = BigInt(allPools._sum.seededMicro ?? 0n)
      - BigInt(paidAwards._sum.amountMicro ?? 0n);
    const requiredReserve = globalBalance + (outstandingRoundReserve > 0n ? outstandingRoundReserve : 0n);
    if (BigInt(reconciliation.onChainBalance.replace(".", "")) < requiredReserve) {
      throw new Error("PRIZE_TREASURY_RESERVED_BALANCE_MISMATCH");
    }

    const client = polygonClient();
    const [tokenBalance, nativeBalance, fees, estimatedGas] = await Promise.all([
      client.readContract({
        address: USDT0_ADDRESS,
        abi: USDT0_ABI,
        functionName: "balanceOf",
        args: [treasuryAddress],
      }),
      client.getBalance({ address: treasuryAddress }),
      client.estimateFeesPerGas(),
      client.estimateContractGas({
        account: treasuryAddress,
        address: USDT0_ADDRESS,
        abi: USDT0_ABI,
        functionName: "transfer",
        args: [destinationAddress, amount],
      }),
    ]);

    if (tokenBalance < amount) throw new Error("INSUFFICIENT_TREASURY_USDT0");
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
    if (!maxFeePerGas || maxFeePerGas <= 0n) throw new Error("POLYGON_FEE_QUOTE_UNAVAILABLE");
    const gasLimit = estimatedGas * 120n / 100n + 1n;
    if (nativeBalance < gasLimit * maxFeePerGas) throw new Error("INSUFFICIENT_TREASURY_POL_FOR_GAS");

    const signer = await createParentTurnkeySigner(treasuryAddress, 137);
    if (signer.account?.address.toLowerCase() !== treasuryAddress) {
      throw new Error("PRIZE_TREASURY_SIGNER_ADDRESS_MISMATCH");
    }

    // From this point an exception is treated as an uncertain broadcast. The
    // worker will never automatically retry a SIGNING record.
    broadcastAttempted = true;
    const transactionHash = await signer.writeContract({
      account: signer.account!,
      chain: polygon,
      address: USDT0_ADDRESS,
      abi: USDT0_ABI,
      functionName: "transfer",
      args: [destinationAddress, amount],
      gas: gasLimit,
      maxFeePerGas,
      ...(fees.maxPriorityFeePerGas ? { maxPriorityFeePerGas: fees.maxPriorityFeePerGas } : {}),
    });
    knownTransactionHash = transactionHash;

    const updated = await prisma.prizeAward.updateMany({
      where: { id: award.id, status: "SIGNING", transactionHash: null },
      data: {
        status: "BROADCAST",
        destinationAddress,
        transactionHash,
        broadcastAt: new Date(),
        failureCode: null,
      },
    });
    if (updated.count !== 1) {
      throw new Error("PRIZE_PAYOUT_STATE_CHANGED_AFTER_BROADCAST");
    }
    console.log("Prize payout broadcast", {
      awardId: award.id,
      contestId: award.contestId,
      amountMicro: amount.toString(),
      transactionHash,
    });
  } catch (error) {
    if (!broadcastAttempted) {
      await prisma.prizeAward.updateMany({
        where: { id: awardId, status: "SIGNING", transactionHash: null },
        data: {
          status: "PENDING_PAYMENT",
          failureCode: error instanceof Error ? error.message.slice(0, 180) : "PRE_BROADCAST_FAILURE",
        },
      }).catch(() => undefined);
    } else if (knownTransactionHash && knownDestinationAddress) {
      // The hash is known even if the first persistence attempt failed. Retry
      // only the database write; never submit a second blockchain transaction.
      const recovered = await prisma.prizeAward.updateMany({
        where: { id: awardId, status: "SIGNING", transactionHash: null },
        data: {
          status: "BROADCAST",
          destinationAddress: knownDestinationAddress,
          transactionHash: knownTransactionHash,
          broadcastAt: new Date(),
          failureCode: null,
        },
      }).catch(() => ({ count: 0 }));
      if (recovered.count !== 1) {
        await setNeedsReview(awardId, "BROADCAST_HASH_PERSISTENCE_FAILED");
      }
      console.error("Prize payout broadcast persistence recovery attempted", { awardId, recovered: recovered.count });
    } else {
      await setNeedsReview(awardId, "BROADCAST_OUTCOME_UNCERTAIN");
      console.error("Prize payout broadcast outcome is uncertain; automatic retry is disabled", {
        awardId,
        error,
      });
    }
  }
}

export async function runPrizePayoutProcessorOnce() {
  if (!payoutsEnabled()) return { skipped: "PRIZE_PAYOUTS_NOT_ENABLED" };

  const emergencyPause = await prisma.systemSetting.findUnique({
    where: { key: "wallet_global_emergency_pause" },
    select: { value: true },
  });
  if (emergencyPause?.value === "true") return { skipped: "WALLET_GLOBAL_EMERGENCY_PAUSE_ACTIVE" };

  const broadcasts = await prisma.prizeAward.findMany({
    where: { status: "BROADCAST", transactionHash: { not: null } },
    orderBy: { broadcastAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true, contestId: true, userId: true, amountMicro: true,
      destinationAddress: true, transactionHash: true,
    },
  });
  if (broadcasts.length > 0) {
    for (const award of broadcasts) {
      try {
        await reconcileBroadcastAward(award);
      } catch (error) {
        console.error("Prize payout reconciliation will retry", { awardId: award.id, error });
      }
    }
    return { reconciled: broadcasts.length };
  }

  // A SIGNING row means the previous process may have sent a transaction but
  // failed before saving its hash. Never risk paying that award twice.
  const uncertain = await prisma.prizeAward.count({ where: { status: "SIGNING" } });
  if (uncertain > 0) return { skipped: "PRIZE_PAYOUT_REQUIRES_MANUAL_REVIEW" };

  const pending = await prisma.prizeAward.findFirst({
    where: { status: "PENDING_PAYMENT", amountMicro: { gt: 0n }, contest: { prizePool: { is: { status: "PAYOUT_PENDING" } } } },
    orderBy: [{ createdAt: "asc" }, { rank: "asc" }],
    select: { id: true },
  });
  if (!pending) return { processed: 0 };

  await executePendingAward(pending.id);
  return { processed: 1, awardId: pending.id };
}

export function startPrizePayoutProcessor() {
  const intervalMs = Math.max(15_000, Number.parseInt(process.env.PRIZE_PAYOUT_INTERVAL_MS ?? "30_000", 10) || 30_000);
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
      console.error("Prize payout processor error", error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  return timer;
}
