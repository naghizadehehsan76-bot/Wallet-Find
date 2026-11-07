import prisma from "../../config/prisma.js";
import { parseAssetUnits } from "./asset-amount.js";
import { isEvmWithdrawalFeeModelSupported, isSupportedEvmChainId } from "./chain-adapters/evm.adapter.js";

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

async function isWalletGloballyPaused(tx: any): Promise<boolean> {
  const setting = await tx.systemSetting.findUnique({
    where: { key: "wallet_global_emergency_pause" },
    select: { value: true },
  });
  return setting?.value === "true";
}

function positiveIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

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
  const [networks, provisioning, pauseSetting] = await Promise.all([
    prisma.walletNetwork.findMany({
      where: { family: "EVM" },
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
    prisma.systemSetting.findUnique({
      where: { key: "wallet_global_emergency_pause" },
      select: { value: true, updatedAt: true },
    }),
  ]);

  return {
    globalEmergencyPause: {
      active: pauseSetting?.value === "true",
      updatedAt: pauseSetting?.updatedAt ?? null,
    },
    networks: networks.map((network) => ({
      ...network,
      adapterReady: network.family === "EVM" && network.chainId !== null && isSupportedEvmChainId(network.chainId),
      withdrawalAdapterReady: network.family === "EVM" && network.chainId !== null && isEvmWithdrawalFeeModelSupported(network.chainId),
      assets: network.assets.map((asset) => ({
        ...asset,
        minDepositAtomic: asset.minDepositAtomic?.toFixed(0) ?? null,
      })),
      scanner: network.scanCursor
        ? {
            cursorPosition: network.scanCursor.cursorPosition,
            cursorHash: network.scanCursor.cursorHash,
            leaseOwner: network.scanCursor.leaseOwner,
            leaseExpiresAt: network.scanCursor.leaseExpiresAt,
            heartbeatAt: network.scanCursor.heartbeatAt,
            lastSuccessfulScanAt: network.scanCursor.lastSuccessfulScanAt,
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
      "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
      "wallet-network-admin:" + networkId,
    );
    const existing = await tx.walletNetwork.findUnique({ where: { id: networkId }, include: { scanCursor: true } });
    if (!existing) throw new Error("WALLET_NETWORK_NOT_FOUND");
    // Bitcoin and Solana are retired product networks. Keep their registry rows for
    // referential integrity, but reject all admin mutations so they cannot be reactivated.
    if (existing.family !== "EVM") throw new Error("WALLET_NETWORK_RETIRED");
    const depositAdapterReady = existing.family === "EVM"
      && existing.chainId !== null && isSupportedEvmChainId(existing.chainId);
    const withdrawalAdapterReady = existing.family === "EVM"
      && existing.chainId !== null && isEvmWithdrawalFeeModelSupported(existing.chainId);
    if ((patch.isEnabled === true || patch.depositEnabled === true) && !depositAdapterReady) {
      throw new Error("WALLET_NETWORK_ADAPTER_NOT_IMPLEMENTED");
    }
    if (patch.withdrawalEnabled === true && !withdrawalAdapterReady) {
      throw new Error("WALLET_NETWORK_WITHDRAWAL_ADAPTER_NOT_IMPLEMENTED");
    }
    if (
      (patch.depositEnabled === true || patch.withdrawalEnabled === true) &&
      await isWalletGloballyPaused(tx)
    ) {
      throw new Error("WALLET_GLOBAL_EMERGENCY_PAUSE_ACTIVE");
    }

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

    if (patch.depositEnabled === true) {
      const heartbeatAt = existing.scanCursor?.lastSuccessfulScanAt;
      const maxHeartbeatAgeMs = positiveIntegerEnv("WALLET_GENERIC_SCAN_INTERVAL_MS", 30_000, 15_000, 300_000) * 3;
      if (!heartbeatAt || Date.now() - heartbeatAt.getTime() > maxHeartbeatAgeMs) {
        throw new Error("WALLET_NETWORK_SCANNER_NOT_READY");
      }
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
      "SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS advisory_lock",
      "wallet-asset-admin:" + assetId,
    );
    const existing = await tx.walletAsset.findUnique({
      where: { id: assetId },
      include: { network: { include: { scanCursor: true } } },
    });
    if (!existing) throw new Error("WALLET_ASSET_NOT_FOUND");
    // Assets attached to retired non-EVM networks are immutable compatibility records.
    if (existing.network.family !== "EVM") throw new Error("WALLET_NETWORK_RETIRED");
    const depositAdapterReady = existing.network.family === "EVM"
      && existing.network.chainId !== null && isSupportedEvmChainId(existing.network.chainId);
    const withdrawalAdapterReady = existing.network.family === "EVM"
      && existing.network.chainId !== null && isEvmWithdrawalFeeModelSupported(existing.network.chainId);
    if (patch.depositEnabled === true && !depositAdapterReady) {
      throw new Error("WALLET_NETWORK_ADAPTER_NOT_IMPLEMENTED");
    }
    if (patch.withdrawalEnabled === true && !withdrawalAdapterReady) {
      throw new Error("WALLET_NETWORK_WITHDRAWAL_ADAPTER_NOT_IMPLEMENTED");
    }
    if (
      (patch.depositEnabled === true || patch.withdrawalEnabled === true) &&
      await isWalletGloballyPaused(tx)
    ) {
      throw new Error("WALLET_GLOBAL_EMERGENCY_PAUSE_ACTIVE");
    }

    if (patch.depositEnabled === true) {
      if (existing.verificationStatus !== "VERIFIED") throw new Error("WALLET_ASSET_NOT_VERIFIED");
      if (!existing.network.isEnabled || !existing.network.depositEnabled) {
        throw new Error("WALLET_NETWORK_DEPOSITS_DISABLED");
      }
      const heartbeatAt = existing.network.scanCursor?.lastSuccessfulScanAt;
      const maxHeartbeatAgeMs = positiveIntegerEnv("WALLET_GENERIC_SCAN_INTERVAL_MS", 30_000, 15_000, 300_000) * 3;
      if (!heartbeatAt || Date.now() - heartbeatAt.getTime() > maxHeartbeatAgeMs) {
        throw new Error("WALLET_NETWORK_SCANNER_NOT_READY");
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
            minDepositAtomic: existing.minDepositAtomic?.toFixed(0) ?? null,
            verificationStatus: existing.verificationStatus,
          },
          after: {
            depositEnabled: updated.depositEnabled,
            withdrawalEnabled: updated.withdrawalEnabled,
            confirmationCount: updated.confirmationCount,
            minDepositAtomic: updated.minDepositAtomic?.toFixed(0) ?? null,
            verificationStatus: updated.verificationStatus,
          },
        },
      },
    });
    return {
      ...updated,
      minDepositAtomic: updated.minDepositAtomic?.toFixed(0) ?? null,
    };
  }, { isolationLevel: "Serializable" });
}



