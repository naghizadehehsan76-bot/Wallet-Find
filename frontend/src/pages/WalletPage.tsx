import { useCallback, useEffect, useMemo, useState } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";
import { getWallet, type WalletResult } from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type Page = "home" | "auth" | "competition" | "key" | "leaderboard" | "profile" | "wallet";
type Props = { onNavigate: (page: Page) => void };
type WalletView = "overview" | "deposit" | "withdraw";

export default function WalletPage({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const [wallet, setWallet] = useState<WalletResult | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<WalletView>("overview");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const copy = useMemo(() => ({
    title: fa ? "کیف پول من" : "My wallet",
    balance: fa ? "موجودی کل" : "Total balance",
    available: fa ? "موجودی قابل برداشت" : "Available balance",
    deposit: fa ? "واریز" : "Deposit",
    withdraw: fa ? "برداشت" : "Withdraw",
    history: fa ? "تاریخچه تراکنش‌ها" : "Transaction history",
    empty: fa ? "هنوز تراکنش واقعی ثبت نشده است." : "No transactions yet.",
    loading: fa ? "در حال دریافت کیف پول..." : "Loading wallet...",
    error: fa ? "دریافت اطلاعات کیف پول ناموفق بود." : "Unable to load wallet information.",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    overview: fa ? "نمای کلی" : "Overview",
    network: fa ? "شبکه" : "Network",
    asset: fa ? "دارایی" : "Asset",
    polygon: fa ? "Polygon PoS" : "Polygon PoS",
    token: "USDT0",
    depositTitle: fa ? "واریز ارز دیجیتال" : "Crypto deposit",
    withdrawTitle: fa ? "برداشت ارز دیجیتال" : "Crypto withdrawal",
    depositIntro: fa ? "برای دریافت دارایی، شبکه و توکن را با دقت بررسی کنید." : "Choose the correct network and asset before depositing.",
    withdrawIntro: fa ? "مقدار و آدرس مقصد را با دقت وارد کنید." : "Enter the amount and destination address carefully.",
    receiveAddress: fa ? "آدرس کیف پول شما" : "Your wallet address",
    copyAddress: fa ? "کپی آدرس" : "Copy address",
    copied: fa ? "آدرس کپی شد" : "Address copied",
    amount: fa ? "مقدار" : "Amount",
    destination: fa ? "آدرس مقصد" : "Destination address",
    max: fa ? "حداکثر" : "MAX",
    fee: fa ? "کارمزد شبکه" : "Network fee",
    youReceive: fa ? "مقدار دریافتی" : "You will receive",
    continue: fa ? "ادامه" : "Continue",
    unavailable: fa ? "فعلاً غیرفعال" : "Currently unavailable",
    disabledDeposit: fa ? "واریز هنوز فعال نشده است. اسکنر شبکه و تأیید واریز باید ابتدا راه‌اندازی و آزمایش شود. لطفاً هیچ ارزی به این آدرس ارسال نکنید." : "Deposits are not enabled yet. The network scanner and confirmation process must be deployed and tested first. Do not send funds to this address.",
    disabledWithdraw: fa ? "برداشت هنوز فعال نشده است. تا تکمیل بررسی امنیتی و فعال‌شدن پردازش تراکنش، امکان ارسال ارز وجود ندارد." : "Withdrawals are not enabled yet. Transfers remain unavailable until the signing and security process is fully tested.",
    back: fa ? "بازگشت به کیف پول" : "Back to wallet",
    addressRequired: fa ? "آدرس کیف پول هنوز در دسترس نیست." : "Wallet address is not available yet.",
    status: fa ? "وضعیت سرویس" : "Service status",
    safeMode: fa ? "حالت ایمن؛ انتقال واقعی غیرفعال است" : "Safe mode · transfers disabled",
    type: fa ? "نوع" : "Type",
    date: fa ? "تاریخ" : "Date",
    amountColumn: fa ? "مقدار" : "Amount",
  }), [fa]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setWallet(await getWallet()); setError(""); }
    catch { setError(copy.error); }
    finally { setRefreshing(false); }
  }, [copy.error]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const fmt = (value: string) => Number(value).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const address = wallet?.walletAddress ?? null;
  const polygonNetwork = wallet?.supportedNetworks?.find((item) => item.chainId === 137);
  const withdrawalEnabled = Boolean(polygonNetwork?.withdrawalEnabled);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return <div className="app-shell wallet-page">
    <header className="topbar"><button className="brand brand--home" type="button" aria-label={copy.title} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button></header>
    <main className="page wallet-exchange">
      <div className="wallet-page-heading">
        <div><div className="section-title">{copy.title}</div><p>{copy.safeMode}</p></div>
        <button type="button" className="wallet-refresh" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "…" : "↻"} {copy.refresh}</button>
      </div>

      {!wallet && !error && <div className="inline-feedback"><LoadingIndicator label={copy.loading} /></div>}
      {error && <p className="inline-feedback wallet-error" role="alert">{error}</p>}

      {wallet && view === "overview" && <>
        <section className="wallet-exchange-balance">
          <div className="wallet-exchange-balance__top"><span>{copy.balance}</span><span className="wallet-safe-pill">● {copy.safeMode}</span></div>
          <div className="wallet-exchange-balance__value">{fmt(wallet.balance)} <small>USDT</small></div>
          <div className="wallet-exchange-balance__available">{copy.available}: <strong>{fmt(wallet.availableBalance)} USDT</strong></div>
          <div className="wallet-exchange-actions">
            <button type="button" className="wallet-action wallet-action--deposit" onClick={() => setView("deposit")}><span>↓</span>{copy.deposit}</button>
            <button type="button" className="wallet-action wallet-action--withdraw" onClick={() => setView("withdraw")}><span>↑</span>{copy.withdraw}</button>
          </div>
        </section>

        <section className="wallet-network-card">
          <div className="wallet-card-heading"><h2>{fa ? "شبکه و دارایی" : "Network & asset"}</h2><span className="wallet-network-status">{copy.unavailable}</span></div>
          <div className="wallet-network-row"><span>{copy.network}</span><strong><i className="wallet-network-dot" />{copy.polygon}</strong></div>
          <div className="wallet-network-row"><span>{copy.asset}</span><strong>{copy.token}</strong></div>
          <div className="wallet-network-row"><span>{copy.status}</span><strong className="wallet-status-off">{copy.unavailable}</strong></div>
        </section>

        <section className="wallet-history wallet-exchange-history">
          <div className="wallet-card-heading"><h2>{copy.history}</h2><span>{wallet.transactions.length}</span></div>
          {wallet.transactions.length === 0 ? <div className="wallet-empty"><span>↔</span><p>{copy.empty}</p></div> : <div className="wallet-table">
            <div className="wallet-table-head"><span>{copy.type}</span><span>{copy.date}</span><span>{copy.amountColumn}</span></div>
            {wallet.transactions.map(item => <article className="wallet-transaction" key={item.id}>
              <div><strong>{item.type}</strong><small>{item.status}</small></div>
              <small>{new Date(item.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}</small>
              <b>{fmt(item.amount)} <small>{item.currency}</small></b>
            </article>)}
          </div>}
        </section>
      </>}

      {wallet && view === "deposit" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--deposit">↓</div>
        <h1>{copy.depositTitle}</h1><p className="wallet-flow-intro">{copy.depositIntro}</p>
        <div className="wallet-form-field"><label>{copy.network}</label><div className="wallet-select-static"><span className="wallet-network-dot" />{copy.polygon}<span>⌄</span></div></div>
        <div className="wallet-form-field"><label>{copy.asset}</label><div className="wallet-select-static">USDT0 <span>Polygon PoS</span></div></div>
        <div className="wallet-deposit-address">
          <label>{copy.receiveAddress}</label>
          {address ? <><code>{address}</code><button type="button" onClick={() => void copyAddress()}>{copied ? "✓ " + copy.copied : copy.copyAddress}</button></> : <p>{copy.addressRequired}</p>}
        </div>
        <div className="wallet-warning"><strong>⚠ {copy.unavailable}</strong><p>{copy.disabledDeposit}</p></div>
        <button type="button" className="wallet-submit" disabled>{copy.unavailable}</button>
      </section>}

      {wallet && view === "withdraw" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--withdraw">↑</div>
        <h1>{copy.withdrawTitle}</h1><p className="wallet-flow-intro">{copy.withdrawIntro}</p>
        <div className="wallet-form-field"><label>{copy.network}</label><div className="wallet-select-static"><span className="wallet-network-dot" />{copy.polygon}<span>⌄</span></div></div>
        <div className="wallet-form-field"><label>{copy.asset}</label><div className="wallet-select-static">USDT0 <span>Polygon PoS</span></div></div>
        <div className="wallet-form-field"><label>{copy.amount}</label><div className="wallet-input-wrap"><input inputMode="decimal" value={withdrawAmount} onChange={event => setWithdrawAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /><span>USDT0</span></div><small>{copy.available}: {fmt(wallet.availableBalance)} USDT</small></div>
        <div className="wallet-form-field"><label>{copy.destination}</label><input className="wallet-address-input" value={withdrawAddress} onChange={event => setWithdrawAddress(event.target.value)} placeholder="0x..." autoComplete="off" /></div>
        <div className="wallet-fee-row"><span>{copy.fee}</span><strong>—</strong></div>
        <div className="wallet-fee-row"><span>{copy.youReceive}</span><strong>{withdrawAmount && Number.isFinite(Number(withdrawAmount)) ? fmt(withdrawAmount) : "0.00"} USDT0</strong></div>
        <div className="wallet-warning"><strong>⚠ {copy.unavailable}</strong><p>{copy.disabledWithdraw}</p></div>
        <button type="button" className="wallet-submit" disabled={!withdrawalEnabled || !withdrawAmount || !withdrawAddress}>{copy.continue}</button>
      </section>}
    </main>
    <BottomNav activePage="wallet" onNavigate={onNavigate} />
  </div>;
}
