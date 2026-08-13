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
  const { translation: t } = useI18n();

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
        <div className="brand">
          <span className="brand-dot" />
          <span>12Keys</span>
        </div>

        <span className="timer mono">
          ۰۴:۱۸
        </span>
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

        <div className="big-key-number mono">
          ۰۵
        </div>

        <div className="key-of">
          {t.key.fifthOfTwelve}
        </div>

        <div className="clue-card">
          <div className="clue-tag">
            {t.key.clue}
          </div>

          <p>
            نامی که در سه شهر ایران به یک میدان تاریخی
            داده شده و در فارسی معنای «سکه» هم دارد.
            حرف اول را با عدد نمادین این شهرها جمع بزن.
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