/**
 * Global break-glass pause. This is intentionally one-way: all network/asset
 * switches are turned off and must be explicitly reviewed before reactivation.
 * The generic scanner keeps running in cursor-only mode while networks remain
 * enabled, so transfers sent during the pause are not later credited.
 */
export async function emergencyPauseAllWalletOperations(
  adminUserId: string,
  rawReason: unknown,
) {
  const reason = requireReason(rawReason);
  return prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: "wallet_global_emergency_pause" },
      create: { key: "wallet_global_emergency_pause", value: "true" },
      update: { value: "true" },
    });

    const [networks, assets, legacyAssets, legacyAccounts] = await Promise.all([
      tx.walletNetwork.updateMany({
        where: {
          OR: [{ depositEnabled: true }, { withdrawalEnabled: true }],
        },
        data: { depositEnabled: false, withdrawalEnabled: false },
      }),
      tx.walletAsset.updateMany({
        where: {
          OR: [{ depositEnabled: true }, { withdrawalEnabled: true }],
        },
        data: { depositEnabled: false, withdrawalEnabled: false },
      }),
      tx.chainAsset.updateMany({
        where: {
          OR: [{ depositEnabled: true }, { withdrawalEnabled: true }],
        },
        data: { depositEnabled: false, withdrawalEnabled: false },
      }),
      tx.walletNetworkAccount.updateMany({
        where: {
          OR: [{ depositEnabled: true }, { withdrawalEnabled: true }],
        },
        data: { depositEnabled: false, withdrawalEnabled: false },
      }),
    ]);

    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "WALLET_GLOBAL_EMERGENCY_PAUSE",
        entity: "WalletNetwork",
        entityId: "GLOBAL",
        metadata: {
          reason,
          pausedAt: new Date().toISOString(),
          networksChanged: networks.count,
          assetsChanged: assets.count,
          legacyAssetsChanged: legacyAssets.count,
          legacyAccountsChanged: legacyAccounts.count,
          reactivationRequiresExplicitAdminReview: true,
        },
      },
    });

    return {
      paused: true,
      networksChanged: networks.count,
      assetsChanged: assets.count,
      legacyAssetsChanged: legacyAssets.count,
      legacyAccountsChanged: legacyAccounts.count,
      note: "All wallet deposit and withdrawal switches were disabled. Already broadcast transactions still require reconciliation.",
    };
  }, { isolationLevel: "Serializable" });
}


