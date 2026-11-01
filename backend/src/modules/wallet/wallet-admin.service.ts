import prisma from "../../config/prisma.js";
import { parseAssetUnits } from "./asset-amount.js";

type NetworkUpdate = {
  isEnabled?: boolean;
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  finalityDepth?: number;
};

type AssetUpdate = {
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  confirmationCount?: number;
  minDeposit?: string | null;
};

function requireReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length < 8 || reason.trim().length > 500) {
    throw new Error("WALLET_ADMIN_CHANGE_REASON_REQUIRED");
  }
  return reason.trim();
}

function requireBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new Error(code);
  return value;
}

function requireBoundedInteger(value: unknown, min: number, max: number, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(code);
  }
  return value;
}

export async function getWalletNetworkRegistryForAdmin() {
  const [networks, provisioning] = await Promise.all([
    prisma.walletNetwork.findMany({
      orderBy: [{ family: "asc" }, { networkKey: "asc" }],
      include: {
        assets: { orderBy: [{ symbol: "asc" }, { id: "asc" }] },
        scanCursor: true,
        _count: { select: { addresses: true, deposits: true, withdrawals: true } },
      },
    }),
    prisma.walletProvisioningIntent.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  return {
    networks: networks.map((network) => ({
      ...network,
      assets: network.assets.map((asset) => ({
        ...asset,
        minDepositAtomic: asset.minDepositAtomic?.toString() ?? null,
      })),
      scanner: network.scanCursor
        ? {
            cursorPosition: network.scanCursor.cursorPosition,
            cursorHash: network.scanCursor.cursorHash,
            leaseOwner: network.scanCursor.leaseOwner,
            leaseExpiresAt: network.scanCursor.leaseExpiresAt,
            heartbeatAt: network.scanCursor.heartbeatAt,
          }
        : null,
      counts: network._count,
    })),
    provisioning: provisioning.map((item) => ({
      status: item.status,
      count: item._count._all,
    })),
    generatedAt: new Date().toISOString(),
    activationGates: {
      depositsReady:
        process.env.WALLET_GENERIC_DEPOSIT_SCANNER_ENABLED === "true" &&
        process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY === "true",
      withdrawalsReady:
        process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED === "true" &&
        process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY === "true",
    },
  };
}

export async function updateWalletNetworkByAdmin(
  adminUserId: string,
  networkId: string,
  rawPatch: NetworkUpdate,
  rawReason: unknown,
) {
  const reason = requireReason(rawReason);
  if (!networkId || networkId.length > 128) throw new Error("INVALID_WALLET_NETWORK_ID");
  const patch: NetworkUpdate = {};

  if (Object.hasOwn(rawPatch, "isEnabled")) patch.isEnabled = requireBoolean(rawPatch.isEnabled, "INVALID_NETWORK_ENABLED_FLAG");
  if (Object.hasOwn(rawPatch, "depositEnabled")) patch.depositEnabled = requireBoolean(rawPatch.depositEnabled, "INVALID_NETWORK_DEPOSIT_FLAG");
  if (Object.hasOwn(rawPatch, "withdrawalEnabled")) patch.withdrawalEnabled = requireBoolean(rawPatch.withdrawalEnabled, "INVALID_NETWORK_WITHDRAWAL_FLAG");
  if (Object.hasOwn(rawPatch, "finalityDepth")) patch.finalityDepth = requireBoundedInteger(rawPatch.finalityDepth, 1, 1_000_000, "INVALID_NETWORK_FINALITY_DEPTH");

  if (Object.keys(patch).length === 0) throw new Error("EMPTY_WALLET_NETWORK_UPDATE");

  if (patch.depositEnabled === true &&
      (process.env.WALLET_GENERIC_DEPOSIT_SCANNER_ENABLED !== "true" ||
       process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY !== "true")) {
    throw new Error("GENERIC_DEPOSITS_NOT_PRODUCTION_READY");
  }
  if (patch.withdrawalEnabled === true &&
      (process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED !== "true" ||
       process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY !== "true")) {
    throw new Error("GENERIC_WITHDRAWALS_NOT_PRODUCTION_READY");
  }
  if (patch.isEnabled === false) {
    patch.depositEnabled = false;
    patch.withdrawalEnabled = false;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "wallet-network-admin:" + networkId,
    );
    const existing = await tx.walletNetwork.findUnique({ where: { id: networkId } });
    if (!existing) throw new Error("WALLET_NETWORK_NOT_FOUND");

    const next = {
      isEnabled: patch.isEnabled ?? existing.isEnabled,
      depositEnabled: patch.depositEnabled ?? existing.depositEnabled,
      withdrawalEnabled: patch.withdrawalEnabled ?? existing.withdrawalEnabled,
    };
    if ((next.depositEnabled || next.withdrawalEnabled) && !next.isEnabled) {
      throw new Error("WALLET_NETWORK_MUST_BE_ENABLED");
    }
    if (patch.depositEnabled === true && patch.isEnabled !== true && !existing.isEnabled) {
      throw new Error("WALLET_NETWORK_MUST_BE_ENABLED");
    }

    const updated = await tx.walletNetwork.update({
      where: { id: networkId },
      data: patch,
    });
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "WALLET_NETWORK_UPDATED",
        entity: "WalletNetwork",
        entityId: networkId,
        metadata: {
          reason,
          before: {
            isEnabled: existing.isEnabled,
            depositEnabled: existing.depositEnabled,
            withdrawalEnabled: existing.withdrawalEnabled,
            finalityDepth: existing.finalityDepth,
          },
          after: {
            isEnabled: updated.isEnabled,
            depositEnabled: updated.depositEnabled,
            withdrawalEnabled: updated.withdrawalEnabled,
            finalityDepth: updated.finalityDepth,
          },
        },
      },
    });
    return updated;
  }, { isolationLevel: "Serializable" });
}

