import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  login,
  register,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
} from "../services/api";
import { useI18n } from "../i18n";
import { localizeApiError } from "../i18n/localize";
import LoadingIndicator from "../components/LoadingIndicator";

type AuthMode = "login" | "signup" | "verify" | "forgot" | "reset";

type AuthPageProps = {
  onAuthenticated: (token: string) => void;
  onBack: () => void;
  onOpenTerms: () => void;
  initialMode?: "login" | "signup";
  initialNotice?: string;
};

function AuthPage({
  onAuthenticated,
  onBack,
  onOpenTerms,
  initialMode = "login",
  initialNotice = "",
}: AuthPageProps) {
  const { language, translation: t } = useI18n();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialNotice);
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    if (initialNotice) setError(initialNotice);
  }, [initialNotice]);

  function saveSession(result: { token: string; user: unknown }) {
    localStorage.setItem("walletFindToken", result.token);
    localStorage.setItem("walletFindUser", JSON.stringify(result.user));
    onAuthenticated(result.token);
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setSuccess("");
    setCode("");
    setPassword("");
    if (nextMode === "login" || nextMode === "signup") setAcceptedTerms(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (mode === "login") {
        const result = await login(email, password);
        saveSession(result);
      } else if (mode === "signup") {
        await register(email, username, password);
        setPassword("");
        setCode("");
        setMode("verify");
        setSuccess(t.auth.verificationSent);
      } else if (mode === "verify") {
        const result = await verifyEmail(email, code);
        saveSession(result);
      } else if (mode === "forgot") {
        await forgotPassword(email);
        setCode("");
        setPassword("");
        setMode("reset");
        setSuccess(t.auth.resetRequested);
      } else {
        await resetPassword(email, code, password);
        setCode("");
        setPassword("");
        setMode("login");
        setSuccess(t.auth.passwordResetSuccess);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "NETWORK_ERROR";
      if (mode === "login" && message === "EMAIL_NOT_VERIFIED") {
        setMode("verify");
        setSuccess(t.auth.verifyExistingNotice);
      } else if (mode === "signup" && message === "EMAIL_SEND_FAILED") {
        setMode("verify");
        setError(message);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await resendVerification(email);
      setSuccess(t.auth.resendRequested);
    } catch (err) {
      setError(err instanceof Error ? err.message : "NETWORK_ERROR");
    } finally {
      setLoading(false);
    }
  }

  const title =
    mode === "verify" ? t.auth.verificationTitle :
    mode === "forgot" ? t.auth.forgotTitle :
    mode === "reset" ? t.auth.resetTitle :
    t.auth.welcome;

  const instructions =
    mode === "verify" ? t.auth.verificationInstructions :
    mode === "forgot" ? t.auth.forgotInstructions :
    mode === "reset" ? t.auth.resetInstructions :
    "";

  const submitLabel =
    mode === "login" ? t.auth.loginButton :
    mode === "signup" ? t.auth.signupButton :
    mode === "verify" ? t.auth.verifyButton :
    mode === "forgot" ? t.auth.sendResetCode :
    t.auth.resetButton;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={t.auth.back} onClick={onBack}>
          <span className="brand-wallet">Wallet</span><span className="brand-find">Find</span>
        </button>
      </header>

      <main className="page auth-page">
        <button className="back-button" type="button" onClick={onBack}>
          ‹ {t.auth.back}
        </button>

        <h1 className="auth-title" dir={language === "fa" ? "rtl" : "ltr"}>{title}</h1>
        {instructions && <p className="auth-description" dir={language === "fa" ? "rtl" : "ltr"}>{instructions}</p>}

        {(mode === "login" || mode === "signup") && (
          <div className="auth-toggle">
            <button
              className={mode === "login" ? "active" : ""}
              type="button"
              onClick={() => changeMode("login")}
            >
              {t.auth.login}
            </button>
            <button
              className={mode === "signup" ? "active" : ""}
              type="button"
              onClick={() => changeMode("signup")}
            >
              {t.auth.signup}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">{t.auth.email}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t.auth.emailPlaceholder}
              required
              autoComplete="email"
              maxLength={254}
            />
          </div>

          {mode === "signup" && (
            <div className="field">
              <label htmlFor="username">{t.auth.username}</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t.auth.usernamePlaceholder}
                minLength={3}
                maxLength={30}
                required
                autoComplete="username"
              />
            </div>
          )}

          {(mode === "verify" || mode === "reset") && (
            <div className="field">
              <label htmlFor="verification-code">{t.auth.code}</label>
              <input
                id="verification-code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t.auth.codePlaceholder}
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                autoComplete="one-time-code"
              />
            </div>
          )}

          {(mode === "login" || mode === "signup" || mode === "reset") && (
            <div className="field">
              <label htmlFor="password">{t.auth.password}</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "reset" ? t.auth.passwordNewHint : t.auth.passwordHint}
                minLength={8}
                maxLength={100}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
          )}

          {error && (
            <div className="auth-error" role="alert">
              {localizeApiError(error, language)}
            </div>
          )}
          {success && (
            <div className="auth-success" role="status">
              {success}
            </div>
          )}

          {mode === "signup" && (
            <div className="auth-terms">
              <input
                id="auth-terms-accepted"
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                required
                aria-label={`${t.auth.privacyBefore} ${t.auth.privacyLink} ${t.auth.privacyAfter}`}
                aria-describedby="auth-terms-copy"
              />
              <span id="auth-terms-copy">
                <label htmlFor="auth-terms-accepted">{t.auth.privacyBefore}</label>{" "}
                <button className="auth-terms-link" type="button" onClick={onOpenTerms}>
                  {t.auth.privacyLink}
                </button>{" "}
                {t.auth.privacyAfter}
              </span>
            </div>
          )}

          <button
            className="cta-button"
            type="submit"
            disabled={loading || (mode === "signup" && !acceptedTerms)}
          >
            {loading ? <LoadingIndicator compact label={t.auth.loading} /> : submitLabel}
          </button>
        </form>

        {mode === "login" && (
          <button className="auth-terms-link auth-secondary-action" type="button" onClick={() => changeMode("forgot")}>
            {t.auth.forgotPassword}
          </button>
        )}
        {mode === "verify" && (
          <button className="auth-terms-link auth-secondary-action" type="button" onClick={handleResendCode} disabled={loading}>
            {t.auth.resendCode}
          </button>
        )}
        {(mode === "forgot" || mode === "reset" || mode === "verify") && (
          <button className="auth-terms-link auth-secondary-action" type="button" onClick={() => changeMode("login")}>
            {t.auth.backToLogin}
          </button>
        )}
      </main>
    </div>
  );
}

export default AuthPage;
