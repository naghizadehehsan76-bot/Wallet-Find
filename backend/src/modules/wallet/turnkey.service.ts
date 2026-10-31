import { createCipheriv, createDecipheriv, createECDH, randomBytes } from "node:crypto";
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

function generateSubOrganizationApiKey() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey("hex"),
    publicKey: ecdh.getPublicKey("hex", "compressed"),
  };
}

/**
 * Creates one custodial Turnkey sub-organization and its Polygon-compatible EVM
 * wallet for a verified Wallet-Find user. The per-user API private key is
 * encrypted at rest and is never returned by an application endpoint.
 */
export async function provisionTurnkeyWallet(userId: string) {
  if (!isTurnkeyConfigured()) throw new Error("TURNKEY_NOT_CONFIGURED");

  // A transaction-scoped advisory lock prevents concurrent wallet-page requests
  // from provisioning more than one sub-organization for the same user.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`wallet-provision:${userId}`}))) AS advisory_lock`;

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
    if (existing?.turnkeyOrganizationId && existing.turnkeyWalletId) return existing;

    const { client: parentClient } = turnkeyConfig();
    const apiKey = generateSubOrganizationApiKey();
    const created = await parentClient.createSubOrganization({
      subOrganizationName: `Wallet-Find user ${user.id}`,
      rootUsers: [{
        userName: user.username,
        userEmail: user.email,
        apiKeys: [{
          apiKeyName: "Wallet-Find custodial service",
          publicKey: apiKey.publicKey,
          curveType: "API_KEY_CURVE_P256",
        }],
        authenticators: [],
        oauthProviders: [],
      }],
      rootQuorumThreshold: 1,
      wallet: {
        walletName: `Wallet-Find Polygon wallet ${user.id}`,
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

    const organizationId = created.subOrganizationId;
    const walletId = created.wallet?.walletId;
    const address = created.wallet?.addresses?.[0];
    if (!organizationId || !walletId || !address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      // The remote activity may have completed. Do not retry blindly: that could
      // create duplicate organizations. The failed provisioning requires review.
      throw new Error("TURNKEY_SUB_ORGANIZATION_CREATION_REQUIRES_REVIEW");
    }

    const wallet = existing
      ? await tx.walletAccount.update({
          where: { userId },
          data: {
            turnkeyOrganizationId: organizationId,
            turnkeyWalletId: walletId,
            turnkeyApiPublicKey: apiKey.publicKey,
            turnkeyApiPrivateKeyEncrypted: encryptApiPrivateKey(apiKey.privateKey),
            legacyTurnkeyWalletId: existing.legacyTurnkeyWalletId ?? existing.turnkeyWalletId,
            legacyAddress: existing.legacyAddress ?? existing.address,
            address: address.toLowerCase(),
            derivationPath: WALLET_PATH,
            status: "ACTIVE",
          },
          include: { networkAccounts: true },
        })
      : await tx.walletAccount.create({
          data: {
            userId,
            turnkeyOrganizationId: organizationId,
            turnkeyWalletId: walletId,
            turnkeyApiPublicKey: apiKey.publicKey,
            turnkeyApiPrivateKeyEncrypted: encryptApiPrivateKey(apiKey.privateKey),
            address: address.toLowerCase(),
            derivationPath: WALLET_PATH,
            status: "ACTIVE",
          },
          include: { networkAccounts: true },
        });

    for (const network of [
      { chainId: 56, networkKey: "bsc" },
      { chainId: 137, networkKey: "polygon" },
    ]) {
      await tx.walletNetworkAccount.upsert({
        where: { walletAccountId_chainId: { walletAccountId: wallet.id, chainId: network.chainId } },
        create: { walletAccountId: wallet.id, ...network, depositEnabled: false, withdrawalEnabled: false },
        update: {},
      });
    }

    return tx.walletAccount.findUniqueOrThrow({
      where: { id: wallet.id },
      include: { networkAccounts: true },
    });
  }, { timeout: 120_000, maxWait: 15_000 });
}

/** Builds a signer using the API credential stored for this user's own sub-org. */
export async function createTurnkeySigner(
  address: string,
  chainId: 56 | 137,
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
  const chain = chainId === 56 ? bsc : polygon;
  const rpcUrl = chainId === 56 ? process.env.BSC_RPC_URL : process.env.POLYGON_RPC_URL;
  if (!rpcUrl?.trim()) throw new Error("CHAIN_RPC_NOT_CONFIGURED");

  return createWalletClient({ account, chain, transport: http(rpcUrl.trim()) });
}

/** Parent-org signer is intentionally separate and reserved for parent-owned treasury wallets. */
export async function createParentTurnkeySigner(
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