/**
 * Release only the global break-glass lock. All individual network and asset
 * switches stay off; operators must re-enable them individually after checks.
 */
export async function resumeWalletOperationsByAdmin(
  adminUserId: string,
  rawReason: unknown,
) {
  const reason = requireReason(rawReason);
  return prisma.$transaction(async (tx) => {
    const current = await tx.systemSetting.findUnique({
      where: { key: "wallet_global_emergency_pause" },
      select: { value: true },
    });
    if (current?.value !== "true") {
      throw new Error("WALLET_GLOBAL_EMERGENCY_PAUSE_NOT_ACTIVE");
    }

    await tx.systemSetting.update({
      where: { key: "wallet_global_emergency_pause" },
      data: { value: "false" },
    });
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "WALLET_GLOBAL_EMERGENCY_PAUSE_RELEASED",
        entity: "WalletNetwork",
        entityId: "GLOBAL",
        metadata: {
          reason,
          releasedAt: new Date().toISOString(),
          networkAndAssetSwitchesRemainDisabled: true,
          reactivationRequiresPerNetworkReview: true,
        },
      },
    });
    return {
      paused: false,
      networkAndAssetSwitchesRemainDisabled: true,
      note: "The global emergency lock is released, but every network and asset remains disabled until explicitly reviewed.",
    };
  }, { isolationLevel: "Serializable" });
}


/**
 * Read-only admin view of provisioned user wallets. Only public wallet metadata
 * and posted ledger balances are returned; Turnkey signing credentials are never selected.
 */
function formatWalletAtomic(value: bigint, decimals: number): string {
  const safeDecimals = Math.max(0, Math.min(36, decimals));
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(safeDecimals);
  const whole = absolute / base;
  const fraction = safeDecimals ? (absolute % base).toString().padStart(safeDecimals, "0").replace(/0+$/, "") : "";
  return (negative ? "-" : "") + whole.toString() + (fraction ? "." + fraction : "");
}

