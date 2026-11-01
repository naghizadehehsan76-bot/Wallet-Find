import { randomUUID } from "node:crypto";
import { isAddress, type Address } from "viem";
import prisma from "../../config/prisma.js";
import { formatAssetUnits, parseAssetUnits } from "./asset-amount.js";
import {
  getEvmPublicClient,
  isEvmWithdrawalFeeModelSupported,
} from "./chain-adapters/evm.adapter.js";
import { postWalletJournalInTransaction } from "./wallet-journal.service.js";
import { createTurnkeySigner, provisionTurnkeyWallet } from "./turnkey.service.js";

const TOKEN_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const TOKEN_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type WithdrawalSnapshot = {
  id: string;
  userId: string;
  walletAccountId: string;
  walletAddressId: string;
  networkId: string;
  walletAssetId: string;
  feeAssetId: string | null;
  destinationAddress: string;
  amountAtomic: { toString(): string };
  feeAtomic: { toString(): string } | null;
  estimatedGasLimit: { toString(): string } | null;
  maxFeePerGasAtomic: { toString(): string } | null;
  maxPriorityFeePerGasAtomic: { toString(): string } | null;
  transactionReference: string | null;
  status: string;
};

function requireWithdrawalReadiness(): void {
  if (
    process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED !== "true" ||
    process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY !== "true"
  ) {
    throw new Error("GENERIC_WITHDRAWALS_NOT_PRODUCTION_READY");
  }
}

function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 16 || value.trim().length > 128) {
    throw new Error("WALLET_WITHDRAWAL_IDEMPOTENCY_KEY_REQUIRED");
  }
  return value.trim();
}

function requireReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 500) {
    throw new Error("WALLET_WITHDRAWAL_REVIEW_REASON_REQUIRED");
  }
  return value.trim();
}

async function readAvailableBalance(
  tx: any,
  userId: string,
  networkId: string,
  walletAssetId: string,
): Promise<bigint> {
  const postings = await tx.walletJournalPosting.findMany({
    where: {
      account: "USER_AVAILABLE",
      journal: { userId, networkId, walletAssetId },
    },
    select: { direction: true, amountAtomic: true },
  });
  return postings.reduce((total: bigint, posting: any) => {
    const amount = BigInt(posting.amountAtomic.toString());
    return total + (posting.direction === "CREDIT" ? amount : -amount);
  }, 0n);
}

async function postReservation(
  tx: any,
  input: {
    id: string;
    userId: string;
    networkId: string;
    walletAssetId: string;
    amount: bigint;
    suffix: string;
    note: string;
  },
) {
  return postWalletJournalInTransaction(tx, {
    userId: input.userId,
    networkId: input.networkId,
    walletAssetId: input.walletAssetId,
    entryType: "WITHDRAWAL_RESERVE",
    referenceKey: "wallet-chain-withdrawal:" + input.id + ":" + input.suffix,
    note: input.note,
    postings: [
      {
        account: "USER_AVAILABLE",
        direction: "DEBIT",
        amountAtomic: input.amount.toString(),
        accountReference: input.userId,
      },
      {
        account: "USER_RESERVED",
        direction: "CREDIT",
        amountAtomic: input.amount.toString(),
        accountReference: input.id,
      },
    ],
  });
}

async function releaseReservation(
  tx: any,
  input: {
    id: string;
    userId: string;
    networkId: string;
    walletAssetId: string;
    amount: bigint;
    suffix: string;
    note: string;
  },
) {
  if (input.amount <= 0n) return null;
  return postWalletJournalInTransaction(tx, {
    userId: input.userId,
    networkId: input.networkId,
    walletAssetId: input.walletAssetId,
    entryType: "WITHDRAWAL_RELEASE",
    referenceKey: "wallet-chain-withdrawal:" + input.id + ":" + input.suffix,
    note: input.note,
    postings: [
      {
        account: "USER_RESERVED",
        direction: "DEBIT",
        amountAtomic: input.amount.toString(),
        accountReference: input.id,
      },
      {
        account: "USER_AVAILABLE",
        direction: "CREDIT",
        amountAtomic: input.amount.toString(),
        accountReference: input.userId,
      },
    ],
  });
}

