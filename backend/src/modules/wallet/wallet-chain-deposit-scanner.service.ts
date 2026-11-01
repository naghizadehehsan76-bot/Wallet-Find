import { randomUUID } from "node:crypto";
import prisma from "../../config/prisma.js";
import { postWalletJournal } from "./wallet-journal.service.js";
import { createEvmWalletChainAdapter } from "./chain-adapters/evm.adapter.js";
import type { AdapterAddress, AdapterAsset, WalletChainAdapter } from "./chain-adapters/types.js";

const DEFAULT_CHUNK_SIZE = 250n;
const DEFAULT_REORG_LOOKBACK = 2_048n;
const MAX_BATCH_DEPOSITS = 250;
const LEASE_MS = 90_000;

function positiveIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function numericPosition(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("INVALID_NETWORK_CURSOR_POSITION");
  return BigInt(value);
}

function makeAdapter(network: {
  id: string;
  family: "EVM" | "BITCOIN" | "SOLANA";
  chainId: number | null;
}): WalletChainAdapter {
  if (network.family === "EVM" && network.chainId !== null) {
    return createEvmWalletChainAdapter({ networkId: network.id, chainId: network.chainId });
  }
  throw new Error("WALLET_NETWORK_ADAPTER_NOT_CONFIGURED");
}

async function refreshLease(networkId: string, owner: string): Promise<void> {
  const now = new Date();
  const updated = await prisma.walletNetworkScanCursor.updateMany({
    where: { networkId, leaseOwner: owner },
    data: {
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      heartbeatAt: now,
    },
  });
  if (updated.count !== 1) throw new Error("WALLET_NETWORK_SCAN_LEASE_LOST");
}

async function updateCursor(
  networkId: string,
  owner: string,
  position: string,
  hash: string | null,
): Promise<void> {
  const updated = await prisma.walletNetworkScanCursor.updateMany({
    where: { networkId, leaseOwner: owner },
    data: {
      cursorPosition: position,
      cursorHash: hash,
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    },
  });
  if (updated.count !== 1) throw new Error("WALLET_NETWORK_SCAN_LEASE_LOST");
}

async function reverseCreditedDeposit(
  deposit: {
    id: string;
    userId: string;
    walletAccountId: string;
    networkId: string;
    walletAssetId: string;
    creditedJournalId: string | null;
    status: string;
  },
): Promise<void> {
  if (deposit.status === "CREDITED" && deposit.creditedJournalId) {
    const original = await prisma.walletJournal.findUnique({
      where: { id: deposit.creditedJournalId },
      include: { postings: true },
    });
    if (!original) throw new Error("CREDITED_DEPOSIT_JOURNAL_NOT_FOUND");

    const inverse = original.postings.map((posting) => ({
      account: posting.account,
      direction: posting.direction === "DEBIT" ? "CREDIT" as const : "DEBIT" as const,
      amountAtomic: posting.amountAtomic.toString(),
      accountReference: posting.accountReference,
    }));
    await postWalletJournal({
      userId: deposit.userId,
      networkId: deposit.networkId,
      walletAssetId: deposit.walletAssetId,
      entryType: "DEPOSIT_REVERSAL",
      referenceKey: `wallet-chain-deposit-reversal:${deposit.id}`,
      note: "Reversal of previously credited wallet deposit after chain reorganization",
      reversalOfId: original.id,
      postings: inverse,
    });
    await prisma.walletAccount.update({
      where: { id: deposit.walletAccountId },
      data: { status: "SUSPENDED" },
    });
  } else if (deposit.status === "CREDITED") {
    // A CREDITED record without its journal is an accounting integrity fault.
    await prisma.walletAccount.update({
      where: { id: deposit.walletAccountId },
      data: { status: "SUSPENDED" },
    });
    throw new Error("CREDITED_DEPOSIT_MISSING_JOURNAL_REFERENCE");
  }

  await prisma.walletChainDeposit.updateMany({
    where: { id: deposit.id, status: { in: ["CONFIRMING", "CONFIRMED", "CREDITED"] } },
    data: {
      status: "REORGED",
      reviewReason: "SOURCE_CHAIN_REORGANIZATION",
    },
  });
}

