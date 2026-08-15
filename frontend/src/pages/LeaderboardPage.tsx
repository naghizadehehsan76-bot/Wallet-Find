import { useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import {
  getActiveContest,
  getLeaderboard,
  type LeaderboardEntry,
} from "../services/api";
import { useI18n } from "../i18n";
import "./LeaderboardPage.css";

type Page =
  | "home"
  | "auth"
  | "competition"
  | "key"
  | "leaderboard"
  | "profile"
  | "wallet";

type LeaderboardPageProps = {
  onNavigate: (page: Page) => void;
};

function formatTime(milliseconds: number, isPersian: boolean) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const value = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return isPersian
    ? value.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])
    : value;
}

function LeaderboardPage({ onNavigate }: LeaderboardPageProps) {
  const { language } = useI18n();
  const isPersian = language === "fa";
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [contestTitle, setContestTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void getActiveContest()
      .then(async (contest) => {
        if (cancelled) return;
        setContestTitle(contest.title);
        const result = await getLeaderboard(contest.id);
        if (cancelled) return;
        setEntries(result.entries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : isPersian
              ? "خطا در دریافت رتبه‌بندی"
              : "Unable to load leaderboard.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPersian]);

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
              {isPersian ? "رتبه‌بندی" : "Leaderboard"}
            </h2>
            <div className="date">
              {contestTitle ||
                (isPersian ? "مسابقه امشب" : "Tonight's contest")}
            </div>
          </div>
        </section>

        {loading ? (
          <div className="inline-feedback">
            {isPersian
              ? "در حال دریافت رتبه‌بندی..."
              : "Loading leaderboard..."}
          </div>
        ) : error ? (
          <div className="inline-feedback">{error}</div>
        ) : entries.length === 0 ? (
          <div className="inline-feedback">
            {isPersian
              ? "هنوز رتبه‌ای ثبت نشده است."
              : "No rankings yet."}
          </div>
        ) : (
          <section>
            {entries.map((entry) => (
              <div
                className={`leaderboard-row ${
                  entry.rank === 1
                    ? "leaderboard-row--top"
                    : ""
                }`}
                key={entry.userId}
              >
                <div className="leaderboard-rank mono">
                  {entry.rank.toLocaleString(
                    isPersian ? "fa-IR" : "en-US",
                  )}
                </div>

                <div className="leaderboard-avatar">
                  {entry.username
                    .slice(0, 1)
                    .toUpperCase()}
                </div>

                <div className="leaderboard-player">
                  <strong>{entry.username}</strong>
                  <span>
                    {isPersian
                      ? `${entry.solvedCount} از ۱۲ کلید`
                      : `${entry.solvedCount} of 12 keys`}
                  </span>
                </div>

                <div className="leaderboard-time mono">
                  {entry.completed
                    ? formatTime(
                        entry.totalResponseTimeMs,
                        isPersian,
                      )
                    : "—"}
                </div>
              </div>
            ))}
          </section>
        )}
      </main>

      <BottomNav
        activePage="leaderboard"
        onNavigate={onNavigate}
      />
    </div>
  );
}

export default LeaderboardPage;
