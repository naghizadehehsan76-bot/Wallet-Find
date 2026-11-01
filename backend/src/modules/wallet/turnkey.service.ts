import { createCipheriv, createDecipheriv, createECDH, randomBytes, randomUUID } from "node:crypto";
import { Turnkey } from "@turnkey/sdk-server";
import { createAccount } from "@turnkey/viem";
import { createWalletClient, http, type WalletClient } from "viem";
import { arbitrum, bsc, mainnet, optimism, polygon } from "viem/chains";
import prisma from "../../config/prisma.js";

const requiredEnv = [
  "TURNKEY_ORGANIZATION_ID",
  "TURNKEY_API_PUBLIC_KEY",
  "TURNKEY_API_PRIVATE_KEY",
] as const;
const WALLET_PATH = "m/44'/60'/0'/0/0";

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

function encryptionKey(): Buffer {
  const value = process.env.TURNKEY_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("TURNKEY_ENCRYPTION_KEY_NOT_CONFIGURED");
  return Buffer.from(value, "hex");
}

function encryptApiPrivateKey(privateKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(".");
}

function decryptApiPrivateKey(payload: string): string {
  const [ivHex, tagHex, encryptedHex] = payload.split(".");
  if (!ivHex || !tagHex || !encryptedHex) throw new Error("TURNKEY_CREDENTIAL_DECRYPTION_FAILED");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("TURNKEY_CREDENTIAL_DECRYPTION_FAILED");
  }
}

function turnkeyEvmChain(chainId: number) {
  switch (chainId) {
    case 1: return { chain: mainnet, rpcEnv: "ETHEREUM_RPC_URL" };
    case 10: return { chain: optimism, rpcEnv: "OPTIMISM_RPC_URL" };
    case 56: return { chain: bsc, rpcEnv: "BSC_RPC_URL" };
    case 137: return { chain: polygon, rpcEnv: "POLYGON_RPC_URL" };
    case 42161: return { chain: arbitrum, rpcEnv: "ARBITRUM_RPC_URL" };
    default: throw new Error("TURNKEY_EVM_CHAIN_NOT_SUPPORTED");
  }
}

function generateSubOrganizationApiKey() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey("hex"),
    publicKey: ecdh.getPublicKey("hex", "compressed"),
  };
}

