import { createPublicClient, http, isAddress, parseAbiItem, type Address } from "viem";
import prisma from "../../config/prisma.js";
import { EVM_NETWORKS, getEnabledEvmNetworks, type EvmNetworkConfig } from "./evm-network.registry.js";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const eligibleStatuses = ["CONFIRMING", "CONFIRMED", "CREDITED"] as const;

function positiveInteger(value: string | undefined, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function createClient(network: EvmNetworkConfig) {
  const rpcUrl = process.env[network.rpcEnv]?.trim();
  if (!rpcUrl) throw new Error(network.rpcEnv + "_NOT_CONFIGURED");
  return createPublicClient({
    chain: network.chain,
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }),
  });
}

function confirmationsFor(network: EvmNetworkConfig): number {
  return positiveInteger(process.env[network.confirmationsEnv], network.defaultConfirmations, 1, 100_000);
}

function formatAddress(value: string): string {
  return value.toLowerCase();
}

function isNativeAsset(asset: { contractAddress: string }): boolean {
  return asset.contractAddress.trim().toLowerCase() === "native";
}

function assetIsScannable(asset: { contractAddress: string; decimals: number }): boolean {
  return Number.isInteger(asset.decimals)
    && asset.decimals >= 0
    && asset.decimals <= 36
    && (isNativeAsset(asset) || isAddress(asset.contractAddress));
}

type DepositDestination = {
  id: string;
  address: string;
  kind: "wallet" | "treasury";
  walletNetworkAccountId?: string;
  walletAccountId?: string;
  userId?: string;
};

