import { useCallback, useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";
import { getWallet, type WalletResult } from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type Page = "home" | "auth" | "competition" | "key" | "leaderboard" | "profile" | "wallet";
type Props = { onNavigate: (page: Page) => void };

export default function WalletPage({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const [wallet, setWallet] = useState<WalletResult | null>(null);
  const [error, setError] = useState("");
  const copy = {
    title: fa ? "کیف پول من" : "My wallet",
    balance: fa ? "موجودی واقعی" : "Real balance",
    available: fa ? "موجودی قابل‌استفاده" : "Available balance",
    notice: fa
      ? "واریز و برداشت واقعی هنوز فعال نشده است. فقط واریزهای واقعی پس از تأیید شبکه می‌توانند موجودی ایجاد کنند. هیچ موجودی آزمایشی یا جایزهٔ ساختگی ثبت نمی‌شود."
      : "Real deposits and withdrawals are not operational yet. Only deposits verified on-chain can create a balance. No simulated balance or test prize is recorded.",
    history: fa ? "تاریخچه تراکنش‌ها" : "Transaction history",
    empty: fa ? "هنوز تراکنش واقعی ثبت نشده است." : "No real transactions have been recorded.",
    loading: fa ? "در حال دریافت کیف پول..." : "Loading wallet...",
    error: fa ? "دریافت اطلاعات کیف پول ناموفق بود." : "Unable to load wallet information.",
    nav: fa ? "خانه" : "Home",
  };
  const refresh = useCallback(async () => {
    try { setWallet(await getWallet()); setError(""); }
    catch { setError(copy.error); }
  }, [copy.error]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  const fmt = (value: string) => Number(value).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  return <div className="app-shell wallet-page">
    <header className="topbar"><button className="brand brand--home" type="button" aria-label={copy.nav} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button></header>
    <main className="page">
      <div className="section-title">{copy.title}</div>
      {!wallet && !error && <div className="inline-feedback"><LoadingIndicator label={copy.loading} /></div>}
      {wallet && <>
        <section className="balance-card wallet-balance-card">
          <div className="balance-label">{copy.balance}</div>
          <div className="balance-amount mono">{fmt(wallet.balance)} <small>USDT</small></div>
          <div className="balance-network">{copy.available}: {fmt(wallet.availableBalance)} USDT</div>
          <p className="wallet-demo-note">{copy.notice}</p>
        </section>
        <section className="wallet-history">
          <h2>{copy.history}</h2>
          {wallet.transactions.length === 0 ? <p>{copy.empty}</p> : wallet.transactions.map(item => (
            <article className="wallet-transaction" key={item.id}>
              <div><strong>{item.type}</strong><small>{new Date(item.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}</small><small>{item.status}</small></div>
              <b>{fmt(item.amount)} USDT</b>
            </article>
          ))}
        </section>
      </>}
      {error && <p className="inline-feedback wallet-error" role="alert">{error}</p>}
    </main>
    <BottomNav activePage="wallet" onNavigate={onNavigate} />
  </div>;
}
