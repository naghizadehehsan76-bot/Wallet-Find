import { randomUUID } from "node:crypto";
import { createPublicClient, http, isAddress, parseUnits, parseAbi, parseEventLogs } from "viem";
import { polygon } from "viem/chains";
import prisma from "../../config/prisma.js";
import { createTurnkeySigner, isTurnkeyConfigured, provisionTurnkeyWallet } from "./turnkey.service.js";
import { EVM_NETWORKS } from "./evm-network.registry.js";
function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return (negative ? "-" : "") + whole.toString() + (fraction ? "." + fraction : "");
}

function formatMicro(value: bigint): string { return formatUnits(value, 6); }
function formatAssetAmount(value: bigint, decimals: number): string { return formatUnits(value, decimals); }

type AssetBalance = { balance: bigint; pendingWithdrawals: bigint };

async function calculateBalances(tx: any, userId: string) {
  const rows = await tx.walletTransaction.findMany({
    where: { userId },
    select: {
      type: true, status: true, amountMicro: true, currency: true, chainId: true, chainAssetId: true,
    },
  });
  const totals = new Map<string, AssetBalance>();
  for (const row of rows) {
    const key = row.chainAssetId ?? "legacy:" + (row.currency || "USDT");
    const current = totals.get(key) ?? { balance: 0n, pendingWithdrawals: 0n };
    const amount = BigInt(row.amountMicro);
    if (row.status === "COMPLETED") {
      if (row.type === "DEPOSIT") current.balance += amount;
      if (row.type === "DEPOSIT_REVERSAL" || row.type === "WITHDRAWAL") current.balance -= amount;
    }
    if (row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING") current.pendingWithdrawals += amount;
    totals.set(key, current);
  }
  const usdt = totals.get("asset-polygon-usdt0") ?? totals.get("legacy:USDT0") ?? totals.get("legacy:USDT") ?? { balance: 0n, pendingWithdrawals: 0n };
  return {
    balance: usdt.balance,
    availableBalance: usdt.balance - usdt.pendingWithdrawals,
    byAsset: totals,
  };
}

function serializeTransaction(row: any) {
  const decimals = row.asset?.decimals ?? 6;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    amount: formatAssetAmount(BigInt(row.amountMicro), decimals),
    currency: row.asset?.symbol ?? row.currency ?? "USDT",
    assetId: row.chainAssetId ?? null,
    chainId: row.chainId ?? row.asset?.chainId ?? null,
    networkKey: row.asset?.chainId ? EVM_NETWORKS.find((network) => network.chainId === row.asset.chainId)?.networkKey ?? null : null,
    note: row.note,
    contestId: row.contestId,
    createdAt: row.createdAt,
  };
}

