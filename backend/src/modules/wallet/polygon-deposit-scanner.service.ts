import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { polygon } from "viem/chains";
import prisma from "../../config/prisma.js";

const chainId = 137;
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const confirmationsRequired = Math.max(32, Number.parseInt(process.env.POLYGON_USDT_CONFIRMATIONS ?? "128", 10) || 128);
const chunkSize = Math.max(100, Math.min(2_000, Number.parseInt(process.env.POLYGON_SCAN_BLOCK_CHUNK ?? "500", 10) || 500));
const reorgLookback = Math.max(256, Number.parseInt(process.env.POLYGON_REORG_LOOKBACK_BLOCKS ?? "512", 10) || 512);

function getClient() {
  const rpcUrl = process.env.POLYGON_RPC_URL?.trim();
  if (!rpcUrl) throw new Error("POLYGON_RPC_NOT_CONFIGURED");
  return createPublicClient({ chain: polygon, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });
}

function toMicro(raw: bigint, decimals: number): bigint | null {
  return decimals === 6 ? raw : null;
}

/**
 * Reconcile deposits around a cursor whose saved block hash is no longer
 * canonical. A credited deposit that disappeared is marked REORGED and its
 * wallet is suspended; balances are never silently clawed back.
 */
async function reconcileCursorReorg(
  client: ReturnType<typeof getClient>,
  cursor: { lastBlockNumber: bigint; lastBlockHash: string | null },
  initialBlock: bigint,
) {
  if (!cursor.lastBlockHash) return { reorgDetected: false, nextFromBlock: cursor.lastBlockNumber + 1n };
  const canonicalCursorBlock = await client.getBlock({ blockNumber: cursor.lastBlockNumber });
  if (canonicalCursorBlock.hash.toLowerCase() === cursor.lastBlockHash.toLowerCase()) {
    return { reorgDetected: false, nextFromBlock: cursor.lastBlockNumber + 1n };
  }

  const candidateRewind = cursor.lastBlockNumber > BigInt(reorgLookback)
    ? cursor.lastBlockNumber - BigInt(reorgLookback)
    : initialBlock;
  const rewindFrom = candidateRewind > initialBlock ? candidateRewind : initialBlock;
  const affected = await prisma.walletDeposit.findMany({
    where: { chainId, blockNumber: { gte: rewindFrom, lte: cursor.lastBlockNumber }, status: { in: ["CONFIRMING", "CONFIRMED", "CREDITED"] } },
    select: { id: true, userId: true, blockNumber: true, blockHash: true, status: true, walletAccountId: true, amountMicro: true },
  });

  // Treasury deposits need their own reconciliation because a confirmed
  // deposit may already have increased the internal treasury ledger.
  const affectedTreasury = await prisma.treasuryDeposit.findMany({
    where: {
      chainId,
      blockNumber: { gte: rewindFrom, lte: cursor.lastBlockNumber },
      status: { in: ["CONFIRMING", "CONFIRMED", "CREDITED"] },
    },
    select: {
      id: true,
      treasuryWalletId: true,
      transactionHash: true,
      amountMicro: true,
      blockNumber: true,
      blockHash: true,
      status: true,
    },
  });

  let reorged = 0;
  let suspended = 0;
  let treasuryReorged = 0;
  let treasuryReversals = 0;
  for (const deposit of affected) {
    const canonicalBlock = await client.getBlock({ blockNumber: deposit.blockNumber });
    if (canonicalBlock.hash.toLowerCase() === deposit.blockHash.toLowerCase()) continue;

    await prisma.$transaction(async (tx) => {
      const changed = await tx.walletDeposit.updateMany({
        where: { id: deposit.id, status: { in: ["CONFIRMING", "CONFIRMED", "CREDITED"] } },
        data: { status: "REORGED" },
      });
      if (changed.count > 0 && deposit.status === "CREDITED") {
        // Reverse the exact credited amount atomically and idempotently.
        if (deposit.amountMicro !== null && deposit.amountMicro > 0n) {
          await tx.walletTransaction.upsert({
            where: { referenceKey: `polygon-usdt-deposit-reversal:${deposit.id}` },
            create: {
              userId: deposit.userId,
              type: "DEPOSIT_REVERSAL",
              status: "COMPLETED",
              amountMicro: deposit.amountMicro,
              currency: "USDT",
              note: "Reversal of Polygon USDT0 deposit after canonical chain reorganization",
              referenceKey: `polygon-usdt-deposit-reversal:${deposit.id}`,
            },
            update: {},
          });
        }
        await tx.walletAccount.update({
          where: { id: deposit.walletAccountId },
          data: { status: "SUSPENDED" },
        });
      }
    });
    reorged++;
    if (deposit.status === "CREDITED") suspended++;
  }

  for (const deposit of affectedTreasury) {
    const canonicalBlock = await client.getBlock({ blockNumber: deposit.blockNumber });
    if (canonicalBlock.hash.toLowerCase() === deposit.blockHash.toLowerCase()) continue;

    const reversed = await prisma.$transaction(async (tx) => {
      const current = await tx.treasuryDeposit.findUnique({
        where: { id: deposit.id },
        select: { status: true, amountMicro: true, treasuryWalletId: true, transactionHash: true },
      });
      if (!current || (current.status !== "CONFIRMING" && current.status !== "CONFIRMED" && current.status !== "CREDITED")) return false;

      // Match the exact status we just read. If a concurrent scan credits this
      // deposit between the read and update, this claim fails and the next scan
      // will retry using the now-current CREDITED state.
      const changed = await tx.treasuryDeposit.updateMany({
        where: { id: deposit.id, status: current.status },
        data: { status: "REORGED" },
      });
      if (changed.count !== 1) return false;

      if (current.status === "CREDITED" && current.amountMicro !== null && current.amountMicro > 0n) {
        await tx.treasuryLedger.upsert({
          where: { referenceKey: `polygon-treasury-usdt0-reversal:${deposit.id}` },
          create: {
            treasuryWalletId: current.treasuryWalletId,
            depositId: deposit.id,
            type: "DEPOSIT_REVERSAL",
            amountMicro: -current.amountMicro,
            currency: "USDT0",
            transactionHash: current.transactionHash,
            referenceKey: `polygon-treasury-usdt0-reversal:${deposit.id}`,
            note: "Reversal of previously credited Polygon USDT0 treasury deposit after chain reorganization",
            effectiveAt: new Date(),
          },
          update: {},
        });
        return true;
      }
      return false;
    });
    treasuryReorged++;
    if (reversed) treasuryReversals++;
  }

  // Move the cursor back to a canonical anchor. Credited user deposits remain
  // frozen, and credited treasury deposits receive an auditable ledger reversal.
  const anchorBlock = rewindFrom > 0n ? rewindFrom - 1n : 0n;
  const anchor = await client.getBlock({ blockNumber: anchorBlock });
  await prisma.chainScanCursor.update({
    where: { chainId },
    data: { lastBlockNumber: anchorBlock, lastBlockHash: anchor.hash },
  });
  console.error("Polygon chain reorganization detected; scanner rewound", {
    previousCursor: cursor.lastBlockNumber.toString(),
    rewindFrom: rewindFrom.toString(),
    reorgedDeposits: reorged,
    suspendedWallets: suspended,
    reorgedTreasuryDeposits: treasuryReorged,
    treasuryLedgerReversals: treasuryReversals,
  });
  return {
    reorgDetected: true,
    nextFromBlock: rewindFrom,
    reorgedDeposits: reorged,
    suspendedWallets: suspended,
    reorgedTreasuryDeposits: treasuryReorged,
    treasuryLedgerReversals: treasuryReversals,
  };
}