async function registerWalletEvmNetworks(
  tx: any,
  walletAccountId: string,
  address: string,
) {
  const networks = [
    { chainId: 1, networkKey: "ethereum", networkId: "eip155:1" },
    { chainId: 10, networkKey: "optimism", networkId: "eip155:10" },
    { chainId: 56, networkKey: "bsc", networkId: "eip155:56" },
    { chainId: 137, networkKey: "polygon", networkId: "eip155:137" },
    { chainId: 42161, networkKey: "arbitrum", networkId: "eip155:42161" },
  ] as const;

  for (const item of networks) {
    const registry = await tx.walletNetwork.findUnique({
      where: { id: item.networkId },
      select: { id: true, family: true },
    });
    if (!registry || registry.family !== "EVM") {
      throw new Error("WALLET_NETWORK_REGISTRY_NOT_INITIALIZED");
    }

    await tx.walletNetworkAccount.upsert({
      where: {
        walletAccountId_chainId: {
          walletAccountId,
          chainId: item.chainId,
        },
      },
      create: {
        walletAccountId,
        chainId: item.chainId,
        networkKey: item.networkKey,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      update: {},
    });

    await tx.walletAddress.upsert({
      where: {
        walletAccountId_networkId: {
          walletAccountId,
          networkId: item.networkId,
        },
      },
      create: {
        walletAccountId,
        networkId: item.networkId,
        address: address.toLowerCase(),
        addressType: "EVM",
        curve: "SECP256K1",
        derivationPath: WALLET_PATH,
        isPrimary: true,
        status: "ACTIVE",
      },
      update: {
        address: address.toLowerCase(),
        addressType: "EVM",
        curve: "SECP256K1",
        derivationPath: WALLET_PATH,
        isPrimary: true,
        status: "ACTIVE",
      },
    });
  }
}

/**
 * Creates one custodial Turnkey Sub-Organization for a verified user.
 *
 * The durable intent and encrypted per-user API credential are committed
 * before the remote Turnkey request. No database transaction is held open
 * while calling Turnkey. Any uncertain remote outcome is quarantined for
 * reconciliation rather than blindly creating a second organization.
 */
export async function provisionTurnkeyWallet(userId: string) {
  if (!isTurnkeyConfigured()) throw new Error("TURNKEY_NOT_CONFIGURED");

  const preparation = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
      "wallet-provision:" + userId,
    );

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, emailVerifiedAt: true },
    });
    if (!user) throw new Error("USER_NOT_FOUND");
    if (!user.emailVerifiedAt) throw new Error("EMAIL_NOT_VERIFIED");

    const existing = await tx.walletAccount.findUnique({
      where: { userId },
      include: { networkAccounts: true },
    });
    if (existing?.turnkeyOrganizationId && existing.turnkeyWalletId) {
      await registerWalletEvmNetworks(tx, existing.id, existing.address);
      return { kind: "READY" as const, walletAccountId: existing.id };
    }
    if (existing?.turnkeyOrganizationId || existing?.turnkeyWalletId) {
      throw new Error("TURNKEY_WALLET_RECORD_REQUIRES_REVIEW");
    }

    const registries = await tx.walletNetwork.findMany({
      where: { id: { in: ["eip155:1", "eip155:10", "eip155:56", "eip155:137", "eip155:42161"] }, family: "EVM" },
      select: { id: true },
    });
    if (registries.length !== 5) throw new Error("WALLET_NETWORK_REGISTRY_NOT_INITIALIZED");

    const priorIntent = await tx.walletProvisioningIntent.findUnique({
      where: { userId },
    });
    if (priorIntent) {
      if (priorIntent.status === "COMPLETED") {
        throw new Error("TURNKEY_PROVISIONING_RECORD_INCONSISTENT");
      }
      if (priorIntent.status === "CREATING") {
        const staleBefore = Date.now() - 5 * 60_000;
        if (priorIntent.updatedAt.getTime() < staleBefore) {
          await tx.walletProvisioningIntent.update({
            where: { id: priorIntent.id },
            data: {
              status: "REQUIRES_REVIEW",
              failureCode: "STALE_TURNKEY_REMOTE_OUTCOME_REQUIRES_RECONCILIATION",
            },
          });
          return { kind: "REVIEW" as const };
        }
        throw new Error("TURNKEY_PROVISIONING_IN_PROGRESS");
      }
      throw new Error("TURNKEY_PROVISIONING_REQUIRES_REVIEW");
    }

    const apiKey = generateSubOrganizationApiKey();
    const intent = await tx.walletProvisioningIntent.create({
      data: {
        userId,
        idempotencyKey: randomUUID(),
        status: "CREATING",
        turnkeyApiPublicKey: apiKey.publicKey,
        turnkeyApiPrivateKeyEncrypted: encryptApiPrivateKey(apiKey.privateKey),
      },
    });
    return {
      kind: "CREATE" as const,
      user,
      intentId: intent.id,
      apiPublicKey: intent.turnkeyApiPublicKey,
    };
  }, { isolationLevel: "Serializable" });

  if (preparation.kind === "READY") {
    return prisma.walletAccount.findUniqueOrThrow({
      where: { id: preparation.walletAccountId },
      include: { networkAccounts: true },
    });
  }
  if (preparation.kind === "REVIEW") {
    throw new Error("TURNKEY_PROVISIONING_REQUIRES_REVIEW");
  }

  const { client: parentClient } = turnkeyConfig();
  let created: Awaited<ReturnType<typeof parentClient.createSubOrganization>>;

  try {
    created = await parentClient.createSubOrganization({
      subOrganizationName: "Wallet-Find user " + preparation.user.id + " " + preparation.intentId,
      rootUsers: [{
        userName: preparation.user.username,
        userEmail: preparation.user.email,
        apiKeys: [{
          apiKeyName: "Wallet-Find custodial service",
          publicKey: preparation.apiPublicKey,
          curveType: "API_KEY_CURVE_P256",
        }],
        authenticators: [],
        oauthProviders: [],
      }],
      rootQuorumThreshold: 1,
      wallet: {
        walletName: "Wallet-Find user wallet " + preparation.user.id,
        accounts: [{
          curve: "CURVE_SECP256K1",
          pathFormat: "PATH_FORMAT_BIP32",
          path: WALLET_PATH,
          addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        }],
      },
      disableEmailRecovery: true,
      disableEmailAuth: true,
      disableSmsAuth: true,
      disableOtpEmailAuth: true,
    });
  } catch {
    await prisma.walletProvisioningIntent.updateMany({
      where: { id: preparation.intentId, status: "CREATING" },
      data: {
        status: "REQUIRES_REVIEW",
        failureCode: "TURNKEY_REMOTE_RESULT_UNCERTAIN",
      },
    }).catch(() => undefined);
    throw new Error("TURNKEY_PROVISIONING_REQUIRES_REVIEW");
  }

  const organizationId = created.subOrganizationId;
  const walletId = created.wallet?.walletId;
  const address = created.wallet?.addresses?.[0];

  if (!organizationId || !walletId || !address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    await prisma.walletProvisioningIntent.update({
      where: { id: preparation.intentId },
      data: {
        status: "REQUIRES_REVIEW",
        turnkeyOrganizationId: organizationId ?? null,
        turnkeyWalletId: walletId ?? null,
        address: address && /^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() : null,
        failureCode: "TURNKEY_REMOTE_RESPONSE_INCOMPLETE",
      },
    }).catch(() => undefined);
    throw new Error("TURNKEY_PROVISIONING_REQUIRES_REVIEW");
  }

  try {
    const walletAccountId = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
        "wallet-provision:" + userId,
      );

      const intent = await tx.walletProvisioningIntent.findUnique({
        where: { id: preparation.intentId },
      });
      if (!intent || intent.status !== "CREATING") {
        throw new Error("TURNKEY_PROVISIONING_STATE_CHANGED");
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { emailVerifiedAt: true },
      });
      if (!user?.emailVerifiedAt) throw new Error("EMAIL_NOT_VERIFIED");

      const existing = await tx.walletAccount.findUnique({ where: { userId } });
      if (existing?.turnkeyOrganizationId || existing?.turnkeyWalletId) {
        throw new Error("TURNKEY_WALLET_RECORD_REQUIRES_REVIEW");
      }

      const wallet = existing
        ? await tx.walletAccount.update({
            where: { userId },
            data: {
              turnkeyOrganizationId: organizationId,
              turnkeyWalletId: walletId,
              turnkeyApiPublicKey: intent.turnkeyApiPublicKey,
              turnkeyApiPrivateKeyEncrypted: intent.turnkeyApiPrivateKeyEncrypted,
              legacyTurnkeyWalletId: existing.legacyTurnkeyWalletId ?? existing.turnkeyWalletId,
              legacyAddress: existing.legacyAddress ?? existing.address,
              address: address.toLowerCase(),
              derivationPath: WALLET_PATH,
              status: "ACTIVE",
            },
          })
        : await tx.walletAccount.create({
            data: {
              userId,
              turnkeyOrganizationId: organizationId,
              turnkeyWalletId: walletId,
              turnkeyApiPublicKey: intent.turnkeyApiPublicKey,
              turnkeyApiPrivateKeyEncrypted: intent.turnkeyApiPrivateKeyEncrypted,
              address: address.toLowerCase(),
              derivationPath: WALLET_PATH,
              status: "ACTIVE",
            },
          });

      await registerWalletEvmNetworks(tx, wallet.id, address);
      await tx.walletProvisioningIntent.update({
        where: { id: intent.id },
        data: {
          status: "COMPLETED",
          turnkeyOrganizationId: organizationId,
          turnkeyWalletId: walletId,
          address: address.toLowerCase(),
          failureCode: null,
          completedAt: new Date(),
        },
      });
      return wallet.id;
    }, { isolationLevel: "Serializable" });

    return prisma.walletAccount.findUniqueOrThrow({
      where: { id: walletAccountId },
      include: { networkAccounts: true },
    });
  } catch {
    await prisma.walletProvisioningIntent.updateMany({
      where: { id: preparation.intentId, status: "CREATING" },
      data: {
        status: "REQUIRES_REVIEW",
        turnkeyOrganizationId: organizationId,
        turnkeyWalletId: walletId,
        address: address.toLowerCase(),
        failureCode: "LOCAL_PERSISTENCE_AFTER_REMOTE_SUCCESS_FAILED",
      },
    }).catch(() => undefined);
    throw new Error("TURNKEY_PROVISIONING_REQUIRES_REVIEW");
  }
}

