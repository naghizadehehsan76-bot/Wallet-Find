import { randomUUID } from "node:crypto";
import { createPublicClient, http, isAddress, parseAbi, parseEventLogs } from "viem";
import { formatAssetUnits, parseAssetUnits } from "./asset-amount.js";
import { isEvmWithdrawalFeeModelSupported, isSupportedEvmChainId } from "./chain-adapters/evm.adapter.js";
import { polygon } from "viem/chains";
import prisma from "../../config/prisma.js";
import { createTurnkeySigner, isTurnkeyConfigured, provisionTurnkeyWallet } from "./turnkey.service.js";
function formatMicro(value: bigint): string {
  return formatAssetUnits(value, 6);
}
async function calculateBalances(tx: any, userId: string) {
  const rows = await tx.walletTransaction.findMany({ where: { userId }, select: { type: true, status: true, amountMicro: true } });
  let balance = 0n, pendingWithdrawals = 0n;
  for (const row of rows) {
    const amount = BigInt(row.amountMicro);
    if (row.status === "COMPLETED") {
      if (row.type === "DEPOSIT") balance += amount;
      if (row.type === "DEPOSIT_REVERSAL") balance -= amount;
      if (row.type === "WITHDRAWAL") balance -= amount;
    }
    if (row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING") pendingWithdrawals += amount;
  }
  return { balance, availableBalance: balance - pendingWithdrawals };
}
function serializeTransaction(row: any) {
  return { id: row.id, type: row.type, status: row.status, amount: formatMicro(BigInt(row.amountMicro)), currency: row.currency, note: row.note, contestId: row.contestId, createdAt: row.createdAt };
}
export async function getWallet(userId: string) {
  // Turnkey provisioning occurs only for a verified user who explicitly opens
  // the wallet page. Existing partial legacy records are shown read-only and
  // are never silently overwritten or duplicated.
  let turnkeyWallet: (Awaited<ReturnType<typeof provisionTurnkeyWallet>> & {
    networkAccounts: Array<{ chainId: number; networkKey: string; depositEnabled: boolean; withdrawalEnabled: boolean }>;
  }) | null = null;
  let walletProvisioningReviewRequired = false;

  if (isTurnkeyConfigured()) {
    try {
      turnkeyWallet = await provisionTurnkeyWallet(userId);
    } catch (error) {
      if (error instanceof Error && error.message === "TURNKEY_WALLET_RECORD_REQUIRES_REVIEW") {
        walletProvisioningReviewRequired = true;
        turnkeyWallet = await prisma.walletAccount.findUnique({
          where: { userId },
          include: { networkAccounts: true },
        });
      } else {
        throw error;
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const legacyBalances = await calculateBalances(tx, userId);
    const transactions = await tx.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const [chainDeposits, chainWithdrawals, legacyDeposits, legacyWithdrawals] = await Promise.all([
      tx.walletChainDeposit.findMany({
        where: { userId },
        include: {
          network: { select: { displayName: true, explorerTransactionUrlTemplate: true } },
          asset: { select: { symbol: true, decimals: true } },
        },
        orderBy: { detectedAt: "desc" },
        take: 100,
      }),
      tx.walletChainWithdrawal.findMany({
        where: { userId },
        include: {
          network: { select: { displayName: true, explorerTransactionUrlTemplate: true } },
          asset: { select: { symbol: true, decimals: true } },
          feeAsset: { select: { symbol: true, decimals: true } },
        },
        orderBy: { requestedAt: "desc" },
        take: 100,
      }),
      tx.walletDeposit.findMany({
        where: { userId },
        include: { asset: { select: { symbol: true, decimals: true } } },
        orderBy: { detectedAt: "desc" },
        take: 100,
      }),
      tx.walletWithdrawal.findMany({
        where: { userId },
        include: { asset: { select: { symbol: true, decimals: true } } },
        orderBy: { requestedAt: "desc" },
        take: 100,
      }),
    ]);

    const journalPostings = await tx.walletJournalPosting.findMany({
      where: { journal: { userId } },
      select: {
        account: true,
        direction: true,
        amountAtomic: true,
        journal: {
          select: { networkId: true, walletAssetId: true },
        },
      },
    });

    const balanceMap = new Map<string, { available: bigint; reserved: bigint }>();
    for (const posting of journalPostings) {
      const key = posting.journal.networkId + "|" + posting.journal.walletAssetId;
      const current = balanceMap.get(key) ?? { available: 0n, reserved: 0n };
      const signed = posting.direction === "CREDIT"
        ? BigInt(posting.amountAtomic.toString())
        : -BigInt(posting.amountAtomic.toString());

      if (posting.account === "USER_AVAILABLE") current.available += signed;
      if (posting.account === "USER_RESERVED") current.reserved += signed;
      balanceMap.set(key, current);
    }

    const legacyPolygonAsset = await tx.chainAsset.findFirst({
      where: {
        chainId: 137,
        symbol: "USDT0",
        contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        decimals: 6,
        canonicalStatus: "ONCHAIN_VERIFIED",
        depositEnabled: true,
      },
    });
    const legacyPolygonAccount = turnkeyWallet?.networkAccounts.find(
      (item) => item.chainId === 137 && item.networkKey === "polygon",
    );
    const legacyPolygonDepositReady = process.env.POLYGON_DEPOSIT_SCANNER_ENABLED === "true"
      && process.env.POLYGON_DEPOSITS_ENABLED === "true"
      && Boolean(legacyPolygonAsset)
      && Boolean(legacyPolygonAccount?.depositEnabled)
      && Boolean(turnkeyWallet?.status === "ACTIVE")
      && Boolean(turnkeyWallet?.turnkeyOrganizationId && turnkeyWallet?.turnkeyWalletId);

    const networks = await tx.walletNetwork.findMany({
      orderBy: [{ family: "asc" }, { networkKey: "asc" }],
      include: {
        assets: { orderBy: [{ symbol: "asc" }, { id: "asc" }] },
        addresses: {
          where: {
            walletAccountId: turnkeyWallet?.id ?? "__no_wallet_account__",
            status: "ACTIVE",
            isPrimary: true,
          },
        },
      },
    });

    const networkViews = networks.map((network) => {
      const address = network.addresses[0] ?? null;
      const assets = network.assets.map((asset) => {
        const key = network.id + "|" + asset.id;
        const balance = balanceMap.get(key) ?? { available: 0n, reserved: 0n };
        const availableBalance = balance.available;
        const reservedBalance = balance.reserved;
        const isLegacyPolygonUsdt0 = network.chainId === 137
          && asset.symbol === "USDT0"
          && asset.contractAddress?.toLowerCase() === "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";
        const legacyDepositEnabled = isLegacyPolygonUsdt0 && legacyPolygonDepositReady && Boolean(address);
        return {
          id: asset.id,
          symbol: asset.symbol,
          displayName: asset.displayName,
          assetType: asset.assetType,
          assetReference: asset.assetReference,
          contractAddress: asset.contractAddress,
          decimals: asset.decimals,
          issuerClassification: asset.issuerClassification,
          verificationStatus: asset.verificationStatus,
          minDeposit: asset.minDepositAtomic === null
            ? null
            : formatAssetUnits(BigInt(asset.minDepositAtomic.toString()), asset.decimals),
          confirmationCount: asset.confirmationCount,
          depositEnabled: (process.env.WALLET_GENERIC_DEPOSIT_SCANNER_ENABLED === "true"
            && process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY === "true"
            && network.isEnabled && network.depositEnabled && asset.depositEnabled
            && asset.verificationStatus === "VERIFIED" && Boolean(address))
            || legacyDepositEnabled,
          legacyDepositMode: legacyDepositEnabled,
          withdrawalEnabled: process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED === "true"
            && process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY === "true"
            && network.isEnabled && network.withdrawalEnabled && asset.withdrawalEnabled && asset.verificationStatus === "VERIFIED" && Boolean(address),
          balance: formatAssetUnits(availableBalance + reservedBalance, asset.decimals),
          availableBalance: formatAssetUnits(availableBalance, asset.decimals),
          reservedBalance: formatAssetUnits(reservedBalance, asset.decimals),
        };
      });

      return {
        id: network.id,
        family: network.family,
        chainId: network.chainId,
        networkKey: network.networkKey,
        displayName: network.displayName,
        nativeAssetSymbol: network.nativeAssetSymbol,
        nativeAssetDecimals: network.nativeAssetDecimals,
        explorerTransactionUrlTemplate: network.explorerTransactionUrlTemplate,
        finalityDepth: network.finalityDepth,
        adapterReady: network.family === "EVM" && network.chainId !== null && isSupportedEvmChainId(network.chainId),
        withdrawalAdapterReady: network.family === "EVM" && network.chainId !== null && isEvmWithdrawalFeeModelSupported(network.chainId),
        isEnabled: network.isEnabled || (network.chainId === 137 && legacyPolygonDepositReady && Boolean(address)),
        legacyDepositMode: network.chainId === 137 && legacyPolygonDepositReady && Boolean(address),
        depositEnabled: (process.env.WALLET_GENERIC_DEPOSIT_SCANNER_ENABLED === "true"
          && process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY === "true"
          && network.isEnabled && network.depositEnabled && Boolean(address))
          || (network.chainId === 137 && legacyPolygonDepositReady && Boolean(address)),
        withdrawalEnabled: process.env.WALLET_GENERIC_WITHDRAWALS_ENABLED === "true"
          && process.env.WALLET_GENERIC_WITHDRAWALS_PRODUCTION_READY === "true"
          && network.isEnabled && network.withdrawalEnabled && Boolean(address),
        address: address?.address ?? null,
        assets,
      };
    });

    return {
      currency: "USDT",
      simulatedOnly: false,
      turnkeyConfigured: isTurnkeyConfigured(),
      walletProvisioningReviewRequired,
      walletAddress: turnkeyWallet?.address ?? null,
      supportedNetworks: (turnkeyWallet?.networkAccounts ?? []).map((item) => ({
        chainId: item.chainId,
        networkKey: item.networkKey,
        depositEnabled: item.depositEnabled,
        withdrawalEnabled: item.withdrawalEnabled,
      })),
      // Legacy rows remain visible and are deliberately not added to the
      // on-chain multi-asset balances above.
      balance: formatMicro(legacyBalances.balance),
      availableBalance: formatMicro(legacyBalances.availableBalance),
      legacyBalance: formatMicro(legacyBalances.balance),
      legacyAvailableBalance: formatMicro(legacyBalances.availableBalance),
      networks: networkViews,
      onChainDeposits: [
        ...legacyDeposits.map((deposit) => {
          const network = networkViews.find((item) => item.chainId === deposit.chainId);
          const amountAtomic = deposit.amountMicro === null
            ? BigInt(deposit.rawAmount)
            : BigInt(deposit.amountMicro.toString());
          return {
            id: deposit.id,
            type: "DEPOSIT",
            networkId: network?.id ?? "eip155:" + deposit.chainId,
            network: network?.displayName ?? "Legacy EVM network",
            asset: deposit.asset.symbol,
            amount: formatAssetUnits(amountAtomic, deposit.asset.decimals),
            status: deposit.status,
            transactionHash: deposit.transactionHash,
            explorerUrl: network?.explorerTransactionUrlTemplate?.replace("{txHash}", deposit.transactionHash) ?? null,
            confirmationCount: deposit.confirmationCount,
            detectedAt: deposit.detectedAt,
            creditedAt: deposit.creditedAt,
            reviewReason: null,
            legacy: true,
          };
        }),
        ...chainDeposits.map((deposit: any) => ({
        id: deposit.id,
        type: "DEPOSIT",
        networkId: deposit.networkId,
        network: deposit.network.displayName,
        asset: deposit.asset.symbol,
        amount: formatAssetUnits(BigInt(deposit.amountAtomic.toString()), deposit.asset.decimals),
        status: deposit.status,
        transactionHash: deposit.transactionReference,
        explorerUrl: deposit.network.explorerTransactionUrlTemplate?.replace("{txHash}", deposit.transactionReference) ?? null,
        confirmationCount: deposit.confirmationCount,
        detectedAt: deposit.detectedAt,
        creditedAt: deposit.creditedAt,
        reviewReason: deposit.reviewReason,
        legacy: false,
      })),
      ],
      onChainWithdrawals: [
        ...legacyWithdrawals.map((withdrawal) => {
          const network = networkViews.find((item) => item.chainId === withdrawal.chainId);
          return {
            id: withdrawal.id,
            type: "WITHDRAWAL",
            networkId: network?.id ?? "eip155:" + withdrawal.chainId,
            network: network?.displayName ?? "Legacy EVM network",
            asset: withdrawal.asset.symbol,
            amount: formatAssetUnits(BigInt(withdrawal.amountMicro.toString()), withdrawal.asset.decimals),
            estimatedFee: formatAssetUnits(BigInt(withdrawal.feeMicro.toString()), withdrawal.asset.decimals),
            actualFee: null,
            feeAsset: withdrawal.asset.symbol,
            status: withdrawal.status,
            transactionHash: withdrawal.transactionHash,
            explorerUrl: network?.explorerTransactionUrlTemplate?.replace("{txHash}", withdrawal.transactionHash ?? "") ?? null,
            confirmationCount: 0,
            requestedAt: withdrawal.requestedAt,
            confirmedAt: withdrawal.confirmedAt,
            failureCode: withdrawal.failureCode,
            legacy: true,
          };
        }),
        ...chainWithdrawals.map((withdrawal: any) => ({
        id: withdrawal.id,
        type: "WITHDRAWAL",
        networkId: withdrawal.networkId,
        network: withdrawal.network.displayName,
        asset: withdrawal.asset.symbol,
        amount: formatAssetUnits(BigInt(withdrawal.amountAtomic.toString()), withdrawal.asset.decimals),
        estimatedFee: withdrawal.feeAtomic && withdrawal.feeAsset
          ? formatAssetUnits(BigInt(withdrawal.feeAtomic.toString()), withdrawal.feeAsset.decimals)
          : null,
        actualFee: withdrawal.actualFeeAtomic && withdrawal.feeAsset
          ? formatAssetUnits(BigInt(withdrawal.actualFeeAtomic.toString()), withdrawal.feeAsset.decimals)
          : null,
        feeAsset: withdrawal.feeAsset?.symbol ?? null,
        status: withdrawal.status,
        transactionHash: withdrawal.transactionReference,
        explorerUrl: withdrawal.network.explorerTransactionUrlTemplate?.replace("{txHash}", withdrawal.transactionReference ?? "") ?? null,
        confirmationCount: withdrawal.confirmationCount,
        requestedAt: withdrawal.requestedAt,
        confirmedAt: withdrawal.confirmedAt,
        failureCode: withdrawal.failureCode,
        legacy: false,
      })),
      ],
      transactions: transactions.map(serializeTransaction),
    };
  });
}
export async function requestWalletDeposit(
  userId: string,
  rawNetworkId: unknown,
  rawWalletAssetId: unknown,
) {
  if (typeof rawNetworkId !== "string" || typeof rawWalletAssetId !== "string") {
    throw new Error("INVALID_WALLET_ASSET_SELECTION");
  }

  const networkId = rawNetworkId.trim();
  const walletAssetId = rawWalletAssetId.trim();
  if (!networkId || !walletAssetId || networkId.length > 128 || walletAssetId.length > 256) {
    throw new Error("INVALID_WALLET_ASSET_SELECTION");
  }

  // Compatibility path: keep the already-active Polygon USDT0 deposit scanner
  // working until the generic engine has independently passed production gates.
  if (networkId === "eip155:137") {
    const [wallet, network, asset, legacyAsset] = await Promise.all([
      prisma.walletAccount.findUnique({
        where: { userId },
        include: {
          networkAccounts: {
            where: { chainId: 137, networkKey: "polygon" },
          },
        },
      }),
      prisma.walletNetwork.findUnique({ where: { id: networkId } }),
      prisma.walletAsset.findUnique({ where: { id: walletAssetId } }),
      prisma.chainAsset.findFirst({
        where: {
          chainId: 137,
          symbol: "USDT0",
          contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
          decimals: 6,
          canonicalStatus: "ONCHAIN_VERIFIED",
          depositEnabled: true,
        },
      }),
    ]);

    if (
      !network || network.chainId !== 137 || !asset || asset.networkId !== networkId ||
      asset.symbol !== "USDT0" || asset.decimals !== 6 ||
      asset.verificationStatus !== "VERIFIED" ||
      asset.contractAddress?.toLowerCase() !== "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" ||
      !legacyAsset
    ) {
      throw new Error("WALLET_ASSET_NOT_AVAILABLE");
    }

    {
      if (
        process.env.POLYGON_DEPOSIT_SCANNER_ENABLED !== "true" ||
        process.env.POLYGON_DEPOSITS_ENABLED !== "true" ||
        !wallet || wallet.status !== "ACTIVE" ||
        !wallet.turnkeyOrganizationId || !wallet.turnkeyWalletId ||
        wallet.networkAccounts.length !== 1 ||
        wallet.networkAccounts[0]?.depositEnabled !== true
      ) {
        throw new Error("DEPOSITS_DISABLED");
      }

      const address = wallet.address;
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw new Error("WALLET_ADDRESS_NOT_READY");
      }

      return {
        networkId,
        network: network.displayName,
        family: "EVM" as const,
        chainId: 137,
        assetId: asset.id,
        asset: "USDT0",
        displayName: "USDT0 on Polygon PoS",
        assetType: "TOKEN" as const,
        contractAddress: legacyAsset.contractAddress,
        decimals: 6,
        depositAddress: address,
        minDeposit: null,
        confirmationsRequired: Math.max(
          32,
          Number.parseInt(process.env.POLYGON_USDT_CONFIRMATIONS ?? "128", 10) || 128,
        ),
        status: "AWAITING_TRANSFER",
        legacyDepositMode: true,
        message: "Send only Polygon USDT0 to this address. The existing Polygon deposit scanner verifies and credits confirmed transfers.",
      };
    }
  }

  if (process.env.WALLET_GENERIC_DEPOSIT_SCANNER_ENABLED !== "true" ||
      process.env.WALLET_GENERIC_DEPOSITS_PRODUCTION_READY !== "true") {
    throw new Error("DEPOSITS_NOT_PRODUCTION_READY");
  }
  if (!isTurnkeyConfigured()) throw new Error("TURNKEY_NOT_CONFIGURED");

  const wallet = await provisionTurnkeyWallet(userId);
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.turnkeyOrganizationId || !wallet.turnkeyWalletId) {
    throw new Error("WALLET_NOT_ACTIVE");
  }

  const [network, asset, address] = await Promise.all([
    prisma.walletNetwork.findUnique({ where: { id: networkId } }),
    prisma.walletAsset.findUnique({ where: { id: walletAssetId } }),
    prisma.walletAddress.findUnique({
      where: { walletAccountId_networkId: { walletAccountId: wallet.id, networkId } },
    }),
  ]);
  if (!network || !asset || asset.networkId !== networkId || !address || address.status !== "ACTIVE") {
    throw new Error("WALLET_ASSET_NOT_AVAILABLE");
  }

  if (
    !network.isEnabled ||
    !network.depositEnabled ||
    !asset.depositEnabled ||
    asset.verificationStatus !== "VERIFIED"
  ) {
    throw new Error("DEPOSITS_DISABLED");
  }

  return {
    networkId: network.id,
    network: network.displayName,
    family: network.family,
    chainId: network.chainId,
    assetId: asset.id,
    asset: asset.symbol,
    displayName: asset.displayName,
    assetType: asset.assetType,
    contractAddress: asset.contractAddress,
    decimals: asset.decimals,
    depositAddress: address.address,
    minDeposit: asset.minDepositAtomic === null
      ? null
      : formatAssetUnits(BigInt(asset.minDepositAtomic.toString()), asset.decimals),
    confirmationsRequired: asset.confirmationCount,
    status: "AWAITING_TRANSFER",
    legacyDepositMode: false,
    message: "Send only the selected asset on the selected network to this address. The balance is credited after canonical finality checks.",
  };
}
export async function requestWalletWithdrawal(userId: string, rawAmount: unknown, rawDestination: unknown) {
  if (typeof rawAmount !== "string") throw new Error("INVALID_WALLET_AMOUNT");
  let amountMicro: bigint;
  try {
    amountMicro = parseAssetUnits(rawAmount, 6);
  } catch {
    throw new Error("INVALID_WALLET_AMOUNT");
  }
  if (amountMicro <= 0n) throw new Error("INVALID_WALLET_AMOUNT");
  if (typeof rawDestination !== "string" || !isAddress(rawDestination.trim())) throw new Error("INVALID_DESTINATION_ADDRESS");

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.walletAccount.findUnique({
      where: { userId },
      include: { networkAccounts: true },
    });
    if (!wallet || wallet.status !== "ACTIVE") throw new Error("WALLET_NOT_ACTIVE");
    const network = wallet.networkAccounts.find((item) => item.chainId === 137 && item.networkKey === "polygon");
    if (!network || !network.withdrawalEnabled) throw new Error("WITHDRAWALS_DISABLED");

    const asset = await tx.chainAsset.findFirst({
      where: {
        chainId: 137,
        symbol: "USDT0",
        canonicalStatus: "ONCHAIN_VERIFIED",
        withdrawalEnabled: true,
        decimals: 6,
      },
    });
    if (!asset) throw new Error("WITHDRAWALS_DISABLED");

    const balances = await calculateBalances(tx, userId);
    if (balances.availableBalance < amountMicro) throw new Error("INSUFFICIENT_WALLET_BALANCE");

    const idempotencyKey = randomUUID();
    const withdrawal = await tx.walletWithdrawal.create({
      data: {
        userId,
        walletAccountId: wallet.id,
        walletNetworkAccountId: network.id,
        chainAssetId: asset.id,
        chainId: 137,
        destinationAddress: rawDestination.trim().toLowerCase(),
        amountMicro,
        status: "REQUESTED",
        idempotencyKey,
      },
    });
    await tx.walletTransaction.create({
      data: {
        userId,
        type: "WITHDRAWAL_REQUEST",
        status: "PENDING",
        amountMicro,
        currency: "USDT",
        note: "Polygon USDT0 withdrawal request reserved pending admin review",
        referenceKey: `withdrawal-request:${withdrawal.id}`,
      },
    });
    return {
      id: withdrawal.id,
      status: withdrawal.status,
      network: "Polygon PoS",
      asset: "USDT0",
      destinationAddress: withdrawal.destinationAddress,
      amount: formatMicro(amountMicro),
      requestedAt: withdrawal.requestedAt,
    };
  }, { isolationLevel: "Serializable" });
}


