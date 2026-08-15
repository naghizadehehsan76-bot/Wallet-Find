import { useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import { getProfile, type ProfileResult } from "../services/api";
import { useI18n } from "../i18n";

type Page =
  | "home"
  | "auth"
  | "competition"
  | "key"
  | "leaderboard"
  | "profile"
  | "wallet";

type ProfilePageProps = {
  onNavigate: (page: Page) => void;
};

function ProfilePage({ onNavigate }: ProfilePageProps) {
  const { language } = useI18n();
  const isPersian = language === "fa";
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getProfile()
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : isPersian
                ? "خطا در دریافت پروفایل"
                : "Unable to load profile.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPersian]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>12Keys</span>
        </div>
        <div className="wallet-pill">{isPersian ? "پروفایل" : "Profile"}</div>
      </header>

      <main className="page">
        {loading ? (
          <div className="inline-feedback">
            {isPersian ? "در حال دریافت پروفایل..." : "Loading profile..."}
          </div>
        ) : error ? (
          <div className="inline-feedback">{error}</div>
        ) : profile ? (
          <>
            <section className="profile-head">
              <div className="avatar-lg">
                {profile.username.slice(0, 2).toUpperCase()}
              </div>
              <h2>{profile.username}</h2>
              <span>
                {isPersian
                  ? `عضو از ${new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(profile.createdAt))}`
                  : `Member since ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(profile.createdAt))}`}
              </span>
            </section>

            <section className="stat-row">
              <div className="stat-card">
                <strong>{profile.contestsParticipated}</strong>
                <span>{isPersian ? "شرکت در مسابقه" : "Contests"}</span>
              </div>
              <div className="stat-card">
                <strong>{profile.completedContests}</strong>
                <span>{isPersian ? "مسابقه کامل" : "Completed"}</span>
              </div>
              <div className="stat-card">
                <strong>{profile.solvedKeys}</strong>
                <span>{isPersian ? "کلید حل‌شده" : "Keys solved"}</span>
              </div>
            </section>

            <div className="section-title">
              {isPersian ? "اطلاعات عملکرد" : "Performance"}
            </div>

            <div className="step">
              <div className="step-number mono">#</div>
              <div className="step-content">
                <p>
                  {isPersian ? "بهترین رتبه" : "Best rank"}: {profile.bestRank ?? "—"}
                </p>
                <small>
                  {isPersian ? "پاسخ‌های نادرست" : "Incorrect attempts"}: {profile.incorrectAttempts}
                </small>
              </div>
            </div>
          </>
        ) : null}
      </main>

      <BottomNav activePage="profile" onNavigate={onNavigate} />
    </div>
  );
}

export default ProfilePage;
