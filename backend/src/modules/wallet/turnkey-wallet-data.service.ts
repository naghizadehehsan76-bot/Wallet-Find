import { Turnkey } from "@turnkey/sdk-server";
import prisma from "../../config/prisma.js";
import { decryptApiPrivateKey } from "./turnkey.service.js";

const TURNKEY_NATIVE_DATA_NETWORKS = new Set([
  "eip155:1",
  "eip155:10",
  "eip155:56",
  "eip155:137",
  "eip155:42161",
]);

function normalizeNetworkId(value: unknown): string {
  if (typeof value !== "string" || !TURNKEY_NATIVE_DATA_NETWORKS.has(value.trim())) {
    throw new Error("TURNKEY_NATIVE_DATA_NETWORK_UNSUPPORTED");
  }
  return value.trim();
}

/**
 * Read-only wallet data from Turnkey. This deliberately does not alter the
 * accounting journal or credit deposits: finalized webhook reconciliation is
 * a separate stage and must be enabled before replacing the existing deposit
 * lifecycle.
 */
export async function getTurnkeyWalletAddressData(userId: string, rawNetworkId: unknown) {
  if (process.env.TURNKEY_NATIVE_DATA_API_ENABLED !== "true") {
    throw new Error("TURNKEY_NATIVE_DATA_API_DISABLED");
  }

  const networkId = normalizeNetworkId(rawNetworkId);
  const [wallet, network, address] = await Promise.all([
    prisma.walletAccount.findUnique({
      where: { userId },
      select: {
        id: true,
        status: true,
        turnkeyOrganizationId: true,
        turnkeyApiPublicKey: true,
        turnkeyApiPrivateKeyEncrypted: true,
      },
    }),
    prisma.walletNetwork.findUnique({
      where: { id: networkId },
      select: { id: true, isEnabled: true, displayName: true, family: true },
    }),
    prisma.walletAccount.findUnique({
      where: { userId },
      select: { address: true },
    }),
  ]);

  if (!wallet || wallet.status !== "ACTIVE" || !wallet.turnkeyOrganizationId ||
      !wallet.turnkeyApiPublicKey || !wallet.turnkeyApiPrivateKeyEncrypted) {
    throw new Error("TURNKEY_USER_ORGANIZATION_NOT_FOUND");
  }
  if (!network || network.family !== "EVM" || !network.isEnabled) {
    throw new Error("TURNKEY_NATIVE_DATA_NETWORK_DISABLED");
  }

  const walletAddress = await prisma.walletAddress.findUnique({
    where: {
      walletAccountId_networkId: {
        walletAccountId: wallet.id,
        networkId,
      },
    },
    select: { address: true, status: true },
  });
  const resolvedAddress = walletAddress?.status === "ACTIVE"
    ? walletAddress.address
    : address?.address;
  if (!resolvedAddress || !/^0x[a-fA-F0-9]{40}$/.test(resolvedAddress)) {
    throw new Error("WALLET_ADDRESS_NOT_READY");
  }

  const client = new Turnkey({
    apiBaseUrl: process.env.TURNKEY_API_BASE_URL?.trim() || "https://api.turnkey.com",
    apiPublicKey: wallet.turnkeyApiPublicKey,
    apiPrivateKey: decryptApiPrivateKey(wallet.turnkeyApiPrivateKeyEncrypted),
    defaultOrganizationId: wallet.turnkeyOrganizationId,
  }).apiClient();

  const caip2 = networkId as any;
  const [balanceResult, historyResult] = await Promise.all([
    client.getWalletAddressBalances({
      organizationId: wallet.turnkeyOrganizationId,
      address: resolvedAddress,
      caip2,
    }),
    client.listEthTransactionHistory({
      organizationId: wallet.turnkeyOrganizationId,
      address: resolvedAddress,
      caip2,
      paginationOptions: { limit: "50" },
    }),
  ]);

  return {
    provider: "turnkey" as const,
    networkId,
    network: network.displayName,
    address: resolvedAddress,
    balances: balanceResult.balances ?? [],
    transactions: historyResult.transactions ?? [],
    pageInfo: historyResult.pageInfo ?? null,
    fetchedAt: new Date().toISOString(),
  };
}