/** Builds a signer using the API credential stored for this user's own sub-org. */
export async function createTurnkeySigner(
  address: string,
  chainId: number,
): Promise<WalletClient> {
  const wallet = await prisma.walletAccount.findFirst({
    where: { address: address.toLowerCase() },
    select: {
      turnkeyOrganizationId: true,
      turnkeyApiPublicKey: true,
      turnkeyApiPrivateKeyEncrypted: true,
    },
  });
  if (!wallet?.turnkeyOrganizationId || !wallet.turnkeyApiPublicKey || !wallet.turnkeyApiPrivateKeyEncrypted) {
    throw new Error("TURNKEY_USER_ORGANIZATION_NOT_FOUND");
  }

  const client = new Turnkey({
    apiBaseUrl: process.env.TURNKEY_API_BASE_URL?.trim() || "https://api.turnkey.com",
    apiPublicKey: wallet.turnkeyApiPublicKey,
    apiPrivateKey: decryptApiPrivateKey(wallet.turnkeyApiPrivateKeyEncrypted),
    defaultOrganizationId: wallet.turnkeyOrganizationId,
  }).apiClient();
  const account = await createAccount({
    client,
    organizationId: wallet.turnkeyOrganizationId,
    signWith: address,
  });
  const chainConfig = turnkeyEvmChain(chainId);
  const rpcUrl = process.env[chainConfig.rpcEnv];
  if (!rpcUrl?.trim()) throw new Error("CHAIN_RPC_NOT_CONFIGURED");

  return createWalletClient({ account, chain: chainConfig.chain, transport: http(rpcUrl.trim()) });
}

