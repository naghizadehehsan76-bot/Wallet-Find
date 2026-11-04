import { useEffect, useMemo, useState } from "react";
import BottomNav from "../components/BottomNav";
import { getLeaderboardHistory, type LeaderboardRound } from "../services/api";
import { useI18n } from "../i18n";
import { getPageCopy } from "../i18n/page-overrides";
import "./LeaderboardPage.css";
import { localizeApiError } from "../i18n/localize";
import LoadingIndicator from "../components/LoadingIndicator";

type Page = "home" | "auth" | "competition" | "key" | "leaderboard" | "profile" | "wallet";
type LeaderboardPageProps = { onNavigate: (page: Page) => void };

function formatTime(milliseconds: number, isPersian: boolean) {
  const safe = Math.max(0, milliseconds);
  const totalSeconds = Math.floor(safe / 1000);
  const value = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}.${String(safe % 1000).padStart(3, "0")}`;
  return isPersian ? value.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]) : value;
}

function formatDate(value: string | null, isPersian: boolean) {
  if (!value) return isPersian ? "هنوز پایان نیافته" : "Not ended yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(isPersian ? "fa-IR" : "en-GB", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatAmount(value: string, isPersian: boolean) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString(isPersian ? "fa-IR" : "en-US", {
    minimumFractionDigits: 0, maximumFractionDigits: 6,
  });
}

function LeaderboardPage({ onNavigate }: LeaderboardPageProps) {
  const { language } = useI18n();
  const isPersian = language === "fa";
  const copy = getPageCopy(language, "leaderboardPage");
  const [rounds, setRounds] = useState<LeaderboardRound[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getLeaderboardHistory()
      .then((result) => {
        if (cancelled) return;
        const newestFirst = [...result.rounds]
          .filter((round) => round.entries.length > 0)
          .sort((a, b) => (b.startsAt ?? "").localeCompare(a.startsAt ?? ""));
        setRounds(newestFirst);
        setSelectedRoundId((current) =>
          newestFirst.some((round) => round.id === current) ? current : newestFirst[0]?.id || "",
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : (isPersian ? "خطا در دریافت رتبه‌بندی" : "Unable to load leaderboard."));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isPersian]);

  const selectedRound = useMemo(
    () => rounds.find((round) => round.id === selectedRoundId) ?? null,
    [rounds, selectedRoundId],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={isPersian ? "خانه" : "Home"} onClick={() => onNavigate("home")}>
          <span className="brand-wallet">Wallet</span><span className="brand-find">Find</span>
        </button>
      </header>

      <main className="page leaderboard-page">
        <section className="comp-head">
          <div>
            <h2 className="page-title">{copy.title ?? (isPersian ? "رتبه‌بندی" : "Leaderboard")}</h2>
            <div className="date">{copy.subtitle ?? (isPersian ? "نتایج هر دور و مجموع جوایز ثبت‌شده" : "Round results and total recorded prizes")}</div>
          </div>
        </section>

        {loading ? (
          <div className="inline-feedback"><LoadingIndicator label={copy.loading ?? (isPersian ? "در حال دریافت رتبه‌بندی..." : "Loading leaderboard...")} /></div>
        ) : error ? (
          <div className="inline-feedback">{localizeApiError(error, language)}</div>
        ) : rounds.length === 0 ? (
          <div className="inline-feedback">{copy.empty ?? (isPersian ? "هنوز دوری برای نمایش ثبت نشده است." : "No contest rounds are available yet.")}</div>
        ) : (
          <>
            <section className="leaderboard-round-filter">
              <label htmlFor="leaderboard-round-select">{copy.selectRound ?? (isPersian ? "انتخاب شمارهٔ مسابقه" : "Select contest round")}</label>
              <select id="leaderboard-round-select" value={selectedRoundId} onChange={(event) => setSelectedRoundId(event.target.value)}>
                {rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    {isPersian ? `مسابقه ${round.number.toLocaleString("fa-IR")} · ${formatDate(round.startsAt, true)}` : `Round #${round.number} · ${formatDate(round.startsAt, false)}`}
                  </option>
                ))}
              </select>
              {selectedRound && (
                <div className="leaderboard-round-dates">
                  <div><span>{copy.start ?? (isPersian ? "تاریخ و ساعت شروع" : "Start date & time")}</span><strong>{formatDate(selectedRound.startsAt, isPersian)}</strong></div>
                  <div><span>{copy.end ?? (isPersian ? "تاریخ و ساعت پایان" : "End date & time")}</span><strong>{formatDate(selectedRound.endsAt ?? (selectedRound.startsAt ? new Date(new Date(selectedRound.startsAt).getTime() + 15 * 60_000).toISOString() : null), isPersian)}</strong></div>
                </div>
              )}
            </section>

            {selectedRound && selectedRound.entries.length === 0 ? (
              <div className="inline-feedback">{copy.noResults ?? (isPersian ? "برای این مسابقه هنوز نتیجه‌ای ثبت نشده است." : "No participant results have been recorded for this round yet.")}</div>
            ) : selectedRound && (
              <section className="leaderboard-history-list" aria-label={isPersian ? "نتایج مسابقه" : "Contest results"}>
                <div className="leaderboard-history-heading">
                  <span>{copy.rank ?? (isPersian ? "رتبه" : "Rank")}</span>
                  <span>{copy.participant ?? (isPersian ? "شرکت‌کننده" : "Participant")}</span>
                  <span>{copy.completion ?? (isPersian ? "زمان تکمیل" : "Completion time")}</span>
                  <span>{copy.roundPrize ?? (isPersian ? "جایزه این دور" : "Round prize")}</span>
                  <span>{copy.totalPrizes ?? (isPersian ? "مجموع جوایز" : "Total prizes")}</span>
                </div>
                {selectedRound.entries.map((entry) => (
                  <article className={`leaderboard-row ${entry.completed ? "leaderboard-row--completed" : ""} ${entry.rank === 1 && entry.completed ? "leaderboard-row--top" : ""}`} key={entry.userId}>
                    <div className="leaderboard-rank mono" data-label={copy.rank ?? (isPersian ? "رتبه" : "Rank")}>{entry.rank.toLocaleString(isPersian ? "fa-IR" : "en-US")}</div>
                    <div className="leaderboard-player-cell" data-label={copy.participant ?? (isPersian ? "شرکت‌کننده" : "Participant")}>
                      <div className="leaderboard-avatar">{entry.username.slice(0, 1).toUpperCase()}</div>
                      <div className="leaderboard-player">
                        <strong>{entry.username}</strong>
                        <span>{isPersian ? `${entry.solvedCount.toLocaleString("fa-IR")} از ۱۲ کلید` : `${entry.solvedCount} of 12 keys`}{entry.completed ? (` · ${copy.completed ?? "Completed"}`) : ""}</span>
                      </div>
                    </div>
                    <div className="leaderboard-time mono" data-label={copy.completion ?? (isPersian ? "زمان تکمیل" : "Completion time")}>{entry.completed ? formatTime(entry.totalResponseTimeMs, isPersian) : "—"}</div>
                    <div className="leaderboard-prize" data-label={copy.roundPrize ?? (isPersian ? "جایزه این دور" : "Round prize")}>{formatAmount(entry.prizeEarned, isPersian)} <small>USDT</small></div>
                    <div className="leaderboard-prize leaderboard-prize--total" data-label={copy.totalPrizes ?? (isPersian ? "مجموع جوایز" : "Total prizes")}>{formatAmount(entry.totalPrizeEarned, isPersian)} <small>USDT</small></div>
                  </article>
                ))}
                <p className="leaderboard-footnote">
                  {isPersian
                    ? "زمان تکمیل فقط برای کسانی نمایش داده می‌شود که هر ۱۲ کلید را در مهلت رسمی حل کرده‌اند؛ رتبهٔ سایر شرکت‌کنندگان بر اساس تعداد کلیدهای حل‌شده و سپس زمان ثبت فعالیت محاسبه می‌شود. جوایز فقط پس از تأیید موجودی واقعی صندوق و فعال‌شدن پرداخت شبکه قابل پرداخت خواهند بود."
                    : "Completion time is shown only for participants who solved all 12 keys within the official round. Other participants are ranked by solved keys, then recorded activity time. Prizes are payable only after real prize-fund verification and on-chain payout processing are operational."}
                </p>
              </section>
            )}
          </>
        )}
      </main>
      <BottomNav activePage="leaderboard" onNavigate={onNavigate} />
    </div>
  );
}

export default LeaderboardPage;
