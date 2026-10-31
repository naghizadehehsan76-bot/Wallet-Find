import prisma from "../../config/prisma.js";
import { isTurnkeyConfigured, provisionTurnkeyWallet } from "./turnkey.service.js";
const MICRO = 1_000_000n;
function formatMicro(value: bigint): string {
  const whole = value / MICRO;
  const fraction = (value % MICRO).toString().padStart(6, "0");
  return whole.toString() + "." + fraction;
}
function parseAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,12}(\.\d{1,6})?$/.test(value.trim())) throw new Error("INVALID_WALLET_AMOUNT");
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const amount = BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, "0") || "0");
  if (amount <= 0n) throw new Error("INVALID_WALLET_AMOUNT");
  return amount;
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
export async function requestWalletDeposit(): Promise<never> { throw new Error("REAL_DEPOSITS_NOT_CONFIGURED"); }
export async function requestWalletWithdrawal(): Promise<never> { throw new Error("REAL_WITHDRAWALS_NOT_CONFIGURED"); }

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