/** Parent-org signer is intentionally separate and reserved for parent-owned treasury wallets. */
export async function createParentTurnkeySigner(
  address: string,
  chainId: 56 | 137,
): Promise<WalletClient> {
  const { client, organizationId } = turnkeyConfig();
  const account = await createAccount({ client, organizationId, signWith: address });
  const chainConfig = turnkeyEvmChain(chainId);
  const rpcUrl = process.env[chainConfig.rpcEnv];
  if (!rpcUrl?.trim()) throw new Error("CHAIN_RPC_NOT_CONFIGURED");
  return createWalletClient({ account, chain: chainConfig.chain, transport: http(rpcUrl.trim()) });
}

export function isTurnkeyConfigured(): boolean {
  return requiredEnv.every((key) => Boolean(process.env[key]?.trim()))
    && /^[a-fA-F0-9]{64}$/.test(process.env.TURNKEY_ENCRYPTION_KEY?.trim() ?? "");
}

/**
 * Creates the single Polygon prize treasury wallet once.
 * This operation creates an address only: it does not move funds or enable payouts.
 */
export async function getPrizeTreasuryWallet() {
  const existing = await prisma.treasuryWallet.findUnique({ where: { id: "polygon-prize-treasury" } });
  if (!existing) return null;
  return {
    created: false,
    walletId: existing.turnkeyWalletId ?? "",
    address: existing.address ?? "",
    chainId: existing.chainId,
    networkKey: existing.networkKey,
    status: existing.status,
  };
}

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
        path: WALLET_PATH,
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
