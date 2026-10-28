import { useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import { getProfile, uploadProfileAvatar, type ProfileResult } from "../services/api";
import { useI18n } from "../i18n";
import { localizeApiError } from "../i18n/localize";
import LoadingIndicator from "../components/LoadingIndicator";

type Page =
  | "home"
  | "auth"
  | "competition"
  | "key"
  | "leaderboard"
  | "profile"
  | "wallet"
  | "admin";

type ProfilePageProps = {
  onNavigate: (page: Page) => void;
  onLogout: () => void;
};

function ProfilePage({ onNavigate, onLogout }: ProfilePageProps) {
  const { language } = useI18n();
  const isPersian = language === "fa";
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);

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
        <button className="brand brand--home" type="button" aria-label={language === "fa" ? "خانه" : "Home"} onClick={() => onNavigate("home")}>
          <span className="brand-wallet">Wallet</span><span className="brand-find">Find</span>
        </button>
        
      </header>

      <main className="page profile-page">
        {loading ? (
          <div className="inline-feedback"><LoadingIndicator label={isPersian ? "در حال دریافت پروفایل..." : "Loading profile..."} /></div>
        ) : error ? (
          <div className="inline-feedback">{localizeApiError(error, language)}</div>
        ) : profile ? (
          <>
            <section className="profile-head">
              <div className="avatar-lg" style={{ overflow: "hidden", padding: 0 }}>
                {profile.avatarDataUrl ? (
                  <img src={profile.avatarDataUrl} alt={isPersian ? "عکس پروفایل" : "Profile photo"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : profile.username.slice(0, 2).toUpperCase()}
              </div>
              <label className="cta-button" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: avatarSaving ? "wait" : "pointer", marginTop: 12, opacity: avatarSaving ? 0.7 : 1 }}>
                {avatarSaving
                  ? (isPersian ? "در حال ذخیرهٔ عکس..." : "Saving photo...")
                  : (isPersian ? (profile.avatarDataUrl ? "تغییر عکس پروفایل" : "آپلود عکس پروفایل") : (profile.avatarDataUrl ? "Change profile photo" : "Upload profile photo"))}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handleAvatarChange(event)} disabled={avatarSaving} style={{ display: "none" }} />
              </label>
              <small>{isPersian ? "JPG، PNG یا WebP؛ حداکثر ۵ مگابایت" : "JPG, PNG, or WebP; max 5 MB"}</small>
              {avatarError && <p className="inline-feedback round-error" role="alert">{avatarError}</p>}
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
                <span>{isPersian ? "شرکت در چالش" : "Challenges"}</span>
              </div>
              <div className="stat-card">
                <strong>{profile.completedContests}</strong>
                <span>{isPersian ? "چالش کامل" : "Completed"}</span>
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

        <div className="profile-actions">
          <button className="cta-button cta-button--logout" type="button" onClick={onLogout}>
            {isPersian ? "خروج از حساب" : "Log out"}
          </button>
        </div>
      </main>

      <BottomNav activePage="profile" onNavigate={onNavigate} />
    </div>
  );
}

export default ProfilePage;
