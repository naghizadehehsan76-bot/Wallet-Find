import { Turnkey } from "@turnkey/sdk-server";
import { createAccount } from "@turnkey/viem";
import { createWalletClient, http, type Address } from "viem";
import { bsc, polygon } from "viem/chains";
import prisma from "../../config/prisma.js";

const requiredEnv = [
  "TURNKEY_ORGANIZATION_ID",
  "TURNKEY_API_PUBLIC_KEY",
  "TURNKEY_API_PRIVATE_KEY",
] as const;

function turnkeyConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error("TURNKEY_NOT_CONFIGURED");
  }
  return {
    organizationId: process.env.TURNKEY_ORGANIZATION_ID!.trim(),
    client: new Turnkey({
      apiBaseUrl: process.env.TURNKEY_API_BASE_URL?.trim() || "https://api.turnkey.com",
      apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!.trim(),
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!.trim(),
      defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!.trim(),
    }).apiClient(),
  };
}

/**
 * Creates one EVM wallet for a Wallet-Find user. Turnkey holds the private key;
 * only the public address and Turnkey identifiers are persisted in our database.
 * Deposit/withdrawal flags intentionally remain disabled until token contracts,
 * RPC endpoints, confirmations and gas funding have passed operational checks.
 */
export async function provisionTurnkeyWallet(userId: string) {
  const existing = await prisma.walletAccount.findUnique({
    where: { userId },
    include: { networkAccounts: true },
  });
  if (existing) return existing;

  const { client, organizationId } = turnkeyConfig();
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

  const account = await prisma.walletAccount.create({
    data: {
      userId,
      turnkeyWalletId: created.walletId,
      turnkeyAccountId: created.addresses[0],
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
  return account;
}

export async function createTurnkeySigner(address: string, chainId: 56 | 137) {
  const { client, organizationId } = turnkeyConfig();
  const account = await createAccount({
    client,
    organizationId,
    signWith: address,
  });
  const chain = chainId === 56 ? bsc : polygon;
  const rpcUrl = chainId === 56 ? process.env.BSC_RPC_URL : process.env.POLYGON_RPC_URL;
  if (!rpcUrl?.trim()) throw new Error("CHAIN_RPC_NOT_CONFIGURED");

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl.trim()),
  });
}

export function isTurnkeyConfigured(): boolean {
  return requiredEnv.every((key) => Boolean(process.env[key]?.trim()));
}