export async function getWallet(userId: string) {
  // Provision an EVM address only after server-side Turnkey credentials are configured.
  // No private key material is returned to the API caller.
  const turnkeyWallet = isTurnkeyConfigured() ? await provisionTurnkeyWallet(userId) : null;
  return prisma.$transaction(async (tx) => {
    const transactions = await tx.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { asset: { select: { id: true, chainId: true, symbol: true, displayName: true, decimals: true, contractAddress: true } } },
    });
    const balances = await calculateBalances(tx, userId);
    const assetIds = Array.from(new Set(transactions.map((row: any) => row.chainAssetId).filter((id: string | null): id is string => Boolean(id))));
    const assetWhere: any[] = [{ depositEnabled: true }, { withdrawalEnabled: true }];
    if (assetIds.length) assetWhere.push({ id: { in: assetIds } });
    const assetRecords = await tx.chainAsset.findMany({
      where: { OR: assetWhere },
      orderBy: [{ chainId: "asc" }, { symbol: "asc" }],
    });
    const networkAccounts = turnkeyWallet?.networkAccounts ?? [];
    const networkByChain = new Map(networkAccounts.map((network: any) => [network.chainId, network]));
    const assets = assetRecords.flatMap((asset: any) => {
      const network: any = networkByChain.get(asset.chainId);
      const totals = balances.byAsset.get(asset.id) ?? { balance: 0n, pendingWithdrawals: 0n };
      const available = totals.balance - totals.pendingWithdrawals;
      const depositEnabled = Boolean(asset.depositEnabled && network?.depositEnabled);
      const withdrawalEnabled = Boolean(asset.withdrawalEnabled && network?.withdrawalEnabled);
      if (!depositEnabled && !withdrawalEnabled && totals.balance === 0n && totals.pendingWithdrawals === 0n) return [];
      const networkConfig = EVM_NETWORKS.find((item) => item.chainId === asset.chainId);
      return [{
        assetId: asset.id,
        chainId: asset.chainId,
        networkKey: network?.networkKey ?? networkConfig?.networkKey ?? null,
        networkName: networkConfig?.displayName ?? network?.networkKey ?? "Unknown network",
        symbol: asset.symbol,
        displayName: asset.displayName,
        decimals: asset.decimals,
        contractAddress: asset.contractAddress,
        isNative: asset.contractAddress.toLowerCase() === "native",
        balance: formatAssetAmount(totals.balance, asset.decimals),
        availableBalance: formatAssetAmount(available, asset.decimals),
        depositEnabled,
        withdrawalEnabled,
      }];
    });
    const usdtAsset = assetRecords.find((asset: any) => asset.chainId === 137 && asset.symbol === "USDT0");
    return {
      currency: "USDT0",
      simulatedOnly: false,
      turnkeyConfigured: isTurnkeyConfigured(),
      walletAddress: turnkeyWallet?.address ?? null,
      supportedNetworks: networkAccounts.map((network: any) => ({
        chainId: network.chainId,
        networkKey: network.networkKey,
        networkName: EVM_NETWORKS.find((item) => item.chainId === network.chainId)?.displayName ?? network.networkKey,
        depositEnabled: network.depositEnabled,
        withdrawalEnabled: network.withdrawalEnabled,
      })),
      // Legacy scalar fields are retained for clients that have not yet moved
      // to the asset collection. They always represent Polygon USDT0 only.
      balance: formatAssetAmount(balances.balance, usdtAsset?.decimals ?? 6),
      availableBalance: formatAssetAmount(balances.availableBalance, usdtAsset?.decimals ?? 6),
      assets,
      transactions: transactions.map(serializeTransaction),
    };
  });
}
export async function requestWalletDeposit(userId: string, rawAssetId: unknown) {
  if (!isTurnkeyConfigured()) throw new Error("TURNKEY_NOT_CONFIGURED");
  if (typeof rawAssetId !== "string" || rawAssetId.length > 128) throw new Error("INVALID_WALLET_ASSET");
  // Provisioning enforces verified email and creates/returns the user's own
  // independent Turnkey sub-organization. The selected asset is resolved from
  // the server-side registry; client-supplied amounts/contracts are never trusted.
  const wallet = await provisionTurnkeyWallet(userId);
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.turnkeyOrganizationId || !wallet.turnkeyWalletId) {
    throw new Error("WALLET_NOT_ACTIVE");
  }
  const asset = await prisma.chainAsset.findUnique({ where: { id: rawAssetId } });
  if (!asset || asset.canonicalStatus !== "ONCHAIN_VERIFIED" || !asset.depositEnabled) throw new Error("DEPOSITS_DISABLED");
  const network = await prisma.walletNetworkAccount.findUnique({
    where: { walletAccountId_chainId: { walletAccountId: wallet.id, chainId: asset.chainId } },
  });
  const networkConfig = EVM_NETWORKS.find((item) => item.chainId === asset.chainId);
  if (!network || !network.depositEnabled || !networkConfig || process.env[networkConfig.scannerEnabledEnv] !== "true") {
    throw new Error("DEPOSITS_DISABLED");
  }
  const confirmationsRequired = Math.max(
    1,
    Number.parseInt(process.env[networkConfig.confirmationsEnv] ?? String(networkConfig.defaultConfirmations), 10)
      || networkConfig.defaultConfirmations,
  );
  const isNative = asset.contractAddress.toLowerCase() === "native";
  return {
    network: networkConfig.displayName,
    networkKey: networkConfig.networkKey,
    chainId: asset.chainId,
    assetId: asset.id,
    asset: asset.symbol,
    displayName: asset.displayName,
    assetType: isNative ? "NATIVE" : "ERC20",
    contractAddress: isNative ? null : asset.contractAddress,
    decimals: asset.decimals,
    depositAddress: wallet.address,
    confirmationsRequired,
    status: "AWAITING_TRANSFER",
    message: "Send only " + asset.symbol + " on " + networkConfig.displayName + " to this address. The balance is credited after canonical network confirmations.",
  };
}
export async function requestWalletWithdrawal(userId: string, rawAmount: unknown, rawDestination: unknown) {
  if (typeof rawAmount !== "string" && typeof rawAmount !== "number") throw new Error("INVALID_WALLET_AMOUNT");
  const amountText = String(rawAmount).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(amountText)) throw new Error("INVALID_WALLET_AMOUNT");
  const amountMicro = parseUnits(amountText, 6);
  if (amountMicro <= 0n) throw new Error("INVALID_WALLET_AMOUNT");
  if (typeof rawDestination !== "string" || !isAddress(rawDestination.trim())) throw new Error("INVALID_DESTINATION_ADDRESS");

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.walletAccount.findUnique({
      where: { userId },
      include: { networkAccounts: true },
    });
    if (!wallet || wallet.status !== "ACTIVE") throw new Error("WALLET_NOT_ACTIVE");
    const network = wallet.networkAccounts.find((item) => item.chainId === 137 && item.networkKey === "polygon");
    if (!network || !network.withdrawalEnabled) throw new Error("WITHDRAWALS_DISABLED");

    const asset = await tx.chainAsset.findFirst({
      where: {
        chainId: 137,
        symbol: "USDT0",
        canonicalStatus: "ONCHAIN_VERIFIED",
        withdrawalEnabled: true,
        decimals: 6,
      },
    });
    if (!asset) throw new Error("WITHDRAWALS_DISABLED");

    const balances = await calculateBalances(tx, userId);
    const assetBalance = balances.byAsset.get(asset.id) ?? { balance: 0n, pendingWithdrawals: 0n };
    if (assetBalance.balance - assetBalance.pendingWithdrawals < amountMicro) throw new Error("INSUFFICIENT_WALLET_BALANCE");

    const idempotencyKey = randomUUID();
    const withdrawal = await tx.walletWithdrawal.create({
      data: {
        userId,
        walletAccountId: wallet.id,
        walletNetworkAccountId: network.id,
        chainAssetId: asset.id,
        chainId: 137,
        destinationAddress: rawDestination.trim().toLowerCase(),
        amountMicro,
        status: "REQUESTED",
        idempotencyKey,
      },
    });
    await tx.walletTransaction.create({
      data: {
        userId,
        type: "WITHDRAWAL_REQUEST",
        status: "PENDING",
        amountMicro,
        currency: asset.symbol,
        chainId: asset.chainId,
        chainAssetId: asset.id,
        note: "Polygon USDT0 withdrawal request reserved pending admin review",
        referenceKey: `withdrawal-request:${withdrawal.id}`,
      },
    });
    return {
      id: withdrawal.id,
      status: withdrawal.status,
      network: "Polygon PoS",
      asset: "USDT0",
      destinationAddress: withdrawal.destinationAddress,
      amount: formatAssetAmount(amountMicro, asset.decimals),
      requestedAt: withdrawal.requestedAt,
    };
  }, { isolationLevel: "Serializable" });
}