const polygonUsdt0Abi = parseAbi(["function transfer(address to, uint256 value) returns (bool)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);
const polygonUsdt0Contract = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" as const;
const polygonWithdrawalConfirmations = Math.max(32, Number.parseInt(process.env.POLYGON_WITHDRAWAL_CONFIRMATIONS ?? "128", 10) || 128);

function polygonRpcClient() {
  const rpc = process.env.POLYGON_RPC_URL?.trim();
  if (!rpc) throw new Error("POLYGON_RPC_NOT_CONFIGURED");
  return createPublicClient({ chain: polygon, transport: http(rpc, { timeout: 20_000, retryCount: 2 }) });
}

export async function executeApprovedWalletWithdrawal(withdrawalId: string, adminUserId: string) {
  if (process.env.POLYGON_WITHDRAWALS_EXECUTION_ENABLED !== "true") throw new Error("REAL_WITHDRAWAL_EXECUTION_DISABLED");
  if (!withdrawalId || withdrawalId.length > 128) throw new Error("WITHDRAWAL_NOT_FOUND");
  const withdrawal = await prisma.walletWithdrawal.findUnique({
    where: { id: withdrawalId },
    include: { walletAccount: true, networkAccount: true, asset: true },
  });
  if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
  if (withdrawal.status !== "APPROVED") throw new Error("WITHDRAWAL_NOT_APPROVED");
  if (withdrawal.chainId !== 137 || withdrawal.asset.symbol !== "USDT0" ||
      withdrawal.asset.contractAddress.toLowerCase() !== polygonUsdt0Contract.toLowerCase() ||
      withdrawal.asset.decimals !== 6 || withdrawal.asset.canonicalStatus !== "ONCHAIN_VERIFIED" ||
      !withdrawal.asset.withdrawalEnabled || !withdrawal.networkAccount.withdrawalEnabled) {
    throw new Error("WITHDRAWALS_DISABLED");
  }
  if (withdrawal.walletAccount.status !== "ACTIVE") throw new Error("WALLET_NOT_ACTIVE");
  const claimed = await prisma.walletWithdrawal.updateMany({
    where: { id: withdrawal.id, status: "APPROVED" },
    data: { status: "SIGNING" },
  });
  if (claimed.count !== 1) throw new Error("WITHDRAWAL_ALREADY_PROCESSING");

  // A SIGNING record is never automatically retried after the broadcast attempt.
  let broadcastAttempted = false;
  try {
    const client = polygonRpcClient();
    const amount = BigInt(withdrawal.amountMicro);
    const accountAddress = withdrawal.walletAccount.address as `0x${string}`;
    const tokenBalance = await client.readContract({
      address: polygonUsdt0Contract, abi: polygonUsdt0Abi,
      functionName: "balanceOf", args: [accountAddress],
    });
    if (tokenBalance < amount) throw new Error("INSUFFICIENT_ONCHAIN_USDT0");
    const gas = await client.estimateContractGas({
      account: accountAddress, address: polygonUsdt0Contract, abi: polygonUsdt0Abi,
      functionName: "transfer", args: [withdrawal.destinationAddress as `0x${string}`, amount],
    });
    const gasPrice = await client.getGasPrice();
    const estimatedGasCost = gas * gasPrice;
    const nativeBalance = await client.getBalance({ address: accountAddress });
    if (nativeBalance < estimatedGasCost) throw new Error("INSUFFICIENT_POLYGON_POL_FOR_GAS");

    const signer = await createTurnkeySigner(withdrawal.walletAccount.address, 137);
    broadcastAttempted = true;
    const hash = await signer.writeContract({
      account: signer.account!, chain: polygon, address: polygonUsdt0Contract,
      abi: polygonUsdt0Abi, functionName: "transfer",
      args: [withdrawal.destinationAddress as `0x${string}`, amount], gas, gasPrice,
    });
    await prisma.$transaction(async (tx) => {
      const changed = await tx.walletWithdrawal.updateMany({
        where: { id: withdrawal.id, status: "SIGNING" },
        data: { status: "BROADCAST", transactionHash: hash, broadcastAt: new Date() },
      });
      if (changed.count !== 1) throw new Error("WITHDRAWAL_STATE_CHANGED_AFTER_BROADCAST");
      await tx.auditLog.create({
        data: {
          userId: adminUserId, action: "WALLET_WITHDRAWAL_BROADCAST",
          entity: "WalletWithdrawal", entityId: withdrawal.id,
          metadata: {
            chainId: 137, asset: "USDT0", transactionHash: hash,
            destinationAddress: withdrawal.destinationAddress,
            amountMicro: amount.toString(), estimatedGas: gas.toString(),
            gasPriceWei: gasPrice.toString(), estimatedGasCostWei: estimatedGasCost.toString(),
          },
        },
      });
    });
    return { id: withdrawal.id, status: "BROADCAST", transactionHash: hash, chainId: 137,
      asset: "USDT0", amount: formatMicro(amount), estimatedGasCostPOLWei: estimatedGasCost.toString() };
  } catch (error) {
    if (!broadcastAttempted) {
      await prisma.walletWithdrawal.updateMany({ where: { id: withdrawal.id, status: "SIGNING" }, data: { status: "APPROVED" } }).catch(() => undefined);
    } else {
      console.error("Withdrawal remains SIGNING and requires manual review; automatic retry is disabled", { withdrawalId, error });
    }
    throw error;
  }
}

export async function reconcileBroadcastWalletWithdrawal(withdrawalId: string, adminUserId: string) {
  const withdrawal = await prisma.walletWithdrawal.findUnique({ where: { id: withdrawalId }, include: { walletAccount: true } });
  if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
  if (withdrawal.status !== "BROADCAST" || !withdrawal.transactionHash) throw new Error("WITHDRAWAL_NOT_BROADCAST");
  const client = polygonRpcClient();
  const receipt = await client.getTransactionReceipt({ hash: withdrawal.transactionHash as `0x${string}` });
  const latestBlock = await client.getBlockNumber();
  const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error("WITHDRAWAL_RECEIPT_NOT_CANONICAL");
  const confirmations = Number(latestBlock - receipt.blockNumber + 1n);
  if (confirmations < polygonWithdrawalConfirmations) {
    return { id: withdrawal.id, status: "BROADCAST", transactionHash: withdrawal.transactionHash, confirmations, confirmationsRequired: polygonWithdrawalConfirmations };
  }
  if (receipt.status === "success") {
    const transferEvents = parseEventLogs({ abi: polygonUsdt0Abi, logs: receipt.logs, eventName: "Transfer", strict: false });
    const expectedAmount = BigInt(withdrawal.amountMicro);
    const verifiedTransfer = transferEvents.some((event) =>
      event.args.from?.toLowerCase() === withdrawal.walletAccount.address.toLowerCase() &&
      event.args.to?.toLowerCase() === withdrawal.destinationAddress.toLowerCase() &&
      event.args.value === expectedAmount
    );
    if (!verifiedTransfer) throw new Error("WITHDRAWAL_TRANSFER_EVENT_MISSING");
  }
  if (receipt.status !== "success") {
    await prisma.$transaction(async (tx) => {
      await tx.walletWithdrawal.updateMany({
        where: { id: withdrawal.id, status: "BROADCAST" },
        data: { status: "FAILED", failureCode: "ONCHAIN_TRANSACTION_REVERTED" },
      });
      await tx.walletTransaction.updateMany({
        where: { userId: withdrawal.userId, referenceKey: "withdrawal-request:" + withdrawal.id, status: "PENDING" },
        data: { status: "CANCELLED", note: "Withdrawal transaction reverted on Polygon; reserved USDT0 balance released" },
      });
      await tx.auditLog.create({
        data: { userId: adminUserId, action: "WALLET_WITHDRAWAL_REVERTED", entity: "WalletWithdrawal", entityId: withdrawal.id, metadata: { transactionHash: withdrawal.transactionHash, confirmations } },
      });
    });
    return { id: withdrawal.id, status: "FAILED", transactionHash: withdrawal.transactionHash, confirmations };
  }
  await prisma.$transaction(async (tx) => {
    const changed = await tx.walletWithdrawal.updateMany({
      where: { id: withdrawal.id, status: "BROADCAST", transactionHash: withdrawal.transactionHash },
      data: { status: "CONFIRMED", confirmedAt: new Date(), failureCode: null },
    });
    if (changed.count !== 1) throw new Error("WITHDRAWAL_STATE_CHANGED");
    await tx.walletTransaction.updateMany({
      where: { userId: withdrawal.userId, referenceKey: "withdrawal-request:" + withdrawal.id, status: "PENDING" },
      data: { status: "CANCELLED", note: "Withdrawal reservation settled on canonical Polygon confirmation" },
    });
    await tx.walletTransaction.create({
      data: {
        userId: withdrawal.userId, type: "WITHDRAWAL", status: "COMPLETED",
        amountMicro: withdrawal.amountMicro, currency: "USDT",
        note: "Confirmed Polygon USDT0 withdrawal",
        referenceKey: "withdrawal-completed:" + withdrawal.id,
      },
    });
    await tx.auditLog.create({
      data: { userId: adminUserId, action: "WALLET_WITHDRAWAL_CONFIRMED", entity: "WalletWithdrawal", entityId: withdrawal.id, metadata: { transactionHash: withdrawal.transactionHash, confirmations, receiptBlock: receipt.blockNumber.toString() } },
    });
  });
  return { id: withdrawal.id, status: "CONFIRMED", transactionHash: withdrawal.transactionHash, confirmations };
}

export async function getAdminWithdrawalRequests() {
  const rows = await prisma.walletWithdrawal.findMany({
    where: { status: { in: ["REQUESTED", "APPROVED", "SIGNING", "BROADCAST", "CONFIRMED", "FAILED"] } },
    orderBy: { requestedAt: "asc" },
    take: 200,
    include: { user: { select: { username: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    email: row.user.email,
    network: "Polygon PoS",
    asset: "USDT0",
    destinationAddress: row.destinationAddress,
    amount: formatMicro(BigInt(row.amountMicro)),
    fee: formatMicro(BigInt(row.feeMicro)),
    status: row.status,
    requestedAt: row.requestedAt,
    transactionHash: row.transactionHash,
  }));
}

export async function reviewWalletWithdrawal(
  withdrawalId: string,
  decision: "APPROVE" | "REJECT",
  adminUserId: string,
  reason?: string,
) {
  if (!withdrawalId || withdrawalId.length > 128) throw new Error("WITHDRAWAL_NOT_FOUND");
  const normalizedReason = reason?.trim().slice(0, 500) || null;
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.walletWithdrawal.findUnique({
      where: { id: withdrawalId },
      select: { id: true, userId: true, amountMicro: true, status: true },
    });
    if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
    if (withdrawal.status !== "REQUESTED") throw new Error("WITHDRAWAL_ALREADY_REVIEWED");

    const nextStatus = decision === "APPROVE" ? "APPROVED" : "CANCELLED";
    const changed = await tx.walletWithdrawal.updateMany({
      where: { id: withdrawalId, status: "REQUESTED" },
      data: { status: nextStatus },
    });
    if (changed.count !== 1) throw new Error("WITHDRAWAL_ALREADY_REVIEWED");

    if (decision === "REJECT") {
      await tx.walletTransaction.updateMany({
        where: {
          userId: withdrawal.userId,
          referenceKey: `withdrawal-request:${withdrawal.id}`,
          type: "WITHDRAWAL_REQUEST",
          status: "PENDING",
        },
        data: { status: "CANCELLED", note: normalizedReason ? `Withdrawal request rejected: ${normalizedReason}` : "Withdrawal request rejected by admin" },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: decision === "APPROVE" ? "WALLET_WITHDRAWAL_APPROVED" : "WALLET_WITHDRAWAL_REJECTED",
        entity: "WalletWithdrawal",
        entityId: withdrawal.id,
        metadata: {
          userId: withdrawal.userId,
          amountMicro: withdrawal.amountMicro.toString(),
          reason: normalizedReason,
        },
      },
    });
    return { id: withdrawal.id, status: nextStatus };
  }, { isolationLevel: "Serializable" });
}

export async function getAdminWallets() {
  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, email: true,
      walletTransactions: { select: { type: true, status: true, amountMicro: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return users.map((user) => {
    let balance = 0n, pendingWithdrawals = 0n, pendingDeposits = 0;
    for (const row of user.walletTransactions) {
      const amount = BigInt(row.amountMicro);
      if (row.status === "COMPLETED") {
        if (row.type === "DEPOSIT") balance += amount;
        if (row.type === "WITHDRAWAL") balance -= amount;
      }
      if (row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING") pendingWithdrawals += amount;
      if (row.type === "DEPOSIT_REQUEST" && row.status === "PENDING") pendingDeposits++;
    }
    return {
      userId: user.id, username: user.username, email: user.email,
      balance: formatMicro(balance), availableBalance: formatMicro(balance - pendingWithdrawals),
      pendingDepositRequests: pendingDeposits,
      pendingWithdrawalRequests: user.walletTransactions.filter((row) => row.type === "WITHDRAWAL_REQUEST" && row.status === "PENDING").length,
    };
  });
}


const TREASURY_ID = "polygon-prize-treasury";
const USDT0_ADDRESS = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" as const;
const USDT0_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

async function readTreasuryChainSnapshot(address: string) {
  const rpc = process.env.POLYGON_RPC_URL?.trim();
  if (!rpc) throw new Error("TREASURY_RPC_NOT_CONFIGURED");
  if (!isAddress(address)) throw new Error("TREASURY_ADDRESS_INVALID");

  const client = createPublicClient({
    chain: polygon,
    transport: http(rpc, { timeout: 20_000, retryCount: 2 }),
  });

  // Public Polygon RPC nodes can briefly disagree about the newest block header.
  // Read from a slightly confirmed head first, then move farther back only when
  // the provider reports that a requested header is not available.
  const latestBlock = await client.getBlockNumber();
  const safeOffsets = [12n, 24n, 48n, 96n];
  let lastError: unknown;

  for (const offset of safeOffsets) {
    if (latestBlock <= offset) continue;
    const blockNumber = latestBlock - offset;
    try {
      const block = await client.getBlock({ blockNumber });
      if (!block.hash) throw new Error("TREASURY_BLOCK_HASH_UNAVAILABLE");

      const balance = await client.readContract({
        address: USDT0_ADDRESS,
        abi: USDT0_ABI,
        functionName: "balanceOf",
        args: [address],
        blockNumber,
      });

      return { blockNumber, blockHash: block.hash, balanceMicro: BigInt(balance) };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const headerUnavailable = /header not found|block not found|unknown block|cannot query unfinalized data/i.test(message);
      if (!headerUnavailable) throw error;
    }
  }

  console.error("Treasury Polygon snapshot could not find a readable confirmed block", {
    latestBlock: latestBlock.toString(),
    offsets: safeOffsets.map(String),
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new Error("TREASURY_RPC_CONFIRMED_BLOCK_UNAVAILABLE");
}


export async function reconcileTreasuryAccounting(adminUserId: string) {
  const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID } });
  if (!treasury || treasury.status !== "ACTIVE" || !treasury.address) throw new Error("TREASURY_NOT_READY");

  const [chain, ledger] = await Promise.all([
    readTreasuryChainSnapshot(treasury.address),
    prisma.treasuryLedger.aggregate({
      where: { treasuryWalletId: treasury.id, currency: "USDT0" },
      _sum: { amountMicro: true },
    }),
  ]);
  const ledgerBalanceMicro = BigInt(ledger._sum.amountMicro ?? 0n);
  const differenceMicro = chain.balanceMicro - ledgerBalanceMicro;
  const status = differenceMicro === 0n ? "MATCH" : "MISMATCH";

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.treasuryReconciliation.create({
      data: {
        treasuryWalletId: treasury.id,
        chainId: 137,
        asset: "USDT0",
        blockNumber: chain.blockNumber,
        blockHash: chain.blockHash,
        onChainBalanceMicro: chain.balanceMicro,
        ledgerBalanceMicro,
        differenceMicro,
        status,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "TREASURY_ACCOUNTING_RECONCILIATION",
        entity: "TreasuryReconciliation",
        entityId: created.id,
        metadata: {
          chainId: 137,
          asset: "USDT0",
          blockNumber: chain.blockNumber.toString(),
          blockHash: chain.blockHash,
          onChainBalanceMicro: chain.balanceMicro.toString(),
          ledgerBalanceMicro: ledgerBalanceMicro.toString(),
          differenceMicro: differenceMicro.toString(),
          status,
        },
      },
    });
    return created;
  });

  return {
    id: record.id,
    treasuryAddress: treasury.address,
    chainId: 137,
    asset: "USDT0",
    blockNumber: chain.blockNumber.toString(),
    blockHash: chain.blockHash,
    onChainBalance: formatMicro(chain.balanceMicro),
    ledgerBalance: formatMicro(ledgerBalanceMicro),
    difference: formatMicro(differenceMicro),
    status,
    checkedAt: record.createdAt,
    note: status === "MATCH"
      ? "On-chain balance matches the treasury ledger at the recorded Polygon block."
      : "Balance mismatch detected. Prize-fund allocation is blocked until the difference is investigated and an authorized ledger correction is recorded.",
  };
}

export async function getLatestTreasuryAccountingReconciliation() {
  const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID } });
  if (!treasury) throw new Error("TREASURY_NOT_READY");
  const record = await prisma.treasuryReconciliation.findFirst({
    where: { treasuryWalletId: treasury.id },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return null;
  return {
    id: record.id,
    treasuryAddress: treasury.address,
    chainId: record.chainId,
    asset: record.asset,
    blockNumber: record.blockNumber.toString(),
    blockHash: record.blockHash,
    onChainBalance: formatMicro(BigInt(record.onChainBalanceMicro)),
    ledgerBalance: formatMicro(BigInt(record.ledgerBalanceMicro)),
    difference: formatMicro(BigInt(record.differenceMicro)),
    status: record.status,
    checkedAt: record.createdAt,
  };
}

export async function getTreasuryPrizeFundingSnapshot() {
  const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID } });
  if (!treasury || treasury.status !== "ACTIVE" || !treasury.address) throw new Error("TREASURY_NOT_READY");
  const [chain, fund, fundingRows, treasuryLedgerRows] = await Promise.all([
    readTreasuryChainSnapshot(treasury.address),
    prisma.globalPrizeFund.findUnique({ where: { id: "global" } }),
    prisma.globalPrizeLedger.aggregate({ where: { type: "TREASURY_FUNDING" }, _sum: { amountMicro: true } }),
    prisma.treasuryLedger.aggregate({
      where: { treasuryWalletId: treasury.id, currency: "USDT0" },
      _sum: { amountMicro: true },
    }),
  ]);
  const reserved = BigInt(fundingRows._sum.amountMicro ?? 0n);
  const ledgerBalance = BigInt(treasuryLedgerRows._sum.amountMicro ?? 0n);
  const difference = chain.balanceMicro - ledgerBalance;
  return {
    treasuryAddress: treasury.address,
    chainId: 137,
    asset: "USDT0",
    snapshotBlockNumber: chain.blockNumber.toString(),
    snapshotBlockHash: chain.blockHash,
    onChainBalance: formatMicro(chain.balanceMicro),
    treasuryLedgerBalance: formatMicro(ledgerBalance),
    accountingDifference: formatMicro(difference),
    accountingStatus: difference === 0n ? "MATCH" : "MISMATCH",
    allocatedToPrizeFund: formatMicro(reserved),
    unallocatedTreasuryBalance: formatMicro(chain.balanceMicro > reserved ? chain.balanceMicro - reserved : 0n),
    prizeFundBalance: formatMicro(BigInt(fund?.balanceMicro ?? 0n)),
    updatedAt: new Date().toISOString(),
  };
}

