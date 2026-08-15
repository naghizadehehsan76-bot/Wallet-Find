import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  activateContest,
  createClue,
  createContest,
  finishContest,
} from "../services/api";

type Page =
  | "home"
  | "auth"
  | "competition"
  | "key"
  | "leaderboard"
  | "profile"
  | "wallet"
  | "admin";

type AdminPageProps = {
  onNavigate: (page: Page) => void;
};

type ClueDraft = {
  content: string;
  correctAnswer: string;
};

type ContestStatus = "draft" | "scheduled" | "active" | "finished";

const emptyClue = (): ClueDraft => ({
  content: "",
  correctAnswer: "",
});

function toIsoOrUndefined(value: string) {
  if (!value) return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

function AdminPage({ onNavigate }: AdminPageProps) {
  const [title, setTitle] = useState("مسابقه شبانه 12Keys");
  const [description, setDescription] = useState(
    "مسابقه آزمایشی برای تست موتور ۱۲ کلیدی.",
  );
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [clues, setClues] = useState<ClueDraft[]>(() =>
    Array.from({ length: 12 }, emptyClue),
  );
  const [contestId, setContestId] = useState<string | null>(null);
  const [status, setStatus] = useState<ContestStatus>("draft");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const validClues = useMemo(
    () =>
      clues.filter(
        (clue) => clue.content.trim() && clue.correctAnswer.trim(),
      ).length,
    [clues],
  );

  function updateClue(
    index: number,
    field: keyof ClueDraft,
    value: string,
  ) {
    setClues((current) =>
      current.map((clue, clueIndex) =>
        clueIndex === index ? { ...clue, [field]: value } : clue,
      ),
    );
  }

  async function handleCreateContest(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const normalizedStart = toIsoOrUndefined(startsAt);
      const normalizedEnd = toIsoOrUndefined(endsAt);

      if (startsAt && !normalizedStart) {
        throw new Error("INVALID_START_TIME");
      }

      if (endsAt && !normalizedEnd) {
        throw new Error("INVALID_END_TIME");
      }

      if (
        normalizedStart &&
        normalizedEnd &&
        new Date(normalizedEnd) <= new Date(normalizedStart)
      ) {
        throw new Error("END_TIME_MUST_BE_AFTER_START_TIME");
      }

      const result = await createContest({
        title: title.trim(),
        description: description.trim() || undefined,
        startsAt: normalizedStart,
        endsAt: normalizedEnd,
      });

      setContestId(result.contest.id);
      setStatus(
        result.contest.status === "SCHEDULED" ? "scheduled" : "draft",
      );
      setMessage(
        result.contest.status === "SCHEDULED"
          ? "مسابقه زمان‌بندی شد. پس از تکمیل ۱۲ سرنخ، فعال‌سازی به‌صورت خودکار انجام می‌شود."
          : "مسابقه ساخته شد. حالا ۱۲ سرنخ را ثبت کن.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ساخت مسابقه ناموفق بود.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handlePublishClues() {
    if (!contestId || validClues !== 12 || loading) return;

    setLoading(true);
    setMessage("");
    setError("");

    try {
      for (let index = 0; index < clues.length; index += 1) {
        const clue = clues[index];
        await createClue(contestId, {
          sequence: index + 1,
          content: clue.content.trim(),
          correctAnswer: clue.correctAnswer.trim(),
          type: "TEXT",
        });
      }

      setMessage(
        status === "scheduled"
          ? "هر ۱۲ سرنخ ثبت شد. Scheduler مسابقه را در زمان تعیین‌شده فعال می‌کند."
          : "هر ۱۲ سرنخ ثبت شد. مسابقه آماده فعال‌سازی است.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ثبت سرنخ‌ها ناموفق بود.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleActivate() {
    if (!contestId || validClues !== 12 || loading) return;

    setLoading(true);
    setMessage("");
    setError("");

    try {
      await activateContest(contestId);
      setStatus("active");
      setMessage("مسابقه فعال شد و بازیکنان می‌توانند وارد شوند.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "فعال‌سازی ناموفق بود.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleFinish() {
    if (!contestId || loading) return;

    setLoading(true);
    setMessage("");
    setError("");

    try {
      await finishContest(contestId);
      setStatus("finished");
      setMessage("مسابقه پایان یافت.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "پایان مسابقه ناموفق بود.",
      );
    } finally {
      setLoading(false);
    }
  }

  const isScheduled = status === "scheduled";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>12Keys Admin</span>
        </div>
        <button
          className="wallet-pill"
          type="button"
          onClick={() => onNavigate("profile")}
        >
          بازگشت
        </button>
      </header>

      <main className="page">
        <section className="comp-head">
          <div>
            <h1 className="page-title">ماشین ساخت مسابقه</h1>
            <div className="date">
              ساخت، زمان‌بندی، ثبت ۱۲ سرنخ و اجرای خودکار
            </div>
          </div>
          <div className="prize">
            <strong>{status}</strong>
            <span>{validClues}/12 clues</span>
          </div>
        </section>

        <form onSubmit={handleCreateContest}>
          <div className="field">
            <label htmlFor="contest-title">عنوان مسابقه</label>
            <input
              id="contest-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              minLength={3}
              maxLength={200}
              required
              disabled={Boolean(contestId)}
            />
          </div>

          <div className="field">
            <label htmlFor="contest-description">توضیحات</label>
            <textarea
              id="contest-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              disabled={Boolean(contestId)}
            />
          </div>

          {!contestId && (
            <>
              <div className="field">
                <label htmlFor="contest-start">شروع مسابقه (اختیاری)</label>
                <input
                  id="contest-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="contest-end">پایان مسابقه (اختیاری)</label>
                <input
                  id="contest-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </div>
            </>
          )}

          <button
            className="cta-button"
            type="submit"
            disabled={loading || Boolean(contestId)}
          >
            {contestId ? "مسابقه ساخته شده" : "ساخت مسابقه"}
          </button>
        </form>

        {contestId && (
          <>
            <div className="section-title">۱۲ کلید مسابقه</div>

            <section className="admin-clues-grid">
              {clues.map((clue, index) => (
                <article className="admin-clue-card" key={index}>
                  <div className="keycell-top">
                    <div className="keycell-number mono">{index + 1}</div>
                    <div className="keycell-status">TEXT</div>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="متن سرنخ"
                    value={clue.content}
                    onChange={(event) =>
                      updateClue(index, "content", event.target.value)
                    }
                    disabled={loading || status !== "draft"}
                  />
                  <input
                    type="text"
                    placeholder="پاسخ صحیح"
                    value={clue.correctAnswer}
                    onChange={(event) =>
                      updateClue(index, "correctAnswer", event.target.value)
                    }
                    disabled={loading || status !== "draft"}
                  />
                </article>
              ))}
            </section>

            <div className="cta-group">
              <button
                className="cta-button"
                type="button"
                onClick={() => void handlePublishClues()}
                disabled={
                  loading ||
                  status === "active" ||
                  status === "finished" ||
                  validClues !== 12
                }
              >
                ثبت هر ۱۲ سرنخ
              </button>

              {!isScheduled && status === "draft" && (
                <button
                  className="cta-button cta-button--ghost"
                  type="button"
                  onClick={() => void handleActivate()}
                  disabled={loading || validClues !== 12}
                >
                  فعال‌سازی دستی مسابقه
                </button>
              )}

              {isScheduled && (
                <div className="inline-feedback">
                  زمان شروع مشخص شده است؛ فعال‌سازی در زمان تعیین‌شده به‌صورت خودکار انجام می‌شود.
                </div>
              )}

              <button
                className="cta-button cta-button--ghost"
                type="button"
                onClick={() => void handleFinish()}
                disabled={loading || status !== "active"}
              >
                پایان مسابقه
              </button>
            </div>
          </>
        )}

        {message && <div className="inline-feedback">{message}</div>}
        {error && <div className="inline-feedback">{error}</div>}
      </main>
    </div>
  );
}

export default AdminPage;
