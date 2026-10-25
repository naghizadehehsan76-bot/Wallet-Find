import { useState } from "react";
import type { FormEvent } from "react";
import { bootstrapAdmin } from "../services/api";
import { useI18n } from "../i18n";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function AdminSetupPage() {
  const { language } = useI18n();
  const fa = language === "fa";
  const [setupSecret, setSetupSecret] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await bootstrapAdmin({ setupSecret, email, username, password });
      setSuccess(true);
      setSetupSecret("");
      setPassword("");
    } catch (err) {
      const code = err instanceof Error ? err.message : "REQUEST_FAILED";
      const faMessages: Record<string, string> = {
        ADMIN_BOOTSTRAP_NOT_CONFIGURED: "راه‌اندازی مدیر در تنظیمات سرور فعال نشده است.",
        INVALID_SETUP_SECRET: "کلید راه‌اندازی اشتباه است.",
        INVALID_ADMIN_DETAILS: "ایمیل، نام کاربری یا رمز عبور معتبر نیست.",
        ADMIN_ALREADY_CONFIGURED: "حساب مدیر قبلاً ساخته شده است؛ از صفحه ورود استفاده کن.",
        EMAIL_OR_USERNAME_ALREADY_EXISTS: "این ایمیل یا نام کاربری قبلاً ثبت شده است.",
      };
      const enMessages: Record<string, string> = {
        ADMIN_BOOTSTRAP_NOT_CONFIGURED: "Admin setup has not been enabled in the server environment.",
        INVALID_SETUP_SECRET: "The setup secret is incorrect.",
        INVALID_ADMIN_DETAILS: "The email, username, or password is invalid.",
        ADMIN_ALREADY_CONFIGURED: "An administrator already exists. Please sign in instead.",
        EMAIL_OR_USERNAME_ALREADY_EXISTS: "That email or username is already registered.",
      };
      setError((fa ? faMessages : enMessages)[code] ?? (fa ? "ساخت حساب مدیر ناموفق بود." : "Administrator setup failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand brand--home"><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></div>
        <div className="topbar-actions"><LanguageSwitcher /></div>
      </header>
      <main className="page auth-page">
        <div className="eyebrow">SECURE ONE-TIME SETUP</div>
        <h1 className="auth-title">{fa ? "راه‌اندازی مدیر اصلی" : "Set up the first administrator"}</h1>
        <p className="date">{fa ? "این صفحه فقط تا زمانی کار می‌کند که هنوز حساب مدیری ساخته نشده باشد." : "This page works only before the first administrator account exists."}</p>
        {success ? (
          <div className="admin-message" role="status">
            {fa ? "حساب مدیر ساخته شد. حالا به صفحه ورود برو و با ایمیل و رمز انتخابی خودت وارد شو. کلید ADMIN_BOOTSTRAP_SECRET را از تنظیمات Render حذف کن." : "Administrator created. Sign in using the email and password you chose. Remove ADMIN_BOOTSTRAP_SECRET from Render environment settings."}
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="field"><label htmlFor="setup-secret">{fa ? "کلید راه‌اندازی محرمانه" : "Private setup secret"}</label><input id="setup-secret" type="password" value={setupSecret} onChange={e => setSetupSecret(e.target.value)} required autoComplete="off" /></div>
            <div className="field"><label htmlFor="admin-email">{fa ? "ایمیل مدیر" : "Administrator email"}</label><input id="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></div>
            <div className="field"><label htmlFor="admin-username">{fa ? "نام کاربری" : "Username"}</label><input id="admin-username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_-]{3,30}" autoComplete="username" /></div>
            <div className="field"><label htmlFor="admin-password">{fa ? "رمز عبور (حداقل ۱۲ نویسه)" : "Password (at least 12 characters)"}</label><input id="admin-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" /></div>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="cta-button" type="submit" disabled={busy}>{busy ? (fa ? "در حال ساخت..." : "Creating...") : (fa ? "ساخت حساب مدیر" : "Create administrator")}</button>
          </form>
        )}
      </main>
    </div>
  );
}