export async function getAdminTreasuryDeposits() {
  const treasury = await prisma.treasuryWallet.findUnique({ where: { id: TREASURY_ID }, select: { id: true, address: true, status: true, chainId: true } });
  if (!treasury || treasury.status !== "ACTIVE" || !treasury.address) throw new Error("TREASURY_NOT_READY");
  const rows = await prisma.treasuryDeposit.findMany({
    where: { treasuryWalletId: treasury.id },
    orderBy: [{ detectedAt: "desc" }, { blockNumber: "desc" }],
    take: 100,
    select: {
      id: true, transactionHash: true, logIndex: true, blockNumber: true,
      fromAddress: true, toAddress: true, amountMicro: true, status: true,
      confirmationCount: true, detectedAt: true, confirmedAt: true, creditedAt: true,
    },
  });
  return {
    treasuryAddress: treasury.address,
    chainId: treasury.chainId,
    deposits: rows.map((row) => ({
      id: row.id,
      transactionHash: row.transactionHash,
      logIndex: row.logIndex,
      blockNumber: row.blockNumber.toString(),
      fromAddress: row.fromAddress,
      toAddress: row.toAddress,
      amount: row.amountMicro === null ? null : formatMicro(row.amountMicro),
      status: row.status,
      confirmationCount: row.confirmationCount,
      detectedAt: row.detectedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      creditedAt: row.creditedAt?.toISOString() ?? null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function getAdminTreasuryLedgerHistory() {
  const treasury = await prisma.treasuryWallet.findUnique({
    where: { id: TREASURY_ID },
    select: { id: true, address: true, status: true, chainId: true },
  });
  if (!treasury || treasury.status !== "ACTIVE" || !treasury.address) throw new Error("TREASURY_NOT_READY");
  const rows = await prisma.treasuryLedger.findMany({
    where: { treasuryWalletId: treasury.id, currency: "USDT0" },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true, type: true, amountMicro: true, transactionHash: true,
      referenceKey: true, note: true, effectiveAt: true, createdAt: true,
    },
  });
  return {
    treasuryAddress: treasury.address,
    chainId: treasury.chainId,
    transactions: rows.map((row) => ({
      id: row.id, type: row.type, amount: formatMicro(row.amountMicro),
      transactionHash: row.transactionHash, referenceKey: row.referenceKey,
      note: row.note, effectiveAt: row.effectiveAt.toISOString(), createdAt: row.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function allocateTreasuryToPrizeFund(rawAmount: unknown, adminUserId: string) {
  if (typeof rawAmount !== "string") throw new Error("INVALID_ALLOCATION_AMOUNT");
  let amount: bigint;
  try {
    amount = parseAssetUnits(rawAmount, 6);
  } catch {
    throw new Error("INVALID_ALLOCATION_AMOUNT");
  }
  if (amount <= 0n) throw new Error("INVALID_ALLOCATION_AMOUNT");
  const snapshot = await getTreasuryPrizeFundingSnapshot();
  if (snapshot.accountingStatus !== "MATCH") throw new Error("TREASURY_ACCOUNTING_MISMATCH");
  const liveBalance = parseAssetUnits(snapshot.onChainBalance, 6);
  if (amount > liveBalance) throw new Error("INSUFFICIENT_TREASURY_BALANCE");
  return prisma.$transaction(async (tx) => {
    await tx.globalPrizeFund.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
    const prior = await tx.globalPrizeLedger.aggregate({ where: { type: "TREASURY_FUNDING" }, _sum: { amountMicro: true } });
    const alreadyReserved = BigInt(prior._sum.amountMicro ?? 0n);
    if (alreadyReserved + amount > liveBalance) throw new Error("INSUFFICIENT_UNALLOCATED_TREASURY_BALANCE");
    const referenceKey = "treasury-prize-funding:" + randomUUID();
    const fund = await tx.globalPrizeFund.update({ where: { id: "global" }, data: { balanceMicro: { increment: amount }, totalFundedMicro: { increment: amount } } });
    await tx.globalPrizeLedger.create({ data: { type: "TREASURY_FUNDING", amountMicro: amount, effectiveAt: new Date(), referenceKey, note: "Admin internal allocation from reconciled Polygon treasury; no on-chain transfer" } });
    await tx.auditLog.create({ data: { userId: adminUserId, action: "TREASURY_PRIZE_FUND_ALLOCATION", entity: "GlobalPrizeFund", entityId: "global", metadata: { amountMicro: amount.toString(), treasuryAddress: snapshot.treasuryAddress, reconciliationBlockNumber: snapshot.snapshotBlockNumber } } });
    return { amount: formatMicro(amount), treasuryAddress: snapshot.treasuryAddress, chainId: 137, asset: "USDT0", snapshotBlockNumber: snapshot.snapshotBlockNumber, snapshotBlockHash: snapshot.snapshotBlockHash, onChainBalance: snapshot.onChainBalance, treasuryLedgerBalance: snapshot.treasuryLedgerBalance, accountingDifference: snapshot.accountingDifference, accountingStatus: snapshot.accountingStatus, allocatedToPrizeFund: formatMicro(alreadyReserved + amount), unallocatedTreasuryBalance: formatMicro(liveBalance - alreadyReserved - amount), prizeFundBalance: formatMicro(BigInt(fund.balanceMicro)), updatedAt: new Date().toISOString() };
  }, { isolationLevel: "Serializable" });
}
