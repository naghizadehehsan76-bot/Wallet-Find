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
    { page: "competition", icon: "🔑", label: t.navigation.competition },
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
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default BottomNav;