const polygonUsdt0Abi = parseAbi(["function transfer(address to, uint256 value) returns (bool)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);
const polygonUsdt0Contract = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" as const;
const polygonWithdrawalConfirmations = Math.max(32, Number.parseInt(process.env.POLYGON_WITHDRAWAL_CONFIRMATIONS ?? "128", 10) || 128);

function polygonRpcClient() {
  const rpc = process.env.POLYGON_RPC_URL?.trim();
  if (!rpc) throw new Error("POLYGON_RPC_NOT_CONFIGURED");
  return createPublicClient({ chain: polygon, transport: http(rpc, { timeout: 20_000, retryCount: 2 }) });
}

export async function executeApprovedWalletWithdrawal(withdrawalId: string, adminUserId: string) {
  if (process.env.POLYGON_WITHDRAWALS_EXECUTION_ENABLED !== "true") throw new Error("REAL_WITHDRAWAL_EXECUTION_DISABLED");
  if (!withdrawalId || withdrawalId.length > 128) throw new Error("WITHDRAWAL_NOT_FOUND");
  const withdrawal = await prisma.walletWithdrawal.findUnique({
    where: { id: withdrawalId },
    include: { walletAccount: true, networkAccount: true, asset: true },
  });
  if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
  if (withdrawal.status !== "APPROVED") throw new Error("WITHDRAWAL_NOT_APPROVED");
  if (withdrawal.chainId !== 137 || withdrawal.asset.symbol !== "USDT0" ||
      withdrawal.asset.contractAddress.toLowerCase() !== polygonUsdt0Contract.toLowerCase() ||
      withdrawal.asset.decimals !== 6 || withdrawal.asset.canonicalStatus !== "ONCHAIN_VERIFIED" ||
      !withdrawal.asset.withdrawalEnabled || !withdrawal.networkAccount.withdrawalEnabled) {
    throw new Error("WITHDRAWALS_DISABLED");
  }
  if (withdrawal.walletAccount.status !== "ACTIVE") throw new Error("WALLET_NOT_ACTIVE");
  const claimed = await prisma.walletWithdrawal.updateMany({
    where: { id: withdrawal.id, status: "APPROVED" },
    data: { status: "SIGNING" },
  });
  if (claimed.count !== 1) throw new Error("WITHDRAWAL_ALREADY_PROCESSING");

  // A SIGNING record is never automatically retried after the broadcast attempt.
  let broadcastAttempted = false;
  try {
    const client = polygonRpcClient();
    const amount = BigInt(withdrawal.amountMicro);
    const accountAddress = withdrawal.walletAccount.address as `0x${string}`;
    const tokenBalance = await client.readContract({
      address: polygonUsdt0Contract, abi: polygonUsdt0Abi,
      functionName: "balanceOf", args: [accountAddress],
    });
    if (tokenBalance < amount) throw new Error("INSUFFICIENT_ONCHAIN_USDT0");
    const gas = await client.estimateContractGas({
      account: accountAddress, address: polygonUsdt0Contract, abi: polygonUsdt0Abi,
      functionName: "transfer", args: [withdrawal.destinationAddress as `0x${string}`, amount],
    });
    const gasPrice = await client.getGasPrice();
    const estimatedGasCost = gas * gasPrice;
    const nativeBalance = await client.getBalance({ address: accountAddress });
    if (nativeBalance < estimatedGasCost) throw new Error("INSUFFICIENT_POLYGON_POL_FOR_GAS");

    const signer = await createTurnkeySigner(withdrawal.walletAccount.address, 137);
    broadcastAttempted = true;
    const hash = await signer.writeContract({
      account: signer.account!, chain: polygon, address: polygonUsdt0Contract,
      abi: polygonUsdt0Abi, functionName: "transfer",
      args: [withdrawal.destinationAddress as `0x${string}`, amount], gas, gasPrice,
    });
    await prisma.$transaction(async (tx) => {
      const changed = await tx.walletWithdrawal.updateMany({
        where: { id: withdrawal.id, status: "SIGNING" },
        data: { status: "BROADCAST", transactionHash: hash, broadcastAt: new Date() },
      });
      if (changed.count !== 1) throw new Error("WITHDRAWAL_STATE_CHANGED_AFTER_BROADCAST");
      await tx.auditLog.create({
        data: {
          userId: adminUserId, action: "WALLET_WITHDRAWAL_BROADCAST",
          entity: "WalletWithdrawal", entityId: withdrawal.id,
          metadata: {
            chainId: 137, asset: "USDT0", transactionHash: hash,
            destinationAddress: withdrawal.destinationAddress,
            amountMicro: amount.toString(), estimatedGas: gas.toString(),
            gasPriceWei: gasPrice.toString(), estimatedGasCostWei: estimatedGasCost.toString(),
          },
        },
      });
    });
    return { id: withdrawal.id, status: "BROADCAST", transactionHash: hash, chainId: 137,
      asset: "USDT0", amount: formatMicro(amount), estimatedGasCostPOLWei: estimatedGasCost.toString() };
  } catch (error) {
    if (!broadcastAttempted) {
      await prisma.walletWithdrawal.updateMany({ where: { id: withdrawal.id, status: "SIGNING" }, data: { status: "APPROVED" } }).catch(() => undefined);
    } else {
      console.error("Withdrawal remains SIGNING and requires manual review; automatic retry is disabled", { withdrawalId, error });
    }
    throw error;
  }
}

export async function reconcileBroadcastWalletWithdrawal(withdrawalId: string, adminUserId: string) {
  const withdrawal = await prisma.walletWithdrawal.findUnique({ where: { id: withdrawalId }, include: { walletAccount: true, asset: true } });
  if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
  if (withdrawal.status !== "BROADCAST" || !withdrawal.transactionHash) throw new Error("WITHDRAWAL_NOT_BROADCAST");
  const client = polygonRpcClient();
  const receipt = await client.getTransactionReceipt({ hash: withdrawal.transactionHash as `0x${string}` });
  const latestBlock = await client.getBlockNumber();
  const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error("WITHDRAWAL_RECEIPT_NOT_CANONICAL");
  const confirmations = Number(latestBlock - receipt.blockNumber + 1n);
  if (confirmations < polygonWithdrawalConfirmations) {
    return { id: withdrawal.id, status: "BROADCAST", transactionHash: withdrawal.transactionHash, confirmations, confirmationsRequired: polygonWithdrawalConfirmations };
  }
  if (receipt.status === "success") {
    const transferEvents = parseEventLogs({ abi: polygonUsdt0Abi, logs: receipt.logs, eventName: "Transfer", strict: false });
    const expectedAmount = BigInt(withdrawal.amountMicro);
    const verifiedTransfer = transferEvents.some((event) =>
      event.args.from?.toLowerCase() === withdrawal.walletAccount.address.toLowerCase() &&
      event.args.to?.toLowerCase() === withdrawal.destinationAddress.toLowerCase() &&
      event.args.value === expectedAmount
    );
    if (!verifiedTransfer) throw new Error("WITHDRAWAL_TRANSFER_EVENT_MISSING");
  }
  if (receipt.status !== "success") {
    await prisma.$transaction(async (tx) => {
      await tx.walletWithdrawal.updateMany({
        where: { id: withdrawal.id, status: "BROADCAST" },
        data: { status: "FAILED", failureCode: "ONCHAIN_TRANSACTION_REVERTED" },
      });
      await tx.walletTransaction.updateMany({
        where: { userId: withdrawal.userId, referenceKey: "withdrawal-request:" + withdrawal.id, status: "PENDING" },
        data: { status: "CANCELLED", note: "Withdrawal transaction reverted on Polygon; reserved USDT0 balance released" },
      });
      await tx.auditLog.create({
        data: { userId: adminUserId, action: "WALLET_WITHDRAWAL_REVERTED", entity: "WalletWithdrawal", entityId: withdrawal.id, metadata: { transactionHash: withdrawal.transactionHash, confirmations } },
      });
    });
    return { id: withdrawal.id, status: "FAILED", transactionHash: withdrawal.transactionHash, confirmations };
  }
  await prisma.$transaction(async (tx) => {
    const changed = await tx.walletWithdrawal.updateMany({
      where: { id: withdrawal.id, status: "BROADCAST", transactionHash: withdrawal.transactionHash },
      data: { status: "CONFIRMED", confirmedAt: new Date(), failureCode: null },
    });
    if (changed.count !== 1) throw new Error("WITHDRAWAL_STATE_CHANGED");
    await tx.walletTransaction.updateMany({
      where: { userId: withdrawal.userId, referenceKey: "withdrawal-request:" + withdrawal.id, status: "PENDING" },
      data: { status: "CANCELLED", note: "Withdrawal reservation settled on canonical Polygon confirmation" },
    });
    await tx.walletTransaction.create({
      data: {
        userId: withdrawal.userId, type: "WITHDRAWAL", status: "COMPLETED",
        amountMicro: withdrawal.amountMicro, currency: withdrawal.asset.symbol,
        chainId: withdrawal.chainId, chainAssetId: withdrawal.chainAssetId,
        note: "Confirmed Polygon USDT0 withdrawal",
        referenceKey: "withdrawal-completed:" + withdrawal.id,
      },
    });
    await tx.auditLog.create({
      data: { userId: adminUserId, action: "WALLET_WITHDRAWAL_CONFIRMED", entity: "WalletWithdrawal", entityId: withdrawal.id, metadata: { transactionHash: withdrawal.transactionHash, confirmations, receiptBlock: receipt.blockNumber.toString() } },
    });
  });
  return { id: withdrawal.id, status: "CONFIRMED", transactionHash: withdrawal.transactionHash, confirmations };
}

export async function getAdminWithdrawalRequests() {
  const rows = await prisma.walletWithdrawal.findMany({
    where: { status: { in: ["REQUESTED", "APPROVED", "SIGNING", "BROADCAST", "CONFIRMED", "FAILED"] } },
    orderBy: { requestedAt: "asc" },
    take: 200,
    include: { user: { select: { username: true, email: true } }, asset: { select: { symbol: true, decimals: true, chainId: true, displayName: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    email: row.user.email,
    network: "Polygon PoS",
    asset: row.asset.symbol,
    chainId: row.chainId,
    displayName: row.asset.displayName,
    destinationAddress: row.destinationAddress,
    amount: formatAssetAmount(BigInt(row.amountMicro), row.asset.decimals),
    fee: formatAssetAmount(BigInt(row.feeMicro), row.asset.decimals),
    status: row.status,
    requestedAt: row.requestedAt,
    transactionHash: row.transactionHash,
  }));
}

export async function reviewWalletWithdrawal(
  withdrawalId: string,
  decision: "APPROVE" | "REJECT",
  adminUserId: string,
  reason?: string,
) {
  if (!withdrawalId || withdrawalId.length > 128) throw new Error("WITHDRAWAL_NOT_FOUND");
  const normalizedReason = reason?.trim().slice(0, 500) || null;
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.walletWithdrawal.findUnique({
      where: { id: withdrawalId },
      select: { id: true, userId: true, amountMicro: true, status: true },
    });
    if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
    if (withdrawal.status !== "REQUESTED") throw new Error("WITHDRAWAL_ALREADY_REVIEWED");

    const nextStatus = decision === "APPROVE" ? "APPROVED" : "CANCELLED";
    const changed = await tx.walletWithdrawal.updateMany({
      where: { id: withdrawalId, status: "REQUESTED" },
      data: { status: nextStatus },
    });
    if (changed.count !== 1) throw new Error("WITHDRAWAL_ALREADY_REVIEWED");

    if (decision === "REJECT") {
      await tx.walletTransaction.updateMany({
        where: {
          userId: withdrawal.userId,
          referenceKey: `withdrawal-request:${withdrawal.id}`,
          type: "WITHDRAWAL_REQUEST",
          status: "PENDING",
        },
        data: { status: "CANCELLED", note: normalizedReason ? `Withdrawal request rejected: ${normalizedReason}` : "Withdrawal request rejected by admin" },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: decision === "APPROVE" ? "WALLET_WITHDRAWAL_APPROVED" : "WALLET_WITHDRAWAL_REJECTED",
        entity: "WalletWithdrawal",
        entityId: withdrawal.id,
        metadata: {
          userId: withdrawal.userId,
          amountMicro: withdrawal.amountMicro.toString(),
          reason: normalizedReason,
        },
      },
    });
    return { id: withdrawal.id, status: nextStatus };
  }, { isolationLevel: "Serializable" });
}

export async function getAdminWallets() {
  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, email: true,
      walletTransactions: {
        select: {
          type: true, status: true, amountMicro: true, currency: true,
          chainId: true, chainAssetId: true,
          asset: { select: { id: true, chainId: true, symbol: true, decimals: true, displayName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return users.map((user) => {
    const totals = new Map<string, { balance: bigint; pendingWithdrawals: bigint; asset: any }>();
    let pendingDeposits = 0;
    for (const row of user.walletTransactions) {
      const key = row.chainAssetId ?? "legacy:" + (row.currency || "USDT");
      const current = totals.get(key) ?? { balance: 0n, pendingWithdrawals: 0n, asset: row.asset };
      const amount = BigInt(row.amountMicro);
      if (row.status === "COMPLETED") {
        if (row.type === "DEPOSIT") current.balance += amount;
        if (row.type === "DEPOSIT_REVERSAL" || row.type === "WITHDRAWAL") current.balance -= amount;
      }
      if (row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING") current.pendingWithdrawals += amount;
      if (row.type === "DEPOSIT_REQUEST" && row.status === "PENDING") pendingDeposits++;
      totals.set(key, current);
    }
    const assets = Array.from(totals.entries()).map(([assetId, value]) => {
      const decimals = value.asset?.decimals ?? 6;
      return {
        assetId: value.asset?.id ?? null,
        chainId: value.asset?.chainId ?? null,
        symbol: value.asset?.symbol ?? "USDT",
        displayName: value.asset?.displayName ?? value.asset?.symbol ?? "Legacy balance",
        decimals,
        balance: formatAssetAmount(value.balance, decimals),
        availableBalance: formatAssetAmount(value.balance - value.pendingWithdrawals, decimals),
      };
    });
    const usdt = assets.find((asset) => asset.assetId === "asset-polygon-usdt0" || (asset.chainId === 137 && asset.symbol === "USDT0"));
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      balance: usdt?.balance ?? "0",
      availableBalance: usdt?.availableBalance ?? "0",
      assets,
      pendingDepositRequests: pendingDeposits,
      pendingWithdrawalRequests: user.walletTransactions.filter((row) => row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING").length,
    };
  });
}


const TREASURY_ID = "polygon-prize-treasury";
const USDT0_ADDRESS = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" as const;
const USDT0_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

async function readTreasuryChainSnapshot(address: string) {
  const rpc = process.env.POLYGON_RPC_URL?.trim();
  if (!rpc) throw new Error("TREASURY_RPC_NOT_CONFIGURED");
  if (!isAddress(address)) throw new Error("TREASURY_ADDRESS_INVALID");

  const client = createPublicClient({
    chain: polygon,
    transport: http(rpc, { timeout: 20_000, retryCount: 2 }),
  });

  // Public Polygon RPC nodes can briefly disagree about the newest block header.
  // Read from a slightly confirmed head first, then move farther back only when
  // the provider reports that a requested header is not available.
  const latestBlock = await client.getBlockNumber();
  const safeOffsets = [12n, 24n, 48n, 96n];
  let lastError: unknown;

  for (const offset of safeOffsets) {
    if (latestBlock <= offset) continue;
    const blockNumber = latestBlock - offset;
    try {
      const block = await client.getBlock({ blockNumber });
      if (!block.hash) throw new Error("TREASURY_BLOCK_HASH_UNAVAILABLE");

      const balance = await client.readContract({
        address: USDT0_ADDRESS,
        abi: USDT0_ABI,
        functionName: "balanceOf",
        args: [address],
        blockNumber,
      });

      return { blockNumber, blockHash: block.hash, balanceMicro: BigInt(balance) };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const headerUnavailable = /header not found|block not found|unknown block|cannot query unfinalized data/i.test(message);
      if (!headerUnavailable) throw error;
    }
  }

  console.error("Treasury Polygon snapshot could not find a readable confirmed block", {
    latestBlock: latestBlock.toString(),
    offsets: safeOffsets.map(String),
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new Error("TREASURY_RPC_CONFIRMED_BLOCK_UNAVAILABLE");
}


export async function reconcileTreasuryAccounting(adminUserId: string) {
  const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID } });
  if (!treasury || treasury.status !== "ACTIVE" || !treasury.address) throw new Error("TREASURY_NOT_READY");

  const [chain, ledger] = await Promise.all([
    readTreasuryChainSnapshot(treasury.address),
    prisma.treasuryLedger.aggregate({
      where: { treasuryWalletId: treasury.id, currency: "USDT0" },
      _sum: { amountMicro: true },
    }),
  ]);
  const ledgerBalanceMicro = BigInt(ledger._sum.amountMicro ?? 0n);
  const differenceMicro = chain.balanceMicro - ledgerBalanceMicro;
  const status = differenceMicro === 0n ? "MATCH" : "MISMATCH";

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.treasuryReconciliation.create({
      data: {
        treasuryWalletId: treasury.id,
        chainId: 137,
        asset: "USDT0",
        blockNumber: chain.blockNumber,
        blockHash: chain.blockHash,
        onChainBalanceMicro: chain.balanceMicro,
        ledgerBalanceMicro,
        differenceMicro,
        status,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "TREASURY_ACCOUNTING_RECONCILIATION",
        entity: "TreasuryReconciliation",
        entityId: created.id,
        metadata: {
          chainId: 137,
          asset: "USDT0",
          blockNumber: chain.blockNumber.toString(),
          blockHash: chain.blockHash,
          onChainBalanceMicro: chain.balanceMicro.toString(),
          ledgerBalanceMicro: ledgerBalanceMicro.toString(),
          differenceMicro: differenceMicro.toString(),
          status,
        },
      },
    });
    return created;
  });

  return {
    id: record.id,
    treasuryAddress: treasury.address,
    chainId: 137,
    asset: "USDT0",
    blockNumber: chain.blockNumber.toString(),
    blockHash: chain.blockHash,
    onChainBalance: formatMicro(chain.balanceMicro),
    ledgerBalance: formatMicro(ledgerBalanceMicro),
    difference: formatMicro(differenceMicro),
    status,
    checkedAt: record.createdAt,
    note: status === "MATCH"
      ? "On-chain balance matches the treasury ledger at the recorded Polygon block."
      : "Balance mismatch detected. Prize-fund allocation is blocked until the difference is investigated and an authorized ledger correction is recorded.",
  };
}

export async function getLatestTreasuryAccountingReconciliation() {
  const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID } });
  if (!treasury) throw new Error("TREASURY_NOT_READY");
  const record = await prisma.treasuryReconciliation.findFirst({
    where: { treasuryWalletId: treasury.id },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return null;
  return {
    id: record.id,
    treasuryAddress: treasury.address,
    chainId: record.chainId,
    asset: record.asset,
    blockNumber: record.blockNumber.toString(),
    blockHash: record.blockHash,
    onChainBalance: formatMicro(BigInt(record.onChainBalanceMicro)),
    ledgerBalance: formatMicro(BigInt(record.ledgerBalanceMicro)),
    difference: formatMicro(BigInt(record.differenceMicro)),
    status: record.status,
    checkedAt: record.createdAt,
  };
}

export async function getTreasuryPrizeFundingSnapshot() {
  const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID } });
  if (!treasury || treasury.status !== "ACTIVE" || !treasury.address) throw new Error("TREASURY_NOT_READY");
  const [chain, fund, fundingRows, treasuryLedgerRows] = await Promise.all([
    readTreasuryChainSnapshot(treasury.address),
    prisma.globalPrizeFund.findUnique({ where: { id: "global" } }),
    prisma.globalPrizeLedger.aggregate({ where: { type: "TREASURY_FUNDING" }, _sum: { amountMicro: true } }),
    prisma.treasuryLedger.aggregate({
      where: { treasuryWalletId: treasury.id, currency: "USDT0" },
      _sum: { amountMicro: true },
    }),
  ]);
  const reserved = BigInt(fundingRows._sum.amountMicro ?? 0n);
  const ledgerBalance = BigInt(treasuryLedgerRows._sum.amountMicro ?? 0n);
  const difference = chain.balanceMicro - ledgerBalance;
  return {
    treasuryAddress: treasury.address,
    chainId: 137,
    asset: "USDT0",
    snapshotBlockNumber: chain.blockNumber.toString(),
    snapshotBlockHash: chain.blockHash,
    onChainBalance: formatMicro(chain.balanceMicro),
    treasuryLedgerBalance: formatMicro(ledgerBalance),
    accountingDifference: formatMicro(difference),
    accountingStatus: difference === 0n ? "MATCH" : "MISMATCH",
    allocatedToPrizeFund: formatMicro(reserved),
    unallocatedTreasuryBalance: formatMicro(chain.balanceMicro > reserved ? chain.balanceMicro - reserved : 0n),
    prizeFundBalance: formatMicro(BigInt(fund?.balanceMicro ?? 0n)),
    updatedAt: new Date().toISOString(),
  };
}