function atomic(value: { toString(): string } | null | undefined): bigint {
  return value ? BigInt(value.toString()) : 0n;
}

async function quoteEvmFee(input: {
  chainId: number;
  from: Address;
  to: Address;
  assetType: "NATIVE" | "TOKEN";
  contractAddress: string | null;
  amountAtomic: bigint;
}) {
  if (!isEvmWithdrawalFeeModelSupported(input.chainId)) {
    throw new Error("EVM_WITHDRAWAL_FEE_MODEL_NOT_SUPPORTED");
  }

  const client = getEvmPublicClient(input.chainId);
  const gasEstimate = input.assetType === "NATIVE"
    ? await client.estimateGas({
        account: input.from,
        to: input.to,
        value: input.amountAtomic,
      })
    : input.contractAddress
      ? await client.estimateContractGas({
          account: input.from,
          address: input.contractAddress as Address,
          abi: TOKEN_TRANSFER_ABI,
          functionName: "transfer",
          args: [input.to, input.amountAtomic],
        })
      : (() => { throw new Error("INVALID_TOKEN_ASSET_CONFIGURATION"); })();

  const fees = await client.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? null;
  if (!maxFeePerGas || maxFeePerGas <= 0n) {
    throw new Error("EVM_WITHDRAWAL_FEE_QUOTE_UNAVAILABLE");
  }

  // Add a 20% gas limit buffer. Max fee per gas remains bounded by the
  // recorded reservation; reconciliation releases the unused portion.
  const gasLimit = gasEstimate * 120n / 100n + 1n;
  const feeAtomic = gasLimit * maxFeePerGas;

  return {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    feeAtomic,
    feeQuoteExpiresAt: new Date(Date.now() + 120_000),
  };
}

