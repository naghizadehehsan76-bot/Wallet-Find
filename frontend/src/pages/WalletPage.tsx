import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";
import {
  getWallet,
  getTurnkeyWalletData,
  getMarketPrices,
  requestWalletDeposit,
  requestWalletWithdrawal,
  type WalletChainActivity,
  type WalletResult,
  type WalletWithdrawalRequestResult,
} from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type Page = "home" | "auth" | "competition" | "key" | "leaderboard" | "profile" | "wallet";
type Props = { onNavigate: (page: Page) => void };
type WalletView = "overview" | "deposit" | "withdraw";
type PlannedWalletAction = "transfer" | "convert" | "buy" | "sell" | "earn" | "addressBook" | "export";
type TurnkeySnapshot = { networkId: string; network: string; address: string; balances: unknown[]; transactions: unknown[]; fetchedAt: string; error?: string };
function recordOf(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function firstValue(record: Record<string, unknown>, keys: string[]): unknown { for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key]; return undefined; }
function turnkeyBalance(value: unknown) {
  const row = recordOf(value); const asset = recordOf(row.asset ?? row.token ?? row.currency);
  const symbol = firstValue(row, ["symbol", "assetSymbol", "tokenSymbol"]) ?? firstValue(asset, ["symbol", "name"]);
  const decimals = Number(firstValue(row, ["decimals", "tokenDecimals"]) ?? firstValue(asset, ["decimals"]) ?? 0);
  const raw = firstValue(row, ["formattedBalance", "displayBalance", "uiAmount", "amountFormatted", "balance", "amount", "quantity"]);
  let amount = raw === undefined ? "—" : String(raw);
  if (["amount", "quantity"].some((key) => row[key] === raw) && /^\d+$/.test(amount) && Number.isInteger(decimals) && decimals > 0) amount = formatAtomic(amount, decimals, "en-US");
  return { symbol: typeof symbol === "string" ? symbol : "Asset", amount, contract: String(firstValue(row, ["contractAddress", "tokenAddress", "address", "mint"]) ?? firstValue(asset, ["contractAddress", "address"]) ?? "") };
}
function turnkeyTransaction(value: unknown, index: number) {
  const row = recordOf(value); const asset = recordOf(row.asset ?? row.token);
  const timestamp = firstValue(row, ["timestamp", "timestampMs", "createdAt", "updatedAt", "blockTimestamp", "date"]);
  const date = typeof timestamp === "number" || (typeof timestamp === "string" && /^\d{13}$/.test(timestamp)) ? new Date(Number(timestamp)).toISOString() : typeof timestamp === "string" ? timestamp : "";
  return { id: String(firstValue(row, ["id", "transactionId", "hash", "txHash"]) ?? "turnkey-" + index), type: String(firstValue(row, ["type", "transactionType", "direction"]) ?? "TRANSACTION"), status: String(firstValue(row, ["status", "state"]) ?? "ON-CHAIN"), amount: String(firstValue(row, ["displayAmount", "formattedAmount", "amount", "value", "quantity"]) ?? "—"), symbol: String(firstValue(row, ["symbol", "assetSymbol", "tokenSymbol"]) ?? firstValue(asset, ["symbol", "name"]) ?? ""), date, hash: String(firstValue(row, ["hash", "transactionHash", "txHash"]) ?? "") };
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function formatAmount(value: string, decimals: number, locale: string, maxDecimals = 6): string {
  const [wholePart, fractionPart = ""] = value.split(".");
  const whole = (() => {
    try {
      return BigInt(wholePart || "0").toLocaleString(locale);
    } catch {
      return wholePart || "0";
    }
  })();
  const fraction = fractionPart
    .slice(0, Math.min(Math.max(0, decimals), maxDecimals))
    .replace(/0+$/, "");
  return fraction ? whole + "." + fraction : whole;
}

function formatAtomic(value: string, decimals: number, locale: string): string {
  try {
    const atomic = BigInt(value);
    const scale = 10n ** BigInt(decimals);
    const whole = (atomic / scale).toString();
    const fraction = (atomic % scale).toString().padStart(decimals, "0");
    return formatAmount(whole + "." + fraction, decimals, locale, 6);
  } catch {
    return "—";
  }
}

function errorMessage(error: unknown, copy: {
  error: string;
  depositDisabled: string;
  withdrawDisabled: string;
  scannerNotReady: string;
  insufficientPol: string;
  insufficientUsdt0: string;
  invalidDestination: string;
}) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("WALLET_NETWORK_SCANNER_NOT_READY")) return copy.scannerNotReady;
  if (message.includes("DEPOSITS_DISABLED") || message.includes("DEPOSITS_NOT_PRODUCTION_READY")) return copy.depositDisabled;
  if (message.includes("WITHDRAWALS_DISABLED") || message.includes("GENERIC_WITHDRAWALS_NOT_PRODUCTION_READY")) return copy.withdrawDisabled;
  if (message.includes("INSUFFICIENT_NATIVE_FEE_BALANCE")) return copy.insufficientPol;
  if (message.includes("INSUFFICIENT_WALLET_BALANCE")) return copy.insufficientUsdt0;
  if (message.includes("INVALID_DESTINATION_ADDRESS")) return copy.invalidDestination;
  return message || copy.error;
}

type ActivityRow = {
  id: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
  fee?: string | null;
  feeAsset?: string | null;
  explorerUrl?: string | null;
  note?: string | null;
};