function walletBalanceByAsset(journals: Array<{
  networkId: string;
  walletAssetId: string;
  network: { displayName: string; networkKey: string; chainId: number | null };
  asset: { symbol: string; displayName: string; decimals: number };
  postings: Array<{ account: string; direction: string; amountAtomic: { toFixed(scale?: number): string } }>;
}>) {
  const balances = new Map<string, {
    networkId: string; network: string; networkKey: string; chainId: number | null;
    assetId: string; asset: string; assetName: string; decimals: number;
    availableAtomic: bigint; reservedAtomic: bigint;
  }>();
  for (const journal of journals) {
    const key = journal.networkId + ":" + journal.walletAssetId;
    const row = balances.get(key) ?? {
      networkId: journal.networkId,
      network: journal.network.displayName,
      networkKey: journal.network.networkKey,
      chainId: journal.network.chainId,
      assetId: journal.walletAssetId,
      asset: journal.asset.symbol,
      assetName: journal.asset.displayName,
      decimals: journal.asset.decimals,
      availableAtomic: 0n,
      reservedAtomic: 0n,
    };
    for (const posting of journal.postings) {
      if (posting.account !== "USER_AVAILABLE" && posting.account !== "USER_RESERVED") continue;
      const amount = BigInt(posting.amountAtomic.toFixed(0));
      const signed = posting.direction === "CREDIT" ? amount : -amount;
      if (posting.account === "USER_AVAILABLE") row.availableAtomic += signed;
      else row.reservedAtomic += signed;
    }
    balances.set(key, row);
  }
  return [...balances.values()].map((row) => ({
    networkId: row.networkId,
    network: row.network,
    networkKey: row.networkKey,
    chainId: row.chainId,
    assetId: row.assetId,
    asset: row.asset,
    assetName: row.assetName,
    decimals: row.decimals,
    available: formatWalletAtomic(row.availableAtomic, row.decimals),
    reserved: formatWalletAtomic(row.reservedAtomic, row.decimals),
    total: formatWalletAtomic(row.availableAtomic + row.reservedAtomic, row.decimals),
  }));
}