export async function getAdminTreasuryDeposits() {
  const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID }, select: { id: true, address: true, status: true, chainId: true } });
  if (!treasury || treasury.status !== "ACTIVE" || !treasury.address) throw new Error("TREASURY_NOT_READY");
  const rows = await prisma.treasuryDeposit.findMany({
    where: { treasuryWalletId: treasury.id },
    orderBy: [{ detectedAt: "desc" }, { blockNumber: "desc" }],
    take: 100,
    include: { asset: { select: { symbol: true, decimals: true, displayName: true, contractAddress: true } } },
  });
  return {
    treasuryAddress: treasury.address,
    chainId: treasury.chainId,
    deposits: rows.map((row) => ({
      id: row.id,
      transactionHash: row.transactionHash,
      logIndex: row.logIndex,
      blockNumber: row.blockNumber.toString(),
      fromAddress: row.fromAddress,
      toAddress: row.toAddress,
      amount: row.amountMicro === null ? null : formatAssetAmount(row.amountMicro, row.asset.decimals),
      asset: row.asset.symbol,
      displayName: row.asset.displayName,
      isNative: row.asset.contractAddress.toLowerCase() === "native",
      status: row.status,
      confirmationCount: row.confirmationCount,
      detectedAt: row.detectedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      creditedAt: row.creditedAt?.toISOString() ?? null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function getAdminTreasuryLedgerHistory() {
  const treasury = await prisma.treasuryWallet.findUnique({
    where: { id: TREASURY_ID },
    select: { id: true, address: true, status: true, chainId: true },
  });
  if (!treasury || treasury.status !== "ACTIVE" || !treasury.address) throw new Error("TREASURY_NOT_READY");
  const rows = await prisma.treasuryLedger.findMany({
    where: { treasuryWalletId: treasury.id },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { asset: { select: { symbol: true, decimals: true, chainId: true, displayName: true } } },
  });
  return {
    treasuryAddress: treasury.address,
    chainId: treasury.chainId,
    transactions: rows.map((row) => ({
      id: row.id, type: row.type,
      amount: formatAssetAmount(row.amountMicro, row.asset?.decimals ?? 6),
      currency: row.asset?.symbol ?? row.currency,
      chainId: row.chainId ?? row.asset?.chainId ?? treasury.chainId,
      networkName: EVM_NETWORKS.find((network) => network.chainId === (row.chainId ?? row.asset?.chainId ?? treasury.chainId))?.displayName ?? "Unknown network",
      displayName: row.asset?.displayName ?? row.currency,
      transactionHash: row.transactionHash, referenceKey: row.referenceKey,
      note: row.note, effectiveAt: row.effectiveAt.toISOString(), createdAt: row.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function allocateTreasuryToPrizeFund(rawAmount: unknown, adminUserId: string) {
  if (typeof rawAmount !== "string" && typeof rawAmount !== "number") throw new Error("INVALID_ALLOCATION_AMOUNT");
  const amountText = String(rawAmount).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(amountText)) throw new Error("INVALID_ALLOCATION_AMOUNT");
  const amount = parseUnits(amountText, 6);
  if (amount <= 0n) throw new Error("INVALID_ALLOCATION_AMOUNT");
  const snapshot = await getTreasuryPrizeFundingSnapshot();
  if (snapshot.accountingStatus !== "MATCH") throw new Error("TREASURY_ACCOUNTING_MISMATCH");
  const liveBalance = parseUnits(snapshot.onChainBalance, 6);
  if (amount > liveBalance) throw new Error("INSUFFICIENT_TREASURY_BALANCE");
  return prisma.$transaction(async (tx) => {
    await tx.globalPrizeFund.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
    const prior = await tx.globalPrizeLedger.aggregate({ where: { type: "TREASURY_FUNDING" }, _sum: { amountMicro: true } });
    const alreadyReserved = BigInt(prior._sum.amountMicro ?? 0n);
    if (alreadyReserved + amount > liveBalance) throw new Error("INSUFFICIENT_UNALLOCATED_TREASURY_BALANCE");
    const referenceKey = "treasury-prize-funding:" + randomUUID();
    const fund = await tx.globalPrizeFund.update({ where: { id: "global" }, data: { balanceMicro: { increment: amount }, totalFundedMicro: { increment: amount } } });
    await tx.globalPrizeLedger.create({ data: { type: "TREASURY_FUNDING", amountMicro: amount, effectiveAt: new Date(), referenceKey, note: "Admin internal allocation from reconciled Polygon treasury; no on-chain transfer" } });
    await tx.auditLog.create({ data: { userId: adminUserId, action: "TREASURY_PRIZE_FUND_ALLOCATION", entity: "GlobalPrizeFund", entityId: "global", metadata: { amountMicro: amount.toString(), treasuryAddress: snapshot.treasuryAddress, reconciliationBlockNumber: snapshot.snapshotBlockNumber } } });
    return { amount: formatMicro(amount), treasuryAddress: snapshot.treasuryAddress, chainId: 137, asset: "USDT0", snapshotBlockNumber: snapshot.snapshotBlockNumber, snapshotBlockHash: snapshot.snapshotBlockHash, onChainBalance: snapshot.onChainBalance, treasuryLedgerBalance: snapshot.treasuryLedgerBalance, accountingDifference: snapshot.accountingDifference, accountingStatus: snapshot.accountingStatus, allocatedToPrizeFund: formatMicro(alreadyReserved + amount), unallocatedTreasuryBalance: formatMicro(liveBalance - alreadyReserved - amount), prizeFundBalance: formatMicro(BigInt(fund.balanceMicro)), updatedAt: new Date().toISOString() };
  }, { isolationLevel: "Serializable" });
}
