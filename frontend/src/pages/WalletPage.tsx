import { useCallback, useEffect, useState, type FormEvent } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";
import { getWallet, requestWalletDeposit, requestWalletWithdrawal, type WalletResult } from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type Page = "home" | "auth" | "competition" | "key" | "leaderboard" | "profile" | "wallet";
type Props = { onNavigate: (page: Page) => void };

export default function WalletPage({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const [wallet, setWallet] = useState<WalletResult | null>(null);
  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const copy = {
    title: fa ? "کیف پول من" : "My wallet",
    balance: fa ? "موجودی کل آزمایشی" : "Simulated balance",
    available: fa ? "موجودی قابل برداشت" : "Available balance",
    demo: fa ? "این کیف پول آزمایشی است؛ هیچ رمزارز واقعی واریز یا برداشت نمی‌شود." : "This is a simulated wallet; no real cryptocurrency is deposited or withdrawn.",
    deposit: fa ? "واریز" : "Deposit", withdraw: fa ? "برداشت" : "Withdraw",
    amount: fa ? "مبلغ (USDT فرضی)" : "Amount (simulated USDT)",
    send: fa ? "ثبت درخواست" : "Submit request",
    history: fa ? "تاریخچه کیف پول" : "Wallet history",
    empty: fa ? "هنوز تراکنشی ثبت نشده است." : "No wallet transactions yet.",
    loading: fa ? "در حال دریافت موجودی..." : "Loading wallet...",
    busy: fa ? "در حال ثبت..." : "Submitting...",
    depositHelp: fa ? "درخواست واریز فقط ثبت می‌شود و تا تأیید مدیر به موجودی اضافه نمی‌شود." : "A deposit request is recorded only; it will not increase your balance unless approved by an administrator.",
    withdrawHelp: fa ? "درخواست برداشت فقط ثبت می‌شود؛ در این نسخه هیچ پرداخت واقعی انجام نمی‌شود." : "A withdrawal request is recorded only; no real payment is made in this version.",
    pending: fa ? "در انتظار بررسی" : "Pending", completed: fa ? "تکمیل‌شده" : "Completed", rejected: fa ? "ردشده" : "Rejected",
    prize: fa ? "جایزه مسابقه" : "Challenge prize",
    depRequest: fa ? "درخواست واریز" : "Deposit request",
    withRequest: fa ? "درخواست برداشت" : "Withdrawal request",
    depositCredit: fa ? "واریز تأییدشده" : "Approved deposit",
    withdrawal: fa ? "برداشت تأییدشده" : "Approved withdrawal",
    badAmount: fa ? "مبلغ معتبر و مثبت با حداکثر ۶ رقم اعشار وارد کن." : "Enter a positive amount with up to 6 decimal places.",
    successDeposit: fa ? "درخواست واریز ثبت شد؛ موجودی پس از تأیید تغییر می‌کند." : "Deposit request submitted; balance changes only after approval.",
    successWithdraw: fa ? "درخواست برداشت ثبت شد." : "Withdrawal request submitted.",
    insufficient: fa ? "موجودی قابل برداشت کافی نیست." : "Insufficient available balance.",
    error: fa ? "خطا در ارتباط با سرور. دوباره تلاش کن." : "Server error. Please try again.",
    nav: fa ? "خانه" : "Home",
  };
  const refresh = useCallback(async () => {
    try { setWallet(await getWallet()); }
    catch { setError(copy.error); }
  }, [copy.error]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount.trim()) || Number(amount) <= 0) { setError(copy.badAmount); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "deposit") { await requestWalletDeposit(amount.trim()); setNotice(copy.successDeposit); }
      else { await requestWalletWithdrawal(amount.trim()); setNotice(copy.successWithdraw); }
      setAmount(""); await refresh();
    } catch (e) {
      setError(e instanceof Error && e.message === "INSUFFICIENT_WALLET_BALANCE" ? copy.insufficient : e instanceof Error && e.message === "INVALID_WALLET_AMOUNT" ? copy.badAmount : copy.error);
    } finally { setBusy(false); }
  }
  const fmt = (value: string) => Number(value).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const typeLabel = (type: string) => type === "PRIZE_CREDIT" ? copy.prize : type === "DEPOSIT_REQUEST" ? copy.depRequest : type === "WITHDRAWAL_REQUEST" ? copy.withRequest : type === "DEPOSIT" ? copy.depositCredit : type === "WITHDRAWAL" ? copy.withdrawal : type;
  const statusLabel = (status: string) => status === "PENDING" ? copy.pending : status === "COMPLETED" ? copy.completed : status === "REJECTED" ? copy.rejected : status;

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
          <p className="wallet-demo-note">{copy.demo}</p>
        </section>
        <section className="wallet-actions">
          <div className="wallet-action-tabs" role="tablist">
            <button type="button" className={action === "deposit" ? "is-active" : ""} onClick={() => { setAction("deposit"); setError(""); setNotice(""); }}>{copy.deposit}</button>
            <button type="button" className={action === "withdraw" ? "is-active" : ""} onClick={() => { setAction("withdraw"); setError(""); setNotice(""); }}>{copy.withdraw}</button>
          </div>
          <form className="wallet-action-form" onSubmit={submit}>
            <label>{copy.amount}<input type="number" inputMode="decimal" min="0.000001" step="0.000001" max="999999999999.999999" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
            <p className="wallet-demo-note">{action === "deposit" ? copy.depositHelp : copy.withdrawHelp}</p>
            <button className="cta-button" type="submit" disabled={busy}>{busy ? copy.busy : copy.send}</button>
          </form>
        </section>
        <section className="wallet-history">
          <h2>{copy.history}</h2>
          {wallet.transactions.length === 0 ? <p>{copy.empty}</p> : wallet.transactions.map(item => <article className="wallet-transaction" key={item.id}>
            <div><strong>{typeLabel(item.type)}</strong><small>{new Date(item.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}</small><small>{statusLabel(item.status)}</small></div>
            <b className={item.type === "PRIZE_CREDIT" || item.type === "DEPOSIT" ? "wallet-credit" : ""}>{item.type === "PRIZE_CREDIT" || item.type === "DEPOSIT" ? "+" : ""}{fmt(item.amount)} USDT</b>
          </article>)}
        </section>
      </>}
      {error && <p className="inline-feedback wallet-error" role="alert">{error}</p>}
      {notice && <p className="inline-feedback wallet-success" role="status">{notice}</p>}
    </main>
    <BottomNav activePage="wallet" onNavigate={onNavigate} />
  </div>;
}