/**
 * Scans only explicitly enabled Polygon assets and wallet network accounts.
 * The scanner is inert unless POLYGON_DEPOSIT_SCANNER_ENABLED=true AND the
 * corresponding asset/network rows are enabled by an operator.
 */
export async function scanPolygonUsdtDepositsOnce() {
  if (process.env.POLYGON_DEPOSIT_SCANNER_ENABLED !== "true") return { skipped: "SCANNER_DISABLED" };

  // Establish a one-time activation boundary before checking whether any
  // asset or user network account is enabled. This prevents the first enabled
  // scan from backfilling historical transfers and crediting old deposits.
  // The cursor is anchored at the confirmation-safe head, so scanning begins
  // strictly after the scanner's first successful initialization.
  const bootstrapClient = getClient();
  const bootstrapLatestBlock = await bootstrapClient.getBlockNumber();
  const bootstrapSafeHead = bootstrapLatestBlock > BigInt(confirmationsRequired)
    ? bootstrapLatestBlock - BigInt(confirmationsRequired)
    : 0n;
  if (bootstrapSafeHead === 0n) {
    return { scanned: 0, reason: "WAITING_FOR_SAFE_BOOTSTRAP_BLOCK" };
  }
  const existingCursor = await prisma.chainScanCursor.findUnique({ where: { chainId } });
  if (!existingCursor) {
    const anchor = await bootstrapClient.getBlock({ blockNumber: bootstrapSafeHead });
    await prisma.chainScanCursor.createMany({
      data: [{ chainId, lastBlockNumber: bootstrapSafeHead, lastBlockHash: anchor.hash }],
      skipDuplicates: true,
    });
    const initializedCursor = await prisma.chainScanCursor.findUnique({ where: { chainId } });
    console.log("Polygon deposit scanner activation boundary initialized", {
      chainId,
      lastScannedBlock: initializedCursor?.lastBlockNumber.toString(),
      nextScanBlock: initializedCursor ? (initializedCursor.lastBlockNumber + 1n).toString() : null,
      anchorBlockHash: initializedCursor?.lastBlockHash,
    });
    return {
      initialized: true,
      chainId,
      lastScannedBlock: initializedCursor?.lastBlockNumber.toString(),
      nextScanBlock: initializedCursor ? (initializedCursor.lastBlockNumber + 1n).toString() : null,
    };
  }

  const assets = await prisma.chainAsset.findMany({
    where: {
      chainId,
      symbol: "USDT0",
      contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      decimals: 6,
      depositEnabled: true,
      canonicalStatus: "ONCHAIN_VERIFIED",
    },
    take: 2,
  });
  if (assets.length !== 1) return { skipped: assets.length === 0 ? "NO_VERIFIED_ENABLED_USDT0_ASSET" : "AMBIGUOUS_POLYGON_USDT0_ASSET" };
  const asset = assets[0];

  // Explicit operator gate: enable only the verified Polygon USDT0 asset and
  // network accounts belonging to active users with independent Turnkey
  // sub-organizations. BSC and withdrawal flags are never touched here.
  if (process.env.POLYGON_DEPOSITS_ENABLED === "true") {
    await prisma.chainAsset.updateMany({
      where: {
        chainId,
        symbol: "USDT0",
        contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        decimals: 6,
        canonicalStatus: "ONCHAIN_VERIFIED",
      },
      data: { depositEnabled: true, withdrawalEnabled: false },
    });
    await prisma.walletNetworkAccount.updateMany({
      where: {
        chainId,
        networkKey: "polygon",
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

  const wallets = await prisma.walletNetworkAccount.findMany({
    where: {
      chainId,
      networkKey: "polygon",
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
      id: true, walletAccountId: true,
      walletAccount: { select: { userId: true, address: true, status: true } },
    },
  });
  const treasury = await prisma.treasuryWallet.findFirst({
    where: { chainId, networkKey: "polygon", status: "ACTIVE", address: { not: null } },
    select: { id: true, address: true },
  });
  if (!wallets.length && !treasury?.address) {
    return { skipped: "NO_ENABLED_USER_OR_ACTIVE_TREASURY_ADDRESSES" };
  }

  const startBlockSetting = process.env.POLYGON_DEPOSIT_START_BLOCK?.trim();
  if (!startBlockSetting || !/^\d+$/.test(startBlockSetting)) {
    throw new Error("POLYGON_DEPOSIT_START_BLOCK_REQUIRED");
  }

  const client = getClient();
  const latestBlock = await client.getBlockNumber();
  const safeHead = latestBlock > BigInt(confirmationsRequired) ? latestBlock - BigInt(confirmationsRequired) : 0n;
  if (safeHead === 0n) return { scanned: 0, reason: "WAITING_FOR_CONFIRMATIONS" };

  const initialBlock = BigInt(startBlockSetting);
  let cursor = await prisma.chainScanCursor.findUnique({ where: { chainId } });
  let reorgResult: Record<string, unknown> = { reorgDetected: false };
  if (cursor) {
    reorgResult = await reconcileCursorReorg(client, cursor, initialBlock);
    cursor = await prisma.chainScanCursor.findUnique({ where: { chainId } });
  }
  const fromBlock = cursor ? cursor.lastBlockNumber + 1n : initialBlock;
  const hasNewBlocks = fromBlock <= safeHead;
  const recipients = new Map(wallets.map((wallet) => [wallet.walletAccount.address.toLowerCase(), wallet]));
  const treasuryAddress = treasury?.address?.toLowerCase() ?? null;
  if (treasuryAddress && recipients.has(treasuryAddress)) {
    throw new Error("TREASURY_ADDRESS_COLLIDES_WITH_USER_WALLET");
  }
  const addresses = Array.from(new Set([
    ...wallets.map((wallet) => wallet.walletAccount.address.toLowerCase()),
    ...(treasuryAddress ? [treasuryAddress] : []),
  ])) as Address[];
  const tokenAddress = asset.contractAddress as Address;
  let scannedThrough = fromBlock - 1n;
  let detected = 0;
  let treasuryDetected = 0;

  if (hasNewBlocks) {
  for (let start = fromBlock; start <= safeHead; start += BigInt(chunkSize)) {
    const end = start + BigInt(chunkSize) - 1n > safeHead ? safeHead : start + BigInt(chunkSize) - 1n;
    // Split recipient filters to avoid provider limits on large address arrays.
    for (let offset = 0; offset < addresses.length; offset += 100) {
      const addressBatch = addresses.slice(offset, offset + 100);
      const logs = await client.getLogs({
        address: tokenAddress,
        event: transferEvent,
        args: { to: addressBatch },
        fromBlock: start,
        toBlock: end,
      });

      for (const log of logs) {
        if (!log.args.to || !log.args.from || log.args.value === undefined || log.blockNumber === null || !log.blockHash || log.transactionHash === null) continue;
        const recipientAddress = log.args.to.toLowerCase();
        const wallet = recipients.get(recipientAddress);
        const isTreasuryRecipient = treasuryAddress !== null && recipientAddress === treasuryAddress;
        if (!wallet && !isTreasuryRecipient) continue;
        const amountMicro = toMicro(log.args.value, asset.decimals);
        if (amountMicro === null || amountMicro <= 0n) continue;

        const unique = { chainId, transactionHash: log.transactionHash, logIndex: log.logIndex };
        if (wallet) {
          // PostgreSQL enforces the compound unique key during insertion. With
          // skipDuplicates, concurrent/repeated scans cannot create duplicate rows
          // and a duplicate log does not abort the whole scan.
          const inserted = await prisma.walletDeposit.createMany({
            data: [{
              userId: wallet.walletAccount.userId,
              walletAccountId: wallet.walletAccountId,
              walletNetworkAccountId: wallet.id,
              chainAssetId: asset.id,
              chainId,
              transactionHash: log.transactionHash,
              logIndex: log.logIndex,
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              fromAddress: log.args.from.toLowerCase(),
              toAddress: recipientAddress,
              rawAmount: log.args.value.toString(),
              amountMicro,
              status: "CONFIRMING",
              confirmationCount: Number(latestBlock - log.blockNumber + 1n),
            }],
            skipDuplicates: true,
          });
          if (inserted.count === 1) {
            detected++;
          } else {
            const existing = await prisma.walletDeposit.findUnique({
              where: { chainId_transactionHash_logIndex: unique },
              select: { id: true, status: true },
            });
            if (existing && (existing.status === "CONFIRMING" || existing.status === "CONFIRMED")) {
              await prisma.walletDeposit.updateMany({
                where: { id: existing.id, status: { in: ["CONFIRMING", "CONFIRMED"] } },
                data: {
                  confirmationCount: Number(latestBlock - log.blockNumber + 1n),
                  blockHash: log.blockHash,
                },
              });
            }
          }
          // CREDITED and REORGED user records are intentionally never reset by rescans.
        }

        if (isTreasuryRecipient && treasury) {
          // The database compound unique constraint is the final arbiter. This
          // insert is atomic and safely ignores a log already stored by another scan.
          const insertedTreasury = await prisma.treasuryDeposit.createMany({
            data: [{
              treasuryWalletId: treasury.id,
              chainAssetId: asset.id,
              chainId,
              transactionHash: log.transactionHash,
              logIndex: log.logIndex,
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              fromAddress: log.args.from.toLowerCase(),
              toAddress: recipientAddress,
              rawAmount: log.args.value.toString(),
              amountMicro,
              status: "CONFIRMING",
              confirmationCount: Number(latestBlock - log.blockNumber + 1n),
            }],
            skipDuplicates: true,
          });
          if (insertedTreasury.count === 1) {
            treasuryDetected++;
          } else {
            const existingTreasuryDeposit = await prisma.treasuryDeposit.findUnique({
              where: { chainId_transactionHash_logIndex: unique },
              select: { id: true, status: true },
            });
            if (existingTreasuryDeposit && (existingTreasuryDeposit.status === "CONFIRMING" || existingTreasuryDeposit.status === "CONFIRMED")) {
              await prisma.treasuryDeposit.updateMany({
                where: { id: existingTreasuryDeposit.id, status: { in: ["CONFIRMING", "CONFIRMED"] } },
                data: {
                  confirmationCount: Number(latestBlock - log.blockNumber + 1n),
                  blockHash: log.blockHash,
                },
              });
            }
          }
          // Treasury ledger credit is intentionally deferred to the confirmation/accounting stage.
        }
      }
    }
    scannedThrough = end;
  }

  }

  if (hasNewBlocks) {
    const lastBlock = await client.getBlock({ blockNumber: scannedThrough });
    await prisma.chainScanCursor.upsert({
      where: { chainId },
      create: { chainId, lastBlockNumber: scannedThrough, lastBlockHash: lastBlock.hash },
      update: { lastBlockNumber: scannedThrough, lastBlockHash: lastBlock.hash },
    });
  }

  const mature = await prisma.walletDeposit.findMany({
    where: { chainId, status: "CONFIRMING", blockNumber: { lte: safeHead } },
    take: 250,
    orderBy: { blockNumber: "asc" },
  });
  let credited = 0;
  for (const deposit of mature) {
    const canonicalBlock = await client.getBlock({ blockNumber: deposit.blockNumber });
    if (canonicalBlock.hash.toLowerCase() !== deposit.blockHash.toLowerCase()) {
      await prisma.walletDeposit.update({ where: { id: deposit.id }, data: { status: "REORGED" } });
      continue;
    }
    const count = Number(latestBlock - deposit.blockNumber + 1n);
    if (count < confirmationsRequired || !deposit.amountMicro) continue;

    await prisma.$transaction(async (tx) => {
      const current = await tx.walletDeposit.findUnique({ where: { id: deposit.id } });
      if (!current || current.status !== "CONFIRMING") return;
      const ledger = await tx.walletTransaction.upsert({
        where: { referenceKey: `polygon-usdt-deposit:${deposit.id}` },
        create: {
          userId: deposit.userId,
          type: "DEPOSIT",
          status: "COMPLETED",
          amountMicro: deposit.amountMicro!,
          currency: "USDT",
          note: "Confirmed USDT0 deposit on Polygon PoS",
          referenceKey: `polygon-usdt-deposit:${deposit.id}`,
        },
        update: {},
      });
      await tx.walletDeposit.update({
        where: { id: deposit.id },
        data: { status: "CREDITED", confirmationCount: count, confirmedAt: new Date(), creditedAt: new Date(), creditedLedgerId: ledger.id },
      });
    });
    credited++;
  }

  const matureTreasuryDeposits = await prisma.treasuryDeposit.findMany({
    where: {
      chainId,
      status: "CONFIRMING",
      blockNumber: { lte: safeHead },
    },
    take: 250,
    orderBy: { blockNumber: "asc" },
  });
  let treasuryCredited = 0;

  for (const deposit of matureTreasuryDeposits) {
    const canonicalBlock = await client.getBlock({ blockNumber: deposit.blockNumber });
    if (canonicalBlock.hash.toLowerCase() !== deposit.blockHash.toLowerCase()) {
      await prisma.treasuryDeposit.updateMany({
        where: { id: deposit.id, status: "CONFIRMING" },
        data: { status: "REORGED" },
      });
      continue;
    }

    const count = Number(latestBlock - deposit.blockNumber + 1n);
    if (count < confirmationsRequired || deposit.amountMicro === null || deposit.amountMicro <= 0n) continue;

    const credited = await prisma.$transaction(async (tx) => {
      // Conditional state transition prevents concurrent scanner instances from
      // creating more than one accounting credit for the same deposit.
      const claimed = await tx.treasuryDeposit.updateMany({
        where: { id: deposit.id, status: "CONFIRMING" },
        data: { status: "CREDITED", confirmationCount: count, confirmedAt: new Date() },
      });
      if (claimed.count !== 1) return false;

      await tx.treasuryLedger.upsert({
        where: { referenceKey: `polygon-treasury-usdt0-deposit:${deposit.id}` },
        create: {
          treasuryWalletId: deposit.treasuryWalletId,
          depositId: deposit.id,
          type: "DEPOSIT_CREDIT",
          amountMicro: deposit.amountMicro!,
          currency: asset.symbol,
          transactionHash: deposit.transactionHash,
          referenceKey: `polygon-treasury-usdt0-deposit:${deposit.id}`,
          note: "Confirmed USDT0 deposit credited to treasury accounting on Polygon PoS",
          effectiveAt: new Date(),
        },
        update: {},
      });

      await tx.treasuryDeposit.update({
        where: { id: deposit.id },
        data: { creditedAt: new Date() },
      });
      return true;
    });

    if (credited) treasuryCredited++;
  }

  return {
    scanned: hasNewBlocks ? Number(scannedThrough - fromBlock + 1n) : 0,
    detected,
    treasuryDetected,
    treasuryCredited,
    credited,
    latestBlock: latestBlock.toString(),
    safeHead: safeHead.toString(),
    ...reorgResult,
  };
}

export function startPolygonDepositScanner() {
  if (process.env.POLYGON_DEPOSIT_SCANNER_ENABLED !== "true") {
    console.log("Polygon deposit scanner remains disabled by configuration");
    return null;
  }
  const intervalMs = Math.max(15_000, Number.parseInt(process.env.POLYGON_SCAN_INTERVAL_MS ?? "30000", 10) || 30_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await scanPolygonUsdtDepositsOnce();
      console.log("Polygon deposit scan completed", result);
    } catch (error) {
      console.error("Polygon deposit scanner error", error);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(() => { void tick(); }, intervalMs);
}
