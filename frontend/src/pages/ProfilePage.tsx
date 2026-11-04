import { useEffect, useState, type ChangeEvent } from "react";
import BottomNav from "../components/BottomNav";
import { deleteOwnAccount, getProfile, uploadProfileAvatar, type ProfileResult } from "../services/api";
import { useI18n } from "../i18n";
import { getPageCopy } from "../i18n/page-overrides";
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
  const copy = getPageCopy(language, "profilePage");
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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

  async function handleDeleteAccount() {
    if (!profile || profile.role !== "USER" || deletingAccount) return;
    const confirmed = window.confirm(isPersian
      ? "حذف حساب دائمی است و سوابق فعالیت مسابقه‌ای این حساب نیز پاک می‌شود. ادامه می‌دهی؟"
      : "Account deletion is permanent and this account's challenge activity history will also be erased. Continue?");
    if (!confirmed) return;
    const typedUsername = window.prompt(isPersian
      ? `برای تأیید نهایی، نام کاربری «${profile.username}» را دقیقاً وارد کن:`
      : `For final confirmation, type the username exactly: ${profile.username}`);
    if (typedUsername !== profile.username) {
      if (typedUsername !== null) setDeleteError(copy.deleteMismatch ?? (isPersian ? "نام کاربری مطابقت نداشت؛ حساب حذف نشد." : "The username did not match. The account was not deleted."));
      return;
    }
    setDeleteError("");
    setDeletingAccount(true);
    try {
      await deleteOwnAccount();
      localStorage.removeItem("walletFindToken");
      localStorage.removeItem("walletFindUser");
      onLogout();
    } catch (err) {
      const code = err instanceof Error ? err.message : "ACCOUNT_DELETION_FAILED";
      const messages: Record<string, [string, string]> = {
        ACCOUNT_HAS_FINANCIAL_OR_EXTERNAL_RECORDS: [
          "این حساب دارای کیف پول، سوابق مالی، جایزه یا اطلاعات وابسته است؛ برای محافظت از دارایی‌ها حذف آن مسدود شد.",
          "This account has a wallet, financial records, prizes, or linked external records. Deletion was blocked to protect them."
        ],
        ACCOUNT_DELETION_NOT_ALLOWED: ["حذف این نوع حساب مجاز نیست.", "This account type cannot be deleted here."],
        USER_NOT_FOUND: ["حساب پیدا نشد.", "Account not found."],
      };
      const message = messages[code];
      setDeleteError(message ? (isPersian ? message[0] : message[1]) : (isPersian ? "حذف حساب ناموفق بود؛ دوباره تلاش کن." : "Account deletion failed. Please try again."));
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarError(copy.avatarFormat ?? (isPersian ? "فقط تصویر JPG، PNG یا WebP قابل قبول است." : "Please choose a JPG, PNG, or WebP image."));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError(copy.avatarSize ?? (isPersian ? "حجم تصویر باید کمتر از ۵ مگابایت باشد." : "The image must be smaller than 5 MB."));
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
        : (copy.avatarSaveError ?? (isPersian ? "ذخیرهٔ عکس پروفایل ناموفق بود؛ دوباره تلاش کن." : "Could not save the profile photo. Please try again.")));
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
          <div className="inline-feedback"><LoadingIndicator label={copy.loading ?? (isPersian ? "در حال دریافت پروفایل..." : "Loading profile...")} /></div>
        ) : error ? (
          <div className="inline-feedback">{localizeApiError(error, language)}</div>
        ) : profile ? (
          <>
            <section className="profile-head">
              <div style={{ position: "relative", width: 104, height: 104, margin: "0 auto 12px" }}>
                <div className="avatar-lg" style={{ width: "100%", height: "100%", overflow: "hidden", padding: 0 }}>
                  {profile.avatarDataUrl ? (
                    <img src={profile.avatarDataUrl} alt={copy.profilePhoto ?? (isPersian ? "عکس پروفایل" : "Profile photo")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : profile.username.slice(0, 2).toUpperCase()}
                </div>
                <label
                  title={copy.changePhoto ?? (isPersian ? "آپلود یا تغییر عکس پروفایل" : "Upload or change profile photo")}
                  aria-label={isPersian ? "آپلود یا تغییر عکس پروفایل" : "Upload or change profile photo"}
                  style={{
                    position: "absolute", right: 0, bottom: 0, width: 32, height: 32,
                    borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--brass-light)", color: "#171717", border: "3px solid var(--panel, #171717)",
                    fontSize: 24, fontWeight: 700, lineHeight: 1, cursor: avatarSaving ? "wait" : "pointer",
                    opacity: avatarSaving ? 0.7 : 1, boxShadow: "0 2px 8px rgba(0,0,0,.25)"
                  }}
                >
                  {avatarSaving ? "…" : "+"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handleAvatarChange(event)} disabled={avatarSaving} style={{ display: "none" }} />
                </label>
              </div>
              {avatarError && <p className="inline-feedback round-error" role="alert">{avatarError}</p>}
              <h2>{profile.username}</h2>
              <span>
                {`${copy.memberSince ?? (isPersian ? "عضو از" : "Member since")} ${new Intl.DateTimeFormat(language === "fa" ? "fa-IR" : language, { dateStyle: "medium" }).format(new Date(profile.createdAt))}`}
              </span>
            </section>

            <section className="stat-row">
              <div className="stat-card">
                <strong>{profile.contestsParticipated}</strong>
                <span>{copy.challenges ?? (isPersian ? "شرکت در چالش" : "Challenges")}</span>
              </div>
              <div className="stat-card">
                <strong>{profile.completedContests}</strong>
                <span>{copy.completed ?? (isPersian ? "چالش کامل" : "Completed")}</span>
              </div>
              <div className="stat-card">
                <strong>{profile.solvedKeys}</strong>
                <span>{copy.keysSolved ?? (isPersian ? "کلید حل‌شده" : "Keys solved")}</span>
              </div>
            </section>

            <div className="section-title">
              {copy.performance ?? (isPersian ? "اطلاعات عملکرد" : "Performance")}
            </div>

            <div className="step">
              <div className="step-number mono">#</div>
              <div className="step-content">
                <p>
                  {copy.bestRank ?? (isPersian ? "بهترین رتبه" : "Best rank")}: {profile.bestRank ?? "—"}
                </p>
                <small>
                  {copy.incorrectAttempts ?? (isPersian ? "پاسخ‌های نادرست" : "Incorrect attempts")}: {profile.incorrectAttempts}
                </small>
              </div>
            </div>

          </>
        ) : null}

        <div className="profile-actions" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <button className="cta-button cta-button--logout" type="button" onClick={onLogout}>
            {copy.logout ?? (isPersian ? "خروج از حساب" : "Log out")}
          </button>
          {profile?.role === "USER" && (
            <button className="cta-button cta-button--logout" type="button" onClick={() => void handleDeleteAccount()} disabled={deletingAccount || loading}>
              {deletingAccount ? (copy.deleting ?? (isPersian ? "در حال حذف..." : "Deleting...")) : (copy.deleteAccount ?? (isPersian ? "حذف حساب" : "Delete account"))}
            </button>
          )}
          {deleteError && <p className="inline-feedback round-error" role="alert">{deleteError}</p>}
        </div>
      </main>

      <BottomNav activePage="profile" onNavigate={onNavigate} />
    </div>
  );
}

export default ProfilePage;
