import { useEffect, useState } from "react";
import AuthPage from "./pages/AuthPage";
import CompetitionPage from "./pages/CompetitionPage";
import KeyStagePage from "./pages/KeyStagePage";
import LeaderboardPage from "./pages/LeaderboardPage";
import ProfilePage from "./pages/ProfilePage";
import AdminPage from "./pages/AdminPage";
import { useI18n, type Language } from "./i18n";
import SharedLanguageSwitcher from "./components/LanguageSwitcher";
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
  | "admin";

function LanguageSwitcher({
  language,
  onChange,
}: {
  language: Language;
  onChange: (language: Language) => void;
}) {
  return (
    <div className="language-switcher">
      <button type="button" className={language === "fa" ? "active" : ""} onClick={() => onChange("fa")}>
        {language === "fa" ? "فارسی" : "Persian"}
      </button>
      <button type="button" className={language === "en" ? "active" : ""} onClick={() => onChange("en")}>
        {language === "fa" ? "انگلیسی" : "English"}
      </button>
    </div>
  );
}

const faStats = [
  { value: "۲٬۴۱۸", label: "شرکت‌کننده امشب" },
  { value: "۵۰۰ ₮", label: "جایزه مسابقه" },
  { value: "۰۳:۵۹", label: "تا شروع بعدی" },
];

const enStats = [
  { value: "2,418", label: "Tonight's players" },
  { value: "500 ₮", label: "Contest prize" },
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
  onLanguageChange,
}: {
  onNavigate: (page: Page) => void;
  onAuth: (mode: AuthMode) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const { translation: t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isPersian = language === "fa";

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
          <div className="brand"><span className="brand-dot" /><span>12Keys</span></div>
        </div>
        <div className="topbar-actions">
          <LanguageSwitcher language={language} onChange={onLanguageChange} />
          <div className="wallet-pill mono">₮ 128.40</div>
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
          <div className="sidebar-brand"><span className="brand-dot" /><strong>12Keys</strong></div>
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
        <section className="hero">
          <div className="eyebrow">{isPersian ? "مسابقه شبانه" : "NIGHTLY CONTEST"}</div>
          <h1 className="hero-title">
            {isPersian ? <><span>۱۲ کلید</span><br />یک قفل، یک برنده</> : <>Every night <span>12 Keys</span><br />One lock, one winner</>}
          </h1>
          <p className="hero-description">
            {isPersian ? "هر شب یک گاوصندوق جدید باز می‌شود. ۱۲ سرنخ حل کن، سریع‌تر از بقیه به کلید آخر برس و جایزه USDT را ببر." : "A new vault opens every night. Solve 12 clues, reach the final key faster than everyone else, and win the USDT prize."}
          </p>
        </section>

        <section className="dial-wrap" aria-label={isPersian ? "۱۲ کلید" : "12 keys"}>
          <div className="dial-ring">
            {Array.from({ length: 12 }).map((_, index) => {
              const angle = (index / 12) * 360 - 90;
              const radius = 118;
              const x = 130 + radius * Math.cos((angle * Math.PI) / 180);
              const y = 130 + radius * Math.sin((angle * Math.PI) / 180);
              const state = index < 4 ? "solved" : index === 4 ? "current" : "locked";
              return <div key={index} className={`keyhole ${state}`} style={{ left: `${x}px`, top: `${y}px` }}>{(index + 1).toLocaleString(isPersian ? "fa-IR" : "en-US")}</div>;
            })}
          </div>
          <div className="dial-center">
            <div className="dial-label">{isPersian ? "تا شروع بعدی" : "NEXT START"}</div>
            <div className="dial-time mono">{isPersian ? "۰۳:۵۹:۰۲" : "03:59:02"}</div>
          </div>
        </section>

        <section className="cta-group">
          <button className="cta-button" type="button" onClick={() => onNavigate("competition")}>{isPersian ? "ورود به مسابقه امشب" : "Enter Tonight's Contest"}</button>
          <button className="cta-button cta-button--ghost" type="button" onClick={() => onNavigate("auth")}>{isPersian ? "ثبت‌نام / ورود" : "Sign Up / Login"}</button>
        </section>

        <section className="stat-row">
          {stats.map((stat) => <div className="stat-card" key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}
        </section>

        <section className="how-section">
          <h2 className="section-heading">{isPersian ? "مسابقه چطور کار می‌کند" : "How the contest works"}</h2>
          <div className="steps">
            {steps.map((step) => <article className="step" key={step.number}><div className="step-number mono">{step.number}</div><div className="step-content"><p>{step.title}</p><small>{step.description}</small></div></article>)}
          </div>
        </section>
        </main>
      </div>
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
        <div className="brand"><span className="brand-dot" /><span>12Keys</span></div>
        <div className="topbar-actions"><SharedLanguageSwitcher /></div>
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

function App() {
  const { language, changeLanguage, isRTL, translation: t } = useI18n();

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
  }, [language, isRTL]);

  const savedUser = localStorage.getItem("walletFindUser");
  const savedRole = savedUser ? (JSON.parse(savedUser) as { role?: string }).role : undefined;
  const isAdmin = savedRole === "ADMIN";

  const [page, setPage] = useState<Page>(() => localStorage.getItem("walletFindToken") ? "competition" : "home");
  const [authMode, setAuthMode] = useState<AuthMode>("login");

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    setPage("auth");
  }

  function handleAuthenticated(token: string) {
    localStorage.setItem("walletFindToken", token);
    setPage("competition");
  }

  function handleLogout() {
    localStorage.removeItem("walletFindToken");
    localStorage.removeItem("walletFindUser");
    setPage("home");
  }

  if (page === "auth") {
    return <AuthPage initialMode={authMode} onAuthenticated={handleAuthenticated} onBack={() => setPage("home")} />;
  }

  if (page === "admin" && isAdmin) {
    return <AdminPage onNavigate={setPage} />;
  }

  if (page === "competition") {
    return <CompetitionPage onNavigate={setPage} />;
  }

  if (page === "leaderboard") {
    return <LeaderboardPage onNavigate={setPage} />;
  }

  if (page === "profile") {
    return <ProfilePage onNavigate={setPage} onLogout={handleLogout} />;
  }

  if (page === "key") {
    return <KeyStagePage onNavigate={setPage} />;
  }

  if (page === "rewards" || page === "help" || page === "terms") {
    return <InfoPage kind={page} onNavigate={setPage} />;
  }

  if (page === "wallet") {
    return (
      <div className="app-shell">
        <header className="topbar"><div className="brand"><span className="brand-dot" /><span>12Keys</span></div><div className="topbar-actions"><SharedLanguageSwitcher /></div></header><main className="page"><div className="section-title">{t.wallet.title}</div><div className="balance-card"><div className="balance-label">{t.wallet.displayBalance}</div><div className="balance-amount mono">{t.wallet.balance}</div><div className="balance-network">Polygon</div></div><div className="inline-feedback">{t.wallet.notice}</div></main><BottomNavShim activePage="wallet" onNavigate={setPage} /></div>
    );
  }

  return <HomePage onNavigate={setPage} onAuth={openAuth} language={language} onLanguageChange={changeLanguage} />;
}

