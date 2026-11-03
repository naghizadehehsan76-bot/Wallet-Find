import prisma from "../../config/prisma.js";
import { createEvmWalletChainAdapter } from "./chain-adapters/evm.adapter.js";
import type { AdapterAddress, AdapterAsset } from "./chain-adapters/types.js";
import { scanWalletNetworkDepositsOnce } from "./wallet-chain-deposit-scanner.service.js";

const PROCESS_INTERVAL_MS = 15_000;
const STALE_PROCESSING_MS = 5 * 60_000;
const MAX_EVENTS_PER_TICK = 10;

class PermanentWebhookDepositError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "PermanentWebhookDepositError";
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseDepositMessage(payloadValue: unknown) {
  const payload = objectValue(payloadValue);
  const msg = objectValue(payload?.msg);
  const asset = objectValue(msg?.asset);
  const block = objectValue(msg?.block);
  if (!payload || !msg || !asset || !block) {
    throw new PermanentWebhookDepositError("TURNKEY_FINALIZED_EVENT_SCHEMA_INVALID");
  }

  const operation = stringValue(msg.operation);
  if (operation !== "deposit") {
    throw new PermanentWebhookDepositError("TURNKEY_EVENT_NOT_A_DEPOSIT");
  }

  const txHash = stringValue(msg.txHash)?.toLowerCase() ?? null;
  const address = stringValue(msg.address)?.toLowerCase() ?? null;
  const caip2 = stringValue(msg.caip2);
  const caip19 = stringValue(asset.caip19);
  const amountAtomic = stringValue(asset.amount);
  const blockNumber = safeInteger(block.number);
  const blockHash = stringValue(block.hash)?.toLowerCase() ?? null;
  const decimals = safeInteger(asset.decimals);
  const symbol = stringValue(asset.symbol);

  if (!txHash || !/^0x[a-f0-9]{64}$/.test(txHash) ||
      !address || !/^0x[a-f0-9]{40}$/.test(address) ||
      !caip2 || !/^eip155:\d+$/.test(caip2) ||
      !caip19 || !amountAtomic || !/^[1-9]\d{0,77}$/.test(amountAtomic) ||
      blockNumber === null || !blockHash || !/^0x[a-f0-9]{64}$/.test(blockHash) ||
      decimals === null || decimals > 255 || !symbol) {
    throw new PermanentWebhookDepositError("TURNKEY_FINALIZED_EVENT_FIELDS_INVALID");
  }

  const chainId = Number(caip2.slice("eip155:".length));
  if (!Number.isSafeInteger(chainId) || chainId <= 0 ||
      !caip19.startsWith(caip2 + "/")) {
    throw new PermanentWebhookDepositError("TURNKEY_CAIP_NETWORK_ASSET_MISMATCH");
  }

  return {
    chainId,
    networkId: caip2,
    caip19,
    txHash,
    address,
    amountAtomic,
    blockNumber: blockNumber.toString(),
    blockHash,
    decimals,
    symbol,
  };
}

