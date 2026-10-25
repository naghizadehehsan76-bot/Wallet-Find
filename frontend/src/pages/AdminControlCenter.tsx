import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useI18n } from "../i18n";
import LanguageSwitcher from "../components/LanguageSwitcher";
import {
  getAdminAuditLogs,
  getAdminOverview,
  getAdminWallets,
  getSystemSettings,
  saveSystemSetting,
  type AdminAuditLog,
  type AdminOverview,
  type AdminWalletSummary,
  type SystemSettingRecord,
} from "../services/api";

type AdminDestination = "home" | "admin-manage";

type Props = { onNavigate: (page: AdminDestination) => void };
type Section = "overview" | "users" | "finance" | "prizes" | "ads" | "security" | "support" | "wallets" | "settings" | "audit";

export default function AdminControlCenter({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const [section, setSection] = useState<Section>("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [settings, setSettings] = useState<SystemSettingRecord[]>([]);
  const [wallets, setWallets] = useState<AdminWalletSummary[]>([]);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [hypotheticalPoolAmount, setHypotheticalPoolAmount] = useState("100");

  const copy = {
    title: fa ? "مرکز کنترل Wallet-Find" : "Wallet-Find Control Center",
    subtitle: fa ? "مدیریت مرکزی سایت، تنظیمات و رویدادهای مدیریتی" : "Central administration for site settings and operational activity",
    overview: fa ? "نمای کلی" : "Overview",
    usersTab: fa ? "مدیریت کاربران" : "Users",
    finance: fa ? "امور مالی" : "Finance",
    prizes: fa ? "صندوق جوایز و تسویه" : "Prize pool & settlement",
    ads: fa ? "تبلیغات و اسپانسرها" : "Ads & sponsors",
    security: fa ? "امنیت و ضدتقلب" : "Security & anti-fraud",
    support: fa ? "پشتیبانی و گزارش‌ها" : "Support & reports",
    settings: fa ? "تنظیمات سایت" : "Site settings",
    wallets: fa ? "کیف پول و تراکنش‌ها" : "Wallets & transactions",
    walletBalance: fa ? "موجودی آزمایشی" : "Simulated balance",
    walletAvailable: fa ? "موجودی قابل برداشت" : "Available balance",
    pendingDeposits: fa ? "واریزهای در انتظار" : "Pending deposits",
    pendingWithdrawals: fa ? "برداشت‌های در انتظار" : "Pending withdrawals",
    noWallets: fa ? "کاربری برای نمایش وجود ندارد." : "No users to display.",
    walletNote: fa ? "این فهرست فقط دفترکل آزمایشی را نشان می‌دهد؛ پرداخت واقعی انجام نمی‌شود." : "This list shows simulated ledger balances only; no real payments are made.",
    audit: fa ? "گزارش فعالیت‌ها" : "Activity log",
    users: fa ? "کاربران" : "Users",
    contests: fa ? "چالش‌های ثبت‌شده" : "Challenges",
    active: fa ? "چالش فعال" : "Active challenges",
    submissions: fa ? "پاسخ‌های ثبت‌شده" : "Answer submissions",
    adOrders: fa ? "سفارش‌های تبلیغاتی" : "Ad orders",
    pendingPayments: fa ? "پرداخت‌های تبلیغاتی در انتظار" : "Pending ad payments",
    reload: fa ? "به‌روزرسانی اطلاعات" : "Refresh data",
    newSetting: fa ? "افزودن تنظیم" : "Add setting",
    keyLabel: fa ? "کلید تنظیم (انگلیسی و بدون فاصله)" : "Setting key (English, no spaces)",
    valueLabel: fa ? "مقدار" : "Value",
    save: fa ? "ذخیره" : "Save setting",
    saving: fa ? "در حال ذخیره…" : "Saving…",
    saved: fa ? "تنظیم ذخیره شد." : "Setting saved.",
    empty: fa ? "هنوز تنظیمی ثبت نشده است." : "No settings have been saved yet.",
    noLogs: fa ? "هنوز رویداد مدیریتی ثبت نشده است." : "No administrative events found.",
    action: fa ? "عملیات" : "Action",
    entity: fa ? "بخش" : "Area",
    actor: fa ? "انجام‌دهنده" : "Actor",
    date: fa ? "زمان" : "Time",
    modules: fa ? "بخش‌های قابل توسعه" : "Control modules",
    sponsors: fa ? "اسپانسرها" : "Sponsors",
    planned: fa ? "در مراحل بعدی پیاده‌سازی می‌شود" : "Planned for a later implementation phase",
    back: fa ? "بازگشت به سایت" : "Back to site",
    loading: fa ? "در حال دریافت اطلاعات…" : "Loading dashboard…",
    refreshError: fa ? "دریافت اطلاعات ناموفق بود. دسترسی مدیر و اتصال سرور را بررسی کن." : "Could not load dashboard data. Check admin access and server connectivity.",
    keyError: fa ? "کلید باید با حرف انگلیسی شروع شود و فقط شامل حروف، عدد، نقطه، خط تیره یا زیرخط باشد." : "Key must start with a letter and contain only letters, numbers, dots, dashes or underscores.",
    poolTitle: fa ? "استخر جایزهٔ فرضی هر دور" : "Hypothetical prize pool per round",
    poolAmount: fa ? "مقدار پایه برای هر دور (USDT فرضی)" : "Base amount per round (simulated USDT)",
    poolHelp: fa ? "این مبلغ فقط در دفترکل آزمایشی ثبت می‌شود و هیچ انتقال واقعی رمزارز انجام نمی‌دهد. مبالغ انتقالی از دورهای قبل جداگانه به آن اضافه می‌شوند." : "This amount is recorded only in the simulated ledger; no real crypto is transferred. Rollover from previous rounds is added separately.",
    savePool: fa ? "ذخیرهٔ استخر جایزه" : "Save prize pool amount",
    invalidPool: fa ? "مبلغ باید عددی مثبت با حداکثر ۶ رقم اعشار باشد." : "Enter a positive amount with up to 6 decimal places.",
    poolSaved: fa ? "مبلغ پایهٔ استخر جایزه برای دورهای جدید ذخیره شد." : "Base prize pool amount saved for new rounds.",
    conceptTitle: fa ? "بخش در حال طراحی" : "Module concept",
    conceptBody: fa ? "این بخش فعلاً فقط به‌عنوان جایگاه در پنل مدیریت اضافه شده است. قابلیت‌ها و عملیات آن در مراحل بعدی، جداگانه طراحی و پیاده‌سازی می‌شوند." : "This section is currently a placeholder in the admin panel. Its tools and workflows will be designed and implemented separately in later phases.",
    usersBody: fa ? "جست‌وجو و مشاهدهٔ کاربران، نقش‌ها، وضعیت حساب، تأیید ایمیل و محدودیت‌های دسترسی." : "Search users, review roles and account status, email verification, and access restrictions.",
    financeBody: fa ? "بررسی تراکنش‌ها، درخواست‌های واریز و برداشت، دفترکل و مغایرت‌های مالی." : "Review transactions, deposit and withdrawal requests, the ledger, and financial discrepancies.",
    prizesBody: fa ? "مشاهدهٔ صندوق هر دور، انتقال مانده، جوایز ثبت‌شده، تسویه‌ها و گزارش حسابداری آزمایشی یا واقعی." : "Inspect each round's prize pool, rollover, awards, settlements, and simulated or real accounting.",
    adsBody: fa ? "مدیریت تبلیغ‌دهندگان، اسپانسرها، کمپین‌ها، سفارش‌ها و وضعیت پرداخت تبلیغات." : "Manage advertisers, sponsors, campaigns, orders, and advertising payment status.",
    securityBody: fa ? "بررسی فعالیت مشکوک، تلاش‌های ورود، گزارش‌های ضدتقلب، مسدودسازی و کنترل دسترسی مدیران." : "Review suspicious activity, login attempts, anti-fraud alerts, account restrictions, and administrator access.",
    supportBody: fa ? "مدیریت پیام‌های پشتیبانی، گزارش خطا، شکایت‌ها و درخواست‌های کاربران." : "Handle support messages, bug reports, complaints, and user requests.",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [stats, settingRows, auditRows, walletRows] = await Promise.all([
        getAdminOverview(),
        getSystemSettings(),
        getAdminAuditLogs(),
        getAdminWallets(),
      ]);
      setOverview(stats);
      setSettings(settingRows);
      setHypotheticalPoolAmount(settingRows.find((setting) => setting.key === "hypothetical_prize_pool_per_round")?.value ?? "100");
      setLogs(auditRows);
      setWallets(walletRows);
    } catch {
      setError(copy.refreshError);
    } finally {
      setLoading(false);
    }
  }, [copy.refreshError]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const normalizedKey = key.trim();
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(normalizedKey)) {
      setError(copy.keyError);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveSystemSetting(normalizedKey, value);
      setNotice(copy.saved);
      setKey("");
      setValue("");
      await load();
    } catch {
      setError(copy.refreshError);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveHypotheticalPool(event: FormEvent) {
    event.preventDefault();
    const amount = hypotheticalPoolAmount.trim();
    if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
      setError(copy.invalidPool);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveSystemSetting("hypothetical_prize_pool_per_round", amount);
      setNotice(copy.poolSaved);
      await load();
    } catch {
      setError(copy.refreshError);
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(setting: SystemSettingRecord) {
    const edited = window.prompt(fa ? "مقدار جدید برای " + setting.key : "New value for " + setting.key, setting.value);
    if (edited === null || edited === setting.value) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveSystemSetting(setting.key, edited);
      setNotice(copy.saved);
      await load();
    } catch {
      setError(copy.refreshError);
    } finally {
      setSaving(false);
    }
  }

  const metricCards = overview ? [
    { label: copy.users, value: overview.users, icon: "◎" },
    { label: copy.contests, value: overview.contests, icon: "▦" },
    { label: copy.active, value: overview.activeContests, icon: "●" },
    { label: copy.submissions, value: overview.submissions, icon: "⌁" },
    { label: copy.adOrders, value: overview.advertiserOrders, icon: "▤" },
    { label: copy.pendingPayments, value: overview.pendingAdPayments, icon: "◷" },
  ] : [];

  return (
    <div className="app-shell admin-center-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" onClick={() => onNavigate("home")} aria-label={copy.back}>
          <span className="brand-dot" />
          <span>Wallet Find <small>{fa ? "مدیریت" : "ADMIN"}</small></span>
        </button>
        <div className="topbar-actions"><LanguageSwitcher /></div>
      </header>
      <main className="page admin-center">
        <div className="admin-center__heading">
          <div>
            <div className="eyebrow">WALLET-FIND / CONTROL</div>
            <h1 className="page-title">{copy.title}</h1>
            <p className="date">{copy.subtitle}</p>
          </div>
          <button className="admin-refresh" type="button" onClick={() => void load()} disabled={loading}>↻</button>
        </div>

        <nav className="admin-center__tabs" aria-label={copy.title}>
          {([
            ["overview", copy.overview],
            ["users", copy.usersTab],
            ["finance", copy.finance],
            ["wallets", copy.wallets],
            ["prizes", copy.prizes],
            ["ads", copy.ads],
            ["security", copy.security],
            ["support", copy.support],
            ["settings", copy.settings],
            ["audit", copy.audit],
          ] as [Section, string][]).map(([item, label]) => (
            <button key={item} type="button" className={section === item ? "is-active" : ""} onClick={() => setSection(item)}>
              {label}
            </button>
          ))}
        </nav>

        {error && <div className="admin-message admin-message--error" role="alert">{error}</div>}
        {notice && <div className="admin-message" role="status">{notice}</div>}
        {loading && !overview ? <div className="admin-empty">{copy.loading}</div> : null}

        {section === "overview" && (
          <>
            <section className="admin-metrics-grid">
              {metricCards.map((card) => (
                <article className="admin-metric-card" key={card.label}>
                  <span className="admin-metric-card__icon">{card.icon}</span>
                  <span className="admin-metric-card__label">{card.label}</span>
                  <strong>{card.value.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
                </article>
              ))}
            </section>
            <h2 className="section-title">{copy.modules}</h2>
            <section className="admin-module-grid">
              {[
                { icon: "◈", label: copy.finance },
                { icon: "✦", label: copy.sponsors },
                { icon: "▣", label: copy.ads },
                { icon: "⌑", label: copy.security },
              ].map((module) => (
                <article className="admin-module-card" key={module.label}>
                  <span>{module.icon}</span>
                  <strong>{module.label}</strong>
                  <small>{copy.planned}</small>
                </article>
              ))}
            </section>
            {overview?.generatedAt && <p className="admin-footnote">{fa ? "آخرین بروزرسانی: " : "Last refreshed: "}{new Date(overview.generatedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</p>}
          </>
        )}

        {(["users", "finance", "prizes", "ads", "security", "support"] as Section[]).includes(section) && (
          <section className="admin-panel">
            <h2>{({
              users: copy.usersTab,
              finance: copy.finance,
              prizes: copy.prizes,
              ads: copy.ads,
              security: copy.security,
              support: copy.support,
            } as Record<string, string>)[section]}</h2>
            <p>{copy.conceptTitle}</p>
            <p className="admin-footnote">{({
              users: copy.usersBody,
              finance: copy.financeBody,
              prizes: copy.prizesBody,
              ads: copy.adsBody,
              security: copy.securityBody,
              support: copy.supportBody,
            } as Record<string, string>)[section]}</p>
            <p className="admin-footnote">{copy.conceptBody}</p>
          </section>
        )}

        {section === "wallets" && (
          <section className="admin-panel">
            <h2>{copy.wallets}</h2>
            <p className="admin-footnote">{copy.walletNote}</p>
            {wallets.length === 0 ? <p className="admin-empty">{copy.noWallets}</p> : (
              <div className="admin-settings-list">
                {wallets.map((wallet) => (
                  <article className="admin-setting-row admin-wallet-row" key={wallet.userId}>
                    <div>
                      <strong>{wallet.username}</strong>
                      <small>{wallet.email}</small>
                      <code>{copy.walletBalance}: {Number(wallet.balance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT</code>
                      <code>{copy.walletAvailable}: {Number(wallet.availableBalance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT</code>
                      <small>{copy.pendingDeposits}: {wallet.pendingDepositRequests} · {copy.pendingWithdrawals}: {wallet.pendingWithdrawalRequests}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {section === "settings" && (
          <section className="admin-panel">
            <h2>{copy.settings}</h2>
            <form className="admin-setting-form" onSubmit={handleSaveHypotheticalPool}>
              <h3>{copy.poolTitle}</h3>
              <label>{copy.poolAmount}<input type="number" inputMode="decimal" min="0.000001" max="999999999999.999999" step="0.000001" value={hypotheticalPoolAmount} onChange={(event) => setHypotheticalPoolAmount(event.target.value)} required /></label>
              <p className="admin-footnote">{copy.poolHelp}</p>
              <button className="cta-button" type="submit" disabled={saving}>{saving ? copy.saving : copy.savePool}</button>
            </form>
            <form className="admin-setting-form" onSubmit={handleSave}>
              <label>{copy.keyLabel}<input value={key} onChange={(event) => setKey(event.target.value)} required maxLength={80} autoComplete="off" /></label>
              <label>{copy.valueLabel}<textarea value={value} onChange={(event) => setValue(event.target.value)} required maxLength={4000} rows={3} /></label>
              <button className="cta-button" type="submit" disabled={saving}>{saving ? copy.saving : copy.save}</button>
            </form>
            <div className="admin-settings-list">
              {settings.length === 0 && <p className="admin-empty">{copy.empty}</p>}
              {settings.map((setting) => (
                <article className="admin-setting-row" key={setting.key}>
                  <div><strong>{setting.key}</strong><code>{setting.value}</code><small>{new Date(setting.updatedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small></div>
                  <button type="button" onClick={() => void handleEdit(setting)} disabled={saving}>{fa ? "ویرایش" : "Edit"}</button>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "audit" && (
          <section className="admin-panel">
            <h2>{copy.audit}</h2>
            {logs.length === 0 ? <p className="admin-empty">{copy.noLogs}</p> : (
              <div className="admin-audit-list">
                {logs.map((log) => (
                  <article className="admin-audit-row" key={log.id}>
                    <div className="admin-audit-row__top"><strong>{log.action}</strong><time>{new Date(log.createdAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</time></div>
                    <p>{copy.entity}: {log.entity}{log.entityId ? " · " + log.entityId : ""}</p>
                    <small>{copy.actor}: {log.user?.username ?? log.user?.email ?? (fa ? "سیستم" : "System")}</small>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