function BottomNavShim({ activePage, onNavigate }: { activePage: Page; onNavigate: (page: Page) => void }) {
  const { translation: t } = useI18n();
  return (
    <nav className="bottom-nav" aria-label={t.navigation.ariaLabel}>
      <button className={`nav-item ${activePage === "home" ? "nav-item--active" : ""}`} onClick={() => onNavigate("home")} type="button" aria-current={activePage === "home" ? "page" : undefined}><span className="nav-icon" aria-hidden="true">⌂</span><span>{t.navigation.home}</span></button>
      <button className={`nav-item ${activePage === "competition" ? "nav-item--active" : ""}`} onClick={() => onNavigate("competition")} type="button" aria-current={activePage === "competition" ? "page" : undefined}><span className="nav-icon" aria-hidden="true">🔑</span><span>{t.navigation.competition}</span></button>
      <button className={`nav-item ${activePage === "leaderboard" ? "nav-item--active" : ""}`} onClick={() => onNavigate("leaderboard")} type="button" aria-current={activePage === "leaderboard" ? "page" : undefined}><span className="nav-icon" aria-hidden="true">🏆</span><span>{t.navigation.leaderboard}</span></button>
      <button className={`nav-item ${activePage === "wallet" ? "nav-item--active" : ""}`} onClick={() => onNavigate("wallet")} type="button" aria-current={activePage === "wallet" ? "page" : undefined}><span className="nav-icon" aria-hidden="true">◈</span><span>{t.navigation.wallet}</span></button>
      <button className={`nav-item ${activePage === "profile" ? "nav-item--active" : ""}`} onClick={() => onNavigate("profile")} type="button" aria-current={activePage === "profile" ? "page" : undefined}><span className="nav-icon" aria-hidden="true">◎</span><span>{t.navigation.profile}</span></button>
    </nav>
  );
}

export default App;