export async function requestChainWalletWithdrawal(input: {
  userId: string;
  networkId: unknown;
  assetId: unknown;
  amount: unknown;
  destinationAddress: unknown;
  idempotencyKey: unknown;
}) {
  requireWithdrawalReadiness();

  if (typeof input.networkId !== "string" || typeof input.assetId !== "string") {
    throw new Error("INVALID_WALLET_ASSET_SELECTION");
  }
  const networkId = input.networkId.trim();
  const assetId = input.assetId.trim();
  if (!networkId || !assetId) throw new Error("INVALID_WALLET_ASSET_SELECTION");

  if (typeof input.destinationAddress !== "string" || !isAddress(input.destinationAddress.trim())) {
    throw new Error("INVALID_DESTINATION_ADDRESS");
  }
  const destinationAddress = input.destinationAddress.trim().toLowerCase();
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);

  const wallet = await provisionTurnkeyWallet(input.userId);
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.turnkeyOrganizationId || !wallet.turnkeyWalletId) {
    throw new Error("WALLET_NOT_ACTIVE");
  }

  const [network, asset, address] = await Promise.all([
    prisma.walletNetwork.findUnique({ where: { id: networkId } }),
    prisma.walletAsset.findUnique({ where: { id: assetId } }),
    prisma.walletAddress.findUnique({
      where: { walletAccountId_networkId: { walletAccountId: wallet.id, networkId } },
    }),
  ]);
  if (!network || !asset || asset.networkId !== networkId || !address || address.status !== "ACTIVE") {
    throw new Error("WALLET_ASSET_NOT_AVAILABLE");
  }
  if (!network.isEnabled || !network.withdrawalEnabled ||
      !asset.withdrawalEnabled || asset.verificationStatus !== "VERIFIED") {
    throw new Error("WITHDRAWALS_DISABLED");
  }
  if (network.family !== "EVM" || network.chainId === null) {
    throw new Error("WALLET_NETWORK_WITHDRAWAL_ADAPTER_NOT_READY");
  }

  const amount = typeof input.amount === "string"
    ? parseAssetUnits(input.amount, asset.decimals)
    : (() => { throw new Error("INVALID_WALLET_AMOUNT"); })();
  if (amount <= 0n || amount.toString().length > 78) throw new Error("INVALID_WALLET_AMOUNT");

  const feeAsset = await prisma.walletAsset.findFirst({
    where: {
      networkId,
      assetType: "NATIVE",
      verificationStatus: "VERIFIED",
    },
  });
  if (!feeAsset) throw new Error("WALLET_NATIVE_FEE_ASSET_NOT_CONFIGURED");

  const feeQuote = await quoteEvmFee({
    chainId: network.chainId,
    from: address.address as Address,
    to: destinationAddress as Address,
    assetType: asset.assetType,
    contractAddress: asset.contractAddress,
    amountAtomic: amount,
  });
  if (feeQuote.feeAtomic <= 0n || feeQuote.feeAtomic.toString().length > 78) {
    throw new Error("INVALID_WITHDRAWAL_FEE_QUOTE");
  }

  const id = randomUUID();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "wallet-withdrawal-idempotency:" + idempotencyKey,
    );
    const duplicate = await tx.walletChainWithdrawal.findUnique({
      where: { idempotencyKey },
    });
    if (duplicate) {
      if (
        duplicate.userId !== input.userId ||
        duplicate.networkId !== networkId ||
        duplicate.walletAssetId !== assetId ||
        duplicate.destinationAddress !== destinationAddress ||
        duplicate.amountAtomic.toString() !== amount.toString()
      ) {
        throw new Error("WALLET_WITHDRAWAL_IDEMPOTENCY_CONFLICT");
      }
      return duplicate;
    }

    const lockKeys = Array.from(new Set([asset.id, feeAsset.id]))
      .sort()
      .map((key) => "wallet-user-asset:" + input.userId + ":" + networkId + ":" + key);
    for (const key of lockKeys) {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", key);
    }

    const feeAndAmountSameAsset = asset.id === feeAsset.id;
    const availableAmount = await readAvailableBalance(tx, input.userId, networkId, asset.id);
    const availableFee = feeAndAmountSameAsset
      ? availableAmount
      : await readAvailableBalance(tx, input.userId, networkId, feeAsset.id);
    if (feeAndAmountSameAsset) {
      if (availableAmount < amount + feeQuote.feeAtomic) {
        throw new Error("INSUFFICIENT_WALLET_BALANCE_FOR_AMOUNT_AND_NETWORK_FEE");
      }
    } else {
      if (availableAmount < amount) throw new Error("INSUFFICIENT_WALLET_BALANCE");
      if (availableFee < feeQuote.feeAtomic) throw new Error("INSUFFICIENT_NATIVE_FEE_BALANCE");
    }

    const withdrawal = await tx.walletChainWithdrawal.create({
      data: {
        id,
        userId: input.userId,
        walletAccountId: wallet.id,
        walletAddressId: address.id,
        networkId,
        walletAssetId: asset.id,
        feeAssetId: feeAsset.id,
        destinationAddress,
        amountAtomic: amount.toString(),
        feeAtomic: feeQuote.feeAtomic.toString(),
        estimatedGasLimit: feeQuote.gasLimit.toString(),
        maxFeePerGasAtomic: feeQuote.maxFeePerGas.toString(),
        maxPriorityFeePerGasAtomic: feeQuote.maxPriorityFeePerGas?.toString() ?? null,
        feeQuoteExpiresAt: feeQuote.feeQuoteExpiresAt,
        idempotencyKey,
        status: "RESERVED",
      },
    });

    await postReservation(tx, {
      id,
      userId: input.userId,
      networkId,
      walletAssetId: asset.id,
      amount,
      suffix: "amount-reserve",
      note: "Reserve wallet balance for approved on-chain withdrawal",
    });
    await postReservation(tx, {
      id,
      userId: input.userId,
      networkId,
      walletAssetId: feeAsset.id,
      amount: feeQuote.feeAtomic,
      suffix: "fee-reserve",
      note: "Reserve native asset for estimated network fee",
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "WALLET_CHAIN_WITHDRAWAL_REQUESTED",
        entity: "WalletChainWithdrawal",
        entityId: id,
        metadata: {
          networkId,
          assetId,
          amountAtomic: amount.toString(),
          feeAssetId: feeAsset.id,
          reservedFeeAtomic: feeQuote.feeAtomic.toString(),
          idempotencyKey,
        },
      },
    });

    return {
      ...withdrawal,
      amount: withdrawal.amountAtomic.toString(),
      fee: withdrawal.feeAtomic?.toString() ?? null,
      reused: false,
    };
  }, { isolationLevel: "Serializable" });
}

