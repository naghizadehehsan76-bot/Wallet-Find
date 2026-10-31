import { createPublicClient, http, parseAbiItem, type Address, type Hash } from "viem";
import { polygon } from "viem/chains";
import prisma from "../../config/prisma.js";

const chainId = 137;
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const confirmationsRequired = Math.max(32, Number.parseInt(process.env.POLYGON_USDT_CONFIRMATIONS ?? "128", 10) || 128);
const chunkSize = Math.max(100, Math.min(2_000, Number.parseInt(process.env.POLYGON_SCAN_BLOCK_CHUNK ?? "500", 10) || 500));

function getClient() {
  const rpcUrl = process.env.POLYGON_RPC_URL?.trim();
  if (!rpcUrl) throw new Error("POLYGON_RPC_NOT_CONFIGURED");
  return createPublicClient({ chain: polygon, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });
}

function toMicro(raw: bigint, decimals: number): bigint | null {
  if (decimals !== 6) return null;
  return raw;
}

/**
 * Scans only explicitly enabled Polygon assets and wallet network accounts.
 * The scanner is inert unless POLYGON_DEPOSIT_SCANNER_ENABLED=true AND the
 * corresponding asset/network rows are enabled by an operator.
 */
export async function scanPolygonUsdtDepositsOnce() {
  if (process.env.POLYGON_DEPOSIT_SCANNER_ENABLED !== "true") return { skipped: "SCANNER_DISABLED" };

  const asset = await prisma.chainAsset.findFirst({
    where: { chainId, depositEnabled: true, canonicalStatus: "ONCHAIN_VERIFIED" },
  });
  if (!asset || asset.decimals !== 6) return { skipped: "NO_VERIFIED_ENABLED_ASSET" };

  const wallets = await prisma.walletNetworkAccount.findMany({
    where: { chainId, depositEnabled: true, walletAccount: { status: "ACTIVE" } },
    select: {
      id: true, walletAccountId: true,
      walletAccount: { select: { userId: true, address: true, status: true } },
    },
  });
  if (!wallets.length) return { skipped: "NO_ENABLED_DEPOSIT_ADDRESSES" };

  const startBlockSetting = process.env.POLYGON_DEPOSIT_START_BLOCK?.trim();
  if (!startBlockSetting || !/^\d+$/.test(startBlockSetting)) {
    throw new Error("POLYGON_DEPOSIT_START_BLOCK_REQUIRED");
  }

  const client = getClient();
  const latestBlock = await client.getBlockNumber();
  const safeHead = latestBlock > BigInt(confirmationsRequired) ? latestBlock - BigInt(confirmationsRequired) : 0n;
  if (safeHead === 0n) return { scanned: 0, reason: "WAITING_FOR_CONFIRMATIONS" };

  const cursor = await prisma.chainScanCursor.findUnique({ where: { chainId } });
  const initialBlock = BigInt(startBlockSetting);
  const fromBlock = cursor ? cursor.lastBlockNumber + 1n : initialBlock;
  if (fromBlock > safeHead) return { scanned: 0, latestBlock: latestBlock.toString(), safeHead: safeHead.toString() };

  const recipients = new Map(wallets.map((wallet) => [wallet.walletAccount.address.toLowerCase(), wallet]));
  const addresses = wallets.map((wallet) => wallet.walletAccount.address as Address);
  const tokenAddress = asset.contractAddress as Address;
  let scannedThrough = fromBlock - 1n;
  let detected = 0;

  for (let start = fromBlock; start <= safeHead; start += BigInt(chunkSize)) {
    const end = start + BigInt(chunkSize) - 1n > safeHead ? safeHead : start + BigInt(chunkSize) - 1n;
    const logs = await client.getLogs({
      address: tokenAddress,
      event: transferEvent,
      args: { to: addresses },
      fromBlock: start,
      toBlock: end,
    });

    for (const log of logs) {
      if (!log.args.to || !log.args.from || log.args.value === undefined || log.blockNumber === null || !log.blockHash || log.transactionHash === null) continue;
      const wallet = recipients.get(log.args.to.toLowerCase());
      if (!wallet) continue;
      const amountMicro = toMicro(log.args.value, asset.decimals);
      if (amountMicro === null || amountMicro <= 0n) continue;

      await prisma.walletDeposit.upsert({
        where: { chainId_transactionHash_logIndex: { chainId, transactionHash: log.transactionHash, logIndex: log.logIndex } },
        create: {
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
          toAddress: log.args.to.toLowerCase(),
          rawAmount: log.args.value.toString(),
          amountMicro,
          status: "CONFIRMING",
          confirmationCount: Number(latestBlock - log.blockNumber + 1n),
        },
        update: {
          confirmationCount: Number(latestBlock - log.blockNumber + 1n),
          status: "CONFIRMING",
          blockHash: log.blockHash,
        },
      });
      detected++;
    }

    scannedThrough = end;
  }

  const lastBlock = await client.getBlock({ blockNumber: scannedThrough });
  await prisma.chainScanCursor.upsert({
    where: { chainId },
    create: { chainId, lastBlockNumber: scannedThrough, lastBlockHash: lastBlock.hash },
    update: { lastBlockNumber: scannedThrough, lastBlockHash: lastBlock.hash },
  });

  // Credit only after the configured confirmation depth. The unique transaction
  // reference and single DB transaction make crediting idempotent.
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
      if (!current || current.status === "CREDITED" || current.status === "REORGED") return;
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

  return { scanned: Number(scannedThrough - fromBlock + 1n), detected, credited, latestBlock: latestBlock.toString(), safeHead: safeHead.toString() };
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