export async function updateWalletAssetByAdmin(
  adminUserId: string,
  assetId: string,
  rawPatch: AssetUpdate,
  rawReason: unknown,
) {
  const reason = requireReason(rawReason);
  if (!assetId || assetId.length > 256) throw new Error("INVALID_WALLET_ASSET_ID");
  const patch: AssetUpdate = {};

  if (Object.hasOwn(rawPatch, "depositEnabled")) patch.depositEnabled = requireBoolean(rawPatch.depositEnabled, "INVALID_ASSET_DEPOSIT_FLAG");
  if (Object.hasOwn(rawPatch, "withdrawalEnabled")) patch.withdrawalEnabled = requireBoolean(rawPatch.withdrawalEnabled, "INVALID_ASSET_WITHDRAWAL_FLAG");
  if (Object.hasOwn(rawPatch, "confirmationCount")) patch.confirmationCount = requireBoundedInteger(rawPatch.confirmationCount, 1, 1_000_000, "INVALID_ASSET_CONFIRMATION_COUNT");
  if (Object.hasOwn(rawPatch, "minDeposit")) {
    if (rawPatch.minDeposit === null) {
      patch.minDeposit = null;
    } else if (typeof rawPatch.minDeposit === "string") {
      patch.minDeposit = rawPatch.minDeposit.trim();
      if (!patch.minDeposit || patch.minDeposit.length > 512) throw new Error("INVALID_ASSET_MINIMUM_DEPOSIT");
    } else {
      throw new Error("INVALID_ASSET_MINIMUM_DEPOSIT");
    }
  }
  if (Object.keys(patch).length === 0) throw new Error("EMPTY_WALLET_ASSET_UPDATE");

  if (patch.depositEnabled === true &&
      (process.env.WALLET_GENERIC_DEPOSIT_SCANNER_ENABLED !== "true" ||
       process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY !== "true")) {
    throw new Error("GENERIC_DEPOSITS_NOT_PRODUCTION_READY");
  }
  if (patch.withdrawalEnabled === true &&
      (process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED !== "true" ||
       process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY !== "true")) {
    throw new Error("GENERIC_WITHDRAWALS_NOT_PRODUCTION_READY");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "wallet-asset-admin:" + assetId,
    );
    const existing = await tx.walletAsset.findUnique({
      where: { id: assetId },
      include: { network: true },
    });
    if (!existing) throw new Error("WALLET_ASSET_NOT_FOUND");

    if (patch.depositEnabled === true) {
      if (existing.verificationStatus !== "VERIFIED") throw new Error("WALLET_ASSET_NOT_VERIFIED");
      if (!existing.network.isEnabled || !existing.network.depositEnabled) {
        throw new Error("WALLET_NETWORK_DEPOSITS_DISABLED");
      }
    }
    if (patch.withdrawalEnabled === true) {
      if (existing.verificationStatus !== "VERIFIED") throw new Error("WALLET_ASSET_NOT_VERIFIED");
      if (!existing.network.isEnabled || !existing.network.withdrawalEnabled) {
        throw new Error("WALLET_NETWORK_WITHDRAWALS_DISABLED");
      }
    }

    let minDepositAtomic: string | null | undefined;
    if (Object.hasOwn(patch, "minDeposit")) {
      minDepositAtomic = patch.minDeposit === null
        ? null
        : (() => {
          const amount = parseAssetUnits(patch.minDeposit as string, existing.decimals);
          if (amount.toString().length > 78) throw new Error("ASSET_MINIMUM_DEPOSIT_EXCEEDS_STORAGE_RANGE");
          return amount.toString();
        })();
    }
    const data: any = { ...patch };
    delete data.minDeposit;
    if (Object.hasOwn(patch, "minDeposit")) data.minDepositAtomic = minDepositAtomic;

    const updated = await tx.walletAsset.update({
      where: { id: assetId },
      data,
    });
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "WALLET_ASSET_UPDATED",
        entity: "WalletAsset",
        entityId: assetId,
        metadata: {
          reason,
          before: {
            depositEnabled: existing.depositEnabled,
            withdrawalEnabled: existing.withdrawalEnabled,
            confirmationCount: existing.confirmationCount,
            minDepositAtomic: existing.minDepositAtomic?.toString() ?? null,
            verificationStatus: existing.verificationStatus,
          },
          after: {
            depositEnabled: updated.depositEnabled,
            withdrawalEnabled: updated.withdrawalEnabled,
            confirmationCount: updated.confirmationCount,
            minDepositAtomic: updated.minDepositAtomic?.toString() ?? null,
            verificationStatus: updated.verificationStatus,
          },
        },
      },
    });
    return {
      ...updated,
      minDepositAtomic: updated.minDepositAtomic?.toString() ?? null,
    };
  }, { isolationLevel: "Serializable" });
}
