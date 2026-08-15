import { useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import { getActiveContest, getCurrentClue, submitAnswer } from "../services/api";
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

type KeyStatus = "solved" | "current" | "locked";

function CompetitionPage({ onNavigate }: CompetitionPageProps) {
  const { language } = useI18n();
  const isPersian = language === "fa";

  const [contestId, setContestId] = useState<string | null>(null);
  const [contestTitle, setContestTitle] = useState("");
  const [contestDate, setContestDate] = useState<string | null>(null);
  const [currentClueId, setCurrentClueId] = useState<string | null>(null);
  const [currentSequence, setCurrentSequence] = useState<number | null>(null);
  const [solvedCount, setSolvedCount] = useState(0);
  const [clueContent, setClueContent] = useState("");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  async function loadContest() {
    setLoading(true);
    setError("");

    try {
      const contest = await getActiveContest();
      setContestId(contest.id);
      setContestTitle(contest.title);
      setContestDate(contest.startsAt);

      const current = await getCurrentClue(contest.id);

      setSolvedCount(current.solvedCount);
      setCurrentSequence(current.currentSequence);
      setCurrentClueId(current.clue?.id ?? null);
      setClueContent(current.clue?.content ?? "");
      setCompleted(current.status === "CONTEST_COMPLETED");

      if (current.status === "WAITING_FOR_CLUE") {
        setFeedback(
          isPersian
            ? "سرنخ بعدی هنوز منتشر نشده است."
            : "The next clue has not been published yet.",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isPersian
            ? "خطا در دریافت مسابقه"
            : "Unable to load the contest.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContest();
  }, []);

  async function handleSubmit() {
    const value = answer.trim();

    if (!value) {
      setFeedback(
        isPersian
          ? "پاسخ را وارد کن."
          : "Enter your answer.",
      );
      return;
    }

    if (!contestId || !currentClueId || submitting) {
      return;
    }

    setSubmitting(true);
    setFeedback("");
    setError("");

    try {
      const result = await submitAnswer(
        contestId,
        currentClueId,
        value,
      );

      if (result.status === "INCORRECT") {
        setFeedback(
          isPersian
            ? "پاسخ نادرست است. کلید فعلی همچنان فعال است."
            : "Incorrect answer. The current key remains active.",
        );
        setAnswer("");
        return;
      }

      if (result.status === "CONTEST_COMPLETED") {
        setSolvedCount(12);
        setCurrentSequence(null);
        setCurrentClueId(null);
        setClueContent("");
        setCompleted(true);
        setAnswer("");
        setFeedback(
          isPersian
            ? "تبریک! هر ۱۲ کلید را حل کردی."
            : "Congratulations! You solved all 12 keys.",
        );
        return;
      }

      setAnswer("");
      setFeedback(
        isPersian
          ? "پاسخ صحیح است. کلید بعدی باز شد."
          : "Correct answer. The next key is unlocked.",
      );
      await loadContest();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isPersian
            ? "خطا در ثبت پاسخ"
            : "Unable to submit the answer.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const statusFor = (sequence: number): KeyStatus => {
    if (sequence <= solvedCount) {
      return "solved";
    }

    if (currentSequence === sequence) {
      return "current";
    }

    return "locked";
  };

  const formattedDate = contestDate
    ? new Intl.DateTimeFormat(
        isPersian ? "fa-IR" : "en-US",
        {
          dateStyle: "medium",
          timeStyle: "short",
        },
      ).format(new Date(contestDate))
    : "";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>12Keys</span>
        </div>

        <div className="wallet-pill mono">₮ 128.40</div>
      </header>

      <main className="page">
        <section className="comp-head">
          <div>
            <h2 className="page-title">
              {contestTitle ||
                (isPersian ? "مسابقه امشب" : "Tonight's Contest")}
            </h2>

            <div className="date">
              {formattedDate ||
                (isPersian ? "مسابقه فعال" : "Active contest")}
            </div>
          </div>

          <div className="prize">
            <strong>۵۰۰ ₮</strong>
            <span>USDT · Polygon</span>
          </div>
        </section>

        {loading ? (
          <div className="inline-feedback">
            {isPersian ? "در حال دریافت مسابقه..." : "Loading contest..."}
          </div>
        ) : error ? (
          <div className="inline-feedback">
            {error}
          </div>
        ) : (
          <>
            <section className="keys-grid keys-grid--3x4">
              {Array.from({ length: 12 }).map((_, index) => {
                const keyNumber = index + 1;
                const status = statusFor(keyNumber);
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
                          (isPersian ? "حل‌شده" : "Solved")}

                        {isCurrent &&
                          (isPersian ? "در حال حل" : "In Progress")}

                        {isLocked &&
                          (isPersian ? "قفل" : "Locked")}
                      </div>
                    </div>

                    {isSolved && (
                      <div className="keycell-answer solved-answer">
                        ✓
                      </div>
                    )}

                    {isCurrent && (
                      <>
                        <div className="key-clue-preview">
                          {clueContent}
                        </div>

                        <div className="inline-answer">
                          <input
                            type="text"
                            value={answer}
                            onChange={(event) =>
                              setAnswer(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                void handleSubmit();
                              }
                            }}
                            placeholder={
                              isPersian ? "کلمه..." : "Word..."
                            }
                            autoComplete="off"
                            disabled={submitting || completed}
                          />

                          <button
                            type="button"
                            onClick={() => void handleSubmit()}
                            disabled={submitting || completed}
                            aria-label={
                              isPersian ? "ثبت پاسخ" : "Submit answer"
                            }
                          >
                            {submitting ? "…" : "✓"}
                          </button>
                        </div>
                      </>
                    )}

                    {isLocked && (
                      <div className="keycell-lock">🔒</div>
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
              {isPersian ? "قوانین کوتاه" : "Short Rules"}
            </div>

            <div className="step">
              <div className="step-number mono">–</div>
              <div className="step-content">
                <p>
                  {isPersian
                    ? "کلیدها باید به ترتیب حل شوند و پاسخ هر کلمه در همان جایگاه وارد می‌شود."
                    : "Keys must be solved in order, with each word entered in its own position."}
                </p>
              </div>
            </div>

            <div className="step">
              <div className="step-number mono">–</div>
              <div className="step-content">
                <p>
                  {isPersian
                    ? "پاسخ‌های اشتباه ثبت می‌شوند اما کلید بعدی را باز نمی‌کنند."
                    : "Wrong answers are recorded but do not unlock the next key."}
                </p>
              </div>
            </div>
          </>
        )}
      </main>

      <BottomNav
        activePage="competition"
        onNavigate={onNavigate}
      />
    </div>
  );
}

export default CompetitionPage;