/**
 * One idempotent, lease-protected scan pass for one enabled network. The first
 * activation deliberately anchors at the confirmed head: old transfers are
 * not silently backfilled into user balances.
 */
export async function scanWalletNetworkDepositsOnce(networkId: string) {
  const network = await prisma.walletNetwork.findUnique({
    where: { id: networkId },
    include: {
      assets: {
        where: {
          verificationStatus: "VERIFIED",
          depositEnabled: true,
        },
      },
      addresses: {
        where: { addressType: "EVM", status: "ACTIVE", isPrimary: true },
        include: {
          walletAccount: {
            select: { id: true, userId: true, status: true },
          },
        },
      },
    },
  });

  if (!network || !network.isEnabled) {
    return { networkId, skipped: "NETWORK_DISABLED" };
  }
  if (network.id === "eip155:137" && process.env.POLYGON_DEPOSIT_SCANNER_ENABLED === "true") {
    return { networkId, skipped: "LEGACY_POLYGON_SCANNER_ACTIVE" };
  }
  if (network.family !== "EVM") {
    return { networkId, skipped: "NETWORK_ADAPTER_NOT_IMPLEMENTED" };
  }
  const adapter = makeAdapter(network);
  const latestPosition = await adapter.getLatestPosition();
  const safePosition = await adapter.getSafePosition(network.finalityDepth);
  const safeValue = numericPosition(safePosition);
  const latestValue = numericPosition(latestPosition);

  let cursor = await prisma.walletNetworkScanCursor.findUnique({ where: { networkId } });
  if (!cursor) {
    const anchorHash = await adapter.getPositionHash(safePosition);
    if (!anchorHash) throw new Error("EVM_CANONICAL_CURSOR_HASH_UNAVAILABLE");
    await prisma.walletNetworkScanCursor.createMany({
      data: [{ networkId, cursorPosition: safePosition, cursorHash: anchorHash }],
      skipDuplicates: true,
    });
    cursor = await prisma.walletNetworkScanCursor.findUnique({ where: { networkId } });
    return {
      networkId,
      initialized: true,
      cursorPosition: cursor?.cursorPosition ?? safePosition,
      note: "Scanner activation boundary initialized; historical transfers are not backfilled.",
    };
  }
  if (!cursor) throw new Error("WALLET_NETWORK_SCAN_CURSOR_INITIALIZATION_FAILED");

  const owner = randomUUID();
  const now = new Date();
  const claimed = await prisma.walletNetworkScanCursor.updateMany({
    where: {
      networkId,
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      heartbeatAt: now,
    },
  });
  if (claimed.count !== 1) return { networkId, skipped: "SCANNER_LEASE_HELD" };

  let scannedBlocks = 0n;
  let detected = 0;
  let credited = 0;
  let ignoredBelowMinimum = 0;
  let reorged = 0;

  try {
    cursor = await prisma.walletNetworkScanCursor.findUniqueOrThrow({ where: { networkId } });
    let cursorPosition = numericPosition(cursor.cursorPosition);

    // A cursor-tip mismatch signals a possible reorg. Recheck deposit block
    // hashes in a bounded lookback window, reverse credited entries, and rewind.
    if (cursor.cursorHash) {
      const canonicalCursorHash = await adapter.getPositionHash(cursor.cursorPosition);
      if (!canonicalCursorHash) {
        throw new Error("EVM_CANONICAL_CURSOR_HASH_UNAVAILABLE");
      }
      if (canonicalCursorHash.toLowerCase() !== cursor.cursorHash.toLowerCase()) {
        const lookback = BigInt(positiveIntegerEnv(
          "WALLET_NETWORK_REORG_LOOKBACK",
          Number(DEFAULT_REORG_LOOKBACK),
          256,
          100_000,
        ));
        const rewindFrom = cursorPosition > lookback ? cursorPosition - lookback : 0n;
        const affected = await prisma.walletChainDeposit.findMany({
          where: {
            networkId,
            positionValue: { gte: rewindFrom.toString(), lte: cursorPosition.toString() },
            status: { in: ["CONFIRMING", "CONFIRMED", "CREDITED"] },
          },
          select: {
            id: true,
            userId: true,
            walletAccountId: true,
            networkId: true,
            walletAssetId: true,
            creditedJournalId: true,
            status: true,
            position: true,
            blockHash: true,
          },
          take: 10_000,
        });

        for (const deposit of affected) {
          const canonicalDepositHash = await adapter.getPositionHash(deposit.position);
          if (!canonicalDepositHash) {
            throw new Error("EVM_CANONICAL_DEPOSIT_HASH_UNAVAILABLE");
          }
          if (deposit.blockHash &&
              canonicalDepositHash.toLowerCase() === deposit.blockHash.toLowerCase()) continue;

          await reverseCreditedDeposit(deposit);
          reorged++;
        }

        const anchorPosition = rewindFrom > 0n ? rewindFrom - 1n : 0n;
        const anchorText = anchorPosition.toString();
        const anchorHash = await adapter.getPositionHash(anchorText);
        await updateCursor(networkId, owner, anchorText, anchorHash);
        cursorPosition = anchorPosition;
      }
    }

    const chunkSize = BigInt(positiveIntegerEnv(
      "WALLET_NETWORK_SCAN_BLOCK_CHUNK",
      Number(DEFAULT_CHUNK_SIZE),
      10,
      2_000,
    ));
    const custodyAddressSet = new Set(network.addresses.map((item) => item.address.toLowerCase()));
    const addressInputs: AdapterAddress[] = network.addresses.map((item) => ({
      id: item.id,
      address: item.address,
      walletAccountId: item.walletAccountId,
      userId: item.walletAccount.userId,
    }));

    if (network.depositEnabled !== true ||
        process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY !== "true" ||
        network.assets.length === 0 || network.addresses.length === 0) {
      // Advance the cursor while deposits are disabled or no eligible asset /
      // receiving address exists. Transfers sent during a paused period are
      // intentionally not credited when operations resume.
      if (cursorPosition < safeValue) {
        const safeHash = await adapter.getPositionHash(safePosition);
        if (!safeHash) throw new Error("EVM_CANONICAL_CURSOR_HASH_UNAVAILABLE");
        await updateCursor(networkId, owner, safePosition, safeHash);
        scannedBlocks += safeValue - cursorPosition;
        cursorPosition = safeValue;
      }
    } else {
    for (let start = cursorPosition + 1n; start <= safeValue; start += chunkSize) {
      const end = start + chunkSize - 1n > safeValue ? safeValue : start + chunkSize - 1n;

      for (const asset of network.assets) {
        if (asset.assetType === "TOKEN" && !asset.contractAddress) continue;

        const assetInput: AdapterAsset = {
          id: asset.id,
          assetType: asset.assetType,
          contractAddress: asset.contractAddress,
          decimals: asset.decimals,
        };

        const transfers = await adapter.getIncomingTransfers({
          asset: assetInput,
          addresses: addressInputs,
          fromPosition: start.toString(),
          toPosition: end.toString(),
        });

        const addressByLower = new Map(
          network.addresses.map((item) => [item.address.toLowerCase(), item]),
        );

        const rows = transfers.flatMap((transfer) => {
          const recipient = addressByLower.get(transfer.toAddress.toLowerCase());
          if (!recipient) return [];
          // Wallet-Find-to-Wallet-Find movements are not external deposits.
          if (transfer.fromAddress &&
              custodyAddressSet.has(transfer.fromAddress.toLowerCase())) return [];

          if (!/^[1-9]\d{0,77}$/.test(transfer.amountAtomic)) {
            console.error("Wallet scanner ignored an invalid token amount", {
              networkId,
              assetId: asset.id,
              transactionReference: transfer.transactionReference,
            });
            return [];
          }

          const amount = BigInt(transfer.amountAtomic);
          if (amount <= 0n) return [];

          const minAmount = asset.minDepositAtomic === null
            ? 0n
            : BigInt(asset.minDepositAtomic.toString());
          const belowMinimum = amount < minAmount;

          return [{
            userId: recipient.walletAccount.userId,
            walletAccountId: recipient.walletAccountId,
            walletAddressId: recipient.id,
            networkId,
            walletAssetId: asset.id,
            transactionReference: transfer.transactionReference,
            eventIndex: transfer.eventIndex,
            position: transfer.position,
            positionValue: transfer.position,
            blockHash: transfer.blockHash,
            fromAddress: transfer.fromAddress,
            toAddress: transfer.toAddress,
            rawAmount: transfer.rawAmount,
            amountAtomic: transfer.amountAtomic,
            status: belowMinimum ? "IGNORED" as const : "CONFIRMING" as const,
            reviewReason: belowMinimum ? "BELOW_MINIMUM_DEPOSIT" : null,
            confirmationCount: Number(latestValue - numericPosition(transfer.position) + 1n),
          }];
        });

        if (rows.length > 0) {
          const inserted = await prisma.walletChainDeposit.createMany({
            data: rows,
            skipDuplicates: true,
          });
          detected += inserted.count;
          ignoredBelowMinimum += rows.filter((row) => row.status === "IGNORED").length;
        }
      }

      const endHash = await adapter.getPositionHash(end.toString());
      if (!endHash) throw new Error("EVM_CANONICAL_CURSOR_HASH_UNAVAILABLE");
      await updateCursor(networkId, owner, end.toString(), endHash);
      cursorPosition = end;
      scannedBlocks += end - start + 1n;
      await refreshLease(networkId, owner);
      }
    }

    const emergencyPause = await prisma.systemSetting.findUnique({
      where: { key: "wallet_global_emergency_pause" },
      select: { value: true },
    });
    if (emergencyPause?.value === "true") {
      await refreshLease(networkId, owner);
      return {
        networkId,
        paused: true,
        scannedBlocks: scannedBlocks.toString(),
        detected,
        ignoredBelowMinimum,
        reorged,
        credited: 0,
      };
    }

    // Deposits are credited only after canonicality and configured finality are
    // rechecked. The journal's idempotency reference makes crash recovery safe.
    const mature = await prisma.walletChainDeposit.findMany({
      where: {
        networkId,
        status: { in: ["CONFIRMING", "CONFIRMED"] },
        positionValue: { lte: safeValue.toString() },
      },
      include: {
        walletAccount: { select: { status: true } },
        asset: { select: { decimals: true, symbol: true, confirmationCount: true } },
      },
      orderBy: [{ positionValue: "asc" }, { detectedAt: "asc" }],
      take: MAX_BATCH_DEPOSITS,
    });

    for (const deposit of mature) {
      const position = numericPosition(deposit.position);
      const [canonicalHash, currentLatest] = await Promise.all([
        adapter.getPositionHash(deposit.position),
        adapter.getLatestPosition(),
      ]);
      if (!canonicalHash) {
        throw new Error("EVM_CANONICAL_DEPOSIT_HASH_UNAVAILABLE");
      }
      if (!deposit.blockHash) {
        await reverseCreditedDeposit({
          id: deposit.id,
          userId: deposit.userId,
          walletAccountId: deposit.walletAccountId,
          networkId: deposit.networkId,
          walletAssetId: deposit.walletAssetId,
          creditedJournalId: deposit.creditedJournalId,
          status: deposit.status,
        });
        reorged++;
        continue;
      }
      if (canonicalHash.toLowerCase() !== deposit.blockHash.toLowerCase()) {
        await reverseCreditedDeposit({
          id: deposit.id,
          userId: deposit.userId,
          walletAccountId: deposit.walletAccountId,
          networkId: deposit.networkId,
          walletAssetId: deposit.walletAssetId,
          creditedJournalId: deposit.creditedJournalId,
          status: deposit.status,
        });
        reorged++;
        continue;
      }

      const confirmations = Number(numericPosition(currentLatest) - position + 1n);
      const requiredConfirmations = Math.max(network.finalityDepth, deposit.asset.confirmationCount);
      if (confirmations < requiredConfirmations) continue;
      if (deposit.walletAccount.status !== "ACTIVE") continue;

      if (deposit.status === "CONFIRMING") {
        await prisma.walletChainDeposit.updateMany({
          where: { id: deposit.id, status: "CONFIRMING" },
          data: { status: "CONFIRMED", confirmationCount: confirmations, confirmedAt: new Date() },
        });
      }

      const amountAtomic = deposit.amountAtomic.toString();
      const journal = await postWalletJournal({
        userId: deposit.userId,
        networkId,
        walletAssetId: deposit.walletAssetId,
        entryType: "DEPOSIT_CREDIT",
        referenceKey: `wallet-chain-deposit:${deposit.id}`,
        note: `Confirmed ${deposit.asset.symbol} deposit on ${network.displayName}`,
        postings: [
          {
            account: "CUSTODY_ASSET",
            direction: "DEBIT",
            amountAtomic,
            accountReference: deposit.walletAccountId,
          },
          {
            account: "USER_AVAILABLE",
            direction: "CREDIT",
            amountAtomic,
            accountReference: deposit.userId,
          },
        ],
      });

      const completed = await prisma.walletChainDeposit.updateMany({
        where: {
          id: deposit.id,
          status: { in: ["CONFIRMING", "CONFIRMED"] },
          OR: [{ creditedJournalId: null }, { creditedJournalId: journal.id }],
        },
        data: {
          status: "CREDITED",
          confirmationCount: confirmations,
          confirmedAt: deposit.confirmedAt ?? new Date(),
          creditedAt: new Date(),
          creditedJournalId: journal.id,
        },
      });
      if (completed.count === 1) credited++;
    }

    await prisma.walletNetworkScanCursor.updateMany({
      where: { networkId, leaseOwner: owner },
      data: {
        lastSuccessfulScanAt: new Date(),
        heartbeatAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      },
    });
    await refreshLease(networkId, owner);
    return {
      networkId,
      scannedBlocks: scannedBlocks.toString(),
      detected,
      credited,
      ignoredBelowMinimum,
      reorged,
      latestPosition: latestPosition,
      safePosition,
    };
  } finally {
    await prisma.walletNetworkScanCursor.updateMany({
      where: { networkId, leaseOwner: owner },
      data: { leaseOwner: null, leaseExpiresAt: null },
    }).catch((error) => {
      console.error("Could not release wallet network scanner lease", { networkId, error });
    });
  }
}

export function startWalletChainDepositScanner() {
  if (process.env.WALLET_GENERIC_DEPOSIT_SCANNER_ENABLED !== "true") {
    console.log("Generic wallet deposit scanner remains disabled by configuration");
    return null;
  }

  const intervalMs = positiveIntegerEnv("WALLET_GENERIC_SCAN_INTERVAL_MS", 30_000, 15_000, 300_000);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const networks = await prisma.walletNetwork.findMany({
        where: {
          family: "EVM",
          isEnabled: true,
        },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      for (const network of networks) {
        try {
          const result = await scanWalletNetworkDepositsOnce(network.id);
          console.log("Generic wallet network deposit scan completed", result);
        } catch (error) {
          console.error("Generic wallet network deposit scan failed", {
            networkId: network.id,
            error,
          });
        }
      }
    } catch (error) {
      console.error("Could not load enabled wallet networks for scanning", error);
    } finally {
      running = false;
    }
  };

  void tick();
  return setInterval(() => { void tick(); }, intervalMs);
}
