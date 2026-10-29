import { useCallback, useEffect, useState } from "react";
import { getAdminSecurityFlags, setContestParticipationRestriction, type AdminSecurityFlag } from "../services/api";
import { useI18n } from "../i18n";

function durationLabel(ms: number, fa: boolean): string {
  const seconds = (Math.max(0, ms) / 1000).toFixed(2);
  return fa ? seconds.replace(".", "٫") + " ثانیه" : seconds + " seconds";
}

export default function AdminSecurityPanel() {
  const { language } = useI18n();
  const fa = language === "fa";
  const [flags, setFlags] = useState<AdminSecurityFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setFlags(await getAdminSecurityFlags());
    } catch {
      setError(fa ? "بارگذاری گزارش‌های امنیتی ناموفق بود." : "Could not load security reports.");
    } finally {
      setLoading(false);
    }
  }, [fa]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const toggleRestriction = async (flag: AdminSecurityFlag) => {
    const blocked = !flag.user.contestParticipationBlocked;
    const confirmed = window.confirm(blocked
      ? (fa ? "آیا از محدودکردن شرکت این کاربر در چالش‌ها مطمئن هستید؟" : "Restrict this user's participation in challenges?")
      : (fa ? "آیا محدودیت شرکت این کاربر برداشته شود؟" : "Restore this user's challenge participation?"));
    if (!confirmed) return;
    setSavingUserId(flag.userId);
    setError("");
    setNotice("");
    try {
      const result = await setContestParticipationRestriction(
        flag.userId,
        blocked,
        blocked ? "Manual restriction after anti-fraud review" : undefined,
      );
      setFlags((current) => current.map((item) => item.userId === flag.userId
        ? { ...item, user: { ...item.user, contestParticipationBlocked: result.contestParticipationBlocked, contestParticipationBlockedAt: result.contestParticipationBlockedAt, contestParticipationBlockReason: result.contestParticipationBlockReason } }
        : item));
      setNotice(blocked
        ? (fa ? "شرکت این کاربر در چالش‌ها محدود شد." : "User participation restricted.")
        : (fa ? "محدودیت شرکت کاربر برداشته شد." : "User participation restored."));
    } catch (e) {
      const code = e instanceof Error ? e.message : "REQUEST_FAILED";
      setError(fa ? "تغییر محدودیت انجام نشد: " + code : "Could not update restriction: " + code);
    } finally {
      setSavingUserId(null);
    }
  };

  const uniqueUsers = new Set(flags.map((flag) => flag.userId)).size;

  return (
    <section className="admin-panel">
      <div className="admin-source-report__heading">
        <div>
          <h2>{fa ? "امنیت و ضدتقلب مسابقه" : "Challenge security & anti-fraud"}</h2>
          <p className="admin-footnote">
            {fa
              ? "تکمیل ۱۲ خانه در کمتر از ۲ دقیقه یک هشدار مشکوک ایجاد می‌کند، نه محرومیت خودکار. مدیر پس از بررسی می‌تواند شرکت کاربر را محدود یا دوباره فعال کند."
              : "Completing all 12 clues in under 2 minutes creates a suspicious-activity flag, not an automatic ban. An administrator reviews the evidence and can restrict or restore participation."}
          </p>
        </div>
        <button className="admin-refresh" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? (fa ? "در حال بارگذاری…" : "Loading…") : (fa ? "به‌روزرسانی" : "Refresh")}
        </button>
      </div>
      {error && <div className="admin-message admin-message--error" role="alert">{error}</div>}
      {notice && <div className="admin-message" role="status">{notice}</div>}
      <div className="admin-metrics-grid">
        <article className="admin-metric-card">
          <span className="admin-metric-card__label">{fa ? "گزارش‌های مشکوک" : "Suspicious flags"}</span>
          <strong>{flags.length.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
        </article>
        <article className="admin-metric-card">
          <span className="admin-metric-card__label">{fa ? "کاربران یکتا" : "Unique users"}</span>
          <strong>{uniqueUsers.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
        </article>
        <article className="admin-metric-card">
          <span className="admin-metric-card__label">{fa ? "کاربران محدودشده" : "Restricted users"}</span>
          <strong>{new Set(flags.filter((flag) => flag.user.contestParticipationBlocked).map((flag) => flag.userId)).size.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
        </article>
      </div>
      {loading && flags.length === 0 ? <p className="admin-empty">{fa ? "در حال دریافت گزارش‌ها…" : "Loading security flags…"}</p>
        : flags.length === 0 ? <p className="admin-empty">{fa ? "هنوز فعالیت مشکوکی ثبت نشده است." : "No suspicious activity has been flagged yet."}</p>
        : <div className="admin-settings-list">
          {flags.map((flag) => (
            <article className="admin-setting-row" key={flag.id}>
              <div>
                <strong>{flag.user.username} · {flag.user.email}</strong>
                <small>{fa ? "زمان تکمیل ۱۲ خانه: " : "12-clue completion time: "}<b>{durationLabel(flag.completionTimeMs, fa)}</b></small>
                <small>{fa ? "دلیل: تکمیل در کمتر از ۲ دقیقه" : "Reason: completed in under 2 minutes"}</small>
                <small>{fa ? "چالش: " : "Challenge: "}{flag.contest.title} · {flag.contest.language === "fa" ? (fa ? "فارسی" : "Persian") : (fa ? "انگلیسی" : "English")}</small>
                <small>{fa ? "زمان ثبت هشدار: " : "Flag recorded: "}{new Date(flag.createdAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>
                {flag.user.contestParticipationBlocked && <small><b>{fa ? "محدودیت فعال است" : "Participation is restricted"}</b>{flag.user.contestParticipationBlockReason ? " · " + flag.user.contestParticipationBlockReason : ""}</small>}
              </div>
              <button type="button" onClick={() => void toggleRestriction(flag)} disabled={savingUserId === flag.userId}>
                {savingUserId === flag.userId
                  ? (fa ? "در حال ذخیره…" : "Saving…")
                  : flag.user.contestParticipationBlocked
                    ? (fa ? "رفع محدودیت شرکت" : "Restore participation")
                    : (fa ? "محدودکردن شرکت" : "Restrict participation")}
              </button>
            </article>
          ))}
        </div>}
    </section>
  );
}
