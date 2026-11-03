import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";
import {
  getWallet,
  getMarketPrices,
  requestWalletDeposit,
  requestWalletWithdrawal,
  type WalletResult,
  type WalletWithdrawalRequestResult,
} from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type Page = "home" | "auth" | "competition" | "key" | "leaderboard" | "profile" | "wallet";
type Props = { onNavigate: (page: Page) => void };
type WalletView = "overview" | "deposit" | "withdraw";
function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function AssetLogo({ symbol }: { symbol: string }) {
  const code = symbol.toUpperCase();
  const common = { viewBox: "0 0 40 40", role: "img" as const, "aria-label": code };
  if (code === "BTC") return <span className="wallet-asset-symbol wallet-asset-symbol--btc" aria-hidden="true"><svg {...common}><circle cx="20" cy="20" r="19" fill="#F7931A" /><path d="M25.8 17.1c.5-3.2-1.9-4.8-5.1-5.9l1-4-2.4-.6-1 3.9-2-.5 1-4-2.4-.6-1 4-5-1.2-.7 2.6 1.9.5c1.3.3 1.5.8 1.3 1.8l-2.7 10.7c-.2.6-.6.8-1.3.6l-1.9-.5-1 2.8 5 1.2-1 4 2.4.6 1-4 2 .5-1 4 2.4.6 1-4.1c4.2.8 7.4.5 8.7-3.3 1.1-3-.1-4.8-2.4-5.9 1.7-.4 2.9-1.6 3.2-3.8Zm-5.2 8.1c-.8 3-5.8 1.4-7.4 1l1.3-5.2c1.6.4 7 .9 6.1 4.2Zm.8-8.2c-.7 2.7-4.9 1.3-6.3 1l1.2-4.7c1.4.4 5.8.9 5.1 3.7Z" fill="#fff" transform="translate(5 1) scale(.86)" /></svg></span>;
  if (code === "ETH") return <span className="wallet-asset-symbol wallet-asset-symbol--eth" aria-hidden="true"><svg {...common}><circle cx="20" cy="20" r="19" fill="#627EEA" /><path d="M20 4 10 20l10 6 10-6L20 4Z" fill="#fff" /><path d="m20 28-10-6 10 14 10-14-10 6Z" fill="#C1CCF7" /></svg></span>;
  if (code === "BNB") return <span className="wallet-asset-symbol wallet-asset-symbol--bnb" aria-hidden="true"><svg {...common}><circle cx="20" cy="20" r="19" fill="#F0B90B" /><g fill="#fff"><path d="m20 7 4.2 4.2-4.2 4.2-4.2-4.2L20 7Zm-8 8 3.2 3.2L12 21.4 8.8 18 12 15Zm16 0 3.2 3.2-3.2 3.2-3.2-3.2L28 15Zm-8 8 4.2 4.2-4.2 4.2-4.2-4.2L20 23Zm0-7 4 4-4 4-4-4 4-4Z" /></g></svg></span>;
  if (code === "USDT" || code === "USDT0") return <span className="wallet-asset-symbol wallet-asset-symbol--usdt" aria-hidden="true"><svg {...common}><circle cx="20" cy="20" r="19" fill="#26A17B" /><path fill="#fff" d="M8 9h24v5h-9v3.1c5.3.3 9.3 1.2 9.3 2.4s-4 2.1-9.3 2.4V32h-6V22c-5.3-.3-9.3-1.2-9.3-2.4s4-2.1 9.3-2.4V14H8V9Zm9 8.7v3.1c1 .1 2 .1 3 .1s2 0 3-.1v-3.1c-1-.1-2-.1-3-.1s-2 0-3 .1Zm0 4.4v2.2c1 .1 2 .1 3 .1s2 0 3-.1v-2.2c-1 .1-2 .1-3 .1s-2 0-3-.1Z" /></svg></span>;
  if (code === "POL") return <span className="wallet-asset-symbol wallet-asset-symbol--pol" aria-hidden="true"><svg {...common}><circle cx="20" cy="20" r="19" fill="#8247E5" /><g fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.2 16.2 15 12.8a3.2 3.2 0 0 1 3.2 0l2.2 1.3a3.2 3.2 0 0 1 0 5.5l-2.2 1.3a3.2 3.2 0 0 1-3.2 0l-1.5-.9" /><path d="m30.8 23.8-5.8 3.4a3.2 3.2 0 0 1-3.2 0l-2.2-1.3a3.2 3.2 0 0 1 0-5.5l2.2-1.3a3.2 3.2 0 0 1 3.2 0l1.5.9" /></g></svg></span>;
  if (code === "SOL") return <span className="wallet-asset-symbol wallet-asset-symbol--sol" aria-hidden="true"><svg {...common}><circle cx="20" cy="20" r="19" fill="#14141F" /><defs><linearGradient id="solana-logo-gradient" x1="7" y1="31" x2="32" y2="8" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#9945FF" /><stop offset="0.52" stopColor="#8752F3" /><stop offset="1" stopColor="#14F195" /></linearGradient></defs><g fill="url(#solana-logo-gradient)"><path d="M12.2 9.5h18.2l-3.8 4H8.4l3.8-4Z" /><path d="M9.6 18h18.2l-3.8 4H5.8l3.8-4Z" /><path d="M12.2 26.5h18.2l-3.8 4H8.4l3.8-4Z" /></g></svg></span>;
  return <span className="wallet-asset-symbol" aria-hidden="true">{code.slice(0, 4)}</span>;
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

export default function WalletPage({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const locale = fa ? "fa-IR" : "en-US";
  const [wallet, setWallet] = useState<WalletResult | null>(null);
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


  const copy = useMemo(() => ({
    title: fa ? "کیف پول من" : "My wallet",
    pageSubtitle: fa ? "دارایی‌ها، عملیات و فعالیت‌های کیف پولت را یک‌جا مدیریت کن." : "Manage your assets, wallet actions and activity in one place.",
    overviewTab: fa ? "نمای کلی" : "Overview",
    assetsTab: fa ? "دارایی‌ها" : "Assets",
    activityTab: fa ? "تاریخچه" : "Activity",
    totalPortfolio: fa ? "ارزش کل دارایی‌های ثبت‌شده" : "Total estimated portfolio value",
    assetList: fa ? "لیست دارایی‌ها" : "Asset list",
    activitySearchPlaceholder: fa ? "جست‌وجو در نوع، دارایی یا وضعیت..." : "Search type, asset or status...",
    filterAll: fa ? "همه" : "All",
    filterDeposits: fa ? "واریزها" : "Deposits",
    filterWithdrawals: fa ? "برداشت‌ها" : "Withdrawals",
    noFilteredActivity: fa ? "تراکنشی با این فیلتر پیدا نشد." : "No transactions match this filter.",
    assetsCount: fa ? "دارایی‌های ثبت‌شده" : "Registered assets",
    networkData: fa ? "داده‌های شبکه" : "Network data",
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
    try {
      const walletResult = await getWallet();
      setWallet(walletResult);
      setError("");

    } catch {
      setError(copy.error);
    } finally {
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

      {!wallet && !error && <div className="inline-feedback"><LoadingIndicator label={copy.loading} /></div>}
      {error && <p className="inline-feedback wallet-error" role="alert">{error}</p>}

      {wallet && view === "overview" && <>
        <section className="wallet-exchange-balance" id="wallet-overview">
          <div className="wallet-exchange-balance__top">
            <span>{copy.totalPortfolio}</span>
          </div>
          <div className="wallet-exchange-balance__value">{usdFormatter.format(usdBalance)}</div>
          <div className="wallet-exchange-balance__available">{priceStatus === "loading" ? copy.priceLoading : priceStatus === "error" ? copy.priceUnavailable : copy.balanceNote}</div>
          {unpricedAssetCount > 0 && <div className="wallet-exchange-balance__available">{copy.partialPriceNote}</div>}
          {priceUpdatedAt && <div className="wallet-exchange-balance__available">{fa ? "آخرین به‌روزرسانی قیمت: " : "Prices updated: "}{new Date(priceUpdatedAt).toLocaleTimeString(locale)}</div>}

          <div className="wallet-exchange-actions">
            <button type="button" className="wallet-action wallet-action--deposit" onClick={() => void openDeposit()}><span aria-hidden="true">↓</span>{copy.deposit}</button>
            <button type="button" className="wallet-action wallet-action--withdraw" onClick={() => openWithdraw()}><span aria-hidden="true">↑</span>{copy.withdraw}</button>
          </div>
        </section>

        <section className="wallet-assets-directory" aria-labelledby="wallet-assets-heading">
          <div className="wallet-card-heading">
            <div>
              <h2 id="wallet-assets-heading">{fa ? "لیست دارایی‌ها" : "Asset list"}</h2>
              <p className="wallet-assets-note">{fa ? "تمام دارایی‌های تعریف‌شده در شبکه‌های Wallet-Find" : "All assets registered across Wallet-Find networks"}</p>
            </div>
            <strong>{wallet.networks.reduce((count, network) => count + network.assets.length, 0)}</strong>
          </div>
          {wallet.networks.filter((network) => network.assets.length > 0).map((network) => (
            <div className="wallet-network-group" key={network.id}>
              <div className="wallet-network-group__heading">
                <span className="wallet-network-dot" aria-hidden="true" />
                <div><strong>{network.displayName}</strong><small>{network.networkKey}</small></div>
                <small>{network.assets.length} {fa ? "دارایی" : "assets"}</small>
              </div>
              {network.assets.map((asset) => {
                const amount = Number(asset.balance);
                const priceId = priceIdBySymbol[asset.symbol.toUpperCase()];
                const unitPrice = priceId ? usdPrices[priceId] : undefined;
                const hasBalance = Number.isFinite(amount);
                const hasUsdValue = hasBalance && (amount === 0 || unitPrice !== undefined);
                const usdValue = hasUsdValue ? amount * (unitPrice ?? 0) : null;
                return (
                  <div className="wallet-asset-row" key={asset.id}>
                    <div className="wallet-asset-row__identity">
                      <AssetLogo symbol={asset.symbol} />
                      <div>
                        <strong>{asset.symbol}</strong>
                        <small>{asset.displayName}</small>
                        <small>{fa ? "موجودی" : "Balance"}: {hasBalance ? formatAmount(asset.balance, asset.decimals, locale, 8) : "0"} {asset.symbol}</small>
                      </div>
                    </div>
                    <div className="wallet-asset-row__balance">
                      <strong>{usdValue === null ? "—" : usdFormatter.format(usdValue).replace("$", "") + " USDT"}</strong>
                      <small>{fa ? "ارزش تقریبی" : "Estimated value"}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {wallet.networks.every((network) => network.assets.length === 0) && <p className="wallet-asset-empty">{fa ? "هنوز دارایی‌ای در فهرست شبکه‌ها تعریف نشده است." : "No assets are registered in the network directory yet."}</p>}
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
    </main>
    <BottomNav activePage="wallet" onNavigate={onNavigate} />
  </div>;
}
