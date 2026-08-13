import { useState } from "react";
import type { FormEvent } from "react";
import { login, register } from "../services/api";

type AuthMode = "login" | "signup";

type AuthPageProps = {
  onAuthenticated: (token: string) => void;
  onBack: () => void;
};

function AuthPage({ onAuthenticated, onBack }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
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
          : "خطایی در ارتباط با سرور رخ داد.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>12Keys</span>
        </div>
      </header>

      <main className="page auth-page">
        <button className="back-button" type="button" onClick={onBack}>
          ‹ بازگشت
        </button>

        <h1 className="auth-title">به 12Keys خوش آمدی</h1>

        <div className="auth-toggle">
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            ورود
          </button>

          <button
            className={mode === "signup" ? "active" : ""}
            type="button"
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            ثبت‌نام
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">ایمیل</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="example@email.com"
              required
              autoComplete="email"
            />
          </div>

          {mode === "signup" && (
            <div className="field">
              <label htmlFor="username">نام کاربری</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="مثلاً: shahink"
                minLength={3}
                maxLength={30}
                required
                autoComplete="username"
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="password">رمز عبور</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="حداقل ۸ کاراکتر"
              minLength={8}
              required
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </div>

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button className="cta-button" type="submit" disabled={loading}>
            {loading
              ? "در حال بررسی..."
              : mode === "login"
                ? "ورود"
                : "ساخت حساب"}
          </button>
        </form>

        <p className="auth-hint">
          با ادامه، قوانین مسابقه و حریم خصوصی 12Keys را می‌پذیری.
        </p>
      </main>
    </div>
  );
}

export default AuthPage;