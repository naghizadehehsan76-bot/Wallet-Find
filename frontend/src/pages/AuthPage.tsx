import { useState } from "react";
import type { FormEvent } from "react";
import { register, requestLoginCode, verifyLoginCode } from "../services/api";
import { useI18n } from "../i18n";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { localizeApiError } from "../i18n/localize";

type AuthMode = "login" | "signup";

type AuthPageProps = {
  onAuthenticated: (token: string) => void;
  onBack: () => void;
  initialMode?: AuthMode;
};

function AuthPage({ onAuthenticated, onBack, initialMode = "login" }: AuthPageProps) {
  const { language, translation: t } = useI18n();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);

    try {
      if (mode === "signup") {
        const result = await register(email, username, password);
        localStorage.setItem("walletFindToken", result.token);
        localStorage.setItem("walletFindUser", JSON.stringify(result.user));
        onAuthenticated(result.token);
        return;
      }

      if (!codeSent) {
        await requestLoginCode(email);
        setCodeSent(true);
        setNotice(t.auth.codeSent);
        return;
      }

      const result = await verifyLoginCode(email, code);
      localStorage.setItem("walletFindToken", result.token);
      localStorage.setItem("walletFindUser", JSON.stringify(result.user));
      onAuthenticated(result.token);
    } catch (err) {
      setError(localizeApiError(err, language));
    } finally {
      setLoading(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setCodeSent(false);
    setCode("");
    setError("");
    setNotice("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={t.auth.back} onClick={onBack}>
          <span className="brand-dot" />
          <span>Wallet Find</span>
        </button>
        <div className="topbar-actions"><LanguageSwitcher /></div>
      </header>

      <main className="page auth-page">
        <button className="back-button" type="button" onClick={onBack}>
          ‹ {t.auth.back}
        </button>

        <h1 className="auth-title">{t.auth.welcome}</h1>

        <div className="auth-toggle">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => changeMode("login")}>
            {t.auth.login}
          </button>
          <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => changeMode("signup")}>
            {t.auth.signup}
          </button>
        </div>

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
              readOnly={mode === "login" && codeSent}
            />
          </div>

          {mode === "signup" && (
            <>
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
              <div className="field">
                <label htmlFor="password">{t.auth.password}</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t.auth.passwordHint}
                  minLength={8}
                  maxLength={100}
                  required
                  autoComplete="new-password"
                />
              </div>
            </>
          )}

          {mode === "login" && codeSent && (
            <>
              <div className="field">
                <label htmlFor="login-code">{t.auth.codeLabel}</label>
                <input
                  id="login-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  required
                />
              </div>
              <p className="auth-hint">{t.auth.codeHint}</p>
              <button
                className="back-button"
                type="button"
                onClick={() => { setCodeSent(false); setCode(""); setNotice(""); setError(""); }}
              >
                {t.auth.changeEmail}
              </button>
            </>
          )}

          {error && <div className="auth-error" role="alert">{error}</div>}
          {notice && <p className="auth-hint" role="status">{notice}</p>}

          <button className="cta-button" type="submit" disabled={loading}>
            {loading
              ? t.auth.loading
              : mode === "signup"
                ? t.auth.signupButton
                : codeSent
                  ? t.auth.verifyCodeButton
                  : t.auth.sendCodeButton}
          </button>
        </form>

        <p className="auth-hint">{t.auth.privacy}</p>
      </main>
    </div>
  );
}

export default AuthPage;
