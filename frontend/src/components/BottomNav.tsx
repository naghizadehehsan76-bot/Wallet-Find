import { useI18n } from "../i18n";

type Page =
  | "home"
  | "auth"
  | "competition"
  | "key"
  | "leaderboard"
  | "profile"
  | "wallet";

type BottomNavProps = {
  activePage: Page;
  onNavigate: (page: Page) => void;
};

function BottomNav({ activePage, onNavigate }: BottomNavProps) {
  const { translation: t } = useI18n();
  const items: { page: Page; icon: string; label: string }[] = [
    { page: "home", icon: "⌂", label: t.navigation.home },
    { page: "competition", icon: "", label: t.navigation.competition },
    { page: "leaderboard", icon: "🏆", label: t.navigation.leaderboard },
    { page: "wallet", icon: "◈", label: t.navigation.wallet },
    { page: "profile", icon: "◎", label: t.navigation.profile },
  ];

  return (
    <nav className="bottom-nav" aria-label={t.navigation.ariaLabel}>
      {items.map((item) => (
        <button
          key={item.page}
          className={`nav-item ${activePage === item.page ? "nav-item--active" : ""}`}
          type="button"
          onClick={() => onNavigate(item.page)}
          aria-current={activePage === item.page ? "page" : undefined}
        >
          <span className={"nav-icon" + (item.page === "competition" ? " nav-icon--challenge" : item.page === "leaderboard" ? " nav-icon--leaderboard" : item.page === "profile" ? " nav-icon--profile" : "")} aria-hidden="true">
            {item.page === "competition" ? (
              <svg className="nav-icon__key-svg" viewBox="0 0 24 24" fill="none">
                <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="2.5" />
                <path d="M11.3 11.3 20 20m-4-4 2.2-2.2m-.2 4.2 2.2-2.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : item.page === "wallet" ? (
              <svg className="nav-icon__wallet-svg" viewBox="0 0 24 24" fill="none">
                <path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 8v11a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 15h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : item.page === "leaderboard" ? (
              <span className="nav-icon__trophy">{item.icon}</span>
            ) : item.page === "profile" ? (
              <svg className="nav-icon__profile-svg" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
                <path d="M4.5 21a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : item.icon}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default BottomNav;
