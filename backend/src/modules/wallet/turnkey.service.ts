import { Turnkey } from "@turnkey/sdk-server";
import { createAccount } from "@turnkey/viem";
import { createWalletClient, http, type WalletClient } from "viem";
import { bsc, polygon } from "viem/chains";
import prisma from "../../config/prisma.js";

const requiredEnv = [
  "TURNKEY_ORGANIZATION_ID",
  "TURNKEY_API_PUBLIC_KEY",
  "TURNKEY_API_PRIVATE_KEY",
] as const;

function turnkeyConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error("TURNKEY_NOT_CONFIGURED");

  const organizationId = process.env.TURNKEY_ORGANIZATION_ID!.trim();
  return {
    organizationId,
    client: new Turnkey({
      apiBaseUrl: process.env.TURNKEY_API_BASE_URL?.trim() || "https://api.turnkey.com",
      apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!.trim(),
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!.trim(),
      defaultOrganizationId: organizationId,
    }).apiClient(),
  };
}

export async function provisionTurnkeyWallet(userId: string) {
  const existing = await prisma.walletAccount.findUnique({
    where: { userId },
    include: { networkAccounts: true },
  });
  if (existing) return existing;

  const { client } = turnkeyConfig();
  const created = await client.createWallet({
    walletName: `wallet-find-user-${userId}`,
    accounts: [{
      curve: "CURVE_SECP256K1",
      pathFormat: "PATH_FORMAT_BIP32",
      path: "m/44'/60'/0'/0/0",
      addressFormat: "ADDRESS_FORMAT_ETHEREUM",
    }],
  });

  const address = created.addresses[0];
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("TURNKEY_WALLET_CREATION_FAILED");
  }

  return prisma.walletAccount.create({
    data: {
      userId,
      turnkeyWalletId: created.walletId,
      address: address.toLowerCase(),
      derivationPath: "m/44'/60'/0'/0/0",
      networkAccounts: {
        create: [
          { chainId: 56, networkKey: "bsc", depositEnabled: false, withdrawalEnabled: false },
          { chainId: 137, networkKey: "polygon", depositEnabled: false, withdrawalEnabled: false },
        ],
      },
    },
    include: { networkAccounts: true },
  });
}

export async function createTurnkeySigner(
  address: string,
  chainId: 56 | 137,
): Promise<WalletClient> {
  const { client, organizationId } = turnkeyConfig();
  const account = await createAccount({ client, organizationId, signWith: address });
  const chain = chainId === 56 ? bsc : polygon;
  const rpcUrl = chainId === 56 ? process.env.BSC_RPC_URL : process.env.POLYGON_RPC_URL;
  if (!rpcUrl?.trim()) throw new Error("CHAIN_RPC_NOT_CONFIGURED");

  return createWalletClient({ account, chain, transport: http(rpcUrl.trim()) });
}

export function isTurnkeyConfigured(): boolean {
  return requiredEnv.every((key) => Boolean(process.env[key]?.trim()));
}


/**
 * Creates the single Polygon prize treasury wallet once.
 * This operation creates an address only: it does not move funds or enable payouts.
 */
export async function provisionPrizeTreasuryWallet() {
  const key = "polygon-prize-treasury";
  const existing = await prisma.treasuryWallet.findUnique({ where: { id: key } });
  if (existing) {
    if (existing.status === "ACTIVE" && existing.address && existing.turnkeyWalletId) {
      return { walletId: existing.turnkeyWalletId, address: existing.address, chainId: 137, network: "Polygon PoS", status: existing.status, created: false };
    }
    throw new Error(existing.status === "CREATING" ? "TREASURY_CREATION_IN_PROGRESS" : "TREASURY_CREATION_REQUIRES_REVIEW");
  }

  await prisma.treasuryWallet.create({ data: { id: key, chainId: 137, networkKey: "polygon", status: "CREATING" } });
  try {
    const { client } = turnkeyConfig();
    const created = await client.createWallet({
      walletName: "Wallet-Find-Prize-Treasury",
      accounts: [{
        curve: "CURVE_SECP256K1",
        pathFormat: "PATH_FORMAT_BIP32",
        path: "m/44'/60'/0'/0/0",
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
      }],
    });
    const address = created.addresses[0];
    if (!created.walletId || !address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error("TURNKEY_WALLET_CREATION_FAILED");
    }
    const saved = await prisma.treasuryWallet.update({
      where: { id: key },
      data: { turnkeyWalletId: created.walletId, address: address.toLowerCase(), status: "ACTIVE" },
    });
    return { walletId: saved.turnkeyWalletId, address: saved.address, chainId: 137, network: "Polygon PoS", status: saved.status, created: true };
  } catch (error) {
    await prisma.treasuryWallet.update({ where: { id: key }, data: { status: "FAILED" } }).catch(() => undefined);
    throw error;
  }
}