async function recordDeposit(
  network: EvmNetworkConfig,
  asset: { id: string },
  destination: DepositDestination,
  transfer: {
    transactionHash: string;
    logIndex: number;
    blockNumber: bigint;
    blockHash: string;
    fromAddress: string;
    toAddress: string;
    amount: bigint;
  },
  latestBlock: bigint,
) {
  if (transfer.amount <= 0n) return false;
  const confirmationCount = Number(latestBlock - transfer.blockNumber + 1n);
  const common = {
    chainAssetId: asset.id,
    chainId: network.chainId,
    transactionHash: transfer.transactionHash,
    logIndex: transfer.logIndex,
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    fromAddress: formatAddress(transfer.fromAddress),
    toAddress: formatAddress(transfer.toAddress),
    rawAmount: transfer.amount.toString(),
    amountMicro: transfer.amount,
    status: "CONFIRMING" as const,
    confirmationCount,
  };

  if (destination.kind === "wallet") {
    const inserted = await prisma.walletDeposit.createMany({
      data: [{
        ...common,
        userId: destination.userId!,
        walletAccountId: destination.walletAccountId!,
        walletNetworkAccountId: destination.walletNetworkAccountId!,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return true;
    const existing = await prisma.walletDeposit.findUnique({
      where: { chainId_transactionHash_logIndex: { chainId: network.chainId, transactionHash: transfer.transactionHash, logIndex: transfer.logIndex } },
      select: { id: true, status: true },
    });
    if (existing && (existing.status === "CONFIRMING" || existing.status === "CONFIRMED")) {
      await prisma.walletDeposit.updateMany({
        where: { id: existing.id, status: { in: ["CONFIRMING", "CONFIRMED"] } },
        data: { confirmationCount, blockHash: transfer.blockHash },
      });
    }
    return false;
  }

  const inserted = await prisma.treasuryDeposit.createMany({
    data: [{
      ...common,
      treasuryWalletId: destination.id,
    }],
    skipDuplicates: true,
  });
  if (inserted.count === 1) return true;
  const existing = await prisma.treasuryDeposit.findUnique({
    where: { chainId_transactionHash_logIndex: { chainId: network.chainId, transactionHash: transfer.transactionHash, logIndex: transfer.logIndex } },
    select: { id: true, status: true },
  });
  if (existing && (existing.status === "CONFIRMING" || existing.status === "CONFIRMED")) {
    await prisma.treasuryDeposit.updateMany({
      where: { id: existing.id, status: { in: ["CONFIRMING", "CONFIRMED"] } },
      data: { confirmationCount, blockHash: transfer.blockHash },
    });
  }
  return false;
}

/**
 * Roll back records whose block hash is no longer canonical. Credited user
 * balances receive an idempotent compensating ledger entry and the affected
 * custodial wallet is suspended for review. Treasury reversals are separate
 * signed entries and retain their chain-asset identity.
 */
async function reconcileCursorReorg(
  client: any,
  network: EvmNetworkConfig,
  cursor: { lastBlockNumber: bigint; lastBlockHash: string | null },
  initialBlock: bigint,
) {
  if (!cursor.lastBlockHash) return { reorgDetected: false };
  const canonicalCursorBlock = await client.getBlock({ blockNumber: cursor.lastBlockNumber });
  if (canonicalCursorBlock.hash.toLowerCase() === cursor.lastBlockHash.toLowerCase()) {
    return { reorgDetected: false };
  }

  const lookback = BigInt(positiveInteger(process.env[network.reorgLookbackEnv], 512, 256, 100_000));
  const candidate = cursor.lastBlockNumber > lookback ? cursor.lastBlockNumber - lookback : initialBlock;
  const rewindFrom = candidate > initialBlock ? candidate : initialBlock;
  const affected = await prisma.walletDeposit.findMany({
    where: { chainId: network.chainId, blockNumber: { gte: rewindFrom, lte: cursor.lastBlockNumber }, status: { in: [...eligibleStatuses] } },
    select: { id: true, userId: true, blockNumber: true, blockHash: true, walletAccountId: true },
  });
  const affectedTreasury = await prisma.treasuryDeposit.findMany({
    where: { chainId: network.chainId, blockNumber: { gte: rewindFrom, lte: cursor.lastBlockNumber }, status: { in: [...eligibleStatuses] } },
    select: { id: true, blockNumber: true, blockHash: true },
  });

  let userReversals = 0;
  let treasuryReversals = 0;
  let reorgedRecords = 0;

  for (const deposit of affected) {
    const canonicalBlock = await client.getBlock({ blockNumber: deposit.blockNumber });
    if (canonicalBlock.hash.toLowerCase() === deposit.blockHash.toLowerCase()) continue;

    const reversed = await prisma.$transaction(async (tx) => {
      const current = await tx.walletDeposit.findUnique({
        where: { id: deposit.id },
        include: { asset: { select: { symbol: true } } },
      });
      if (!current || !eligibleStatuses.includes(current.status as (typeof eligibleStatuses)[number])) return false;
      const changed = await tx.walletDeposit.updateMany({
        where: { id: current.id, status: current.status },
        data: { status: "REORGED" },
      });
      if (changed.count !== 1) return false;
      if (current.status === "CREDITED" && current.amountMicro !== null && current.amountMicro > 0n) {
        await tx.walletTransaction.upsert({
          where: { referenceKey: "evm-deposit-reversal:" + network.chainId + ":" + current.id },
          create: {
            userId: current.userId,
            type: "DEPOSIT_REVERSAL",
            status: "COMPLETED",
            amountMicro: current.amountMicro,
            currency: current.asset.symbol,
            chainId: current.chainId,
            chainAssetId: current.chainAssetId,
            note: "Reversal of " + current.asset.symbol + " deposit after canonical chain reorganization on " + network.displayName,
            referenceKey: "evm-deposit-reversal:" + network.chainId + ":" + current.id,
          },
          update: {},
        });
        await tx.walletAccount.update({ where: { id: current.walletAccountId }, data: { status: "SUSPENDED" } });
        return true;
      }
      return false;
    });
    reorgedRecords++;
    if (reversed) userReversals++;
  }

  for (const deposit of affectedTreasury) {
    const canonicalBlock = await client.getBlock({ blockNumber: deposit.blockNumber });
    if (canonicalBlock.hash.toLowerCase() === deposit.blockHash.toLowerCase()) continue;
    const reversed = await prisma.$transaction(async (tx) => {
      const current = await tx.treasuryDeposit.findUnique({
        where: { id: deposit.id },
        include: { asset: { select: { symbol: true } } },
      });
      if (!current || !eligibleStatuses.includes(current.status as (typeof eligibleStatuses)[number])) return false;
      const changed = await tx.treasuryDeposit.updateMany({
        where: { id: current.id, status: current.status },
        data: { status: "REORGED" },
      });
      if (changed.count !== 1) return false;
      if (current.status === "CREDITED" && current.amountMicro !== null && current.amountMicro > 0n) {
        await tx.treasuryLedger.upsert({
          where: { referenceKey: "evm-treasury-deposit-reversal:" + network.chainId + ":" + current.id },
          create: {
            treasuryWalletId: current.treasuryWalletId,
            depositId: current.id,
            type: "DEPOSIT_REVERSAL",
            amountMicro: -current.amountMicro,
            currency: current.asset.symbol,
            chainId: current.chainId,
            chainAssetId: current.chainAssetId,
            transactionHash: current.transactionHash,
            referenceKey: "evm-treasury-deposit-reversal:" + network.chainId + ":" + current.id,
            note: "Reversal of " + current.asset.symbol + " treasury deposit after chain reorganization on " + network.displayName,
            effectiveAt: new Date(),
          },
          update: {},
        });
        return true;
      }
      return false;
    });
    reorgedRecords++;
    if (reversed) treasuryReversals++;
  }

  const anchorBlock = rewindFrom > 0n ? rewindFrom - 1n : 0n;
  const anchor = await client.getBlock({ blockNumber: anchorBlock });
  await prisma.chainScanCursor.update({
    where: { chainId: network.chainId },
    data: { lastBlockNumber: anchorBlock, lastBlockHash: anchor.hash },
  });
  console.error("EVM chain reorganization detected; scanner rewound", {
    network: network.networkKey,
    previousCursor: cursor.lastBlockNumber.toString(),
    rewindFrom: rewindFrom.toString(),
    reorgedRecords,
    userReversals,
    treasuryReversals,
  });
  return { reorgDetected: true, reorgedRecords, userReversals, treasuryReversals };
}

async function scanNetwork(network: EvmNetworkConfig) {
  const client = createClient(network);
  const requiredConfirmations = confirmationsFor(network);
  const latestBlock = await client.getBlockNumber();
  const safeHead = latestBlock > BigInt(requiredConfirmations) ? latestBlock - BigInt(requiredConfirmations) : 0n;
  if (safeHead === 0n) return { network: network.networkKey, scanned: 0, reason: "WAITING_FOR_SAFE_BLOCK" };

  const cursorBefore = await prisma.chainScanCursor.findUnique({ where: { chainId: network.chainId } });
  if (!cursorBefore) {
    const anchor = await client.getBlock({ blockNumber: safeHead });
    await prisma.chainScanCursor.createMany({
      data: [{ chainId: network.chainId, lastBlockNumber: safeHead, lastBlockHash: anchor.hash }],
      skipDuplicates: true,
    });
    return { network: network.networkKey, initialized: true, lastScannedBlock: safeHead.toString(), nextScanBlock: (safeHead + 1n).toString() };
  }

  // Keep the old Polygon switch compatible. It enables the already-reviewed
  // USDT0 asset and eligible Polygon network accounts only; new assets such as
  // native POL remain disabled until explicitly enabled in ChainAsset.
  if (process.env[network.depositsEnabledEnv] === "true") {
    if (network.chainId === 137) {
      await prisma.chainAsset.updateMany({
        where: { chainId: 137, contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", symbol: "USDT0", decimals: 6, canonicalStatus: "ONCHAIN_VERIFIED" },
        data: { depositEnabled: true, withdrawalEnabled: false },
      });
    }
    await prisma.walletNetworkAccount.updateMany({
      where: {
        chainId: network.chainId,
        networkKey: network.networkKey,
        walletAccount: {
          status: "ACTIVE",
          turnkeyOrganizationId: { not: null },
          turnkeyWalletId: { not: null },
          turnkeyApiPublicKey: { not: null },
          turnkeyApiPrivateKeyEncrypted: { not: null },
        },
      },
      data: { depositEnabled: true, withdrawalEnabled: false },
    });
  }

  const startSetting = process.env[network.startBlockEnv]?.trim();
  if (!startSetting || !/^\d+$/.test(startSetting)) throw new Error(network.startBlockEnv + "_REQUIRED");
  const initialBlock = BigInt(startSetting);
  let cursor = await prisma.chainScanCursor.findUnique({ where: { chainId: network.chainId } });
  if (!cursor) throw new Error("CHAIN_SCAN_CURSOR_INITIALIZATION_FAILED");
  const reorgResult = await reconcileCursorReorg(client, network, cursor, initialBlock);
  cursor = await prisma.chainScanCursor.findUnique({ where: { chainId: network.chainId } });
  const cursorBlock = cursor?.lastBlockNumber ?? initialBlock - 1n;
  const fromBlock = cursorBlock + 1n > initialBlock ? cursorBlock + 1n : initialBlock;

  const assets = await prisma.chainAsset.findMany({
    where: { chainId: network.chainId, canonicalStatus: "ONCHAIN_VERIFIED", depositEnabled: true },
    orderBy: { symbol: "asc" },
  });
  const scannableAssets = assets.filter(assetIsScannable);
  const ignoredAssets = assets.filter((asset) => !assetIsScannable(asset)).map((asset) => asset.id);
  if (scannableAssets.length === 0) {
    return { network: network.networkKey, scanned: 0, skipped: "NO_VERIFIED_ENABLED_ASSETS", ignoredAssets };
  }

  const wallets = await prisma.walletNetworkAccount.findMany({
    where: {
      chainId: network.chainId,
      networkKey: network.networkKey,
      depositEnabled: true,
      walletAccount: {
        status: "ACTIVE",
        turnkeyOrganizationId: { not: null },
        turnkeyWalletId: { not: null },
        turnkeyApiPublicKey: { not: null },
        turnkeyApiPrivateKeyEncrypted: { not: null },
      },
    },
    select: {
      id: true,
      walletAccountId: true,
      walletAccount: { select: { userId: true, address: true } },
    },
  });
  const treasury = await prisma.treasuryWallet.findFirst({
    where: { chainId: network.chainId, networkKey: network.networkKey, status: "ACTIVE", address: { not: null } },
    select: { id: true, address: true },
  });
  if (wallets.length === 0 && !treasury?.address) {
    return { network: network.networkKey, scanned: 0, skipped: "NO_ENABLED_DESTINATIONS" };
  }

  const recipients = new Map<string, DepositDestination>();
  for (const wallet of wallets) {
    recipients.set(formatAddress(wallet.walletAccount.address), {
      id: wallet.id,
      address: wallet.walletAccount.address,
      kind: "wallet",
      walletNetworkAccountId: wallet.id,
      walletAccountId: wallet.walletAccountId,
      userId: wallet.walletAccount.userId,
    });
  }
  const treasuryAddress = treasury?.address ? formatAddress(treasury.address) : null;
  if (treasuryAddress && recipients.has(treasuryAddress)) throw new Error("TREASURY_ADDRESS_COLLIDES_WITH_USER_WALLET");
  if (treasury && treasuryAddress) recipients.set(treasuryAddress, { id: treasury.id, address: treasury.address!, kind: "treasury" });
  const addresses = Array.from(recipients.keys()) as Address[];

  const nativeAsset = scannableAssets.find(isNativeAsset) ?? null;
  const tokenAssets = scannableAssets.filter((asset) => !isNativeAsset(asset));
  const chunkSize = positiveInteger(process.env[network.chunkSizeEnv], 500, 10, 2_000);
  let scannedThrough = fromBlock - 1n;
  let detected = 0;
  let treasuryDetected = 0;
  let nativeTransactionsChecked = 0;

  // The cursor advances only after every enabled asset has completed the same
  // block range. A token scan failure or native-block RPC failure therefore
  // cannot silently skip that range for another asset.
  for (let start = fromBlock; start <= safeHead; start += BigInt(chunkSize)) {
    const end = start + BigInt(chunkSize) - 1n > safeHead ? safeHead : start + BigInt(chunkSize) - 1n;

    for (const asset of tokenAssets) {
      const tokenAddress = asset.contractAddress as Address;
      for (let offset = 0; offset < addresses.length; offset += 100) {
        const batch = addresses.slice(offset, offset + 100);
        const logs = await client.getLogs({
          address: tokenAddress,
          event: transferEvent,
          args: { to: batch },
          fromBlock: start,
          toBlock: end,
        });
        for (const log of logs) {
          if (!log.args.to || !log.args.from || log.args.value === undefined || log.blockNumber === null || !log.blockHash || !log.transactionHash) continue;
          const destination = recipients.get(formatAddress(log.args.to));
          if (!destination) continue;
          const inserted = await recordDeposit(network, asset, destination, {
            transactionHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            fromAddress: log.args.from,
            toAddress: log.args.to,
            amount: log.args.value,
          }, latestBlock);
          if (inserted) {
            if (destination.kind === "wallet") detected++;
            else treasuryDetected++;
          }
        }
      }
    }

    if (nativeAsset) {
      for (let blockNumber = start; blockNumber <= end; blockNumber++) {
        const block = await client.getBlock({ blockNumber, includeTransactions: true });
        for (const tx of block.transactions) {
          if (typeof tx === "string" || !tx.to || tx.value <= 0n) continue;
          const destination = recipients.get(formatAddress(tx.to));
          if (!destination) continue;
          nativeTransactionsChecked++;
          const receipt = await client.getTransactionReceipt({ hash: tx.hash });
          if (receipt.status !== "success" || receipt.blockHash.toLowerCase() !== block.hash.toLowerCase()) continue;
          const inserted = await recordDeposit(network, nativeAsset, destination, {
            transactionHash: tx.hash,
            logIndex: -1,
            blockNumber,
            blockHash: block.hash,
            fromAddress: tx.from,
            toAddress: tx.to,
            amount: tx.value,
          }, latestBlock);
          if (inserted) {
            if (destination.kind === "wallet") detected++;
            else treasuryDetected++;
          }
        }
      }
    }

    const anchor = await client.getBlock({ blockNumber: end });
    await prisma.chainScanCursor.upsert({
      where: { chainId: network.chainId },
      create: { chainId: network.chainId, lastBlockNumber: end, lastBlockHash: anchor.hash },
      update: { lastBlockNumber: end, lastBlockHash: anchor.hash },
    });
    scannedThrough = end;
  }

  const mature = await prisma.walletDeposit.findMany({
    where: { chainId: network.chainId, status: { in: ["CONFIRMING", "CONFIRMED"] }, blockNumber: { lte: safeHead } },
    take: 500,
    orderBy: { blockNumber: "asc" },
    include: { asset: { select: { symbol: true, decimals: true } } },
  });
  let credited = 0;
  for (const deposit of mature) {
    const canonicalBlock = await client.getBlock({ blockNumber: deposit.blockNumber });
    if (canonicalBlock.hash.toLowerCase() !== deposit.blockHash.toLowerCase()) {
      await prisma.walletDeposit.updateMany({ where: { id: deposit.id, status: { in: ["CONFIRMING", "CONFIRMED"] } }, data: { status: "REORGED" } });
      continue;
    }
    const count = Number(latestBlock - deposit.blockNumber + 1n);
    const amount = deposit.amountMicro;
    if (count < requiredConfirmations || amount === null || amount <= 0n) continue;
    const didCredit = await prisma.$transaction(async (tx) => {
      const claimed = await tx.walletDeposit.updateMany({
        where: { id: deposit.id, status: { in: ["CONFIRMING", "CONFIRMED"] } },
        data: { status: "CREDITED", confirmationCount: count, confirmedAt: new Date(), creditedAt: new Date() },
      });
      if (claimed.count !== 1) return false;
      const ledger = await tx.walletTransaction.upsert({
        where: { referenceKey: "evm-deposit:" + network.chainId + ":" + deposit.id },
        create: {
          userId: deposit.userId,
          type: "DEPOSIT",
          status: "COMPLETED",
          amountMicro: amount,
          currency: deposit.asset.symbol,
          chainId: deposit.chainId,
          chainAssetId: deposit.chainAssetId,
          note: "Confirmed " + deposit.asset.symbol + " deposit on " + network.displayName,
          referenceKey: "evm-deposit:" + network.chainId + ":" + deposit.id,
        },
        update: {},
      });
      await tx.walletDeposit.update({ where: { id: deposit.id }, data: { creditedLedgerId: ledger.id } });
      return true;
    });
    if (didCredit) credited++;
  }

  const matureTreasury = await prisma.treasuryDeposit.findMany({
    where: { chainId: network.chainId, status: { in: ["CONFIRMING", "CONFIRMED"] }, blockNumber: { lte: safeHead } },
    take: 500,
    orderBy: { blockNumber: "asc" },
    include: { asset: { select: { symbol: true, decimals: true } } },
  });
  let treasuryCredited = 0;
  for (const deposit of matureTreasury) {
    const canonicalBlock = await client.getBlock({ blockNumber: deposit.blockNumber });
    if (canonicalBlock.hash.toLowerCase() !== deposit.blockHash.toLowerCase()) {
      await prisma.treasuryDeposit.updateMany({ where: { id: deposit.id, status: { in: ["CONFIRMING", "CONFIRMED"] } }, data: { status: "REORGED" } });
      continue;
    }
    const count = Number(latestBlock - deposit.blockNumber + 1n);
    const amount = deposit.amountMicro;
    if (count < requiredConfirmations || amount === null || amount <= 0n) continue;
    const didCredit = await prisma.$transaction(async (tx) => {
      const claimed = await tx.treasuryDeposit.updateMany({
        where: { id: deposit.id, status: { in: ["CONFIRMING", "CONFIRMED"] } },
        data: { status: "CREDITED", confirmationCount: count, confirmedAt: new Date(), creditedAt: new Date() },
      });
      if (claimed.count !== 1) return false;
      await tx.treasuryLedger.upsert({
        where: { referenceKey: "evm-treasury-deposit:" + network.chainId + ":" + deposit.id },
        create: {
          treasuryWalletId: deposit.treasuryWalletId,
          depositId: deposit.id,
          type: "DEPOSIT_CREDIT",
          amountMicro: amount,
          currency: deposit.asset.symbol,
          chainId: deposit.chainId,
          chainAssetId: deposit.chainAssetId,
          transactionHash: deposit.transactionHash,
          referenceKey: "evm-treasury-deposit:" + network.chainId + ":" + deposit.id,
          note: "Confirmed " + deposit.asset.symbol + " treasury deposit on " + network.displayName,
          effectiveAt: new Date(),
        },
        update: {},
      });
      return true;
    });
    if (didCredit) treasuryCredited++;
  }

  return {
    network: network.networkKey,
    scanned: scannedThrough >= fromBlock ? Number(scannedThrough - fromBlock + 1n) : 0,
    detected,
    treasuryDetected,
    credited,
    treasuryCredited,
    nativeTransactionsChecked,
    assets: scannableAssets.map((asset) => asset.symbol),
    latestBlock: latestBlock.toString(),
    safeHead: safeHead.toString(),
    ...reorgResult,
  };
}

export async function scanEvmDepositsOnce() {
  const enabled = getEnabledEvmNetworks();
  if (enabled.length === 0) return { skipped: "NO_EVM_DEPOSIT_SCANNERS_ENABLED" };
  const results = [];
  for (const network of enabled) {
    try {
      results.push(await scanNetwork(network));
    } catch (error) {
      console.error("EVM deposit scan failed for " + network.networkKey, error);
      results.push({ network: network.networkKey, error: error instanceof Error ? error.message : "UNKNOWN_SCAN_ERROR" });
    }
  }
  return { networks: results };
}

/** Backward-compatible export used by earlier Wallet-Find server entrypoints. */
export async function scanPolygonUsdtDepositsOnce() {
  const polygon = EVM_NETWORKS.find((item) => item.chainId === 137);
  if (!polygon || process.env[polygon.scannerEnabledEnv] !== "true") return { skipped: "POLYGON_SCANNER_DISABLED" };
  return scanNetwork(polygon);
}

export function startEvmDepositScanners() {
  if (getEnabledEvmNetworks().length === 0) {
    console.log("EVM deposit scanners remain disabled by configuration");
    return null;
  }
  const intervalMs = positiveInteger(process.env.EVM_DEPOSIT_SCAN_INTERVAL_MS ?? process.env.POLYGON_SCAN_INTERVAL_MS, 30_000, 15_000, 300_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      console.log("Multi-chain EVM deposit scan completed", await scanEvmDepositsOnce());
    } catch (error) {
      console.error("Multi-chain EVM deposit scanner error", error);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(() => { void tick(); }, intervalMs);
}

/** Backward-compatible server startup export. */
export function startPolygonDepositScanner() {
  return startEvmDepositScanners();
}
