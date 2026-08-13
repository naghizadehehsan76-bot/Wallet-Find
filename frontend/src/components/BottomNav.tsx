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

function BottomNav({
  activePage,
  onNavigate,
}: BottomNavProps) {
  const items: {
    page: Page;
    icon: string;
    label: string;
  }[] = [
    { page: "home", icon: "⌂", label: "خانه" },
    { page: "competition", icon: "🔑", label: "مسابقه" },
    { page: "leaderboard", icon: "🏆", label: "رتبه‌بندی" },
    { page: "wallet", icon: "◈", label: "کیف پول" },
    { page: "profile", icon: "◎", label: "پروفایل" },
  ];

  return (
    <nav className="bottom-nav" aria-label="ناوبری اصلی">
      {items.map((item) => (
        <button
          key={item.page}
          className={`nav-item ${
            activePage === item.page ? "nav-item--active" : ""
          }`}
          type="button"
          onClick={() => onNavigate(item.page)}
        >
          <span className="nav-icon">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default BottomNav;