export default function WalletPage({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const locale = fa ? "fa-IR" : "en-US";
  const [wallet, setWallet] = useState<WalletResult | null>(null);
  const [turnkeySnapshots, setTurnkeySnapshots] = useState<TurnkeySnapshot[]>([]);
  const [turnkeyLoading, setTurnkeyLoading] = useState(false);
  const [turnkeyUpdatedAt, setTurnkeyUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<WalletView>("overview");
  const [depositAssetId, setDepositAssetId] = useState("");
  const [depositNetworkId, setDepositNetworkId] = useState("");
  const [depositDetails, setDepositDetails] = useState<Awaited<ReturnType<typeof requestWalletDeposit>> | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const depositRequestSequence = useRef(0);
  const [depositError, setDepositError] = useState("");
  const [withdrawAssetId, setWithdrawAssetId] = useState("");
  const [withdrawNetworkId, setWithdrawNetworkId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawResult, setWithdrawResult] = useState<WalletWithdrawalRequestResult | null>(null);
  const [withdrawIdempotencyKey, setWithdrawIdempotencyKey] = useState(createIdempotencyKey);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [usdPrices, setUsdPrices] = useState<Record<string, number>>({});
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<number | null>(null);
  const [priceStatus, setPriceStatus] = useState<"loading" | "ready" | "error">("loading");
  const [balancesHidden, setBalancesHidden] = useState(false);
  const [activityFilter, setActivityFilter] = useState<"all" | "deposit" | "withdrawal">("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [plannedAction, setPlannedAction] = useState<PlannedWalletAction | null>(null);


  const copy = useMemo(() => ({
    title: fa ? "کیف پول من" : "My wallet",
    pageSubtitle: fa ? "دارایی‌ها، عملیات و فعالیت‌های کیف پولت را یک‌جا مدیریت کن." : "Manage your assets, wallet actions and activity in one place.",
    overviewTab: fa ? "نمای کلی" : "Overview",
    assetsTab: fa ? "دارایی‌ها" : "Assets",
    activityTab: fa ? "تاریخچه" : "Activity",
    hideBalances: fa ? "مخفی‌کردن موجودی" : "Hide balances",
    showBalances: fa ? "نمایش موجودی" : "Show balances",
    totalPortfolio: fa ? "ارزش کل دارایی‌های ثبت‌شده" : "Total estimated portfolio value",
    balancePrivacy: fa ? "موجودی‌ها برای حفظ حریم خصوصی مخفی شده‌اند." : "Balances are hidden for privacy.",
    quickActions: fa ? "دسترسی سریع" : "Quick actions",
    planned: fa ? "به‌زودی" : "Coming soon",
    plannedNote: fa ? "این گزینه فعلاً فقط در رابط کاربری نمایش داده می‌شود و هنوز به سرویس عملیاتی متصل نیست." : "This option is visible in the interface but is not connected to an operational service yet.",
    close: fa ? "بستن" : "Close",
    activitySearchPlaceholder: fa ? "جست‌وجو در نوع، دارایی یا وضعیت..." : "Search type, asset or status...",
    filterAll: fa ? "همه" : "All",
    filterDeposits: fa ? "واریزها" : "Deposits",
    filterWithdrawals: fa ? "برداشت‌ها" : "Withdrawals",
    noFilteredActivity: fa ? "تراکنشی با این فیلتر پیدا نشد." : "No transactions match this filter.",
    assetsCount: fa ? "دارایی‌های ثبت‌شده" : "Registered assets",
    networkData: fa ? "داده‌های شبکه" : "Network data",
    plannedActions: {
      transfer: { title: fa ? "انتقال داخلی" : "Internal transfer", description: fa ? "انتقال دارایی بین کاربران Wallet-Find یا بین حساب‌های داخلی؛ به طراحی دفترکل، کارمزد احتمالی و محدودیت‌های انتقال نیاز دارد." : "Move assets between Wallet-Find users or internal accounts. This needs ledger rules, any transfer fees and transfer limits." },
      convert: { title: fa ? "تبدیل ارز" : "Convert assets", description: fa ? "تبدیل یک دارایی به دارایی دیگر با نرخ لحظه‌ای، نرخ نهایی، کارمزد و ثبت دوطرفه در دفترکل هنوز پیاده‌سازی نشده است." : "Asset conversion with a live quote, final rate, fee and balanced ledger posting has not been implemented." },
      buy: { title: fa ? "خرید ارز دیجیتال" : "Buy crypto", description: fa ? "برای خرید به درگاه پرداخت یا ارائه‌دهندهٔ خرید، احراز پرداخت و ثبت سفارش نیاز داریم." : "Buying requires a payment gateway or on-ramp provider, payment verification and order settlement." },
      sell: { title: fa ? "فروش ارز دیجیتال" : "Sell crypto", description: fa ? "برای فروش به مسیر تسویهٔ بانکی/پرداخت، کنترل مقصد و مدیریت بازپرداخت نیاز داریم." : "Selling requires a payout provider, destination checks and refund handling." },
      earn: { title: fa ? "کسب سود / استیکینگ" : "Earn / staking", description: fa ? "محصول سوددهی، انتخاب پروتکل، ریسک‌ها، دورهٔ قفل، محاسبهٔ پاداش و برداشت هنوز تعریف و پیاده‌سازی نشده‌اند." : "An earn product, protocol selection, risk disclosure, lock-up rules, rewards accounting and withdrawals are not defined or implemented." },
      addressBook: { title: fa ? "دفترچهٔ آدرس‌ها" : "Address book", description: fa ? "ذخیره، برچسب‌گذاری، تأیید و حذف آدرس‌های مقصد هنوز در بک‌اند و پایگاه داده ساخته نشده است." : "Saving, labeling, verifying and deleting withdrawal addresses are not yet supported by the backend or database." },
      export: { title: fa ? "خروجی گزارش" : "Export report", description: fa ? "خروجی CSV/PDF با فیلتر تاریخ، نوع عملیات، کارمزد و شناسهٔ تراکنش هنوز ساخته نشده است." : "CSV/PDF export with date, action, fee and transaction filters has not been built yet." },
    },
    balance: fa ? "ارزش تخمینی دارایی‌های ثبت‌شده" : "Estimated portfolio value",
    balanceNote: fa ? "محاسبه بر اساس دفترکل داخلی Wallet-Find و قیمت بازار؛ با موجودی زنجیره‌ای Turnkey یکسان نیست." : "Calculated from Wallet-Find internal records and market prices; it may differ from Turnkey on-chain balances.",
    partialPriceNote: fa ? "قیمت بعضی دارایی‌ها موجود نیست؛ این عدد ممکن است کامل نباشد." : "Some asset prices are unavailable, so this estimate may be incomplete.",
    priceLoading: fa ? "در حال دریافت قیمت لحظه‌ای ارزها..." : "Loading live market prices...",
    priceUnavailable: fa ? "در حال حاضر دریافت قیمت بازار ممکن نیست؛ موجودی دلاری موقتاً نمایش داده نمی‌شود." : "Market prices are temporarily unavailable; the USD total cannot be displayed.",
    available: fa ? "موجودی قابل استفاده" : "Available balance",
    deposit: fa ? "واریز" : "Deposit",
    withdraw: fa ? "برداشت" : "Withdraw",
    history: fa ? "تاریخچه تراکنش‌ها" : "Transaction history",
    empty: fa ? "هنوز تراکنشی ثبت نشده است." : "No transactions yet.",
    turnkeyTitle: fa ? "موجودی روی بلاک‌چین" : "On-chain balances",
    turnkeyHistory: fa ? "فعالیت‌های زنجیره‌ای" : "On-chain activity",
    turnkeyLoading: fa ? "در حال دریافت اطلاعات مستقیم از Turnkey..." : "Fetching live wallet data from Turnkey...",
    turnkeyUnavailable: fa ? "اطلاعات این شبکه فعلاً دریافت نشد؛ این وضعیت به معنی صفر بودن موجودی نیست." : "Network data could not be loaded. This does not mean the balance is zero.",
    turnkeyUpdated: fa ? "آخرین دریافت موفق: " : "Last successful update: ",
    turnkeyAddress: fa ? "آدرس کیف پول" : "Wallet address",
    turnkeyNoBalances: fa ? "Turnkey برای این شبکه موجودی قابل نمایشی برنگرداند." : "Turnkey returned no displayable balances for this network.",
    turnkeyNoHistory: fa ? "Turnkey هنوز تراکنشی برای این آدرس برنگردانده است." : "Turnkey returned no transactions for this address yet.",
    loading: fa ? "در حال دریافت کیف پول..." : "Loading wallet...",
    error: fa ? "دریافت اطلاعات کیف پول ناموفق بود." : "Unable to load wallet information.",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    network: fa ? "شبکه" : "Network",
    asset: fa ? "دارایی" : "Asset",
    polygon: "Polygon PoS",
    depositTitle: fa ? "واریز ارز دیجیتال" : "Crypto deposit",
    withdrawTitle: fa ? "درخواست برداشت" : "Withdrawal request",
    depositIntro: fa ? "دارایی انتخاب‌شده را فقط روی شبکهٔ نمایش‌داده‌شده به آدرس اختصاصی خود ارسال کنید." : "Send only the selected asset on the selected network to your dedicated address.",
    withdrawIntro: fa ? "مبلغ و آدرس مقصد را با دقت وارد کنید. کارمزد شبکه از دارایی بومی همان شبکه پرداخت می‌شود." : "Enter the amount and destination carefully. Network fees are paid in the native asset of the selected network.",
    receiveAddress: fa ? "آدرس دریافت شما" : "Your deposit address",
    copyAddress: fa ? "کپی آدرس" : "Copy address",
    copied: fa ? "آدرس کپی شد" : "Address copied",
    amount: fa ? "مقدار" : "Amount",
    destination: fa ? "آدرس مقصد" : "Destination address",
    fee: fa ? "کارمزد تخمینی شبکه" : "Estimated network fee",
    feePaidInPol: fa ? "کارمزد از موجودی دارایی بومی همان شبکه رزرو می‌شود." : "The network fee is reserved from the native asset balance on this network.",
    polGasBalance: fa ? "موجودی دارایی بومی برای کارمزد" : "Native asset available for gas",
    youReceive: fa ? "مقدار درخواستی" : "Requested amount",
    submitWithdrawal: fa ? "ثبت درخواست برداشت" : "Submit withdrawal request",
    unavailable: fa ? "غیرفعال" : "Disabled",
    depositDisabled: fa ? "واریز در حال حاضر غیرفعال است. لطفاً هیچ ارزی به این آدرس ارسال نکنید." : "Deposits are currently disabled. Do not send funds to this address.",
    withdrawDisabled: fa ? "برداشت در حال حاضر فعال نیست." : "Withdrawals are currently disabled.",
    depositReady: fa ? "واریز پس از آماده بودن اسکنر شبکه فعال می‌شود." : "Deposits become available after the network scanner is healthy.",
    usdt0Warning: fa ? "فقط همین دارایی را روی همین شبکه ارسال کنید. ارسال توکن یا شبکهٔ اشتباه ممکن است باعث از دست رفتن دارایی شود." : "Send only this asset on this network. Using another token or network may result in lost funds.",
    polWarning: fa ? "فقط دارایی بومی اعلام‌شده برای همین شبکه را برای کارمزد در نظر بگیرید." : "Only the configured native asset on this network can be used for network fees.",
    confirmations: fa ? "تعداد تأییدهای لازم" : "Required confirmations",
    contract: fa ? "آدرس قرارداد توکن" : "Token contract",
    minimum: fa ? "حداقل واریز" : "Minimum deposit",
    noMinimum: fa ? "حداقل مبلغ واریز تعیین نشده است." : "No minimum deposit is configured.",
    active: fa ? "فعال" : "Enabled",
    safeWithdraw: fa ? "برداشت غیرفعال" : "Withdrawals disabled",
    type: fa ? "نوع" : "Type",
    date: fa ? "تاریخ" : "Date",
    amountColumn: fa ? "مقدار" : "Amount",
    back: fa ? "بازگشت به کیف پول" : "Back to wallet",
    loadingAddress: fa ? "در حال دریافت آدرس واریز..." : "Preparing deposit address...",
    scannerNotReady: fa ? "اسکنر شبکه هنوز آماده نیست؛ چند لحظه دیگر دوباره تلاش کنید." : "The network scanner is not ready yet. Please try again shortly.",
    insufficientPol: fa ? "موجودی POL برای پرداخت کارمزد شبکه کافی نیست." : "Your POL balance is not sufficient to cover the network fee.",
    insufficientUsdt0: fa ? "موجودی قابل برداشت USDT0 کافی نیست." : "Your available USDT0 balance is insufficient.",
    invalidDestination: fa ? "آدرس مقصد معتبر نیست." : "The destination address is invalid.",
    reviewRequired: fa ? "این کیف پول برای بررسی دستی علامت‌گذاری شده است؛ تا رفع مشکل به آدرس قدیمی آن وجه ارسال نکنید." : "This wallet requires manual review. Do not send funds to its legacy address until it has been reconciled.",
    withdrawalSubmitted: fa ? "درخواست برداشت ثبت شد و منتظر بررسی مدیر است. هنوز هیچ تراکنشی روی بلاک‌چین ارسال نشده است." : "Your withdrawal request is recorded and awaiting admin review. No blockchain transaction has been sent yet.",
    status: fa ? "وضعیت" : "Status",
    assetsTitle: fa ? "موجودی دفترکل Wallet-Find" : "Wallet-Find account records",
    assetsNote: fa ? "سوابق داخلی موجودی و مبالغ قابل استفاده؛ این بخش برای حسابداری و رزروهای داخلی است." : "Internal balances and available amounts used for accounting and reservations.",
    noDepositAssets: fa ? "در حال حاضر دارایی فعالی برای واریز وجود ندارد." : "There are currently no enabled deposit assets.",
    noWithdrawalAssets: fa ? "در حال حاضر دارایی فعالی برای برداشت وجود ندارد." : "There are currently no enabled withdrawal assets.",
    walletActive: fa ? "کیف پول امانی" : "Custodial wallet",
  }), [fa]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setTurnkeyLoading(true);
    try {
      const walletResult = await getWallet();
      setWallet(walletResult);
      setError("");
      const supported = walletResult.networks.filter((network) => network.family === "EVM" && ["eip155:1", "eip155:10", "eip155:56", "eip155:137", "eip155:42161"].includes(network.id));
      const snapshots = await Promise.all(supported.map(async (network): Promise<TurnkeySnapshot> => {
        try {
          const data = await getTurnkeyWalletData(network.id);
          return { ...data, balances: data.balances ?? [], transactions: data.transactions ?? [] };
        } catch (requestError) {
          return { networkId: network.id, network: network.displayName, address: network.address ?? "", balances: [], transactions: [], fetchedAt: new Date().toISOString(), error: requestError instanceof Error ? requestError.message : "TURNKEY_WALLET_DATA_UNAVAILABLE" };
        }
      }));
      setTurnkeySnapshots(snapshots);
      const successful = snapshots.filter((snapshot) => !snapshot.error);
      setTurnkeyUpdatedAt(successful.length ? successful.map((item) => item.fetchedAt).sort().slice(-1)[0] ?? null : null);
    } catch {
      setError(copy.error);
    } finally {
      setTurnkeyLoading(false);
      setRefreshing(false);
    }
  }, [copy.error]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const loadPrices = async () => {
      try {
        const result = await getMarketPrices();
        const validPrices: Record<string, number> = {};
        for (const [id, price] of Object.entries(result.prices ?? {})) {
          if (typeof price === "number" && Number.isFinite(price) && price > 0) validPrices[id] = price;
        }
        if (Object.keys(validPrices).length === 0) throw new Error("PRICE_FEED_UNAVAILABLE");
        if (!cancelled) {
          setUsdPrices(validPrices);
          setPriceUpdatedAt(result.updatedAt);
          setPriceStatus("ready");
        }
      } catch {
        if (!cancelled) setPriceStatus((previous) => previous === "ready" ? "ready" : "error");
      }
    };
    void loadPrices();
    const interval = window.setInterval(() => { void loadPrices(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);


  const allAssets = (wallet?.networks ?? []).flatMap((network) => network.assets.map((asset) => ({ ...asset, networkId: network.id, networkName: network.displayName, chainId: network.chainId, nativeAssetSymbol: network.nativeAssetSymbol })));
  const depositAssets = allAssets.filter((asset) => asset.depositEnabled);
  const withdrawalAssets = allAssets.filter((asset) => asset.withdrawalEnabled);
  const selectedDepositAsset = depositAssets.find((asset) => asset.id === depositAssetId) ?? null;
  const selectedDepositNetwork = wallet?.networks.find((network) => network.id === depositNetworkId) ?? null;
  const selectedWithdrawAsset = withdrawalAssets.find((asset) => asset.id === withdrawAssetId) ?? null;
  const selectedWithdrawNetwork = wallet?.networks.find((network) => network.id === withdrawNetworkId) ?? null;
  const feeAsset = selectedWithdrawNetwork?.assets.find((asset) => asset.assetType === "NATIVE" && asset.verificationStatus === "VERIFIED") ?? null;

  const fmt = (value: string, decimals = 6) => formatAmount(value, decimals, locale);
  const apiErrorCopy = {
    error: copy.error,
    depositDisabled: copy.depositDisabled,
    withdrawDisabled: copy.withdrawDisabled,
    scannerNotReady: copy.scannerNotReady,
    insufficientPol: copy.insufficientPol,
    insufficientUsdt0: copy.insufficientUsdt0,
    invalidDestination: copy.invalidDestination,
  };

  const openDeposit = async (assetId?: string) => {
    const requestSequence = ++depositRequestSequence.current;
    const asset = depositAssets.find((item) => item.id === assetId)
      ?? depositAssets.find((item) => item.symbol === "USDT0")
      ?? depositAssets[0];
    setView("deposit");
    setDepositDetails(null);
    setDepositError("");
    setCopied(false);
    const network = asset ? wallet?.networks.find((item) => item.id === asset.networkId) : null;
    if (!asset || !network) {
      setDepositAssetId("");
      setDepositError(copy.depositDisabled);
      setDepositLoading(false);
      return;
    }
    setDepositAssetId(asset.id);
    setDepositNetworkId(network.id);
    setDepositLoading(true);
    try {
      const details = await requestWalletDeposit(network.id, asset.id);
      if (requestSequence === depositRequestSequence.current) setDepositDetails(details);
    } catch (requestError) {
      if (requestSequence === depositRequestSequence.current) {
        setDepositError(errorMessage(requestError, apiErrorCopy));
      }
    } finally {
      if (requestSequence === depositRequestSequence.current) setDepositLoading(false);
    }
  };

  const changeDepositAsset = (assetId: string) => {
    void openDeposit(assetId);
  };

  const openWithdraw = (assetId?: string) => {
    const asset = withdrawalAssets.find((item) => item.id === assetId)
      ?? withdrawalAssets.find((item) => item.symbol === "USDT0")
      ?? withdrawalAssets[0];
    const network = asset ? wallet?.networks.find((item) => item.id === asset.networkId) : null;
    setView("withdraw");
    setWithdrawAssetId(asset?.id ?? "");
    setWithdrawNetworkId(network?.id ?? "");
    setWithdrawAmount("");
    setWithdrawAddress("");
    setWithdrawError("");
    setWithdrawResult(null);
    setWithdrawIdempotencyKey(createIdempotencyKey());
  };

  const copyAddress = async () => {
    if (!depositDetails?.depositAddress) return;
    try {
      await navigator.clipboard.writeText(depositDetails.depositAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const submitWithdrawal = async () => {
    if (!selectedWithdrawNetwork || !selectedWithdrawAsset || !withdrawAmount || !withdrawAddress) return;
    setWithdrawSubmitting(true);
    setWithdrawError("");
    try {
      const result = await requestWalletWithdrawal({
        networkId: selectedWithdrawNetwork.id,
        assetId: selectedWithdrawAsset.id,
        amount: withdrawAmount,
        destinationAddress: withdrawAddress.trim(),
        idempotencyKey: withdrawIdempotencyKey,
      });
      setWithdrawResult(result);
      setWithdrawIdempotencyKey(createIdempotencyKey());
      await refresh();
    } catch (requestError) {
      setWithdrawError(errorMessage(requestError, apiErrorCopy));
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  const activities: ActivityRow[] = wallet ? [
    ...wallet.onChainDeposits.map((item: WalletChainActivity) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      amount: item.amount,
      currency: item.asset,
      createdAt: item.detectedAt ?? item.creditedAt ?? item.confirmedAt ?? new Date().toISOString(),
      explorerUrl: item.explorerUrl,
      note: item.reviewReason,
    })),
    ...wallet.onChainWithdrawals.map((item: WalletChainActivity) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      amount: item.amount,
      currency: item.asset,
      createdAt: item.requestedAt ?? item.confirmedAt ?? new Date().toISOString(),
      fee: item.actualFee ?? item.estimatedFee,
      feeAsset: item.feeAsset,
      explorerUrl: item.explorerUrl,
      note: item.failureCode,
    })),
    ...wallet.transactions.map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      amount: item.amount,
      currency: item.currency,
      createdAt: item.createdAt,
      note: item.note,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : [];

  const filteredActivities = activities.filter((item) => {
    const normalizedType = item.type.toLowerCase();
    const isDeposit = normalizedType.includes("deposit") || normalizedType.includes("واریز");
    const isWithdrawal = normalizedType.includes("withdraw");
    if (activityFilter === "deposit" && !isDeposit) return false;
    if (activityFilter === "withdrawal" && !isWithdrawal) return false;
    const query = activitySearch.trim().toLowerCase();
    return !query || [item.type, item.status, item.currency, item.note ?? ""].some((value) => value.toLowerCase().includes(query));
  });

  const priceIdBySymbol: Record<string, string> = { POL: "polygon-ecosystem-token", MATIC: "polygon-ecosystem-token", USDT: "tether", USDT0: "tether", USDC: "usd-coin", DAI: "dai", ETH: "ethereum", WETH: "ethereum", BTC: "bitcoin", WBTC: "wrapped-bitcoin", SOL: "solana", BNB: "binancecoin", TRX: "tron", XRP: "ripple", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche-2", LINK: "chainlink", LTC: "litecoin", DOT: "polkadot", XLM: "stellar" };
  const usdBalance = (wallet?.networks ?? []).reduce((sum, network) => sum + network.assets.reduce((assetSum, asset) => { const id = priceIdBySymbol[asset.symbol.toUpperCase()]; const price = id ? usdPrices[id] : undefined; const amount = Number(asset.balance); return price !== undefined && Number.isFinite(amount) ? assetSum + amount * price : assetSum; }, 0), 0);
  const unpricedAssetCount = (wallet?.networks ?? []).reduce((count, network) => count + network.assets.filter((asset) => { const amount = Number(asset.balance); const id = priceIdBySymbol[asset.symbol.toUpperCase()]; return Number.isFinite(amount) && amount > 0 && (!id || usdPrices[id] === undefined); }).length, 0);
  const usdFormatter = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });


  return <div className="app-shell wallet-page">
    <header className="topbar">
      <button className="brand brand--home" type="button" aria-label={copy.title} onClick={() => onNavigate("home")}>
        <span className="brand-wallet">Wallet</span><span className="brand-find">Find</span>
      </button>
    </header>
    <main className="page wallet-exchange">
      <div className="wallet-page-heading">
        <div><div className="section-title">{copy.title}</div><p>{copy.pageSubtitle}</p></div>
        <button type="button" className="wallet-refresh" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "…" : "↻"} {copy.refresh}</button>
      </div>

      {wallet && <nav className="wallet-section-nav" aria-label={fa ? "بخش‌های کیف پول" : "Wallet sections"}>
        <a href="#wallet-overview">{copy.overviewTab}</a>
        <a href="#wallet-assets">{copy.assetsTab}</a>
        <a href="#wallet-ledger-history">{copy.activityTab}</a>
      </nav>}

      {!wallet && !error && <div className="inline-feedback"><LoadingIndicator label={copy.loading} /></div>}
      {error && <p className="inline-feedback wallet-error" role="alert">{error}</p>}
      {wallet?.walletProvisioningReviewRequired && <div className="wallet-warning" role="alert"><strong>⚠ {copy.unavailable}</strong><p>{copy.reviewRequired}</p></div>}

      {wallet && view === "overview" && <>
        <section className="wallet-exchange-balance" id="wallet-overview">
          <div className="wallet-exchange-balance__top">
            <span>{copy.totalPortfolio}</span>
            <button type="button" className="wallet-balance-privacy" onClick={() => setBalancesHidden((value) => !value)} aria-pressed={balancesHidden} aria-label={balancesHidden ? copy.showBalances : copy.hideBalances}>
              <span aria-hidden="true">{balancesHidden ? "◉" : "◎"}</span>{balancesHidden ? copy.showBalances : copy.hideBalances}
            </button>
          </div>
          <div className="wallet-exchange-balance__value">{balancesHidden ? "••••••••" : priceStatus === "ready" ? usdFormatter.format(usdBalance) : "—"}</div>
          <div className="wallet-exchange-balance__available">{balancesHidden ? copy.balancePrivacy : priceStatus === "loading" ? copy.priceLoading : priceStatus === "error" ? copy.priceUnavailable : copy.balanceNote}</div>
          {unpricedAssetCount > 0 && <div className="wallet-exchange-balance__available">{copy.partialPriceNote}</div>}
          {priceUpdatedAt && <div className="wallet-exchange-balance__available">{fa ? "آخرین به‌روزرسانی قیمت: " : "Prices updated: "}{new Date(priceUpdatedAt).toLocaleTimeString(locale)}</div>}

          <div className="wallet-exchange-actions">
            <button type="button" className="wallet-action wallet-action--deposit" onClick={() => void openDeposit()}><span aria-hidden="true">↓</span>{copy.deposit}</button>
            <button type="button" className="wallet-action wallet-action--withdraw" onClick={() => openWithdraw()}><span aria-hidden="true">↑</span>{copy.withdraw}</button>
          </div>
          <div className="wallet-quick-actions">
            <div className="wallet-quick-actions__heading"><strong>{copy.quickActions}</strong><small>{fa ? "عملیات موجود و قابلیت‌های آینده" : "Available actions and planned features"}</small></div>
            <div className="wallet-quick-actions__grid">
              <button type="button" className="wallet-planned-action" onClick={() => setPlannedAction("transfer")}><span>⇄</span><strong>{copy.plannedActions.transfer.title}</strong><em>{copy.planned}</em></button>
              <button type="button" className="wallet-planned-action" onClick={() => setPlannedAction("convert")}><span>⇆</span><strong>{copy.plannedActions.convert.title}</strong><em>{copy.planned}</em></button>
              <button type="button" className="wallet-planned-action" onClick={() => setPlannedAction("buy")}><span>＋</span><strong>{copy.plannedActions.buy.title}</strong><em>{copy.planned}</em></button>
              <button type="button" className="wallet-planned-action" onClick={() => setPlannedAction("sell")}><span>－</span><strong>{copy.plannedActions.sell.title}</strong><em>{copy.planned}</em></button>
              <button type="button" className="wallet-planned-action" onClick={() => setPlannedAction("earn")}><span>✧</span><strong>{copy.plannedActions.earn.title}</strong><em>{copy.planned}</em></button>
            </div>
          </div>
        </section>

        <details className="wallet-provider-details">
          <summary><span><strong>{fa ? "جزئیات فنی و تأیید موجودی" : "Technical details & balance verification"}</strong><small>{fa ? "داده‌های مستقیم شبکه؛ خطا به معنی موجودی صفر نیست." : "Direct network data; an error does not mean a zero balance."}</small></span><span className="wallet-provider-details__chevron">⌄</span></summary>
        <section className="wallet-network-card wallet-assets-directory">
          <div className="wallet-card-heading"><div><h2>{copy.turnkeyTitle}</h2><p className="wallet-assets-note">{fa ? "منبع نمایش موجودی واقعی شبکه؛ خطا یا تأخیر دریافت را با صفر اشتباه نگیرید." : "Source for actual network balances. A loading error must never be interpreted as zero."}</p></div><span>Turnkey</span></div>
          <p className="wallet-deposit-minimum">{turnkeyLoading ? copy.turnkeyLoading : turnkeyUpdatedAt ? copy.turnkeyUpdated + new Date(turnkeyUpdatedAt).toLocaleString(locale) : copy.turnkeyUnavailable}</p>
          {turnkeySnapshots.length === 0 && !turnkeyLoading && <p className="wallet-asset-empty">{copy.turnkeyUnavailable}</p>}
          {turnkeySnapshots.map((snapshot) => <div className="wallet-network-group" key={snapshot.networkId}>
            <div className="wallet-network-group__heading"><span className="wallet-network-dot" /><div><strong>{snapshot.network}</strong><small>{snapshot.address ? copy.turnkeyAddress + ": " + snapshot.address : ""}</small></div></div>
            {snapshot.error ? <p className="wallet-error">{copy.turnkeyUnavailable}</p> : snapshot.balances.length === 0 ? <p className="wallet-asset-empty">{copy.turnkeyNoBalances}</p> :
              snapshot.balances.map((item, index) => { const balance = turnkeyBalance(item); return <div className="wallet-asset-row" key={snapshot.networkId + "-" + balance.contract + "-" + index}>
                <div className="wallet-asset-row__identity"><span className="wallet-asset-symbol">{balance.symbol.slice(0, 4)}</span><div><strong>{balance.symbol}</strong><small>{balance.contract || snapshot.network}</small></div></div>
                <div className="wallet-asset-row__balance"><strong>{balance.amount} {balance.symbol}</strong><small>Turnkey · {fa ? "موجودی زنجیره" : "On-chain balance"}</small></div>
              </div>; })}
          </div>)}
        </section>
        <section className="wallet-history wallet-exchange-history">
          <div className="wallet-card-heading"><div><h2>{copy.turnkeyHistory}</h2><p className="wallet-assets-note">{fa ? "وضعیت و جزئیات تراکنش‌های ثبت‌شده روی شبکه." : "Status and details of transactions recorded on-chain."}</p></div><span>Turnkey</span></div>
          {(() => { const rows = turnkeySnapshots.flatMap((snapshot) => snapshot.transactions.map(turnkeyTransaction));
            return rows.length === 0 ? <div className="wallet-empty"><span>↔</span><p>{turnkeyLoading ? copy.turnkeyLoading : copy.turnkeyNoHistory}</p></div> :
              <div className="wallet-table"><div className="wallet-table-head"><span>{copy.type}</span><span>{copy.date}</span><span>{copy.amountColumn}</span></div>
                {rows.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, 100).map((item, index) => <article className="wallet-transaction" key={item.id + "-" + index}>
                  <div><strong>{item.type}</strong><small>{item.status}{item.hash ? " · " + item.hash : ""}</small></div>
                  <small>{item.date ? new Date(item.date).toLocaleString(locale) : "—"}</small><div><b>{item.amount} <small>{item.symbol}</small></b></div>
                </article>)}
              </div>;
          })()}
        </section>
        </details>
        <section className="wallet-network-card wallet-assets-directory" id="wallet-assets">
          <div className="wallet-card-heading"><div><h2>{copy.assetsTitle}</h2><p className="wallet-assets-note">{copy.assetsNote}</p></div><span>{wallet.networks.reduce((count, network) => count + network.assets.length, 0)}</span></div>
          
          {wallet.networks.map((network) => (
            <div className="wallet-network-group" key={network.id}>
              <div className="wallet-network-group__heading">
                <span className="wallet-network-dot" />
                <div><strong>{network.displayName}</strong></div>
              </div>
              {network.assets.length === 0 ? <p className="wallet-asset-empty">{fa ? "دارایی ثبت‌شده‌ای برای این شبکه وجود ندارد." : "No registered assets on this network."} </p> :
                network.assets.map((asset) => <div className="wallet-asset-row" key={asset.id}>
                  <div className="wallet-asset-row__identity">
                    <span className="wallet-asset-symbol">{asset.symbol.slice(0, 4)}</span>
                    <div><strong>{asset.symbol}</strong><small>{asset.displayName}</small></div>
                  </div>
                  <div className="wallet-asset-row__balance">
                    <strong>{balancesHidden ? "••••••" : fmt(asset.balance, asset.decimals)} {asset.symbol}</strong>
                    <small>{fa ? "قابل استفاده" : "Available"}: {balancesHidden ? "••••••" : fmt(asset.availableBalance, asset.decimals)} {asset.symbol}</small>
                    {Number(asset.reservedBalance) > 0 && <small className="wallet-asset-reserved">{fa ? "رزروشده" : "Reserved"}: {balancesHidden ? "••••••" : fmt(asset.reservedBalance, asset.decimals)} {asset.symbol}</small>}
                  </div>
                  <div className="wallet-asset-row__actions">
                    {asset.depositEnabled && <button type="button" className="wallet-asset-deposit-button" onClick={() => void openDeposit(asset.id)}>{copy.deposit}</button>}
                    {asset.withdrawalEnabled && <button type="button" className="wallet-asset-deposit-button" onClick={() => openWithdraw(asset.id)}>{copy.withdraw}</button>}
                  </div>
                </div>)}
            </div>
          ))}
        </section>

        <section className="wallet-history wallet-exchange-history" id="wallet-ledger-history">
          <div className="wallet-card-heading"><div><h2>{copy.history}</h2><p className="wallet-assets-note">{fa ? "سوابق واریز، برداشت و عملیات ثبت‌شده در Wallet-Find." : "Deposits, withdrawals and operations recorded by Wallet-Find."}</p></div><span>{activities.length}</span></div>
          <div className="wallet-activity-tools">
            <div className="wallet-activity-filters" role="group" aria-label={fa ? "فیلتر تراکنش‌ها" : "Transaction filters"}>
              <button type="button" aria-pressed={activityFilter === "all"} onClick={() => setActivityFilter("all")}>{copy.filterAll}</button>
              <button type="button" aria-pressed={activityFilter === "deposit"} onClick={() => setActivityFilter("deposit")}>{copy.filterDeposits}</button>
              <button type="button" aria-pressed={activityFilter === "withdrawal"} onClick={() => setActivityFilter("withdrawal")}>{copy.filterWithdrawals}</button>
            </div>
            <input className="wallet-activity-search" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder={copy.activitySearchPlaceholder} aria-label={copy.activitySearchPlaceholder} />
          </div>
          {filteredActivities.length === 0 ? <div className="wallet-empty"><span>↔</span><p>{activities.length === 0 ? copy.empty : copy.noFilteredActivity}</p></div> : <div className="wallet-table">
            <div className="wallet-table-head"><span>{copy.type}</span><span>{copy.date}</span><span>{copy.amountColumn}</span></div>
            {filteredActivities.slice(0, 100).map((item) => <article className="wallet-transaction" key={item.id}>
              <div><strong>{item.type}</strong><small>{item.status}{item.note ? " · " + item.note : ""}</small></div>
              <small>{new Date(item.createdAt).toLocaleString(locale)}</small>
              <div><b>{balancesHidden ? "••••••" : fmt(item.amount)} <small>{item.currency}</small></b>
                {item.fee && <small>{copy.fee}: {item.fee} {item.feeAsset ?? "POL"}</small>}
                {item.explorerUrl && <a href={item.explorerUrl} target="_blank" rel="noreferrer">{fa ? "مشاهده تراکنش" : "View transaction"}</a>}
              </div>
            </article>)}
          </div>}
        </section>
      </>}

      {wallet && view === "deposit" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--deposit">↓</div>
        <h1>{copy.depositTitle}</h1><p className="wallet-flow-intro">{copy.depositIntro}</p>
        <div className="wallet-form-field">
          <label>{copy.network}</label>
          <div className="wallet-select-static"><span className="wallet-network-dot" />{selectedDepositNetwork?.displayName ?? selectedDepositAsset?.networkName ?? (fa ? "شبکه انتخاب‌شده" : "Selected network")}</div>
        </div>
        <div className="wallet-form-field">
          <label>{copy.asset}</label>
          <div className="wallet-exchange-actions">
            {depositAssets.map((asset) => <button key={asset.id} type="button" className="wallet-asset-deposit-button" aria-pressed={depositAssetId === asset.id} onClick={() => changeDepositAsset(asset.id)}>{asset.symbol} · {asset.networkName}</button>)}
          </div>
        </div>
        {depositLoading && <div className="inline-feedback"><LoadingIndicator label={copy.loadingAddress} /></div>}
        {depositError && <p className="inline-feedback wallet-error" role="alert">{depositError}</p>}
        {depositDetails && <>
          <div className="wallet-form-field"><label>{copy.asset}</label><div className="wallet-select-static">{depositDetails.asset} <span>{depositDetails.displayName}</span></div></div>
          <div className="wallet-deposit-address">
            <label>{copy.receiveAddress}</label>
            <code>{depositDetails.depositAddress}</code>
            <button type="button" onClick={() => void copyAddress()} disabled={copied}>{copied ? "✓ " + copy.copied : copy.copyAddress}</button>
          </div>
          <div className="wallet-network-row"><span>{copy.confirmations}</span><strong>{depositDetails.confirmationsRequired}</strong></div>
          {depositDetails.contractAddress && <div className="wallet-deposit-address"><label>{copy.contract}</label><code>{depositDetails.contractAddress}</code></div>}
          {depositDetails.minDeposit && <div className="wallet-network-row"><span>{copy.minimum}</span><strong>{depositDetails.minDeposit} {depositDetails.asset}</strong></div>}
          <div className="wallet-warning"><strong>⚠ {fa ? "نکتهٔ مهم" : "Important"}</strong><p>{depositDetails.asset === "POL" ? copy.polWarning : copy.usdt0Warning}</p></div>
          <p className="wallet-deposit-minimum">{depositDetails.message}</p>
        </>}
        {!depositLoading && !depositDetails && !depositError && depositAssets.length === 0 && <div className="wallet-warning"><strong>⚠ {copy.unavailable}</strong><p>{copy.noDepositAssets}</p></div>}

      </section>}

      {wallet && view === "withdraw" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--withdraw">↑</div>
        <h1>{copy.withdrawTitle}</h1><p className="wallet-flow-intro">{copy.withdrawIntro}</p>
        <div className="wallet-form-field"><label>{copy.network}</label><div className="wallet-select-static"><span className="wallet-network-dot" />{selectedWithdrawNetwork?.displayName ?? (fa ? "شبکه انتخاب‌شده" : "Selected network")}</div></div>
        {selectedWithdrawAsset ? <>
          <div className="wallet-form-field"><label>{copy.asset}</label><div className="wallet-select-static">{selectedWithdrawAsset.symbol} <span>{selectedWithdrawAsset.displayName}</span></div></div>
          <div className="wallet-form-field">
            <label>{copy.amount}</label>
            <div className="wallet-input-wrap"><input inputMode="decimal" value={withdrawAmount} onChange={(event) => { setWithdrawAmount(event.target.value.replace(/[^0-9.]/g, "")); setWithdrawIdempotencyKey(createIdempotencyKey()); setWithdrawResult(null); }} placeholder="0.00" /><span>{selectedWithdrawAsset.symbol}</span></div>
            <small>{copy.available}: {fmt(selectedWithdrawAsset.availableBalance, selectedWithdrawAsset.decimals)} {selectedWithdrawAsset.symbol}</small>
          </div>
          <div className="wallet-form-field"><label>{copy.destination}</label><input className="wallet-address-input" value={withdrawAddress} onChange={(event) => { setWithdrawAddress(event.target.value); setWithdrawIdempotencyKey(createIdempotencyKey()); setWithdrawResult(null); }} placeholder="0x..." autoComplete="off" /></div>
          <div className="wallet-fee-row"><span>{copy.polGasBalance}</span><strong>{fmt(feeAsset?.availableBalance ?? "0", feeAsset?.decimals ?? 18)} {feeAsset?.symbol ?? selectedWithdrawNetwork?.nativeAssetSymbol ?? "—"}</strong></div>
          <div className="wallet-fee-row"><span>{copy.fee}</span><strong>{withdrawResult?.fee ? formatAtomic(withdrawResult.fee, withdrawResult.feeDecimals ?? 18, locale) + " " + (withdrawResult.feeAsset ?? feeAsset?.symbol ?? "—") : "— " + (feeAsset?.symbol ?? selectedWithdrawNetwork?.nativeAssetSymbol ?? "")}</strong></div>
          <p className="wallet-deposit-minimum">{copy.feePaidInPol}</p>
          {withdrawError && <p className="inline-feedback wallet-error" role="alert">{withdrawError}</p>}
          {withdrawResult && <div className="wallet-warning"><strong>✓ {copy.status}: {withdrawResult.status}</strong><p>{copy.withdrawalSubmitted}</p></div>}
          <button type="button" className="wallet-submit" onClick={() => void submitWithdrawal()} disabled={withdrawSubmitting || Boolean(withdrawResult) || !withdrawAmount || !withdrawAddress.trim()}>
            {withdrawSubmitting ? (fa ? "در حال ثبت..." : "Submitting...") : copy.submitWithdrawal}
          </button>
        </> : <div className="wallet-warning"><strong>⚠ {copy.unavailable}</strong><p>{copy.noWithdrawalAssets}</p></div>}
      </section>}
      {plannedAction && <div className="wallet-planned-modal" role="presentation" onClick={() => setPlannedAction(null)}>
        <section className="wallet-planned-modal__card" role="dialog" aria-modal="true" aria-labelledby="wallet-planned-title" onClick={(event) => event.stopPropagation()}>
          <div className="wallet-planned-modal__icon">✧</div>
          <span className="wallet-planned-modal__status">{copy.planned}</span>
          <h2 id="wallet-planned-title">{copy.plannedActions[plannedAction].title}</h2>
          <p>{copy.plannedActions[plannedAction].description}</p>
          <div className="wallet-planned-modal__note">{copy.plannedNote}</div>
          <button type="button" onClick={() => setPlannedAction(null)}>{copy.close}</button>
        </section>
      </div>}
    </main>
    <BottomNav activePage="wallet" onNavigate={onNavigate} />
  </div>;
}
