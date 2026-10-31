import { randomUUID } from "node:crypto";
import { createPublicClient, http, isAddress, parseUnits, parseAbi, parseEventLogs } from "viem";
import { polygon } from "viem/chains";
import prisma from "../../config/prisma.js";
import { createTurnkeySigner, isTurnkeyConfigured, provisionTurnkeyWallet } from "./turnkey.service.js";
const MICRO = 1_000_000n;
function formatMicro(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MICRO;
  const fraction = (absolute % MICRO).toString().padStart(6, "0");
  return (negative ? "-" : "") + whole.toString() + "." + fraction;
}
async function calculateBalances(tx: any, userId: string) {
  const rows = await tx.walletTransaction.findMany({ where: { userId }, select: { type: true, status: true, amountMicro: true } });
  let balance = 0n, pendingWithdrawals = 0n;
  for (const row of rows) {
    const amount = BigInt(row.amountMicro);
    if (row.status === "COMPLETED") {
      if (row.type === "DEPOSIT") balance += amount;
      if (row.type === "DEPOSIT_REVERSAL") balance -= amount;
      if (row.type === "WITHDRAWAL") balance -= amount;
    }
    if (row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING") pendingWithdrawals += amount;
  }
  return { balance, availableBalance: balance - pendingWithdrawals };
}
function serializeTransaction(row: any) {
  return { id: row.id, type: row.type, status: row.status, amount: formatMicro(BigInt(row.amountMicro)), currency: row.currency, note: row.note, contestId: row.contestId, createdAt: row.createdAt };
}
export async function getWallet(userId: string) {
  // Provision an EVM address only after server-side Turnkey credentials are configured.
  // No private key material is returned to the API caller.
  const turnkeyWallet = isTurnkeyConfigured() ? await provisionTurnkeyWallet(userId) : null;
  return prisma.$transaction(async (tx) => {
    const balances = await calculateBalances(tx, userId);
    const transactions = await tx.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
    return { currency: "USDT", simulatedOnly: false, turnkeyConfigured: isTurnkeyConfigured(), walletAddress: turnkeyWallet?.address ?? null, supportedNetworks: turnkeyWallet?.networkAccounts.map((network) => ({ chainId: network.chainId, networkKey: network.networkKey, depositEnabled: network.depositEnabled, withdrawalEnabled: network.withdrawalEnabled })) ?? [], balance: formatMicro(balances.balance), availableBalance: formatMicro(balances.availableBalance), transactions: transactions.map(serializeTransaction) };
  });
}
export async function requestWalletDeposit(userId: string, _rawAmount: unknown) {
  if (!isTurnkeyConfigured()) throw new Error("TURNKEY_NOT_CONFIGURED");
  // Provisioning enforces verified email and creates/returns this user's own
  // independent Turnkey sub-organization. Deposits are discovered from canonical
  // Polygon Transfer logs; a client-supplied amount is never credited.
  const wallet = await provisionTurnkeyWallet(userId);
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.turnkeyOrganizationId || !wallet.turnkeyWalletId) {
    throw new Error("WALLET_NOT_ACTIVE");
  }
  const [network, asset] = await Promise.all([
    prisma.walletNetworkAccount.findUnique({
      where: { walletAccountId_chainId: { walletAccountId: wallet.id, chainId: 137 } },
    }),
    prisma.chainAsset.findMany({
      where: {
        chainId: 137,
        symbol: "USDT0",
        contractAddress: polygonUsdt0Contract,
        decimals: 6,
        canonicalStatus: "ONCHAIN_VERIFIED",
        depositEnabled: true,
      },
      take: 2,
    }),
  ]);
  if (!network || network.networkKey !== "polygon" || !network.depositEnabled || asset.length !== 1) {
    throw new Error("DEPOSITS_DISABLED");
  }
  return {
    network: "Polygon PoS",
    chainId: 137,
    asset: "USDT0",
    contractAddress: polygonUsdt0Contract,
    decimals: 6,
    depositAddress: wallet.address,
    confirmationsRequired: Math.max(32, Number.parseInt(process.env.POLYGON_USDT_CONFIRMATIONS ?? "128", 10) || 128),
    status: "AWAITING_TRANSFER",
    message: "Send only Polygon USDT0 to this address. The balance is credited automatically after canonical confirmations.",
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
    if (balances.availableBalance < amountMicro) throw new Error("INSUFFICIENT_WALLET_BALANCE");

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
        currency: "USDT",
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
      amount: formatMicro(amountMicro),
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
  const withdrawal = await prisma.walletWithdrawal.findUnique({ where: { id: withdrawalId }, include: { walletAccount: true } });
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
        amountMicro: withdrawal.amountMicro, currency: "USDT",
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
    include: { user: { select: { username: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    email: row.user.email,
    network: "Polygon PoS",
    asset: "USDT0",
    destinationAddress: row.destinationAddress,
    amount: formatMicro(BigInt(row.amountMicro)),
    fee: formatMicro(BigInt(row.feeMicro)),
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
      walletTransactions: { select: { type: true, status: true, amountMicro: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return users.map((user) => {
    let balance = 0n, pendingWithdrawals = 0n, pendingDeposits = 0;
    for (const row of user.walletTransactions) {
      const amount = BigInt(row.amountMicro);
      if (row.status === "COMPLETED") {
        if (row.type === "DEPOSIT") balance += amount;
        if (row.type === "WITHDRAWAL") balance -= amount;
      }
      if (row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING") pendingWithdrawals += amount;
      if (row.type === "DEPOSIT_REQUEST" && row.status === "PENDING") pendingDeposits++;
    }
    return {
      userId: user.id, username: user.username, email: user.email,
      balance: formatMicro(balance), availableBalance: formatMicro(balance - pendingWithdrawals),
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
  const client = createPublicClient({ chain: polygon, transport: http(rpc, { timeout: 20_000, retryCount: 2 }) });
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  const balance = await client.readContract({
    address: USDT0_ADDRESS,
    abi: USDT0_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
    blockNumber,
  });
  return { blockNumber, blockHash: block.hash, balanceMicro: BigInt(balance) };
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