export async function getAdminWalletAccounts() {
  const accounts = await prisma.walletAccount.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userId: true,
      address: true,
      status: true,
      derivationPath: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, username: true, email: true } },
      walletAddresses: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, address: true, addressType: true, isPrimary: true, status: true, createdAt: true,
          network: { select: { id: true, displayName: true, networkKey: true, chainId: true, nativeAssetSymbol: true } },
        },
      },
      networkAccounts: {
        orderBy: { chainId: "asc" },
        select: {
          id: true, chainId: true, networkKey: true, depositEnabled: true, withdrawalEnabled: true,
          createdAt: true,
        },
      },
      _count: { select: { deposits: true, withdrawals: true, chainDeposits: true, chainWithdrawals: true } },
    },
  });
  if (accounts.length === 0) return [];

  const userIds = [...new Set(accounts.map((account) => account.userId))];
  const journals = await prisma.walletJournal.findMany({
    where: { userId: { in: userIds } },
    include: {
      network: { select: { displayName: true, networkKey: true, chainId: true } },
      asset: { select: { symbol: true, displayName: true, decimals: true } },
      postings: { select: { account: true, direction: true, amountAtomic: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const byUser = new Map<string, typeof journals>();
  for (const journal of journals) {
    const rows = byUser.get(journal.userId ?? "") ?? [];
    rows.push(journal);
    byUser.set(journal.userId ?? "", rows);
  }

  return accounts.map((account) => ({
    id: account.id,
    userId: account.userId,
    username: account.user.username,
    email: account.user.email,
    address: account.address,
    status: account.status,
    derivationPath: account.derivationPath,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    addresses: account.walletAddresses,
    networkAccounts: account.networkAccounts,
    counts: account._count,
    balances: walletBalanceByAsset(byUser.get(account.userId) ?? []),
  }));
}

/**
 * Detailed, read-only transaction history scoped to one wallet account and its owner.
 * Both the current generic wallet ledger and older wallet records are included.
 */
export async function getAdminWalletAccountTransactions(walletAccountId: string) {
  if (!walletAccountId || walletAccountId.length > 128) throw new Error("INVALID_WALLET_ACCOUNT_ID");
  const account = await prisma.walletAccount.findUnique({
    where: { id: walletAccountId },
    select: {
      id: true, userId: true, address: true, status: true, createdAt: true,
      user: { select: { id: true, username: true, email: true } },
      walletAddresses: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, address: true, addressType: true, isPrimary: true, status: true,
          network: { select: { id: true, displayName: true, networkKey: true, chainId: true } },
        },
      },
      networkAccounts: {
        orderBy: { chainId: "asc" },
        select: { id: true, chainId: true, networkKey: true, depositEnabled: true, withdrawalEnabled: true },
      },
    },
  });
  if (!account) throw new Error("WALLET_ACCOUNT_NOT_FOUND");

  const [chainDeposits, chainWithdrawals, legacyDeposits, legacyWithdrawals, journals, legacyTransactions] = await Promise.all([
    prisma.walletChainDeposit.findMany({
      where: { walletAccountId },
      include: {
        network: { select: { id: true, displayName: true, networkKey: true, chainId: true, explorerTransactionUrlTemplate: true } },
        asset: { select: { id: true, symbol: true, displayName: true, decimals: true } },
        walletAddress: { select: { address: true } },
      },
      orderBy: { detectedAt: "desc" },
    }),
    prisma.walletChainWithdrawal.findMany({
      where: { walletAccountId },
      include: {
        network: { select: { id: true, displayName: true, networkKey: true, chainId: true, explorerTransactionUrlTemplate: true } },
        asset: { select: { id: true, symbol: true, displayName: true, decimals: true } },
        feeAsset: { select: { symbol: true, decimals: true } },
        walletAddress: { select: { address: true } },
      },
      orderBy: { requestedAt: "desc" },
    }),
    prisma.walletDeposit.findMany({
      where: { walletAccountId },
      include: {
        asset: { select: { symbol: true, displayName: true, decimals: true } },
        networkAccount: { select: { networkKey: true, chainId: true } },
      },
      orderBy: { detectedAt: "desc" },
    }),
    prisma.walletWithdrawal.findMany({
      where: { walletAccountId },
      include: {
        asset: { select: { symbol: true, displayName: true, decimals: true } },
        networkAccount: { select: { networkKey: true, chainId: true } },
      },
      orderBy: { requestedAt: "desc" },
    }),
    prisma.walletJournal.findMany({
      where: { userId: account.userId },
      include: {
        network: { select: { displayName: true, networkKey: true, chainId: true } },
        asset: { select: { symbol: true, displayName: true, decimals: true } },
        postings: { select: { account: true, direction: true, amountAtomic: true, accountReference: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.walletTransaction.findMany({
      where: { userId: account.userId },
      select: { id: true, type: true, status: true, amountMicro: true, currency: true, note: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const balances = walletBalanceByAsset(journals);
  const transactions = [
    ...chainDeposits.map((row) => ({
      id: "chain-deposit:" + row.id, source: "ONCHAIN_DEPOSIT", type: "DEPOSIT", status: row.status,
      network: row.network.displayName, networkKey: row.network.networkKey, chainId: row.network.chainId,
      asset: row.asset.symbol, amount: formatWalletAtomic(BigInt(row.amountAtomic.toFixed(0)), row.asset.decimals),
      fee: null, transactionHash: row.transactionReference, fromAddress: row.fromAddress,
      toAddress: row.toAddress, destinationAddress: null, confirmations: row.confirmationCount,
      position: row.position, note: row.reviewReason, createdAt: row.detectedAt, confirmedAt: row.confirmedAt,
      explorerUrl: row.network.explorerTransactionUrlTemplate?.replace("{hash}", row.transactionReference) ?? null,
    })),
    ...chainWithdrawals.map((row) => ({
      id: "chain-withdrawal:" + row.id, source: "ONCHAIN_WITHDRAWAL", type: "WITHDRAWAL", status: row.status,
      network: row.network.displayName, networkKey: row.network.networkKey, chainId: row.network.chainId,
      asset: row.asset.symbol, amount: formatWalletAtomic(BigInt(row.amountAtomic.toFixed(0)), row.asset.decimals),
      fee: row.feeAtomic === null ? null : formatWalletAtomic(BigInt(row.feeAtomic.toFixed(0)), row.feeAsset?.decimals ?? row.asset.decimals) + " " + (row.feeAsset?.symbol ?? row.asset.symbol),
      transactionHash: row.transactionReference, fromAddress: row.walletAddress.address,
      toAddress: row.destinationAddress, destinationAddress: row.destinationAddress, confirmations: row.confirmationCount,
      position: row.blockPosition, note: row.failureCode ?? row.reviewReason, createdAt: row.requestedAt, confirmedAt: row.confirmedAt,
      explorerUrl: row.transactionReference ? row.network.explorerTransactionUrlTemplate?.replace("{hash}", row.transactionReference) ?? null : null,
    })),
    ...legacyDeposits.map((row) => ({
      id: "legacy-deposit:" + row.id, source: "LEGACY_ONCHAIN_DEPOSIT", type: "DEPOSIT", status: row.status,
      network: row.networkAccount.networkKey, networkKey: row.networkAccount.networkKey, chainId: row.chainId,
      asset: row.asset.symbol, amount: row.amountMicro === null ? row.rawAmount : formatWalletAtomic(BigInt(row.amountMicro), row.asset.decimals),
      fee: null, transactionHash: row.transactionHash, fromAddress: row.fromAddress, toAddress: row.toAddress,
      destinationAddress: null, confirmations: row.confirmationCount, position: row.blockNumber.toString(),
      note: null, createdAt: row.detectedAt, confirmedAt: row.confirmedAt, explorerUrl: null,
    })),
    ...legacyWithdrawals.map((row) => ({
      id: "legacy-withdrawal:" + row.id, source: "LEGACY_ONCHAIN_WITHDRAWAL", type: "WITHDRAWAL", status: row.status,
      network: row.networkAccount.networkKey, networkKey: row.networkAccount.networkKey, chainId: row.chainId,
      asset: row.asset.symbol, amount: formatWalletAtomic(BigInt(row.amountMicro), row.asset.decimals),
      fee: formatWalletAtomic(BigInt(row.feeMicro), row.asset.decimals) + " " + row.asset.symbol,
      transactionHash: row.transactionHash, fromAddress: null, toAddress: row.destinationAddress,
      destinationAddress: row.destinationAddress, confirmations: null, position: null,
      note: row.failureCode, createdAt: row.requestedAt, confirmedAt: row.confirmedAt, explorerUrl: null,
    })),
    ...legacyTransactions.map((row) => ({
      id: "legacy-ledger:" + row.id, source: "INTERNAL_LEDGER", type: row.type, status: row.status,
      network: null, networkKey: null, chainId: null, asset: row.currency,
      amount: formatWalletAtomic(BigInt(row.amountMicro), 6), fee: null, transactionHash: null,
      fromAddress: null, toAddress: null, destinationAddress: null, confirmations: null, position: null,
      note: row.note, createdAt: row.createdAt, confirmedAt: null, explorerUrl: null,
    })),
    ...journals.map((row) => ({
      id: "journal:" + row.id, source: "WALLET_JOURNAL", type: row.entryType, status: "POSTED",
      network: row.network.displayName, networkKey: row.network.networkKey, chainId: row.network.chainId,
      asset: row.asset.symbol,
      amount: (() => {
        const available = row.postings.filter((posting) => posting.account === "USER_AVAILABLE");
        if (available.length === 0) return "—";
        const amount = available.reduce((sum, posting) => sum + (posting.direction === "CREDIT" ? 1n : -1n) * BigInt(posting.amountAtomic.toFixed(0)), 0n);
        return formatWalletAtomic(amount, row.asset.decimals);
      })(),
      fee: null, transactionHash: null, fromAddress: null, toAddress: null, destinationAddress: null,
      confirmations: null, position: null,
      note: row.note + " · " + row.postings.map((posting) => posting.account + " " + posting.direction + " " + posting.amountAtomic.toFixed(0)).join("; "),
      createdAt: row.createdAt, confirmedAt: null, explorerUrl: null,
    })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return {
    wallet: {
      id: account.id, userId: account.userId, username: account.user.username, email: account.user.email,
      address: account.address, status: account.status, createdAt: account.createdAt,
      addresses: account.walletAddresses, networkAccounts: account.networkAccounts,
    },
    balances,
    transactionCount: transactions.length,
    transactions,
    generatedAt: new Date().toISOString(),
  };
}