export async function getAdminChainWalletWithdrawals() {
  const rows = await prisma.walletChainWithdrawal.findMany({
    include: {
      user: { select: { id: true, username: true, email: true } },
      network: { select: { id: true, displayName: true, chainId: true } },
      asset: { select: { id: true, symbol: true, decimals: true } },
      feeAsset: { select: { id: true, symbol: true, decimals: true } },
    },
    orderBy: { requestedAt: "desc" },
    take: 500,
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    email: row.user.email,
    networkId: row.network.id,
    network: row.network.displayName,
    chainId: row.network.chainId,
    assetId: row.asset.id,
    asset: row.asset.symbol,
    decimals: row.asset.decimals,
    feeAsset: row.feeAsset?.symbol ?? null,
    feeDecimals: row.feeAsset?.decimals ?? null,
    destinationAddress: row.destinationAddress,
    amount: formatAssetUnits(BigInt(row.amountAtomic.toString()), row.asset.decimals),
    estimatedFee: row.feeAtomic && row.feeAsset
      ? formatAssetUnits(BigInt(row.feeAtomic.toString()), row.feeAsset.decimals)
      : null,
    actualFee: row.actualFeeAtomic && row.feeAsset
      ? formatAssetUnits(BigInt(row.actualFeeAtomic.toString()), row.feeAsset.decimals)
      : null,
    status: row.status,
    failureCode: row.failureCode,
    reviewReason: row.reviewReason,
    transactionHash: row.transactionReference,
    confirmationCount: row.confirmationCount,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt,
    broadcastAt: row.broadcastAt,
    confirmedAt: row.confirmedAt,
    lastCheckedAt: row.lastCheckedAt,
  }));
}

export async function reviewChainWalletWithdrawal(
  withdrawalId: string,
  decision: "APPROVE" | "REJECT",
  adminUserId: string,
  rawReason: unknown,
) {
  const reason = requireReason(rawReason);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "wallet-chain-withdrawal:" + withdrawalId,
    );
    const withdrawal = await tx.walletChainWithdrawal.findUnique({
      where: { id: withdrawalId },
    });
    if (!withdrawal) throw new Error("WALLET_WITHDRAWAL_NOT_FOUND");
    if (withdrawal.status !== "RESERVED") throw new Error("WALLET_WITHDRAWAL_ALREADY_REVIEWED");

    if (decision === "REJECT") {
      await releaseReservation(tx, {
        id: withdrawal.id,
        userId: withdrawal.userId,
        networkId: withdrawal.networkId,
        walletAssetId: withdrawal.walletAssetId,
        amount: atomic(withdrawal.amountAtomic),
        suffix: "amount-rejected-release",
        note: "Release withdrawal amount after admin rejection",
      });
      if (withdrawal.feeAssetId && withdrawal.feeAtomic) {
        await releaseReservation(tx, {
          id: withdrawal.id,
          userId: withdrawal.userId,
          networkId: withdrawal.networkId,
          walletAssetId: withdrawal.feeAssetId,
          amount: atomic(withdrawal.feeAtomic),
          suffix: "fee-rejected-release",
          note: "Release reserved network fee after admin rejection",
        });
      }
    }

    const updated = await tx.walletChainWithdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "CANCELLED",
        reviewedByUserId: adminUserId,
        reviewedAt: new Date(),
        reviewReason: reason,
        failureCode: decision === "REJECT" ? "ADMIN_REJECTED" : null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: decision === "APPROVE" ? "WALLET_CHAIN_WITHDRAWAL_APPROVED" : "WALLET_CHAIN_WITHDRAWAL_REJECTED",
        entity: "WalletChainWithdrawal",
        entityId: withdrawalId,
        metadata: { reason },
      },
    });
    return updated;
  }, { isolationLevel: "Serializable" });
}

