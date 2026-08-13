import { useState } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";

type Page =
  | "home"
  | "auth"
  | "competition"
  | "key"
  | "leaderboard"
  | "profile"
  | "wallet";

type CompetitionPageProps = {
  onNavigate: (page: Page) => void;
};

type KeyStatus =
  | "solved"
  | "current"
  | "locked";

const keyStatuses: KeyStatus[] = [
  "solved",
  "solved",
  "solved",
  "solved",
  "current",
  "locked",
  "locked",
  "locked",
  "locked",
  "locked",
  "locked",
  "locked",
];

function CompetitionPage({
  onNavigate,
}: CompetitionPageProps) {
  const { language } = useI18n();
  const isPersian = language === "fa";

  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");

  function submitAnswer() {
    const value = answer.trim();

    if (!value) {
      setFeedback(
        isPersian
          ? "پاسخ را وارد کن."
          : "Enter your answer.",
      );
      return;
    }

    setFeedback(
      isPersian
        ? "پاسخ ثبت شد — در حال بررسی..."
        : "Answer submitted — checking...",
    );

    setAnswer("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>12Keys</span>
        </div>

        <div className="wallet-pill mono">
          ₮ 128.40
        </div>
      </header>

      <main className="page">
        <section className="comp-head">
          <div>
            <h2 className="page-title">
              {isPersian
                ? "مسابقه امشب"
                : "Tonight's Contest"}
            </h2>

            <div className="date">
              {isPersian
                ? "۱۶ مرداد ۱۴۰۴ — ساعت ۲۱:۰۰"
                : "August 7, 2025 — 21:00"}
            </div>
          </div>

          <div className="prize">
            <strong>۵۰۰ ₮</strong>
            <span>USDT · Polygon</span>
          </div>
        </section>

        {/* 3 × 4 grid */}
        <section className="keys-grid keys-grid--3x4">
          {keyStatuses.map((status, index) => {
            const keyNumber = index + 1;
            const isCurrent = status === "current";
            const isSolved = status === "solved";
            const isLocked = status === "locked";

            return (
              <div
                key={keyNumber}
                className={`keycell keycell--large ${status}`}
              >
                <div className="keycell-top">
                  <div className="keycell-number mono">
                    {keyNumber.toLocaleString(
                      isPersian ? "fa-IR" : "en-US",
                    )}
                  </div>

                  <div className="keycell-status">
                    {isSolved &&
                      (isPersian
                        ? "حل‌شده"
                        : "Solved")}

                    {isCurrent &&
                      (isPersian
                        ? "در حال حل"
                        : "In Progress")}

                    {isLocked &&
                      (isPersian
                        ? "قفل"
                        : "Locked")}
                  </div>
                </div>

                {isSolved && (
                  <div className="keycell-answer solved-answer">
                    ✓
                  </div>
                )}

                {isCurrent && (
                  <div className="inline-answer">
                    <input
                      type="text"
                      value={answer}
                      onChange={(event) =>
                        setAnswer(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          submitAnswer();
                        }
                      }}
                      placeholder={
                        isPersian
                          ? "پاسخ..."
                          : "Answer..."
                      }
                      autoComplete="off"
                    />

                    <button
                      type="button"
                      onClick={submitAnswer}
                      aria-label={
                        isPersian
                          ? "ثبت پاسخ"
                          : "Submit answer"
                      }
                    >
                      ✓
                    </button>
                  </div>
                )}

                {isLocked && (
                  <div className="keycell-lock">
                    🔒
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {feedback && (
          <div className="inline-feedback">
            {feedback}
          </div>
        )}

        <div className="section-title">
          {isPersian
            ? "قوانین کوتاه"
            : "Short Rules"}
        </div>

        <div className="step">
          <div className="step-number mono">
            –
          </div>

          <div className="step-content">
            <p>
              {isPersian
                ? "ترتیب کلیدها ثابت است؛ کلید بعدی بعد از حل کلید قبلی باز می‌شود."
                : "Keys must be solved in order. The next key unlocks after the previous one is solved."}
            </p>
          </div>
        </div>

        <div className="step">
          <div className="step-number mono">
            –
          </div>

          <div className="step-content">
            <p>
              {isPersian
                ? "پاسخ‌های اشتباه ثبت می‌شوند اما زمان حل مسابقه را کم نمی‌کنند."
                : "Wrong answers are recorded but do not reduce the contest solving time."}
            </p>
          </div>
        </div>
      </main>

      <BottomNav
        activePage="competition"
        onNavigate={onNavigate}
      />
    </div>
  );
}

export default CompetitionPage;