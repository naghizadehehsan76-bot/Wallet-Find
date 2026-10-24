import { useEffect, useState, type ReactNode } from "react";
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
  | "rules"
  | "admin";

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
}: {
  onNavigate: (page: Page) => void;
  onAuth: (mode: AuthMode) => void;
  language: Language;
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
          <div className="home-wallet-art" aria-hidden="true">
            <div className="home-wallet-art__orbit home-wallet-art__orbit--outer" />
            <div className="home-wallet-art__orbit home-wallet-art__orbit--inner" />
            <div className="home-wallet-art__wallet">
              <span className="home-wallet-art__letter">W</span>
            </div>
            <div className="home-wallet-art__lens" />
            <span className="home-wallet-art__spark home-wallet-art__spark--one" />
            <span className="home-wallet-art__spark home-wallet-art__spark--two" />
          </div>
          <h1 className="home-showcase__title">
            {isPersian ? <>کیف پول رو پیدا کن، <span>کریپتو بگیر</span></> : <>Find the wallet, <span>get crypto</span></>}
          </h1>
          <p className="home-showcase__description">
            {isPersian ? <>هر روز سرنخ‌ها رو بهت میدیم ...<br />هر چقدر سریعتر باشی درآمدت بیشتره.</> : <>We give you clues every day...<br />The faster you are, the more you earn.</>}
          </p>
        </section>

        <section className="home-challenge-card" aria-label={isPersian ? "چالش امروز" : "Today's challenge"}>
          <div className="home-challenge-card__top">
            <div className="home-challenge-card__bolt" aria-hidden="true">ϟ</div>
            <strong>{isPersian ? "چالش امروز" : "Today's Challenge"}</strong>
            <div className="home-challenge-card__timer">
              <span><span aria-hidden="true">◷</span> ۱۵:۰۰</span>
              <small>{isPersian ? "تا شروع دور جدید" : "Until next round"}</small>
            </div>
          </div>
          <div className="home-challenge-card__progress">
            <strong>۰/۱۲</strong>
            <span>{isPersian ? "پیشرفت شما" : "Your progress"}</span>
            <i><b /></i>
          </div>
        </section>

        <section className="home-key-grid" aria-label={isPersian ? "۱۲ خانهٔ چالش" : "12 challenge keys"}>
          {Array.from({ length: 12 }).map((_, index) => (
            <button
              key={index}
              type="button"
              className={`home-key-tile ${index === 0 ? "home-key-tile--current" : "home-key-tile--locked"}`}
              onClick={() => onNavigate("competition")}
              aria-label={index === 0 ? (isPersian ? "خانهٔ اول، ورود به چالش" : "Key 1, enter challenge") : (isPersian ? `خانهٔ قفل‌شدهٔ ${index + 1}` : `Locked key ${index + 1}`)}
            >
              {index === 0 ? <><span className="home-key-tile__number">۱</span><span className="home-key-tile__subnumber">۱</span></> : <><span className="home-key-tile__lock" aria-hidden="true"><i /></span><span className="home-key-tile__number">{(index + 1).toLocaleString(isPersian ? "fa-IR" : "en-US")}</span></>}
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
        <div className="topbar-actions"><SharedLanguageSwitcher /></div>
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
              <span aria-hidden="true">{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-auth">
          {isLoggedIn ? (
            <button type="button" className="sidebar-login sidebar-logout" onClick={() => { onLogout(); setIsOpen(false); }}>
              <span aria-hidden="true">↪</span>{t.profile.logout}
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
  const { language, isRTL, translation: t } = useI18n();

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

  const isLoggedIn = Boolean(localStorage.getItem("walletFindToken"));
  let currentView: ReactNode;

  if (page === "auth") {
    currentView = <AuthPage initialMode={authMode} onAuthenticated={handleAuthenticated} onBack={() => setPage("home")} />;
  } else if (page === "admin" && isAdmin) {
    currentView = <AdminPage onNavigate={setPage} />;
  } else if (page === "competition") {
    currentView = <CompetitionPage onNavigate={setPage} />;
  } else if (page === "leaderboard") {
    currentView = <LeaderboardPage onNavigate={setPage} />;
  } else if (page === "profile") {
    currentView = <ProfilePage onNavigate={setPage} onLogout={handleLogout} />;
  } else if (page === "key") {
    currentView = <KeyStagePage onNavigate={setPage} />;
  } else if (page === "rewards" || page === "help" || page === "terms") {
    currentView = <InfoPage kind={page} onNavigate={setPage} />;
  } else if (page === "rules") {
    currentView = <ContestRulesPage onNavigate={setPage} />;
  } else if (page === "wallet") {
    currentView = (
      <div className="app-shell">
        <header className="topbar"><button className="brand brand--home" type="button" aria-label={t.navigation.home} onClick={() => setPage("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button></header><main className="page"><div className="section-title">{t.wallet.title}</div><div className="balance-card"><div className="balance-label">{t.wallet.displayBalance}</div><div className="balance-amount mono">{t.wallet.balance}</div><div className="balance-network">Polygon</div></div><div className="inline-feedback">{t.wallet.notice}</div></main><BottomNavShim activePage="wallet" onNavigate={setPage} /></div>
    );
  } else {
    currentView = <HomePage onNavigate={setPage} onAuth={openAuth} language={language} />;
  }

  return (
    <>
      <GlobalSidebar
        currentPage={page}
        isLoggedIn={isLoggedIn}
        onNavigate={setPage}
        onAuth={openAuth}
        onLogout={handleLogout}
      />
      {currentView}
    </>
  );
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
