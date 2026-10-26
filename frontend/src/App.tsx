import { useEffect, useState, type ReactNode } from "react";
import AuthPage from "./pages/AuthPage";
import CompetitionPage from "./pages/CompetitionPage";
import KeyStagePage from "./pages/KeyStagePage";
import LeaderboardPage from "./pages/LeaderboardPage";
import ProfilePage from "./pages/ProfilePage";
import AdminPage from "./pages/AdminPage";
import AdminControlCenter from "./pages/AdminControlCenter";
import WalletPage from "./pages/WalletPage";
import { useI18n, type Language } from "./i18n";
import SharedLanguageSwitcher from "./components/LanguageSwitcher";
import { getActiveContest, getCurrentClue, getProfile } from "./services/api";
import "./App.css";

type AuthMode = "login" | "signup";

type Page =
  | "home"
  | "auth"
  | "competition"
  | "key"
  | "leaderboard"
  | "profile"
  | "wallet"
  | "rewards"
  | "help"
  | "terms"
  | "rules"
  | "admin"
  | "admin-manage";

const faStats = [
  { value: "۲٬۴۱۸", label: "شرکت‌کننده امشب" },
  { value: "۵۰۰ ₮", label: "جایزه چالش" },
  { value: "۰۳:۵۹", label: "تا شروع بعدی" },
];

const enStats = [
  { value: "2,418", label: "Tonight's players" },
  { value: "500 ₮", label: "Challenge prize" },
  { value: "03:59", label: "Until next start" },
];

const faSteps = [
  { number: "۰۱", title: "هر شب ساعت ۲۱:۰۰ گاوصندوق باز می‌شود و کلید اول در دسترس قرار می‌گیرد.", description: "هر کلید یک سرنخ متنی یا تصویری دارد." },
  { number: "۰۲", title: "با حل هر سرنخ، کلید بعدی باز می‌شود؛ ترتیب حل کلیدها مهم است.", description: "پاسخ اشتباه زمان تو را از دست نمی‌دهد ولی ثبت می‌شود." },
  { number: "۰۳", title: "اولین نفری که هر ۱۲ کلید را باز کند، جایزه USDT را روی پالیگان دریافت می‌کند.", description: "پرداخت خودکار و شفاف است." },
];

const enSteps = [
  { number: "01", title: "Every night at 21:00, the vault opens and the first key becomes available.", description: "Each key contains a text or visual clue." },
  { number: "02", title: "Solve each clue to unlock the next key. The order matters.", description: "Wrong answers are recorded but do not reduce your solving time." },
  { number: "03", title: "The first player to unlock all 12 keys wins the USDT prize on Polygon.", description: "Automatic and transparent payout." },
];

