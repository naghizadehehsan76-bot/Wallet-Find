import { useEffect, useState, type ChangeEvent } from "react";
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

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarError(isPersian ? "فقط تصویر JPG، PNG یا WebP قابل قبول است." : "Please choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError(isPersian ? "حجم تصویر باید کمتر از ۵ مگابایت باشد." : "The image must be smaller than 5 MB.");
      return;
    }

    setAvatarError("");
    setAvatarSaving(true);
    try {
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("IMAGE_READ_FAILED"));
        reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
        reader.readAsDataURL(file);
      });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
        img.src = imageDataUrl;
      });
      const canvas = document.createElement("canvas");
      const maxDimension = 512;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("IMAGE_PROCESSING_FAILED");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const optimized = canvas.toDataURL("image/webp", 0.82);
      if (optimized.length > 1_390_000) throw new Error("AVATAR_TOO_LARGE");
      const saved = await uploadProfileAvatar(optimized);
      setProfile((current) => current ? { ...current, avatarDataUrl: saved.avatarDataUrl } : current);
    } catch (err) {
      const code = err instanceof Error ? err.message : "AVATAR_SAVE_FAILED";
      setAvatarError(code === "AVATAR_TOO_LARGE"
        ? (isPersian ? "حجم تصویر پس از پردازش همچنان زیاد است؛ تصویر دیگری انتخاب کن." : "The processed image is still too large. Please choose another image.")
        : (isPersian ? "ذخیرهٔ عکس پروفایل ناموفق بود؛ دوباره تلاش کن." : "Could not save the profile photo. Please try again."));
    } finally {
      setAvatarSaving(false);
    }
  }

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
