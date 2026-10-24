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

type KeyStagePageProps = {
  onNavigate: (page: Page) => void;
};

function KeyStagePage({
  onNavigate,
}: KeyStagePageProps) {
  const { translation: t, language } = useI18n();
  const numberLocale = language === "fa" ? "fa-IR" : "en-US";

  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<string>(
    t.key.checking,
  );

  function handleSubmit() {
    const value = answer.trim();

    if (!value) {
      setFeedback(t.key.emptyAnswer);
      return;
    }

    setFeedback(t.key.checking);
    setAnswer("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={language === "fa" ? "خانه" : "Home"} onClick={() => onNavigate("home")}>
          <span className="brand-wallet">Wallet</span><span className="brand-find">Find</span>
        </button>

        
      </header>

      <main className="page">
        <div className="stage-top">
          <button
            className="back-button"
            type="button"
            onClick={() =>
              onNavigate("competition")
            }
          >
            ‹ {t.key.allKeys}
          </button>
        </div>

        <div className="big-key-number mono">{(5).toLocaleString(numberLocale, { minimumIntegerDigits: 2, useGrouping: false })}</div>

        <div className="key-of">
          {t.key.fifthOfTwelve}
        </div>

        <div className="clue-card">
          <div className="clue-tag">
            {t.key.clue}
          </div>

          <p>
            {t.key.mockClue}
          </p>
        </div>

        <div className="answer-box">
          <input
            type="text"
            value={answer}
            onChange={(event) =>
              setAnswer(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSubmit();
              }
            }}
            placeholder={
              t.key.answerPlaceholder
            }
          />

          <button
            type="button"
            onClick={handleSubmit}
          >
            {t.key.submit}
          </button>
        </div>

        <div className="feedback">
          {feedback}
        </div>
      </main>

      <BottomNav
        activePage="competition"
        onNavigate={onNavigate}
      />
    </div>
  );
}

export default KeyStagePage;