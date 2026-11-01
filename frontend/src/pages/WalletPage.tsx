import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";
import {
  getWallet,
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
  const [error, setError] = useState("");
  const [view, setView] = useState<WalletView>("overview");
  const [depositAssetId, setDepositAssetId] = useState("");
  const [depositDetails, setDepositDetails] = useState<Awaited<ReturnType<typeof requestWalletDeposit>> | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const depositRequestSequence = useRef(0);
  const [depositError, setDepositError] = useState("");
  const [withdrawAssetId, setWithdrawAssetId] = useState("");
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

  const copy = useMemo(() => ({
    title: fa ? "کیف پول من" : "My wallet",
    balance: fa ? "موجودی کل به دلار" : "Total balance in USD",
    balanceNote: fa ? "ارزش تقریبی دارایی‌ها بر اساس قیمت بازار؛ قیمت‌ها هر ۶۰ ثانیه به‌روزرسانی می‌شوند." : "Estimated market value of assets; prices refresh every 60 seconds.",
    partialPriceNote: fa ? "قیمت برخی دارایی‌ها در دسترس نیست؛ جمع بالا فقط دارایی‌های قیمت‌گذاری‌شده را شامل می‌شود." : "Some asset prices are unavailable; the total includes only priced assets.",
    available: fa ? "موجودی قابل استفاده" : "Available balance",
    deposit: fa ? "واریز" : "Deposit",
    withdraw: fa ? "برداشت" : "Withdraw",
    history: fa ? "تاریخچه تراکنش‌ها" : "Transaction history",
    empty: fa ? "هنوز تراکنشی ثبت نشده است." : "No transactions yet.",
    loading: fa ? "در حال دریافت کیف پول..." : "Loading wallet...",
    error: fa ? "دریافت اطلاعات کیف پول ناموفق بود." : "Unable to load wallet information.",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    network: fa ? "شبکه" : "Network",
    asset: fa ? "دارایی" : "Asset",
    polygon: "Polygon PoS",
    depositTitle: fa ? "واریز ارز دیجیتال" : "Crypto deposit",
    withdrawTitle: fa ? "درخواست برداشت" : "Withdrawal request",
    depositIntro: fa ? "دارایی انتخاب‌شده را فقط روی شبکه Polygon PoS به آدرس نمایش‌داده‌شده ارسال کنید." : "Send only the selected asset on Polygon PoS to the address shown below.",
    withdrawIntro: fa ? "برداشت USDT0 پس از بررسی و تأیید مدیر ارسال می‌شود. کارمزد شبکه با POL پرداخت خواهد شد." : "USDT0 withdrawals are broadcast only after admin review. The network fee is paid in POL.",
    receiveAddress: fa ? "آدرس دریافت شما" : "Your deposit address",
    copyAddress: fa ? "کپی آدرس" : "Copy address",
    copied: fa ? "آدرس کپی شد" : "Address copied",
    amount: fa ? "مقدار" : "Amount",
    destination: fa ? "آدرس مقصد" : "Destination address",
    fee: fa ? "کارمزد تخمینی شبکه" : "Estimated network fee",
    feePaidInPol: fa ? "کارمزد از موجودی POL کسر می‌شود." : "The network fee is reserved from your POL balance.",
    polGasBalance: fa ? "موجودی POL برای کارمزد" : "POL available for gas",
    youReceive: fa ? "مقدار درخواستی" : "Requested amount",
    submitWithdrawal: fa ? "ثبت درخواست برداشت" : "Submit withdrawal request",
    unavailable: fa ? "غیرفعال" : "Disabled",
    depositDisabled: fa ? "واریز در حال حاضر غیرفعال است. لطفاً هیچ ارزی به این آدرس ارسال نکنید." : "Deposits are currently disabled. Do not send funds to this address.",
    withdrawDisabled: fa ? "برداشت در حال حاضر فعال نیست." : "Withdrawals are currently disabled.",
    depositReady: fa ? "واریز پس از آماده بودن اسکنر شبکه فعال می‌شود." : "Deposits become available after the network scanner is healthy.",
    usdt0Warning: fa ? "فقط USDT0 روی شبکه Polygon PoS ارسال کنید. ارسال توکن یا شبکهٔ اشتباه ممکن است باعث از دست رفتن دارایی شود." : "Send only USDT0 on Polygon PoS. Using another token or network may result in lost funds.",
    polWarning: fa ? "فقط POL بومی شبکه Polygon PoS ارسال کنید؛ توکن‌های رَپ‌شده یا POL روی شبکه‌های دیگر پذیرفته نمی‌شوند." : "Send only native POL on Polygon PoS. Wrapped POL or POL on another network is not supported.",
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
    assetsTitle: fa ? "دارایی‌ها و شبکه‌ها" : "Assets & networks",
    assetsNote: fa ? "موجودی هر دارایی جداگانه نمایش داده می‌شود؛ POL برای پرداخت کارمزد برداشت USDT0 استفاده می‌شود." : "Each asset balance is shown separately. POL is used to pay network fees for USDT0 withdrawals.",
    noDepositAssets: fa ? "در حال حاضر دارایی فعالی برای واریز وجود ندارد." : "There are currently no enabled deposit assets.",
    noWithdrawalAssets: fa ? "در حال حاضر دارایی فعالی برای برداشت وجود ندارد." : "There are currently no enabled withdrawal assets.",
    walletActive: fa ? "کیف پول امانی" : "Custodial wallet",
  }), [fa]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setWallet(await getWallet());
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
    const ids = ["polygon-ecosystem-token", "tether", "usd-coin", "ethereum", "bitcoin", "solana", "binancecoin", "tron", "ripple", "dogecoin", "cardano", "avalanche-2", "chainlink", "dai", "litecoin", "polkadot", "stellar", "wrapped-bitcoin"].join(",");
    let cancelled = false;
    const loadPrices = async () => {
      try {
        const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=" + ids + "&vs_currencies=usd", { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("PRICE_FEED_UNAVAILABLE");
        const data = await response.json() as Record<string, { usd?: number }>;
        const next: Record<string, number> = {};
        for (const [id, quote] of Object.entries(data)) { if (typeof quote.usd === "number" && Number.isFinite(quote.usd)) next[id] = quote.usd; }
        if (!cancelled) { setUsdPrices(next); setPriceUpdatedAt(Date.now()); }
      } catch { /* Keep last known prices if the provider is temporarily unavailable. */ }
    };
    void loadPrices();
    const interval = window.setInterval(() => { void loadPrices(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  const polygonNetwork = wallet?.networks.find((network) => network.chainId === 137) ?? null;
  const polygonAssets = polygonNetwork?.assets ?? [];
  const depositAssets = polygonAssets.filter((asset) => asset.depositEnabled);
  const withdrawalAssets = polygonAssets.filter((asset) => asset.withdrawalEnabled);
  const usdt0Asset = polygonAssets.find((asset) => asset.symbol === "USDT0") ?? null;
  const polAsset = polygonAssets.find((asset) => asset.symbol === "POL") ?? null;
  const selectedWithdrawAsset = withdrawalAssets.find((asset) => asset.id === withdrawAssetId) ?? null;

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
    if (!asset || !polygonNetwork) {
      setDepositAssetId("");
      setDepositError(copy.depositDisabled);
      setDepositLoading(false);
      return;
    }
    setDepositAssetId(asset.id);
    setDepositLoading(true);
    try {
      const details = await requestWalletDeposit(polygonNetwork.id, asset.id);
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
    setView("withdraw");
    setWithdrawAssetId(asset?.id ?? "");
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
    if (!polygonNetwork || !selectedWithdrawAsset || !withdrawAmount || !withdrawAddress) return;
    setWithdrawSubmitting(true);
    setWithdrawError("");
    try {
      const result = await requestWalletWithdrawal({
        networkId: polygonNetwork.id,
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

  const usdt0Balance = usdt0Asset?.balance ?? "0";
  const usdt0Available = usdt0Asset?.availableBalance ?? "0";
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
        <div><div className="section-title">{copy.title}</div><p>{copy.assetsNote}</p></div>
        <button type="button" className="wallet-refresh" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "…" : "↻"} {copy.refresh}</button>
      </div>

      {!wallet && !error && <div className="inline-feedback"><LoadingIndicator label={copy.loading} /></div>}
      {error && <p className="inline-feedback wallet-error" role="alert">{error}</p>}
      {wallet?.walletProvisioningReviewRequired && <div className="wallet-warning" role="alert"><strong>⚠ {copy.unavailable}</strong><p>{copy.reviewRequired}</p></div>}

      {wallet && view === "overview" && <>
        <section className="wallet-exchange-balance">
          <div className="wallet-exchange-balance__top">
            <span>{copy.balance}</span>
            <span className="wallet-safe-pill">● {depositAssets.length > 0 ? copy.active : copy.unavailable}</span>
          </div>
          <div className="wallet-exchange-balance__value">{usdFormatter.format(usdBalance)}</div>
          <div className="wallet-exchange-balance__available">{copy.balanceNote}</div>
          {unpricedAssetCount > 0 && <div className="wallet-exchange-balance__available">{copy.partialPriceNote}</div>}
          {priceUpdatedAt && <div className="wallet-exchange-balance__available">{fa ? "آخرین به‌روزرسانی قیمت: " : "Prices updated: "}{new Date(priceUpdatedAt).toLocaleTimeString(locale)}</div>}
          <div className="wallet-exchange-balance__available">{fa ? "موجودی USDT0" : "USDT0 balance"}: <strong>{fmt(usdt0Balance, usdt0Asset?.decimals ?? 6)} USDT0</strong> · {copy.available}: <strong>{fmt(usdt0Available, usdt0Asset?.decimals ?? 6)} USDT0</strong></div>
          <div className="wallet-exchange-actions">
            <button type="button" className="wallet-action wallet-action--deposit" onClick={() => void openDeposit()}><span>↓</span>{copy.deposit}</button>
            <button type="button" className="wallet-action wallet-action--withdraw" onClick={() => openWithdraw()}><span>↑</span>{copy.withdraw}</button>
          </div>
        </section>

        <section className="wallet-network-card wallet-assets-directory">
          <div className="wallet-card-heading"><h2>{copy.assetsTitle}</h2><span>{wallet.networks.reduce((count, network) => count + network.assets.length, 0)}</span></div>
          <p className="wallet-assets-note">{copy.assetsNote}</p>
          {wallet.networks.map((network) => (
            <div className="wallet-network-group" key={network.id}>
              <div className="wallet-network-group__heading">
                <span className="wallet-network-dot" />
                <div><strong>{network.displayName}</strong><small>{network.family === "EVM" ? (fa ? "شبکه سازگار با EVM" : "EVM-compatible network") : network.family === "BITCOIN" ? "Bitcoin" : "Solana"}</small></div>
                <span className={network.depositEnabled || network.withdrawalEnabled ? "wallet-network-status wallet-network-status--active" : "wallet-network-status"}>{network.depositEnabled || network.withdrawalEnabled ? copy.active : copy.unavailable}</span>
              </div>
              {network.assets.length === 0 ? <p className="wallet-asset-empty">{fa ? "دارایی ثبت‌شده‌ای برای این شبکه وجود ندارد." : "No registered assets on this network."} </p> :
                network.assets.map((asset) => <div className="wallet-asset-row" key={asset.id}>
                  <div className="wallet-asset-row__identity">
                    <span className="wallet-asset-symbol">{asset.symbol.slice(0, 4)}</span>
                    <div><strong>{asset.symbol}</strong><small>{asset.displayName}</small></div>
                  </div>
                  <div className="wallet-asset-row__balance">
                    <strong>{fmt(asset.balance, asset.decimals)} {asset.symbol}</strong>
                    <small>{fa ? "قابل استفاده" : "Available"}: {fmt(asset.availableBalance, asset.decimals)} {asset.symbol}</small>
                  </div>
                  <div className="wallet-asset-row__meta">
                    <span className={asset.depositEnabled ? "wallet-status-on" : "wallet-status-off"}>{asset.depositEnabled ? copy.active : copy.unavailable}</span>
                    <span className={asset.withdrawalEnabled ? "wallet-status-on" : "wallet-status-off"}>{asset.withdrawalEnabled ? copy.active : copy.safeWithdraw}</span>
                  </div>
                  <div className="wallet-asset-row__actions">
                    {asset.depositEnabled && <button type="button" className="wallet-asset-deposit-button" onClick={() => void openDeposit(asset.id)}>{copy.deposit}</button>}
                    {asset.withdrawalEnabled && <button type="button" className="wallet-asset-deposit-button" onClick={() => openWithdraw(asset.id)}>{copy.withdraw}</button>}
                  </div>
                </div>)}
            </div>
          ))}
        </section>

        <section className="wallet-history wallet-exchange-history">
          <div className="wallet-card-heading"><h2>{copy.history}</h2><span>{activities.length}</span></div>
          {activities.length === 0 ? <div className="wallet-empty"><span>↔</span><p>{copy.empty}</p></div> : <div className="wallet-table">
            <div className="wallet-table-head"><span>{copy.type}</span><span>{copy.date}</span><span>{copy.amountColumn}</span></div>
            {activities.slice(0, 100).map((item) => <article className="wallet-transaction" key={item.id}>
              <div><strong>{item.type}</strong><small>{item.status}{item.note ? " · " + item.note : ""}</small></div>
              <small>{new Date(item.createdAt).toLocaleString(locale)}</small>
              <div><b>{fmt(item.amount)} <small>{item.currency}</small></b>
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
          <div className="wallet-select-static"><span className="wallet-network-dot" />{polygonNetwork?.displayName ?? copy.polygon}</div>
        </div>
        <div className="wallet-form-field">
          <label>{copy.asset}</label>
          <div className="wallet-exchange-actions">
            {depositAssets.map((asset) => <button key={asset.id} type="button" className="wallet-asset-deposit-button" aria-pressed={depositAssetId === asset.id} onClick={() => changeDepositAsset(asset.id)}>{asset.symbol}</button>)}
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
        <button type="button" className="wallet-submit" disabled={!depositDetails}>{depositDetails ? (fa ? "آدرس آمادهٔ دریافت است" : "Deposit address ready") : copy.unavailable}</button>
      </section>}

      {wallet && view === "withdraw" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--withdraw">↑</div>
        <h1>{copy.withdrawTitle}</h1><p className="wallet-flow-intro">{copy.withdrawIntro}</p>
        <div className="wallet-form-field"><label>{copy.network}</label><div className="wallet-select-static"><span className="wallet-network-dot" />{polygonNetwork?.displayName ?? copy.polygon}</div></div>
        {selectedWithdrawAsset ? <>
          <div className="wallet-form-field"><label>{copy.asset}</label><div className="wallet-select-static">{selectedWithdrawAsset.symbol} <span>{selectedWithdrawAsset.displayName}</span></div></div>
          <div className="wallet-form-field">
            <label>{copy.amount}</label>
            <div className="wallet-input-wrap"><input inputMode="decimal" value={withdrawAmount} onChange={(event) => { setWithdrawAmount(event.target.value.replace(/[^0-9.]/g, "")); setWithdrawIdempotencyKey(createIdempotencyKey()); setWithdrawResult(null); }} placeholder="0.00" /><span>{selectedWithdrawAsset.symbol}</span></div>
            <small>{copy.available}: {fmt(selectedWithdrawAsset.availableBalance, selectedWithdrawAsset.decimals)} {selectedWithdrawAsset.symbol}</small>
          </div>
          <div className="wallet-form-field"><label>{copy.destination}</label><input className="wallet-address-input" value={withdrawAddress} onChange={(event) => { setWithdrawAddress(event.target.value); setWithdrawIdempotencyKey(createIdempotencyKey()); setWithdrawResult(null); }} placeholder="0x..." autoComplete="off" /></div>
          <div className="wallet-fee-row"><span>{copy.polGasBalance}</span><strong>{fmt(polAsset?.availableBalance ?? "0", polAsset?.decimals ?? 18)} POL</strong></div>
          <div className="wallet-fee-row"><span>{copy.fee}</span><strong>{withdrawResult?.fee ? formatAtomic(withdrawResult.fee, withdrawResult.feeDecimals ?? 18, locale) + " " + (withdrawResult.feeAsset ?? "POL") : "— POL"}</strong></div>
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
