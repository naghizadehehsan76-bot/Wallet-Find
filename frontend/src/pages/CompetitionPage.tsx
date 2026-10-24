import { useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import {
  getActiveContest,
  getCurrentClue,
  startNextContest,
  submitAnswer,
  getContestPrizePool,
  type PrizePoolView,
} from "../services/api";
import { useI18n } from "../i18n";
import { localizeApiError, localizeContestTitle, localizeUiMessage } from "../i18n/localize";

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
  const [prizePool, setPrizePool] = useState<PrizePoolView | null>(null);
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
  const [startingNextContest, setStartingNextContest] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [waitingForClue, setWaitingForClue] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [serverTimeOffset, setServerTimeOffset] = useState(0);

  function applyCurrentClue(current: Awaited<ReturnType<typeof getCurrentClue>>) {
    if (current.serverTime) {
      const serverTimestamp = Date.parse(current.serverTime);
      if (Number.isFinite(serverTimestamp)) {
        setServerTimeOffset(serverTimestamp - Date.now());
      }
    }
    setSolvedCount(current.solvedCount);
    setCurrentSequence(current.currentSequence);
    setCurrentClueId(current.clue?.id ?? null);
    setClueContent(current.clue?.content ?? "");
    setHintAnchor(current.clue?.hintAnchor ?? "");
    setSourceUrl(current.clue?.sourceUrl ?? "");
    setCompleted(current.status === "CONTEST_COMPLETED");
    setCompletedAt(current.completedAt ?? null);
    setLockedUntil(current.lockedUntil ?? null);
    setWaitingForClue(current.status === "WAITING_FOR_CLUE");

    const restoredAnswers = Array(12).fill("") as string[];
    const restoredSolved = Array(12).fill(false) as boolean[];
    for (const saved of current.solvedAnswers ?? []) {
      const index = saved.sequence - 1;
      if (index >= 0 && index < 12) {
        restoredAnswers[index] = saved.answer;
        restoredSolved[index] = true;
      }
    }
    setAnswerSlots(restoredAnswers);
    setSolvedSlots(restoredSolved);
    setIncorrectSlots(Array(12).fill(false));
  }

  useEffect(() => {
    let cancelled = false;

    void getActiveContest()
      .then(async (contest) => {
        if (cancelled) return;

        setContestId(contest.id);
        setContestTitle(contest.title);
        setContestDate(contest.startsAt);
        void getContestPrizePool(contest.id).then((result) => setPrizePool(result.pool)).catch(() => undefined);

        const current = await getCurrentClue(contest.id);
        if (cancelled) return;

        applyCurrentClue(current);

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
              ? "خطا در دریافت چالش"
              : "Unable to load the challenge.",
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
    // A late joiner must not remain stuck with every answer box locked if the
    // first current-clue request races round activation or returns no clue.
    // Retry while waiting for the next round OR while no usable clue has been
    // received. Once a clue arrives, the effect cleans up its polling timer.
    if (!contestId || completed || (!waitingForClue && currentClueId)) return;

    let cancelled = false;
    const pollForClue = () => {
      void getCurrentClue(contestId)
        .then((current) => {
          if (cancelled) return;

          applyCurrentClue(current);

          if (current.status === "READY" && current.clue?.id) {
            setFeedbackTone("info");
            setFeedback(
              isPersian
                ? "چالش آماده است؛ از اولین کلمه‌ی حل‌نشده شروع کن."
                : "The challenge is ready. Start with your first unsolved word.",
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
                ? "در حال همگام‌سازی وضعیت چالش؛ دوباره خودکار تلاش می‌کنیم."
                : "Syncing challenge status. Retrying automatically.",
            );
          }
        });
    };

    const intervalId = window.setInterval(pollForClue, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [contestId, waitingForClue, currentClueId, completed, isPersian]);

  async function refreshCurrentClue() {
    if (!contestId) return;

    const current = await getCurrentClue(contestId);

    applyCurrentClue(current);
  }

  useEffect(() => {
    if (!contestDate || completed) return;

    const timerId = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 100);

    return () => window.clearInterval(timerId);
  }, [contestDate, completed]);

  async function handleStartNextContest() {
    if (!contestId || !completed || startingNextContest) return;

    setStartingNextContest(true);
    setError("");
    setFeedback("");

    try {
      const nextContest = await startNextContest(contestId);
      setContestId(nextContest.id);
      setContestTitle(nextContest.title);
      setContestDate(nextContest.startsAt);
      setPrizePool(null);
      void getContestPrizePool(nextContest.id).then((result) => setPrizePool(result.pool)).catch(() => undefined);

      const current = await getCurrentClue(nextContest.id);
      applyCurrentClue(current);
      setFeedbackTone("success");
      setFeedback(
        current.status === "WAITING_FOR_CLUE"
          ? (isPersian
              ? "ثبت شد؛ دور بعد در زمان ثابت شروع می‌شود. صفحه به‌صورت خودکار آماده خواهد شد."
              : "Scheduled. The next round starts at its fixed boundary; this page will update automatically.")
          : (isPersian
              ? "چالش بعدی آماده است؛ راند اول را شروع کن."
              : "The next challenge is ready. Start with round one."),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "NEXT_CHALLENGE_FAILED";
      setError(
        message === "NEXT_CHALLENGE_GENERATION_FAILED"
          ? (isPersian
              ? "فعلاً ساخت چالش بعدی ممکن نشد. چند لحظه بعد دوباره تلاش کن."
              : "The next challenge could not be generated right now. Please try again shortly.")
          : message === "CHALLENGE_NOT_COMPLETED_BY_USER"
            ? (isPersian
                ? "برای شروع چالش بعدی باید هر ۱۲ راند چالش فعلی را کامل کنی."
                : "Complete all 12 rounds of the current challenge before starting the next one.")
            : message === "AUTHENTICATION_REQUIRED" || message === "TOKEN_EXPIRED"
              ? (isPersian
                  ? "نشست ورودت منقضی شده است؛ دوباره وارد حساب شو."
                  : "Your session has expired. Please sign in again.")
              : (isPersian
                  ? "شروع چالش بعدی ناموفق بود. دوباره تلاش کن."
                  : "Could not start the next challenge. Please try again."),
      );
    } finally {
      setStartingNextContest(false);
    }
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
        setLockedUntil(new Date(Date.now() + serverTimeOffset + 60_000).toISOString());
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
        setCompletedAt(result.completedAt ?? new Date(Date.now() + serverTimeOffset).toISOString());
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
  const numberLocale = isPersian ? "fa-IR" : "en-US";
  const formatNumber = (value: number) => value.toLocaleString(numberLocale);
  const progressPercent = Math.min(100, (solvedCount / 12) * 100);
  const authoritativeNow = timerNow + serverTimeOffset;
  const lockRemainingMs = lockedUntil ? Math.max(0, Date.parse(lockedUntil) - authoritativeNow) : 0;
  const isClueLocked = lockRemainingMs > 0;
  const contestStartTimestamp = contestDate ? Date.parse(contestDate) : Number.NaN;
  const completionTimestamp = completedAt ? Date.parse(completedAt) : Number.NaN;
  const timerEndTimestamp =
    completed && Number.isFinite(completionTimestamp)
      ? completionTimestamp
      : authoritativeNow;
  const totalContestElapsedMs = Number.isFinite(contestStartTimestamp)
    ? Math.max(0, timerEndTimestamp - contestStartTimestamp)
    : null;
  const roundRemainingMs = Number.isFinite(contestStartTimestamp)
    ? waitingForClue && contestStartTimestamp > authoritativeNow
      ? contestStartTimestamp - authoritativeNow
      : Math.max(0, contestStartTimestamp + 15 * 60_000 - authoritativeNow)
    : null;
  const formatCountdown = (milliseconds: number) => {
    const totalSeconds = Math.ceil(milliseconds / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formatPart = (value: number) =>
      value.toLocaleString(numberLocale, {
        minimumIntegerDigits: 2,
        useGrouping: false,
      });
    return formatPart(minutes) + ":" + formatPart(seconds);
  };
  const formatElapsed = (milliseconds: number) => {
    const safeMilliseconds = Math.max(0, milliseconds);
    const totalSeconds = Math.floor(safeMilliseconds / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((safeMilliseconds % 1_000) / 10);
    const formatPart = (value: number) =>
      value.toLocaleString(numberLocale, {
        minimumIntegerDigits: 2,
        useGrouping: false,
      });
    return formatPart(minutes) + ":" + formatPart(seconds) + "." + formatPart(centiseconds);
  };

  const renderAnswerGrid = () => (
    <section
      className="word-options-grid"
      aria-label={isPersian ? "دوازده کادر پاسخ، هر راند یک کادر" : "Twelve answer boxes, one per round"}
    >
      {answerSlots.map((value, index) => {
        const isSolved = solvedSlots[index];
        const isActive =
          !completed &&
          !waitingForClue &&
          Boolean(currentClueId) &&
          (roundRemainingMs === null || roundRemainingMs > 0) &&
          index === activeAnswerIndex &&
          !isSolved;
        const isLocked = !isSolved && !isActive;

        return (
          <div
            key={index}
            className={
              "word-entry " +
              (isActive ? "word-entry--active " : "") +
              (isSolved ? "word-entry--solved " : "") +
              (incorrectSlots[index] ? "word-entry--incorrect" : "")
            }
          >
            <span className="word-option__index mono">
              {(index + 1).toLocaleString(numberLocale, {
                minimumIntegerDigits: 2,
                useGrouping: false,
              })}
            </span>
            {isLocked ? (
              <div
                className="word-entry__lock"
                aria-label={
                  (isPersian ? "خانه‌ی قفل‌شده، زمان باقی‌مانده " : "Locked box, time remaining ") +
                  (isPersian ? "قفل" : "Locked")
                }
              >
                <span className="word-entry__lock-icon" aria-hidden="true">🔒</span>
                <span className="word-entry__lock-time mono">
                  {isPersian ? "قفل" : "Locked"}
                </span>
              </div>
            ) : (
              <input
                type="text"
                value={value}
                dir="ltr"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label={(isPersian ? "کادر پاسخ " : "Answer box ") + formatNumber(index + 1)}
                placeholder={
                  isSolved
                    ? (isPersian ? "پاسخ درست" : "Correct")
                    : (isPersian ? "کلمه..." : "Type word...")
                }
                disabled={submitting || isSolved || (roundRemainingMs !== null && roundRemainingMs <= 0)}
                readOnly={isSolved}
                onChange={(event) => {
                  const next = [...answerSlots];
                  next[index] = event.target.value;
                  setAnswerSlots(next);
                  setIncorrectSlots((slots) =>
                    slots.map((item, slotIndex) => slotIndex === index ? false : item)
                  );
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
            )}
          </div>
        );
      })}
    </section>
  );


  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand brand--home"
          type="button"
          aria-label={isPersian ? "خانه" : "Home"}
          onClick={() => onNavigate("home")}
        >
          <span className="brand-wallet">Wallet</span><span className="brand-find">Find</span>
        </button>
        
      </header>

      <main className="page">
        <section className="comp-head">
          <div>
            <h2 className="page-title">
              {localizeContestTitle(contestTitle, language)}
            </h2>
            <div className="date">
              {formattedDate ||
                (isPersian ? "چالش فعال" : "Active challenge")}
            </div>
          </div>
          <div className="clue-timer" role="timer" aria-live="off">
            <span className="clue-timer__label">
              {completed
                ? (isPersian ? "زمان تکمیل شما" : "Your completion time")
                : waitingForClue
                  ? (isPersian ? "تا شروع دور بعد" : "Until next round")
                  : (isPersian ? "زمان باقی‌مانده چالش" : "Challenge time remaining")}
            </span>
            <strong>
              {completed
                ? (totalContestElapsedMs === null ? "—:—" : formatElapsed(totalContestElapsedMs))
                : (roundRemainingMs === null ? "—:—" : formatCountdown(roundRemainingMs))}
            </strong>
            <span className="clue-timer__note">
              {completed
                ? (isPersian ? "از شروع رسمی دور تا پاسخ دوازدهم" : "From official round start to clue 12")
                : waitingForClue
                  ? (isPersian ? "شروع در مرز ثابت ۳۰ دقیقه‌ای" : "Starts on the fixed 30-minute boundary")
                  : (isPersian ? "دور چالش دقیقاً ۱۵ دقیقه است" : "Each round lasts exactly 15 minutes")}
            </span>
          </div>
        </section>

        {prizePool && (
          <section className="stat-row" aria-label={isPersian ? "صندوق جایزه چالش" : "Challenge prize pool"}>
            <div className="stat-card">
              <strong>{prizePool.total} USDT</strong>
              <span>{isPersian ? "مجموع صندوق فرضی" : "Total simulated pool"}</span>
            </div>
            <div className="stat-card">
              <strong>{prizePool.rolloverIn} USDT</strong>
              <span>{isPersian ? "انتقال از دور قبل" : "Rollover from prior round"}</span>
            </div>
          </section>
        )}

        {loading ? (
          <div className="inline-feedback">
            {isPersian ? "در حال دریافت چالش..." : "Loading challenge..."}
          </div>
        ) : error && !currentClueId && !completed ? (
          <div className="inline-feedback">{localizeApiError(error, language)}</div>
        ) : (
          <>
            <section className="round-progress">
              <div className="round-progress__labels">
                <strong>
                  {isPersian
                    ? "راند " + formatNumber(displayedRound) + " از ۱۲"
                    : "Round " + formatNumber(displayedRound) + " of 12"}
                </strong>
                <span>
                  {isPersian
                    ? formatNumber(solvedCount) + " راند حل‌شده"
                    : formatNumber(solvedCount) + " completed"}
                </span>
              </div>
              <div
                className="round-progress__track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={12}
                aria-valuenow={solvedCount}
                aria-label={isPersian ? "پیشرفت چالش" : "Challenge progress"}
              >
                <span style={{ width: progressPercent + "%" }} />
              </div>
            </section>

            {completed ? (
              <>
              <section className="round-complete">
                <div className="round-complete__icon">✓</div>
                <h3>{isPersian ? "چالش کامل شد!" : "Challenge completed!"}</h3>
                <p>
                  {isPersian
                    ? "هر ۱۲ راند را با موفقیت حل کردی."
                    : "You successfully solved all twelve rounds."}
                </p>
                <button
                  type="button"
                  className="cta-button round-complete__button"
                  onClick={() => void handleStartNextContest()}
                  disabled={startingNextContest}
                >
                  {startingNextContest
                    ? (isPersian ? "در حال آماده‌سازی..." : "Preparing...")
                    : (isPersian ? "شروع چالش بعدی" : "Start Next Challenge")}
                </button>
              </section>
              <div className="word-grid-title">
                <span>{isPersian ? "پاسخ‌های ثبت‌شده" : "Submitted answers"}</span>
                <span className="word-grid-count mono">{formatNumber(solvedCount)} / 12</span>
              </div>
              {renderAnswerGrid()}
              </>
            ) : waitingForClue ? (
              <>
                <div className="inline-feedback">
                  {isPersian
                    ? "پاسخ صحیح ثبت شد. خانه‌ی بعد بلافاصله فعال می‌شود."
                    : "Correct answer saved. The next box is available immediately."}
                </div>
                <div className="word-grid-title">
                  <span>{isPersian ? "وضعیت ۱۲ خانه" : "Twelve box status"}</span>
                  <span className="word-grid-count mono">{isPersian ? "خانه‌ی بعد قفل است" : "Next box locked"}</span>
                </div>
                {renderAnswerGrid()}
              </>
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
                    <p>{localizeUiMessage(clueContent, language)}</p>
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
                  <span className="word-grid-count mono">{isPersian ? "کادر راند " + formatNumber(displayedRound) : "ROUND BOX " + formatNumber(displayedRound)}</span>
                </div>

                {renderAnswerGrid()}

                <button
                  type="button"
                  className="cta-button word-submit-button"
                  onClick={() => void handleSubmit()}
                  disabled={!answer.trim() || submitting || completed || isClueLocked || (roundRemainingMs !== null && roundRemainingMs <= 0)}
                >
                  {submitting
                    ? (isPersian ? "در حال بررسی..." : "Checking...")
                    : isClueLocked
                      ? (isPersian ? "قفل پاسخ: " + Math.ceil(lockRemainingMs / 1000) + " ثانیه" : "Locked: " + Math.ceil(lockRemainingMs / 1000) + "s")
                      : (isPersian ? "بررسی کلمه‌ی واردشده" : "Check typed word")}
                </button>
              </>
            )}

            {!completed && !waitingForClue && roundRemainingMs !== null && roundRemainingMs <= 0 && (
              <div className="inline-feedback round-error" role="status">
                {isPersian
                  ? "زمان چالش تمام شد؛ پس از پایان ۱۵ دقیقه پاسخ جدید پذیرفته نمی‌شود و شرکت‌کنندهٔ تکمیل‌نکرده جایزه نمی‌گیرد."
                  : "The round has ended. No further answers are accepted after 15 minutes; incomplete participants receive no prize."}
              </div>
            )}
            {feedback && (
              <div className={"inline-feedback round-notice round-notice--" + feedbackTone} role="status" aria-live="polite">
                {feedback === "ثبت شد؛ دور بعد در زمان ثابت شروع می‌شود. صفحه به‌صورت خودکار آماده خواهد شد." ||
                feedback === "Scheduled. The next round starts at its fixed boundary; this page will update automatically."
                  ? (isPersian
                      ? "چالش تا " + formatCountdown(roundRemainingMs ?? 0) + " دیگر شروع می‌شود."
                      : "Challenge starts in " + formatCountdown(roundRemainingMs ?? 0) + ".")
                  : localizeUiMessage(feedback, language)}
              </div>
            )}
            {error && <div className="inline-feedback round-error">{localizeApiError(error, language)}</div>}

            <div className="section-title">
              {isPersian ? "روش بازی" : "How to play"}
            </div>

            <div className="step">
              <div className="step-number mono">{formatNumber(1)}</div>
              <div className="step-content">
                <p>
                  {isPersian
                    ? "عبارت مشخص‌شده در راهنما را در لینک منبع جست‌وجو کن."
                    : "Search for the exact phrase from the hint on the source page."}
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-number mono">{formatNumber(2)}</div>
              <div className="step-content">
                <p>
                  {isPersian
                    ? "کلمه‌ی انگلیسی بلافاصله بعد از عبارت را پیدا کن و خودت در یکی از کادرهای خالی تایپ کن."
                    : "Find the English word immediately after the phrase and type it yourself into an empty box."}
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-number mono">{formatNumber(3)}</div>
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