async function processFinalizedDepositEvent(event: {
  id: string;
  organizationId: string | null;
  payload: unknown;
}) {
  if (!event.organizationId) {
    throw new PermanentWebhookDepositError("TURNKEY_WEBHOOK_ORGANIZATION_MISSING");
  }

  const hint = parseDepositMessage(event.payload);
  const network = await prisma.walletNetwork.findUnique({
    where: { id: hint.networkId },
    select: {
      id: true,
      family: true,
      chainId: true,
      displayName: true,
      isEnabled: true,
      depositEnabled: true,
      finalityDepth: true,
    },
  });
  if (!network || network.family !== "EVM" || network.chainId !== hint.chainId) {
    throw new PermanentWebhookDepositError("TURNKEY_DEPOSIT_NETWORK_NOT_SUPPORTED");
  }

  const walletAccount = await prisma.walletAccount.findUnique({
    where: { turnkeyOrganizationId: event.organizationId },
    select: { id: true, userId: true, status: true },
  });
  if (!walletAccount || walletAccount.status !== "ACTIVE") {
    throw new PermanentWebhookDepositError("TURNKEY_DEPOSIT_WALLET_NOT_ACTIVE");
  }

  const walletAddress = await prisma.walletAddress.findFirst({
    where: {
      walletAccountId: walletAccount.id,
      networkId: network.id,
      address: { equals: hint.address, mode: "insensitive" },
      addressType: "EVM",
      status: "ACTIVE",
      isPrimary: true,
    },
    select: { id: true, address: true, walletAccountId: true },
  });
  if (!walletAddress) {
    throw new PermanentWebhookDepositError("TURNKEY_DEPOSIT_ADDRESS_OWNERSHIP_MISMATCH");
  }

  const isNative = hint.caip19.endsWith("/slip44:966") && hint.symbol.toUpperCase() === "POL";
  const tokenContract = hint.caip19.split("/erc20:")[1]?.toLowerCase() ?? null;
  const tokenMatch = tokenContract && /^0x[a-f0-9]{40}$/.test(tokenContract) ? tokenContract : null;
  const asset = await prisma.walletAsset.findFirst({
    where: {
      networkId: network.id,
      verificationStatus: "VERIFIED",
      depositEnabled: true,
      decimals: hint.decimals,
      symbol: { equals: hint.symbol, mode: "insensitive" },
      ...(isNative
        ? { assetType: "NATIVE", contractAddress: null, assetReference: "native" }
        : tokenMatch
          ? { assetType: "TOKEN", contractAddress: tokenMatch }
          : { id: "__unsupported_turnkey_asset__" }),
    },
    select: {
      id: true,
      assetType: true,
      contractAddress: true,
      decimals: true,
      symbol: true,
      minDepositAtomic: true,
      confirmationCount: true,
    },
  });
  if (!asset) {
    throw new PermanentWebhookDepositError("TURNKEY_DEPOSIT_ASSET_NOT_ENABLED_OR_MISMATCHED");
  }

  const pause = await prisma.systemSetting.findUnique({
    where: { key: "wallet_global_emergency_pause" },
    select: { value: true },
  });
  if (pause?.value === "true" || !network.isEnabled || !network.depositEnabled) {
    throw new PermanentWebhookDepositError("WALLET_DEPOSITS_PAUSED_OR_DISABLED");
  }

  const adapter = createEvmWalletChainAdapter({
    networkId: network.id,
    chainId: hint.chainId,
  });
  const addressInput: AdapterAddress = {
    id: walletAddress.id,
    address: walletAddress.address,
    walletAccountId: walletAccount.id,
    userId: walletAccount.userId,
  };
  const assetInput: AdapterAsset = {
    id: asset.id,
    assetType: asset.assetType,
    contractAddress: asset.contractAddress,
    decimals: asset.decimals,
  };

  // Turnkey is only a notification source. The RPC adapter independently
  // proves the exact transfer, destination, amount, and canonical block.
  const [latestPosition, safePosition, canonicalHash, transfers] = await Promise.all([
    adapter.getLatestPosition(),
    adapter.getSafePosition(network.finalityDepth),
    adapter.getPositionHash(hint.blockNumber),
    adapter.getIncomingTransfers({
      asset: assetInput,
      addresses: [addressInput],
      fromPosition: hint.blockNumber,
      toPosition: hint.blockNumber,
    }),
  ]);

  if (!canonicalHash || canonicalHash.toLowerCase() !== hint.blockHash) {
    throw new Error("TURNKEY_DEPOSIT_BLOCK_NOT_CANONICAL_YET");
  }

  const matchingTransfers = transfers.filter((transfer) =>
    transfer.transactionReference.toLowerCase() === hint.txHash &&
    transfer.toAddress.toLowerCase() === hint.address &&
    transfer.amountAtomic === hint.amountAtomic &&
    transfer.blockHash?.toLowerCase() === hint.blockHash
  );
  if (matchingTransfers.length !== 1) {
    throw new PermanentWebhookDepositError("TURNKEY_EVENT_DOES_NOT_MATCH_ONCHAIN_TRANSFER");
  }

  const transfer = matchingTransfers[0];
  const latest = BigInt(latestPosition);
  const position = BigInt(hint.blockNumber);
  const confirmations = Number(latest - position + 1n);
  const requiredConfirmations = Math.max(network.finalityDepth, asset.confirmationCount);
  if (BigInt(safePosition) < position || confirmations < requiredConfirmations) {
    throw new Error("TURNKEY_DEPOSIT_WAITING_FOR_RPC_FINALITY");
  }

  const amount = BigInt(transfer.amountAtomic);
  const minimum = asset.minDepositAtomic === null ? 0n : BigInt(asset.minDepositAtomic.toFixed(0));
  const belowMinimum = amount < minimum;

  const existing = await prisma.walletChainDeposit.findUnique({
    where: {
      networkId_transactionReference_eventIndex: {
        networkId: network.id,
        transactionReference: hint.txHash,
        eventIndex: transfer.eventIndex,
      },
    },
    select: {
      id: true,
      userId: true,
      walletAccountId: true,
      walletAddressId: true,
      walletAssetId: true,
      amountAtomic: true,
      toAddress: true,
      blockHash: true,
      status: true,
    },
  });

  if (existing) {
    const sameTransfer = existing.userId === walletAccount.userId &&
      existing.walletAccountId === walletAccount.id &&
      existing.walletAddressId === walletAddress.id &&
      existing.walletAssetId === asset.id &&
      existing.amountAtomic.toFixed(0) === hint.amountAtomic &&
      existing.toAddress.toLowerCase() === hint.address &&
      existing.blockHash?.toLowerCase() === hint.blockHash;
    if (!sameTransfer) {
      throw new PermanentWebhookDepositError("WALLET_DEPOSIT_IDEMPOTENCY_CONFLICT");
    }
    if (existing.status === "CREDITED") return { result: "ALREADY_CREDITED" as const };
    if (existing.status === "IGNORED" || existing.status === "REORGED") {
      throw new PermanentWebhookDepositError("WALLET_DEPOSIT_REQUIRES_REVIEW");
    }
  } else {
    await prisma.walletChainDeposit.createMany({
      data: [{
        userId: walletAccount.userId,
        walletAccountId: walletAccount.id,
        walletAddressId: walletAddress.id,
        networkId: network.id,
        walletAssetId: asset.id,
        transactionReference: hint.txHash,
        eventIndex: transfer.eventIndex,
        position: hint.blockNumber,
        positionValue: hint.blockNumber,
        blockHash: hint.blockHash,
        fromAddress: transfer.fromAddress,
        toAddress: transfer.toAddress,
        rawAmount: transfer.rawAmount,
        amountAtomic: transfer.amountAtomic,
        status: belowMinimum ? "IGNORED" : "CONFIRMING",
        reviewReason: belowMinimum ? "BELOW_MINIMUM_DEPOSIT" : null,
        confirmationCount: confirmations,
        confirmedAt: belowMinimum ? null : new Date(),
      }],
      skipDuplicates: true,
    });
    if (belowMinimum) return { result: "BELOW_MINIMUM" as const };
  }

  // The normal scanner owns journal posting, reorg reversal, and idempotency.
  // A targeted deposit row lets it handle a delayed webhook even if its cursor
  // has already passed the transfer's block.
  await scanWalletNetworkDepositsOnce(network.id);

  const reconciled = await prisma.walletChainDeposit.findUnique({
    where: {
      networkId_transactionReference_eventIndex: {
        networkId: network.id,
        transactionReference: hint.txHash,
        eventIndex: transfer.eventIndex,
      },
    },
    select: { status: true, creditedJournalId: true },
  });
  if (reconciled?.status === "CREDITED" && reconciled.creditedJournalId) {
    return { result: "CREDITED" as const };
  }
  if (reconciled?.status === "IGNORED") return { result: "BELOW_MINIMUM" as const };
  return { result: "WAITING_FOR_SCANNER" as const };
}