async function refreshWithdrawalFeeReservation(input: {
  withdrawal: {
    id: string;
    userId: string;
    networkId: string;
    walletAssetId: string;
    feeAssetId: string | null;
    feeAtomic: { toString(): string } | null;
  };
  newQuote: Awaited<ReturnType<typeof quoteEvmFee>>;
}): Promise<bigint> {
  if (!input.withdrawal.feeAssetId) throw new Error("WALLET_WITHDRAWAL_FEE_ASSET_MISSING");
  const currentReserved = atomic(input.withdrawal.feeAtomic);
  const nextQuote = input.newQuote.feeAtomic;
  const additional = nextQuote > currentReserved ? nextQuote - currentReserved : 0n;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "wallet-user-asset:" + input.withdrawal.userId + ":" +
        input.withdrawal.networkId + ":" + input.withdrawal.feeAssetId,
    );

    if (additional > 0n) {
      const available = await readAvailableBalance(
        tx,
        input.withdrawal.userId,
        input.withdrawal.networkId,
        input.withdrawal.feeAssetId,
      );
      if (available < additional) {
        throw new Error("INSUFFICIENT_NATIVE_FEE_BALANCE_FOR_UPDATED_QUOTE");
      }
      await postReservation(tx, {
        id: input.withdrawal.id,
        userId: input.withdrawal.userId,
        networkId: input.withdrawal.networkId,
        walletAssetId: input.withdrawal.feeAssetId,
        amount: additional,
        suffix: "fee-reserve-topup:" + nextQuote.toString(),
        note: "Top up reserved native fee after refreshing the withdrawal fee quote",
      });
    }

    const totalReserved = currentReserved + additional;
    await tx.walletChainWithdrawal.update({
      where: { id: input.withdrawal.id },
      data: {
        feeAtomic: totalReserved.toString(),
        estimatedGasLimit: input.newQuote.gasLimit.toString(),
        maxFeePerGasAtomic: input.newQuote.maxFeePerGas.toString(),
        maxPriorityFeePerGasAtomic: input.newQuote.maxPriorityFeePerGas?.toString() ?? null,
        feeQuoteExpiresAt: input.newQuote.feeQuoteExpiresAt,
        failureCode: null,
      },
    });
    return totalReserved;
  }, { isolationLevel: "Serializable" });
}

