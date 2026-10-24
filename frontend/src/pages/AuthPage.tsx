import { useState } from "react";
import type { FormEvent } from "react";
import { login, register } from "../services/api";
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result =
        mode === "login"
          ? await login(email, password)
          : await register(email, username, password);

      localStorage.setItem("walletFindToken", result.token);
      localStorage.setItem(
        "walletFindUser",
        JSON.stringify(result.user),
      );

      onAuthenticated(result.token);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "NETWORK_ERROR",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={t.auth.back} onClick={onBack}>
          <span className="brand-dot" />
          <span>Findoo</span>
        </button>
        <div className="topbar-actions"><LanguageSwitcher /></div>
      </header>

      <main className="page auth-page">
        <button className="back-button" type="button" onClick={onBack}>
          ‹ {t.auth.back}
        </button>

        <h1 className="auth-title">{t.auth.welcome}</h1>

        <div className="auth-toggle">
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            {t.auth.login}
          </button>

          <button
            className={mode === "signup" ? "active" : ""}
            type="button"
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
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

          <div className="field">
            <label htmlFor="password">{t.auth.password}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t.auth.passwordHint}
              minLength={8}
              required
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </div>

          {error && (
            <div className="auth-error" role="alert">
              {localizeApiError(error, language)}
            </div>
          )}

          <button className="cta-button" type="submit" disabled={loading}>
            {loading
              ? t.auth.loading
              : mode === "login"
                ? t.auth.loginButton
                : t.auth.signupButton}
          </button>
        </form>

        <p className="auth-hint">
          {t.auth.privacy}
        </p>
      </main>
    </div>
  );
}

export default AuthPage;