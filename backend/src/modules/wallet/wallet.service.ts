import { randomUUID } from "node:crypto";
import { isAddress, parseUnits } from "viem";
import prisma from "../../config/prisma.js";
import { isTurnkeyConfigured, provisionTurnkeyWallet } from "./turnkey.service.js";
const MICRO = 1_000_000n;
function formatMicro(value: bigint): string {
  const whole = value / MICRO;
  const fraction = (value % MICRO).toString().padStart(6, "0");
  return whole.toString() + "." + fraction;
}
async function calculateBalances(tx: any, userId: string) {
  const rows = await tx.walletTransaction.findMany({ where: { userId }, select: { type: true, status: true, amountMicro: true } });
  let balance = 0n, pendingWithdrawals = 0n;
  for (const row of rows) {
    const amount = BigInt(row.amountMicro);
    if (row.status === "COMPLETED") {
      if (row.type === "DEPOSIT") balance += amount;
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
export async function requestWalletDeposit(_userId: string, _rawAmount: unknown): Promise<never> { throw new Error("REAL_DEPOSITS_NOT_CONFIGURED"); }
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