export async function executeChainWalletWithdrawal(withdrawalId: string, adminUserId: string) {
  requireWithdrawalReadiness();

  const withdrawal = await prisma.walletChainWithdrawal.findUnique({
    where: { id: withdrawalId },
    include: {
      network: true,
      asset: true,
      walletAddress: true,
      walletAccount: true,
      feeAsset: true,
    },
  });
  if (!withdrawal) throw new Error("WALLET_WITHDRAWAL_NOT_FOUND");
  if (withdrawal.status !== "APPROVED") throw new Error("WALLET_WITHDRAWAL_NOT_APPROVED");
  if (withdrawal.network.family !== "EVM" || withdrawal.network.chainId === null) {
    throw new Error("WALLET_NETWORK_WITHDRAWAL_ADAPTER_NOT_READY");
  }
  if (!isEvmWithdrawalFeeModelSupported(withdrawal.network.chainId)) {
    throw new Error("EVM_WITHDRAWAL_FEE_MODEL_NOT_SUPPORTED");
  }
  if (withdrawal.asset.verificationStatus !== "VERIFIED" ||
      !withdrawal.network.isEnabled || !withdrawal.network.withdrawalEnabled ||
      !withdrawal.asset.withdrawalEnabled) {
    throw new Error("WITHDRAWALS_DISABLED");
  }

  const amount = atomic(withdrawal.amountAtomic);
  if (amount <= 0n || !withdrawal.feeAssetId) {
    throw new Error("WALLET_WITHDRAWAL_FEE_QUOTE_MISSING");
  }

  const client = getEvmPublicClient(withdrawal.network.chainId);
  const freshQuote = await quoteEvmFee({
    chainId: withdrawal.network.chainId,
    from: withdrawal.walletAddress.address as Address,
    to: withdrawal.destinationAddress as Address,
    assetType: withdrawal.asset.assetType,
    contractAddress: withdrawal.asset.contractAddress,
    amountAtomic: amount,
  });
  const reservedFee = await refreshWithdrawalFeeReservation({
    withdrawal,
    newQuote: freshQuote,
  });
  const gasLimit = freshQuote.gasLimit;
  const maxFeePerGas = freshQuote.maxFeePerGas;
  const maxPriorityFeePerGas = freshQuote.maxPriorityFeePerGas ?? 0n;

  const updated = await prisma.walletChainWithdrawal.updateMany({
    where: { id: withdrawalId, status: "APPROVED" },
    data: {
      status: "SIGNING",
      failureCode: null,
      lastCheckedAt: new Date(),
    },
  });
  if (updated.count !== 1) throw new Error("WALLET_WITHDRAWAL_ALREADY_PROCESSING");

  try {
    const walletClient = await createTurnkeySigner(
      withdrawal.walletAddress.address,
      withdrawal.network.chainId,
    );
    const fromAddress = withdrawal.walletAddress.address as Address;
    const destination = withdrawal.destinationAddress as Address;
    if (!walletClient.account ||
        walletClient.account.address.toLowerCase() !== fromAddress.toLowerCase()) {
      throw new Error("TURNKEY_SIGNER_ADDRESS_MISMATCH");
    }

    if (withdrawal.asset.assetType === "NATIVE") {
      const nativeBalance = await client.getBalance({ address: fromAddress });
      if (nativeBalance < amount + reservedFee) {
        throw new Error("ONCHAIN_NATIVE_BALANCE_INSUFFICIENT");
      }
    } else {
      if (!withdrawal.asset.contractAddress) throw new Error("INVALID_TOKEN_ASSET_CONFIGURATION");
      const [tokenBalance, nativeBalance] = await Promise.all([
        client.readContract({
          address: withdrawal.asset.contractAddress as Address,
          abi: TOKEN_BALANCE_ABI,
          functionName: "balanceOf",
          args: [fromAddress],
        }),
        client.getBalance({ address: fromAddress }),
      ]);
      if (tokenBalance < amount) throw new Error("ONCHAIN_TOKEN_BALANCE_INSUFFICIENT");
      if (nativeBalance < reservedFee) throw new Error("ONCHAIN_NATIVE_FEE_BALANCE_INSUFFICIENT");
    }

    const hash = withdrawal.asset.assetType === "NATIVE"
      ? await walletClient.sendTransaction({
          account: walletClient.account!,
          to: destination,
          value: amount,
          gas: gasLimit,
          maxFeePerGas,
          ...(maxPriorityFeePerGas > 0n ? { maxPriorityFeePerGas } : {}),
        })
      : await walletClient.writeContract({
          account: walletClient.account!,
          address: withdrawal.asset.contractAddress as Address,
          abi: TOKEN_TRANSFER_ABI,
          functionName: "transfer",
          args: [destination, amount],
          gas: gasLimit,
          maxFeePerGas,
          ...(maxPriorityFeePerGas > 0n ? { maxPriorityFeePerGas } : {}),
        });

    await prisma.walletChainWithdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: "BROADCAST",
        transactionReference: hash,
        broadcastAt: new Date(),
        failureCode: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: adminUserId,
        action: "WALLET_CHAIN_WITHDRAWAL_BROADCAST",
        entity: "WalletChainWithdrawal",
        entityId: withdrawalId,
        metadata: { networkId: withdrawal.networkId, transactionHash: hash },
      },
    });

    return { id: withdrawalId, status: "BROADCAST", transactionHash: hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_SIGNING_OR_BROADCAST_ERROR";
    const safeKnown = new Set([
      "ONCHAIN_NATIVE_BALANCE_INSUFFICIENT",
      "ONCHAIN_TOKEN_BALANCE_INSUFFICIENT",
      "ONCHAIN_NATIVE_FEE_BALANCE_INSUFFICIENT",
      "INVALID_TOKEN_ASSET_CONFIGURATION",
    ]);
    await prisma.walletChainWithdrawal.updateMany({
      where: { id: withdrawalId, status: "SIGNING" },
      data: {
        status: safeKnown.has(message) ? "APPROVED" : "SIGNING",
        failureCode: safeKnown.has(message) ? message : "SIGNING_OR_BROADCAST_OUTCOME_UNCERTAIN",
        lastCheckedAt: new Date(),
      },
    }).catch(() => undefined);

    if (!safeKnown.has(message)) {
      console.error("Generic wallet withdrawal signing/broadcast requires reconciliation", {
        withdrawalId,
        error,
      });
      throw new Error("WALLET_WITHDRAWAL_REQUIRES_MANUAL_RECONCILIATION");
    }
    throw error;
  }
}