function HomePage({
  onNavigate,
  onAuth,
  language,
  isLoggedIn,
}: {
  onNavigate: (page: Page) => void;
  onAuth: (mode: AuthMode) => void;
  language: Language;
  isLoggedIn: boolean;
}) {
  const { translation: t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [homeTimerNow, setHomeTimerNow] = useState(() => Date.now());
  const [homeSolvedCount, setHomeSolvedCount] = useState(0);
  const isPersian = language === "fa";
  const homeProgressPercent = Math.min(100, (homeSolvedCount / 12) * 100);
  const formatHomeNumber = (value: number) => value.toLocaleString(isPersian ? "fa-IR" : "en-US");

  useEffect(() => {
    const timerId = window.setInterval(() => setHomeTimerNow(Date.now()), 250);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;

    async function refreshHomeProgress() {
      if (!isLoggedIn || !localStorage.getItem("walletFindToken")) {
        setHomeSolvedCount(0);
        return;
      }
      if (refreshing) return;
      refreshing = true;
      try {
        const contest = await getActiveContest();
        const current = await getCurrentClue(contest.id);
        if (!cancelled) {
          setHomeSolvedCount(Math.max(0, Math.min(12, current.solvedCount ?? 0)));
        }
      } catch {
        // Keep the last confirmed count during brief network or server interruptions.
      } finally {
        refreshing = false;
      }
    }

    void refreshHomeProgress();
    const intervalId = window.setInterval(() => void refreshHomeProgress(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);
  const stats = isPersian ? faStats : enStats;
  const steps = isPersian ? faSteps : enSteps;
  const homeRoundRemainingMs = 15 * 60_000 - (homeTimerNow % (15 * 60_000));
  const homeTimerSeconds = Math.ceil(homeRoundRemainingMs / 1000);
  const homeTimerText = [Math.floor(homeTimerSeconds / 60), homeTimerSeconds % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");

  return (
    <div className="app-shell home-shell">
      <header className="topbar home-topbar">
        <div className="home-topbar__brand">
          <button
            className="sidebar-toggle"
            type="button"
            aria-controls="home-sidebar"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? t.sidebar.closeMenu : t.sidebar.openMenu}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? "×" : "☰"}
          </button>
          <button className="brand brand--home" type="button" aria-label={t.navigation.home} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button>
        </div>
      </header>

      <div className={`home-content${mobileMenuOpen ? " home-content--menu-open" : ""}`}>
        {mobileMenuOpen && (
          <button
            className="sidebar-backdrop"
            type="button"
            aria-label={t.sidebar.closeMenu}
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        <aside
          id="home-sidebar"
          className="home-sidebar"
          aria-label={t.sidebar.title}
          aria-hidden={!mobileMenuOpen}
        >
          <button type="button" className="sidebar-brand sidebar-brand--home" aria-label={t.navigation.home} onClick={() => { onNavigate("home"); setMobileMenuOpen(false); }}><strong><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></strong></button>
          <p className="sidebar-kicker">{t.sidebar.title}</p>
          <nav className="sidebar-nav">
            <button type="button" className="sidebar-link" onClick={() => { onNavigate("leaderboard"); setMobileMenuOpen(false); }}>
              <span aria-hidden="true">🏆</span><span>{t.sidebar.leaderboard}</span>
            </button>
            <button type="button" className="sidebar-link" onClick={() => { onNavigate("rewards"); setMobileMenuOpen(false); }}>
              <span aria-hidden="true">✦</span><span>{t.sidebar.rewards}</span>
            </button>
            <button type="button" className="sidebar-link" onClick={() => { onNavigate("help"); setMobileMenuOpen(false); }}>
              <span aria-hidden="true">?</span><span>{t.sidebar.helpCenter}</span>
            </button>
            <button type="button" className="sidebar-link" onClick={() => { onNavigate("terms"); setMobileMenuOpen(false); }}>
              <span aria-hidden="true">≡</span><span>{t.sidebar.termsOfUse}</span>
            </button>
          </nav>
          <div className="sidebar-divider" />
          <div className="sidebar-auth">
            <button type="button" className="sidebar-login" onClick={() => { onAuth("login"); setMobileMenuOpen(false); }}>
              {t.sidebar.login}
            </button>
            <button type="button" className="sidebar-signup" onClick={() => { onAuth("signup"); setMobileMenuOpen(false); }}>
              {t.sidebar.signup}
            </button>
          </div>
          <p className="sidebar-footer">{t.sidebar.footer}</p>
        </aside>

        <main className="page home-page">
        <section className="home-showcase">
          <div
            className="home-illustration-frame"
            onPointerMove={(event) => {
              if (event.pointerType === "touch") return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (!rect.width || !rect.height) return;
              const x = (event.clientX - rect.left) / rect.width;
              const y = (event.clientY - rect.top) / rect.height;
              event.currentTarget.style.setProperty("--home-tilt-x", `${(0.5 - y) * 6}deg`);
              event.currentTarget.style.setProperty("--home-tilt-y", `${(x - 0.5) * 8}deg`);
              event.currentTarget.style.setProperty("--home-glow-x", `${x * 100}%`);
              event.currentTarget.style.setProperty("--home-glow-y", `${y * 100}%`);
            }}
            onPointerLeave={(event) => {
              event.currentTarget.style.setProperty("--home-tilt-x", "0deg");
              event.currentTarget.style.setProperty("--home-tilt-y", "0deg");
              event.currentTarget.style.setProperty("--home-glow-x", "50%");
              event.currentTarget.style.setProperty("--home-glow-y", "45%");
            }}
          >
            <img className="home-concept-vector" src="/images/home-concept.svg" alt={isPersian ? "تصویر نئونی کیف پول و ذره‌بین" : "Neon wallet and magnifying glass illustration"} />
          </div>
          <h1 className="home-concept-title" lang={isPersian ? "fa" : "en"} dir={isPersian ? "rtl" : "ltr"}>
            {isPersian ? <>کیف پول رو پیدا کن، <span>کریپتو بگیر</span></> : <>Find the wallet, <span>get rewarded</span></>}
          </h1>
          <p className="home-concept-tagline" lang={isPersian ? "fa" : "en"} dir={isPersian ? "rtl" : "ltr"}>
            {isPersian ? <>هر روز سرنخ‌ها رو بهت میدیم ...<br />هر چقدر سریعتر باشی درآمدت بیشتره.</> : <>We give you clues every day...<br />The faster you are, the more you earn.</>}
          </p>
        </section>

        <section className="home-challenge-card" aria-label={isPersian ? "چالش امروز" : "Today's challenge"}>
          <div className="home-challenge-card__top">
            <div className="home-challenge-card__bolt" aria-hidden="true"><svg className="home-challenge-card__magnifier" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.4" stroke="currentColor" strokeWidth="2.1"/><path d="m15.2 15.2 5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><path d="M10.5 6.8v7.4M6.8 10.5h7.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".4"/></svg></div>
            <strong>{isPersian ? "چالش امروز" : "Today's Challenge"}</strong>
            <div className="home-challenge-card__timer">
              <span><span aria-hidden="true">◷</span> {homeTimerText}</span>
              <small>{isPersian ? "تا شروع دور جدید" : "Until next round"}</small>
            </div>
          </div>
          <div className="home-challenge-card__progress">
            <strong>{formatHomeNumber(homeSolvedCount)} / {formatHomeNumber(12)}</strong>
            <span>{isPersian ? "پیشرفت شما" : "Your progress"}</span>
            <i role="progressbar" aria-valuemin={0} aria-valuemax={12} aria-valuenow={homeSolvedCount} aria-label={isPersian ? "پیشرفت چالش" : "Challenge progress"}><b style={{ width: homeProgressPercent + "%" }} /></i>
          </div>
        </section>

        <section className="home-key-grid" aria-label={isPersian ? "۱۲ خانهٔ چالش" : "12 challenge keys"}>
          {Array.from({ length: 12 }).map((_, index) => (
            <button
              key={index}
              type="button"
              className={`home-key-tile ${index < 3 ? "home-key-tile--current home-key-tile--word" : "home-key-tile--locked"}`}
              onClick={() => onNavigate("competition")}
              aria-label={index < 3 ? (isPersian ? ["چالش", "تو", "سرعت"][index] : ["Challenge", "Your", "Speed"][index]) : (isPersian ? `خانهٔ قفل‌شدهٔ ${index + 1}` : `Locked key ${index + 1}`)}
            >
              {index < 3 ? <span className="home-key-tile__word">{(isPersian ? ["چالش", "تو", "سرعت"] : ["Challenge", "Your", "Speed"])[index]}</span> : <><span className="home-key-tile__lock" aria-hidden="true"><i /></span><span className="home-key-tile__number">{(index + 1).toLocaleString(isPersian ? "fa-IR" : "en-US")}</span></>}
            </button>
          ))}
        </section>

        <section className="cta-group">
          <button className="cta-button" type="button" onClick={() => onNavigate("competition")}>{isPersian ? "ورود به چالش امشب" : "Enter Tonight's Challenge"}</button>
          <button className="cta-button cta-button--ghost" type="button" onClick={() => onNavigate("rules")}>{isPersian ? "روش و قوانین چالش" : "How to Play & Challenge Rules"}</button>
        </section>

        <section className="stat-row">
          {stats.map((stat) => <div className="stat-card" key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}
        </section>

        <section className="how-section">
          <h2 className="section-heading">{isPersian ? "چالش چطور کار می‌کند" : "How the challenge works"}</h2>
          <div className="steps">
            {steps.map((step) => <article className="step" key={step.number}><div className="step-number mono">{step.number}</div><div className="step-content"><p>{step.title}</p><small>{step.description}</small></div></article>)}
          </div>
        </section>
        </main>
      </div>
      <BottomNavShim activePage="home" onNavigate={onNavigate} />
    </div>
  );
}

function InfoPage({
  kind,
  onNavigate,
}: {
  kind: "rewards" | "help" | "terms";
  onNavigate: (page: Page) => void;
}) {
  const { translation: t } = useI18n();
  const content = t.infoPages[kind];
  const icon = kind === "rewards" ? "✦" : kind === "help" ? "?" : "≡";

  return (
    <div className="app-shell info-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={t.navigation.home} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button>
        
      </header>
      <main className="page info-page">
        <button className="back-button" type="button" onClick={() => onNavigate("home")}>
          ‹ {t.navigation.home}
        </button>
        <div className="eyebrow">{t.sidebar.title}</div>
        <h1 className="info-title">{content.title}</h1>
        <p className="info-description">{content.description}</p>
        <section className="info-panel">
          <span className="info-panel__icon" aria-hidden="true">{icon}</span>
          <p>{content.detail}</p>
        </section>
        {kind === "rewards" && (
          <button className="cta-button" type="button" onClick={() => onNavigate("competition")}>
            {t.navigation.competition}
          </button>
        )}
        {kind === "help" && (
          <button className="cta-button" type="button" onClick={() => onNavigate("auth")}>
            {t.auth.login} / {t.auth.signup}
          </button>
        )}
      </main>
    </div>
  );
}

function ContestRulesPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { translation: t } = useI18n();
  const rules = t.contestRules;

  return (
    <div className="app-shell info-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={t.navigation.home} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button>
      </header>
      <main className="page info-page challenge-rules-page">
        <button className="back-button" type="button" onClick={() => onNavigate("home")}>
          ‹ {t.navigation.home}
        </button>
        <div className="eyebrow">{rules.kicker}</div>
        <h1 className="info-title">{rules.title}</h1>
        <p className="info-description">{rules.description}</p>

        <section className="challenge-rules-list" aria-label={rules.stepsTitle}>
          {rules.steps.map((step, index) => (
            <article className="challenge-rule-step" key={step.title}>
              <span className="challenge-rule-step__number mono">{String(index + 1).padStart(2, "0")}</span>
              <div className="challenge-rule-step__copy">
                <h2>{step.title}</h2>
                <p>{step.description}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="challenge-rules-reward">
          <h2>{rules.rewardsTitle}</h2>
          <p>{rules.rewardsDetail}</p>
        </section>
        <p className="challenge-rules-notice" role="note">{rules.previewNotice}</p>
        <button className="cta-button" type="button" onClick={() => onNavigate("competition")}>
          {t.navigation.competition}
        </button>
      </main>
    </div>
  );
}

type GlobalSidebarProps = {
  currentPage: Page;
  isLoggedIn: boolean;
  onNavigate: (page: Page) => void;
  onAuth: (mode: AuthMode) => void;
  onLogout: () => void;
};

function GlobalSidebar({ currentPage, isLoggedIn, onNavigate, onAuth, onLogout }: GlobalSidebarProps) {
  const { translation: t, language } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  function navigateTo(page: Page) {
    onNavigate(page);
    setIsOpen(false);
  }

  const items: { page: Page; icon: string; label: string }[] = [
    { page: "home", icon: "⌂", label: t.navigation.home },
    { page: "competition", icon: "🔑", label: t.navigation.competition },
    { page: "rules", icon: "ⓘ", label: t.contestRules.title },
    { page: "leaderboard", icon: "🏆", label: t.sidebar.leaderboard },
    { page: "rewards", icon: "✦", label: t.sidebar.rewards },
    { page: "wallet", icon: "◈", label: t.navigation.wallet },
    { page: "profile", icon: "◎", label: t.navigation.profile },
    { page: "help", icon: "?", label: t.sidebar.helpCenter },
    { page: "terms", icon: "≡", label: t.sidebar.termsOfUse },
    ...(isLoggedIn && (JSON.parse(localStorage.getItem("walletFindUser") ?? "{}") as { role?: string }).role === "ADMIN"
      ? [{ page: "admin" as Page, icon: "⚙", label: language === "fa" ? "پنل مدیریت" : "Admin panel" }]
      : []),
  ];

  return (
    <>
      {isOpen && (
        <button className="global-sidebar-backdrop" type="button" aria-label={t.sidebar.closeMenu} onClick={() => setIsOpen(false)} />
      )}
      {!isOpen && (
        <button
          className={"global-sidebar-trigger" + (currentPage === "home" ? " global-sidebar-trigger--home" : "")}
          type="button"
          aria-controls="global-sidebar"
          aria-expanded={false}
          aria-label={t.sidebar.openMenu}
          onClick={() => setIsOpen(true)}
        >
          ☰
        </button>
      )}
      <aside
        id="global-sidebar"
        className={"global-sidebar" + (isOpen ? " global-sidebar--open" : "")}
        aria-label={t.sidebar.title}
        aria-hidden={!isOpen}
      >
        <div className="global-sidebar__header">
          <button type="button" className="sidebar-brand sidebar-brand--home" aria-label={t.navigation.home} onClick={() => navigateTo("home")}><strong><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></strong></button>
          <button type="button" className="global-sidebar__close" onClick={() => setIsOpen(false)} aria-label={t.sidebar.closeMenu}>×</button>
        </div>
        <div className="sidebar-home-tools" aria-label={language === "fa" ? "تنظیمات سریع" : "Quick settings"}>
          <SharedLanguageSwitcher />
        </div>
        <p className="sidebar-kicker">{t.sidebar.title}</p>
        <nav className="sidebar-nav">
          {items.map((item) => (
            <button
              key={item.page}
              type="button"
              className={"sidebar-link" + (currentPage === item.page ? " sidebar-link--active" : "")}
              onClick={() => navigateTo(item.page)}
              aria-current={currentPage === item.page ? "page" : undefined}
            >
              <span className={"sidebar-link__icon" + (item.page === "competition" ? " sidebar-link__icon--challenge" : item.page === "leaderboard" ? " sidebar-link__icon--leaderboard" : item.page === "wallet" ? " sidebar-link__icon--wallet" : item.page === "profile" ? " sidebar-link__icon--profile" : "")} aria-hidden="true">{item.page === "competition" ? <svg className="sidebar-link__key-svg" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="2.5"/><path d="M11.3 11.3 20 20m-4-4 2.2-2.2m-.2 4.2 2.2-2.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg> : item.page === "wallet" ? <svg className="sidebar-link__wallet-svg" viewBox="0 0 24 24" fill="none"><path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 8v11a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 15h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg> : item.page === "profile" ? <svg className="sidebar-link__profile-svg" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> : <span className="sidebar-link__glyph">{item.icon}</span>}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-auth">
          {isLoggedIn ? (
            <button type="button" className="sidebar-login sidebar-logout" onClick={() => { onLogout(); setIsOpen(false); }}>
              {t.profile.logout}
            </button>
          ) : (
            <>
              <button type="button" className="sidebar-login" onClick={() => { onAuth("login"); setIsOpen(false); }}>{t.sidebar.login}</button>
              <button type="button" className="sidebar-signup" onClick={() => { onAuth("signup"); setIsOpen(false); }}>{t.sidebar.signup}</button>
            </>
          )}
        </div>
        <p className="sidebar-footer">{t.sidebar.footer}</p>
      </aside>
    </>
  );
}

function App() {
  const { language, isRTL } = useI18n();
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "unauthenticated">(
    () => localStorage.getItem("walletFindToken") ? "checking" : "unauthenticated",
  );
  const initialSavedUser = safelyReadSavedUser();
  const initialIsAdmin = initialSavedUser?.role === "ADMIN";

  const [page, setPage] = useState<Page>(() => {
    const hasToken = Boolean(localStorage.getItem("walletFindToken"));
    const validPages: Page[] = ["home", "auth", "competition", "key", "leaderboard", "profile", "wallet", "rewards", "help", "terms", "rules", "admin", "admin-manage"];
    if (window.location.pathname === "/admin-setup") {
      window.history.replaceState({}, "", initialIsAdmin && hasToken ? "/admin" : "/");
      if (initialIsAdmin && hasToken) return "admin";
    }
    // Keep the last in-app page across a browser refresh instead of always sending signed-in users to the challenge.
    let savedPage: Page | null = null;
    try {
      const saved = sessionStorage.getItem("walletFindCurrentPage");
      if (saved && validPages.includes(saved as Page)) savedPage = saved as Page;
    } catch {
      // If session storage is unavailable, fall back to the safe default below.
    }
    if (hasToken) {
      if (window.location.pathname === "/admin") return "admin";
      if (savedPage && (savedPage !== "admin" && savedPage !== "admin-manage" || initialIsAdmin)) return savedPage;
      return "competition";
    }
    // Public pages remain open after refresh; protected pages still require authentication.
    if (savedPage && ["home", "auth", "leaderboard", "rewards", "help", "terms", "rules"].includes(savedPage)) return savedPage;
    return "auth";
  });
  const [authMode, setAuthMode] = useState<AuthMode>(() =>
    localStorage.getItem("walletFindToken") ? "login" : "signup",
  );

  useEffect(() => {
    try {
      sessionStorage.setItem("walletFindCurrentPage", page);
    } catch {
      // Navigation still works if the browser blocks session storage.
    }
  }, [page]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
  }, [language, isRTL]);

  useEffect(() => {
    const token = localStorage.getItem("walletFindToken");
    if (!token) {
      localStorage.removeItem("walletFindUser");
      setAuthStatus("unauthenticated");
      setAuthMode("signup");
      return;
    }

    let cancelled = false;
    getProfile()
      .then((profile) => {
        if (cancelled) return;
        localStorage.setItem("walletFindUser", JSON.stringify({
          id: profile.id,
          email: profile.email,
          username: profile.username,
          role: profile.role,
          createdAt: profile.createdAt,
        }));
        setAuthStatus("authenticated");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        if (message === "AUTHENTICATION_REQUIRED" || message === "USER_NOT_FOUND") {
          localStorage.removeItem("walletFindToken");
          localStorage.removeItem("walletFindUser");
          setAuthStatus("unauthenticated");
          setAuthMode("signup");
          setPage("auth");
          return;
        }

        // Keep a previously confirmed local session during temporary network/server failures.
        if (safelyReadSavedUser()) {
          setAuthStatus("authenticated");
        } else {
          setAuthStatus("unauthenticated");
          setAuthMode("signup");
          setPage("auth");
        }
      });

    return () => { cancelled = true; };
  }, []);

  const savedUser = safelyReadSavedUser();
  const isAdmin = authStatus === "authenticated" && savedUser?.role === "ADMIN";

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    setPage("auth");
  }

  function handleAuthenticated(token: string) {
    localStorage.setItem("walletFindToken", token);
    setAuthStatus("authenticated");
    setPage("competition");
  }

  function handleLogout() {
    localStorage.removeItem("walletFindToken");
    localStorage.removeItem("walletFindUser");
    setAuthStatus("unauthenticated");
    setAuthMode("signup");
    setPage("auth");
  }

  const isLoggedIn = authStatus === "authenticated";
  if (authStatus === "checking") {
    return (
      <div className="app-shell session-checking" role="status" aria-live="polite">
        {language === "fa" ? "در حال بررسی وضعیت ورود..." : "Checking your session..."}
      </div>
    );
  }

  let currentView: ReactNode;

  if (page === "auth") {
    currentView = <AuthPage initialMode={authMode} onAuthenticated={handleAuthenticated} onOpenTerms={() => setPage("terms")} onBack={() => {
      if (!isLoggedIn) {
        setAuthMode("signup");
        setPage("auth");
      } else {
        setPage("home");
      }
    }} />;
  } else if (page === "admin" && isAdmin) {
    currentView = <AdminControlCenter onNavigate={setPage} />;
  } else if (page === "admin-manage" && isAdmin) {
    currentView = <AdminPage onNavigate={setPage} />;
  } else if (page === "competition") {
    currentView = isLoggedIn
      ? <CompetitionPage onNavigate={setPage} />
      : <AuthPage initialMode="signup" onAuthenticated={handleAuthenticated} onOpenTerms={() => setPage("terms")} onBack={() => setPage("auth")} />;
  } else if (page === "leaderboard") {
    currentView = <LeaderboardPage onNavigate={setPage} />;
  } else if (page === "profile") {
    currentView = isLoggedIn
      ? <ProfilePage onNavigate={setPage} onLogout={handleLogout} />
      : <AuthPage initialMode="signup" onAuthenticated={handleAuthenticated} onOpenTerms={() => setPage("terms")} onBack={() => setPage("auth")} />;
  } else if (page === "key") {
    currentView = <KeyStagePage onNavigate={setPage} />;
  } else if (page === "rewards" || page === "help" || page === "terms") {
    currentView = <InfoPage kind={page} onNavigate={setPage} />;
  } else if (page === "rules") {
    currentView = <ContestRulesPage onNavigate={setPage} />;
  } else if (page === "wallet") {
    currentView = isLoggedIn
      ? <WalletPage onNavigate={setPage} />
      : <AuthPage initialMode="signup" onAuthenticated={handleAuthenticated} onOpenTerms={() => setPage("terms")} onBack={() => setPage("auth")} />;
  } else {
    currentView = <HomePage onNavigate={setPage} onAuth={openAuth} language={language} isLoggedIn={isLoggedIn} />;
  }

  return (
    <>
      <GlobalSidebar
        currentPage={page}
        isLoggedIn={isLoggedIn}
        onNavigate={(nextPage) => {
          if (!isLoggedIn && ["competition", "profile", "wallet", "key"].includes(nextPage)) {
            setAuthMode("signup");
            setPage("auth");
            return;
          }
          setPage(nextPage);
        }}
        onAuth={openAuth}
        onLogout={handleLogout}
      />
      {currentView}
    </>
  );
}

function safelyReadSavedUser(): { id?: string; email?: string; username?: string; role?: string; createdAt?: string } | null {
  try {
    const raw = localStorage.getItem("walletFindUser");
    return raw ? JSON.parse(raw) as { id?: string; email?: string; username?: string; role?: string; createdAt?: string } : null;
  } catch {
    localStorage.removeItem("walletFindUser");
    return null;
  }
}

function BottomNavShim({ activePage, onNavigate }: { activePage: Page; onNavigate: (page: Page) => void }) {
  const { translation: t } = useI18n();
  return (
    <nav className="bottom-nav" aria-label={t.navigation.ariaLabel}>
      <button className={`nav-item ${activePage === "home" ? "nav-item--active" : ""}`} onClick={() => onNavigate("home")} type="button" aria-current={activePage === "home" ? "page" : undefined}><span className="nav-icon" aria-hidden="true">⌂</span><span>{t.navigation.home}</span></button>
      <button className={`nav-item ${activePage === "competition" ? "nav-item--active" : ""}`} onClick={() => onNavigate("competition")} type="button" aria-current={activePage === "competition" ? "page" : undefined}><span className="nav-icon nav-icon--challenge" aria-hidden="true"><svg className="nav-icon__key-svg" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="2.5"/><path d="M11.3 11.3 20 20m-4-4 2.2-2.2m-.2 4.2 2.2-2.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span>{t.navigation.competition}</span></button>
      <button className={`nav-item ${activePage === "leaderboard" ? "nav-item--active" : ""}`} onClick={() => onNavigate("leaderboard")} type="button" aria-current={activePage === "leaderboard" ? "page" : undefined}><span className="nav-icon nav-icon--leaderboard" aria-hidden="true"><span className="nav-icon__trophy">🏆</span></span><span>{t.navigation.leaderboard}</span></button>
      <button className={`nav-item ${activePage === "wallet" ? "nav-item--active" : ""}`} onClick={() => onNavigate("wallet")} type="button" aria-current={activePage === "wallet" ? "page" : undefined}><span className="nav-icon nav-icon--wallet" aria-hidden="true"><svg className="nav-icon__wallet-svg" viewBox="0 0 24 24" fill="none"><path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 8v11a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 15h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></span><span>{t.navigation.wallet}</span></button>
      <button className={`nav-item ${activePage === "profile" ? "nav-item--active" : ""}`} onClick={() => onNavigate("profile")} type="button" aria-current={activePage === "profile" ? "page" : undefined}><span className="nav-icon nav-icon--profile" aria-hidden="true"><svg className="nav-icon__profile-svg" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span><span>{t.navigation.profile}</span></button>
    </nav>
  );
}

export default App;
