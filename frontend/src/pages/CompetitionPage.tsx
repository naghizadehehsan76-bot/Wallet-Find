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
  const [answerSlots, setAnswerSlots] = useState<string[]>(Array(12).fill(""));
  const [solvedSlots, setSolvedSlots] = useState<boolean[]>(Array(12).fill(false));
  const [incorrectSlots, setIncorrectSlots] = useState<boolean[]>(Array(12).fill(false));
  const activeAnswerIndex = currentSequence === null ? 0 : Math.max(0, Math.min(11, currentSequence - 1));
  const answer = answerSlots[activeAnswerIndex] ?? "";
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error" | "info">("info");
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
          setCompleted(current.status === "CONTEST_COMPLETED");
          setWaitingForClue(current.status === "WAITING_FOR_CLUE");

          if (current.status === "READY") {
            setFeedbackTone("info");
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
    setCompleted(current.status === "CONTEST_COMPLETED");
    setWaitingForClue(current.status === "WAITING_FOR_CLUE");
  }

  async function handleSubmit() {
    const value = answer.trim();

    if (!value) {
      setFeedbackTone("info");
      setFeedback(
        isPersian
          ? "کلمه‌ی انگلیسی را در کادر مربوط به همین راند وارد کن."
          : "Type the English word into the box for this round.",
      );
      return;
    }

    if (!contestId || !currentClueId || submitting || solvedSlots[activeAnswerIndex]) return;

    setSubmitting(true);
    setFeedback("");
    setFeedbackTone("info");
    setError("");

    try {
      const result = await submitAnswer(contestId, currentClueId, value);

      if (result.status === "INCORRECT") {
        setIncorrectSlots((slots) => slots.map((item, index) => index === activeAnswerIndex ? true : item));
        setFeedbackTone("error");
        setFeedback(
          isPersian
            ? "پاسخ غلط است. کلمه را در همین کادر اصلاح کن و دوباره بررسی کن."
            : "Incorrect answer. Edit the word in this box and try again.",
        );
        return;
      }

      setSolvedSlots((slots) => slots.map((item, index) => index === activeAnswerIndex ? true : item));
      setIncorrectSlots((slots) => slots.map((item, index) => index === activeAnswerIndex ? false : item));
      setFeedbackTone("success");

      if (result.status === "CONTEST_COMPLETED") {
        setSolvedCount(12);
        setCurrentSequence(null);
        setCurrentClueId(null);
        setClueContent("");
        setHintAnchor("");
        setSourceUrl("");
        setCompleted(true);
        setFeedback(
          isPersian
            ? "پاسخ درست بود! تبریک، هر ۱۲ راند را کامل کردی."
            : "Correct answer! Congratulations, you completed all 12 rounds.",
        );
        return;
      }

      setFeedback(
        isPersian
          ? "پاسخ درست بود! کلمه در کادر سبز باقی می‌ماند."
          : "Correct answer! The word stays green in its box.",
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
                  <span>{isPersian ? "پاسخ هر راند را در کادر شماره‌ی همان راند تایپ کن" : "Type each answer in its matching round box"}</span>
                  <span className="word-grid-count mono">{isPersian ? "کادر راند " + displayedRound : "ROUND BOX " + displayedRound}</span>
                </div>

                <section className="word-options-grid" aria-label={isPersian ? "دوازده کادر پاسخ، هر راند یک کادر" : "Twelve answer boxes, one per round"}>
                  {answerSlots.map((value, index) => (
                    <label
                      key={index}
                      className={"word-entry " + (activeAnswerIndex === index ? "word-entry--active" : "") + (solvedSlots[index] ? " word-entry--solved" : "") + (incorrectSlots[index] ? " word-entry--incorrect" : "")}
                    >
                      <span className="word-option__index mono">
                        {(index + 1).toString().padStart(2, "0")}
                      </span>
                      <input
                        type="text"
                        value={value}
                        dir="ltr"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-label={(isPersian ? "کادر پاسخ " : "Answer box ") + (index + 1)}
                        placeholder={solvedSlots[index] ? (isPersian ? "پاسخ درست" : "Correct") : index === activeAnswerIndex ? (isPersian ? "کلمه..." : "Type word...") : (isPersian ? "قفل" : "Locked")}
                        disabled={submitting || solvedSlots[index] || index !== activeAnswerIndex}
                        readOnly={solvedSlots[index]}
                        onChange={(event) => {
                          const next = [...answerSlots];
                          next[index] = event.target.value;
                          setAnswerSlots(next);
                          setIncorrectSlots((slots) => slots.map((item, slotIndex) => slotIndex === index ? false : item));
                          setFeedback("");
                          setFeedbackTone("info");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleSubmit();
                          }
                        }}
                      />
                    </label>
                  ))}
                </section>

                <button
                  type="button"
                  className="cta-button word-submit-button"
                  onClick={() => void handleSubmit()}
                  disabled={!answer.trim() || submitting || completed}
                >
                  {submitting
                    ? (isPersian ? "در حال بررسی..." : "Checking...")
                    : (isPersian ? "بررسی کلمه‌ی واردشده" : "Check typed word")}
                </button>
              </>
            )}

            {feedback && <div className={"inline-feedback round-notice round-notice--" + feedbackTone} role="status" aria-live="polite">{feedback}</div>}
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
                    ? "کلمه‌ی انگلیسی بلافاصله بعد از عبارت را پیدا کن و خودت در یکی از کادرهای خالی تایپ کن."
                    : "Find the English word immediately after the phrase and type it yourself into an empty box."}
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