export async function reconcileChainWalletWithdrawal(withdrawalId: string, adminUserId: string) {
  const withdrawal = await prisma.walletChainWithdrawal.findUnique({
    where: { id: withdrawalId },
    include: { network: true, asset: true, feeAsset: true },
  });
  if (!withdrawal) throw new Error("WALLET_WITHDRAWAL_NOT_FOUND");
  if (withdrawal.status !== "BROADCAST" || !withdrawal.transactionReference) {
    throw new Error("WALLET_WITHDRAWAL_NOT_BROADCAST");
  }
  if (withdrawal.network.family !== "EVM" || withdrawal.network.chainId === null) {
    throw new Error("WALLET_NETWORK_WITHDRAWAL_ADAPTER_NOT_READY");
  }

  const client = getEvmPublicClient(withdrawal.network.chainId);
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({
      hash: withdrawal.transactionReference as `0x${string}`,
    });
  } catch {
    await prisma.walletChainWithdrawal.updateMany({
      where: { id: withdrawalId, status: "BROADCAST" },
      data: { lastCheckedAt: new Date() },
    });
    return { id: withdrawalId, status: "BROADCAST", note: "Transaction receipt is not available yet." };
  }

  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (!block.hash || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    await prisma.walletChainWithdrawal.update({
      where: { id: withdrawalId },
      data: {
        failureCode: "WITHDRAWAL_RECEIPT_NOT_CANONICAL",
        lastCheckedAt: new Date(),
      },
    });
    return { id: withdrawalId, status: "BROADCAST", note: "Receipt is not currently canonical; funds remain reserved." };
  }

  const latest = await client.getBlockNumber();
  const confirmationsBig = latest >= receipt.blockNumber ? latest - receipt.blockNumber + 1n : 0n;
  const confirmations = Number(confirmationsBig > 1_000_000n ? 1_000_000n : confirmationsBig);
  const required = withdrawal.network.finalityDepth;
  const actualFee = receipt.gasUsed * receipt.effectiveGasPrice;
  const reservedFee = atomic(withdrawal.feeAtomic);

  await prisma.walletChainWithdrawal.updateMany({
    where: { id: withdrawalId, status: "BROADCAST" },
    data: {
      confirmationCount: confirmations,
      blockPosition: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      lastCheckedAt: new Date(),
      actualFeeAtomic: actualFee.toString(),
    },
  });

  if (confirmations < required) {
    return { id: withdrawalId, status: "BROADCAST", confirmations, confirmationsRequired: required };
  }
  if (actualFee > reservedFee) {
    await prisma.walletChainWithdrawal.update({
      where: { id: withdrawalId },
      data: { failureCode: "ACTUAL_GAS_EXCEEDS_RESERVED_FEE" },
    });
    return {
      id: withdrawalId,
      status: "BROADCAST",
      confirmations,
      confirmationsRequired: required,
      error: "ACTUAL_GAS_EXCEEDS_RESERVED_FEE",
    };
  }
  if (!withdrawal.feeAssetId) throw new Error("WALLET_WITHDRAWAL_FEE_ASSET_MISSING");

  const success = receipt.status === "success";
  const finalStatus = success ? "CONFIRMED" : "FAILED";
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "wallet-chain-withdrawal:" + withdrawalId,
    );
    const current = await tx.walletChainWithdrawal.findUnique({ where: { id: withdrawalId } });
    if (!current || current.status !== "BROADCAST") return;

    if (success) {
      await postWalletJournalInTransaction(tx, {
        userId: withdrawal.userId,
        networkId: withdrawal.networkId,
        walletAssetId: withdrawal.walletAssetId,
        entryType: "WITHDRAWAL_SETTLEMENT",
        referenceKey: "wallet-chain-withdrawal:" + withdrawalId + ":amount-settlement",
        note: "Finalized on-chain wallet withdrawal",
        postings: [
          {
            account: "USER_RESERVED",
            direction: "DEBIT",
            amountAtomic: current.amountAtomic.toString(),
            accountReference: withdrawalId,
          },
          {
            account: "CUSTODY_ASSET",
            direction: "CREDIT",
            amountAtomic: current.amountAtomic.toString(),
            accountReference: current.walletAccountId,
          },
        ],
      });
    } else {
      await releaseReservation(tx, {
        id: withdrawalId,
        userId: withdrawal.userId,
        networkId: withdrawal.networkId,
        walletAssetId: withdrawal.walletAssetId,
        amount: atomic(current.amountAtomic),
        suffix: "amount-failed-release",
        note: "Release withdrawal amount after canonical reverted transaction",
      });
    }

    if (actualFee > 0n) {
      await postWalletJournalInTransaction(tx, {
        userId: withdrawal.userId,
        networkId: withdrawal.networkId,
        walletAssetId: withdrawal.feeAssetId!,
        entryType: "NETWORK_FEE",
        referenceKey: "wallet-chain-withdrawal:" + withdrawalId + ":fee-settlement",
        note: "Settle actual on-chain network fee",
        postings: [
          {
            account: "USER_RESERVED",
            direction: "DEBIT",
            amountAtomic: actualFee.toString(),
            accountReference: withdrawalId,
          },
          {
            account: "CUSTODY_ASSET",
            direction: "CREDIT",
            amountAtomic: actualFee.toString(),
            accountReference: current.walletAccountId,
          },
        ],
      });
    }
    await releaseReservation(tx, {
      id: withdrawalId,
      userId: withdrawal.userId,
      networkId: withdrawal.networkId,
      walletAssetId: withdrawal.feeAssetId!,
      amount: reservedFee - actualFee,
      suffix: "fee-unused-release",
      note: "Release unused estimated network fee reserve",
    });

    await tx.walletChainWithdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: finalStatus,
        feeAtomic: reservedFee.toString(),
        actualFeeAtomic: actualFee.toString(),
        confirmationCount: confirmations,
        blockPosition: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        confirmedAt: new Date(),
        lastCheckedAt: new Date(),
        failureCode: success ? null : "ONCHAIN_TRANSACTION_REVERTED",
      },
    });
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: success ? "WALLET_CHAIN_WITHDRAWAL_CONFIRMED" : "WALLET_CHAIN_WITHDRAWAL_FAILED",
        entity: "WalletChainWithdrawal",
        entityId: withdrawalId,
        metadata: {
          transactionHash: withdrawal.transactionReference,
          actualFeeAtomic: actualFee.toString(),
          confirmations,
        },
      },
    });
  }, { isolationLevel: "Serializable" });

  return {
    id: withdrawalId,
    status: finalStatus,
    transactionHash: withdrawal.transactionReference,
    confirmations,
    confirmationsRequired: required,
    actualFee: formatAssetUnits(actualFee, withdrawal.feeAsset?.decimals ?? 18),
  };
}