async function processOneEvent(event: {
  id: string;
  organizationId: string | null;
  payload: unknown;
}) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const claim = await prisma.turnkeyWebhookEvent.updateMany({
    where: {
      id: event.id,
      OR: [
        { status: "RECEIVED" },
        { status: "RETRY" },
        { status: "PROCESSING", updatedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "PROCESSING", processingError: null },
  });
  if (claim.count !== 1) return;

  try {
    const result = await processFinalizedDepositEvent(event);
    if (result.result === "WAITING_FOR_SCANNER") {
      await prisma.turnkeyWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: "RETRY",
          processingError: "WAITING_FOR_SCANNER_TO_FINALIZE_DEPOSIT",
        },
      });
      return;
    }
    await prisma.turnkeyWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: result.result === "BELOW_MINIMUM" ? "IGNORED" : "PROCESSED",
        processedAt: new Date(),
        processingError: result.result === "BELOW_MINIMUM" ? "BELOW_MINIMUM_DEPOSIT" : null,
      },
    });
  } catch (error) {
    const permanent = error instanceof PermanentWebhookDepositError;
    const code = error instanceof Error ? error.message.slice(0, 500) : "TURNKEY_WEBHOOK_PROCESSING_FAILED";
    await prisma.turnkeyWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: permanent ? "REVIEW_REQUIRED" : "RETRY",
        processingError: code,
      },
    });
    if (!permanent) {
      console.error("Turnkey finalized deposit reconciliation will retry", {
        eventId: event.id,
        error: code,
      });
    } else {
      console.error("Turnkey finalized deposit requires manual review", {
        eventId: event.id,
        error: code,
      });
    }
  }
}

export function startTurnkeyWebhookDepositProcessor() {
  if (process.env.TURNKEY_WEBHOOK_DEPOSIT_PROCESSOR_ENABLED !== "true") {
    console.log("Turnkey webhook deposit processor remains disabled by configuration");
    return null;
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
      const events = await prisma.turnkeyWebhookEvent.findMany({
        where: {
          eventType: "balances:finalized",
          OR: [
            { status: "RECEIVED" },
            { status: "RETRY" },
            { status: "PROCESSING", updatedAt: { lt: staleBefore } },
          ],
        },
        orderBy: { receivedAt: "asc" },
        take: MAX_EVENTS_PER_TICK,
        select: { id: true, organizationId: true, payload: true },
      });
      for (const event of events) {
        await processOneEvent(event);
      }
    } catch (error) {
      console.error("Could not process Turnkey finalized deposit inbox", error);
    } finally {
      running = false;
    }
  };

  void tick();
  return setInterval(() => { void tick(); }, PROCESS_INTERVAL_MS);
}
