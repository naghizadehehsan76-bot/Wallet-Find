import { useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import {
  getActiveContest,
  getCurrentClue,
  submitAnswer,
} from "../services/api";
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
  const [hintAnchor, setHintAnchor] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [waitingForClue, setWaitingForClue] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void getActiveContest()
      .then(async (contest) => {
        if (cancelled) return;

        setContestId(contest.id);
        setContestTitle(contest.title);
        setContestDate(contest.startsAt);

        const current = await getCurrentClue(contest.id);
        if (cancelled) return;

        setSolvedCount(current.solvedCount);
        setCurrentSequence(current.currentSequence);
        setCurrentClueId(current.clue?.id ?? null);
        setClueContent(current.clue?.content ?? "");
        setHintAnchor(current.clue?.hintAnchor ?? "");
        setSourceUrl(current.clue?.sourceUrl ?? "");
        setWordOptions(current.clue?.options ?? []);
        setCompleted(current.status === "CONTEST_COMPLETED");
        setWaitingForClue(current.status === "WAITING_FOR_CLUE");

        if (current.status === "WAITING_FOR_CLUE") {
          setFeedback(
            isPersian
              ? "راند بعدی هنوز آماده‌ی انتشار نیست؛ صفحه به‌صورت خودکار بررسی می‌شود."
              : "The next round is not published yet. This page will check automatically.",
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;

        setError(
          err instanceof Error
            ? err.message
            : isPersian
              ? "خطا در دریافت مسابقه"
              : "Unable to load the contest.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPersian]);

  useEffect(() => {
    if (!contestId || !waitingForClue) return;

    let cancelled = false;
    const pollForClue = () => {
      void getCurrentClue(contestId)
        .then((current) => {
          if (cancelled) return;

          setSolvedCount(current.solvedCount);
          setCurrentSequence(current.currentSequence);
          setCurrentClueId(current.clue?.id ?? null);
          setClueContent(current.clue?.content ?? "");
          setHintAnchor(current.clue?.hintAnchor ?? "");
          setSourceUrl(current.clue?.sourceUrl ?? "");
          setWordOptions(current.clue?.options ?? []);
          setCompleted(current.status === "CONTEST_COMPLETED");
          setWaitingForClue(current.status === "WAITING_FOR_CLUE");

          if (current.status === "READY") {
            setAnswer("");
            setFeedback(
              isPersian
                ? "راند جدید آماده است؛ راهنما را بخوان و کلمه را پیدا کن."
                : "The next round is ready. Read the hint and find the word.",
            );
          } else if (current.status === "CONTEST_COMPLETED") {
            setFeedback(
              isPersian
                ? "تبریک! هر ۱۲ راند را کامل کردی."
                : "Congratulations! You completed all 12 rounds.",
            );
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFeedback(
              isPersian
                ? "ارتباط موقتاً قطع شده؛ دوباره به‌صورت خودکار تلاش می‌کنیم."
                : "Connection interrupted. Retrying automatically.",
            );
          }
        });
    };

    const intervalId = window.setInterval(pollForClue, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [contestId, waitingForClue, isPersian]);

  async function refreshCurrentClue() {
    if (!contestId) return;

    const current = await getCurrentClue(contestId);

    setSolvedCount(current.solvedCount);
    setCurrentSequence(current.currentSequence);
    setCurrentClueId(current.clue?.id ?? null);
    setClueContent(current.clue?.content ?? "");
    setHintAnchor(current.clue?.hintAnchor ?? "");
    setSourceUrl(current.clue?.sourceUrl ?? "");
    setWordOptions(current.clue?.options ?? []);
    setCompleted(current.status === "CONTEST_COMPLETED");
    setWaitingForClue(current.status === "WAITING_FOR_CLUE");
  }

  async function handleSubmit() {
    const value = answer.trim();

    if (!value) {
      setFeedback(
        isPersian
          ? "ابتدا یکی از ۱۲ کلمه را انتخاب کن."
          : "Choose one of the twelve words first.",
      );
      return;
    }

    if (!contestId || !currentClueId || submitting) return;

    setSubmitting(true);
    setFeedback("");
    setError("");

    try {
      const result = await submitAnswer(contestId, currentClueId, value);

      if (result.status === "INCORRECT") {
        setFeedback(
          isPersian
            ? "این کلمه درست نیست. راهنما و لینک را دوباره بررسی کن."
            : "That word is not correct. Check the hint and source link again.",
        );
        setAnswer("");
        return;
      }

      if (result.status === "CONTEST_COMPLETED") {
        setSolvedCount(12);
        setCurrentSequence(null);
        setCurrentClueId(null);
        setClueContent("");
        setHintAnchor("");
        setSourceUrl("");
        setWordOptions([]);
        setCompleted(true);
        setAnswer("");
        setFeedback(
          isPersian
            ? "تبریک! هر ۱۲ راند را کامل کردی."
            : "Congratulations! You completed all 12 rounds.",
        );
        return;
      }

      setAnswer("");
      setFeedback(
        isPersian
          ? "آفرین! کلمه درست بود؛ راند بعدی باز شد."
          : "Correct! The next round is unlocked.",
      );
      await refreshCurrentClue();
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

  const formattedDate = contestDate
    ? new Intl.DateTimeFormat(isPersian ? "fa-IR" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(contestDate))
    : "";

  const displayedRound = currentSequence ?? (completed ? 12 : solvedCount + 1);
  const progressPercent = Math.min(100, (solvedCount / 12) * 100);

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
                (isPersian ? "مسابقه واژه‌یابی" : "Word-finding contest")}
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
        ) : error && !currentClueId && !completed ? (
          <div className="inline-feedback">{error}</div>
        ) : (
          <>
            <section className="round-progress">
              <div className="round-progress__labels">
                <strong>
                  {isPersian
                    ? "راند " + displayedRound + " از ۱۲"
                    : "Round " + displayedRound + " of 12"}
                </strong>
                <span>
                  {isPersian
                    ? solvedCount + " راند حل‌شده"
                    : solvedCount + " completed"}
                </span>
              </div>
              <div
                className="round-progress__track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={12}
                aria-valuenow={solvedCount}
                aria-label={isPersian ? "پیشرفت مسابقه" : "Contest progress"}
              >
                <span style={{ width: progressPercent + "%" }} />
              </div>
            </section>

            {completed ? (
              <section className="round-complete">
                <div className="round-complete__icon">✓</div>
                <h3>{isPersian ? "مسابقه کامل شد!" : "Contest completed!"}</h3>
                <p>
                  {isPersian
                    ? "هر ۱۲ راند را با موفقیت حل کردی."
                    : "You successfully solved all twelve rounds."}
                </p>
              </section>
            ) : waitingForClue ? (
              <div className="inline-feedback">
                {isPersian
                  ? "در انتظار آماده‌شدن راند بعدی..."
                  : "Waiting for the next round..."}
              </div>
            ) : (
              <>
                <section className="round-hint-card">
                  <div className="round-card__eyebrow">
                    {isPersian ? "راهنمای این راند" : "ROUND HINT"}
                  </div>
                  {hintAnchor ? (
                    <p>
                      {isPersian
                        ? "در صفحه‌ی منبع عبارت زیر را دقیقاً پیدا کن؛ کلمه‌ی انگلیسی بلافاصله پس از آن، پاسخ این راند است:"
                        : "Find this exact phrase on the source page. The English word immediately after it is the answer:"}
                    </p>
                  ) : (
                    <p>{clueContent}</p>
                  )}
                  {hintAnchor && (
                    <div className="round-hint-card__phrase" dir="ltr">
                      “{hintAnchor}”
                    </div>
                  )}
                  <div className="round-hint-card__tip">
                    {isPersian
                      ? "راهنما کلمه‌ی جواب را نشان نمی‌دهد؛ آن را در خود صفحه‌ی منبع پیدا کن."
                      : "The hint does not reveal the answer; find it on the source page itself."}
                  </div>
                </section>

                {sourceUrl && (
                  <section className="round-source-card">
                    <div className="round-card__eyebrow">
                      {isPersian ? "لینک صفحه‌ی منبع" : "SOURCE PAGE"}
                    </div>
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="round-source-link"
                    >
                      <span className="round-source-link__icon">↗</span>
                      <span>
                        {isPersian ? "باز کردن لینک منبع" : "Open source link"}
                      </span>
                    </a>
                    <div className="round-source-url" dir="ltr">
                      {sourceUrl}
                    </div>
                  </section>
                )}

                <div className="word-grid-title">
                  <span>{isPersian ? "یکی از ۱۲ کلمه را انتخاب کن" : "Choose one of the 12 words"}</span>
                  <span className="word-grid-count mono">12 WORDS</span>
                </div>

                {wordOptions.length === 12 ? (
                  <section className="word-options-grid" aria-label={isPersian ? "گزینه‌های کلمه" : "Word options"}>
                    {wordOptions.map((word, index) => (
                      <button
                        key={word}
                        type="button"
                        className={"word-option " + (answer === word ? "word-option--selected" : "")}
                        aria-pressed={answer === word}
                        disabled={submitting}
                        onClick={() => {
                          setAnswer(word);
                          setFeedback("");
                        }}
                      >
                        <span className="word-option__index mono">
                          {(index + 1).toString().padStart(2, "0")}
                        </span>
                        <span className="word-option__word" dir="ltr">
                          {word}
                        </span>
                      </button>
                    ))}
                  </section>
                ) : (
                  <div className="inline-feedback">
                    {isPersian
                      ? "گزینه‌های این راند دریافت نشدند؛ صفحه را دوباره بارگذاری کن."
                      : "The word options did not load. Please reload the page."}
                  </div>
                )}

                <button
                  type="button"
                  className="cta-button word-submit-button"
                  onClick={() => void handleSubmit()}
                  disabled={!answer || submitting || completed || wordOptions.length !== 12}
                >
                  {submitting
                    ? (isPersian ? "در حال بررسی..." : "Checking...")
                    : (isPersian ? "ثبت کلمه‌ی انتخاب‌شده" : "Submit selected word")}
                </button>
              </>
            )}

            {feedback && <div className="inline-feedback">{feedback}</div>}
            {error && <div className="inline-feedback round-error">{error}</div>}

            <div className="section-title">
              {isPersian ? "روش بازی" : "How to play"}
            </div>

            <div className="step">
              <div className="step-number mono">1</div>
              <div className="step-content">
                <p>
                  {isPersian
                    ? "عبارت مشخص‌شده در راهنما را در لینک منبع جست‌وجو کن."
                    : "Search for the exact phrase from the hint on the source page."}
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-number mono">2</div>
              <div className="step-content">
                <p>
                  {isPersian
                    ? "کلمه‌ی انگلیسی بلافاصله بعد از عبارت را از شبکه‌ی ۳ در ۴ انتخاب کن."
                    : "Select the English word immediately after that phrase from the 3-by-4 grid."}
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-number mono">3</div>
              <div className="step-content">
                <p>
                  {isPersian
                    ? "راندها به ترتیب باز می‌شوند؛ پاسخ اشتباه راند بعدی را باز نمی‌کند."
                    : "Rounds unlock in order. An incorrect answer will not unlock the next round."}
                </p>
              </div>
            </div>
          </>
        )}
      </main>

      <BottomNav activePage="competition" onNavigate={onNavigate} />
    </div>
  );
}

export default CompetitionPage;
