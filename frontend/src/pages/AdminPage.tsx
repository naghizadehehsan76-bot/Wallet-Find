import { FormEvent, useMemo, useState } from "react";
import { activateContest, createClue, createContest, finishContest } from "../services/api";

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

const emptyClue = (): ClueDraft => ({
  content: "",
  correctAnswer: "",
});

function AdminPage({ onNavigate }: AdminPageProps) {
  const [title, setTitle] = useState("مسابقه شبانه 12Keys");
  const [description, setDescription] = useState("مسابقه آزمایشی برای تست موتور ۱۲ کلیدی.");
  const [clues, setClues] = useState<ClueDraft[]>(() =>
    Array.from({ length: 12 }, emptyClue),
  );
  const [contestId, setContestId] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "active" | "finished">("draft");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const validClues = useMemo(
    () => clues.filter((clue) => clue.content.trim() && clue.correctAnswer.trim()).length,
    [clues],
  );

  function updateClue(index: number, field: keyof ClueDraft, value: string) {
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
      const result = await createContest({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setContestId(result.contest.id);
      setMessage("مسابقه ساخته شد. حالا ۱۲ سرنخ را ثبت کن.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ساخت مسابقه ناموفق بود.");
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
      setMessage("هر ۱۲ سرنخ ثبت شد. مسابقه آماده فعال‌سازی است.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت سرنخ‌ها ناموفق بود.");
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
      setError(err instanceof Error ? err.message : "فعال‌سازی ناموفق بود.");
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
      setError(err instanceof Error ? err.message : "پایان مسابقه ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>12Keys Admin</span>
        </div>
        <button className="wallet-pill" type="button" onClick={() => onNavigate("profile")}>
          بازگشت
        </button>
      </header>

      <main className="page">
        <section className="comp-head">
          <div>
            <h1 className="page-title">ماشین ساخت مسابقه</h1>
            <div className="date">ساخت، ثبت ۱۲ سرنخ و فعال‌سازی</div>
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
            />
          </div>

          <button className="cta-button" type="submit" disabled={loading || Boolean(contestId)}>
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
                    onChange={(event) => updateClue(index, "content", event.target.value)}
                    disabled={loading || status !== "draft"}
                  />
                  <input
                    type="text"
                    placeholder="پاسخ صحیح"
                    value={clue.correctAnswer}
                    onChange={(event) => updateClue(index, "correctAnswer", event.target.value)}
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
                disabled={loading || status !== "draft" || validClues !== 12}
              >
                ثبت هر ۱۲ سرنخ
              </button>

              <button
                className="cta-button cta-button--ghost"
                type="button"
                onClick={() => void handleActivate()}
                disabled={loading || status !== "draft" || validClues !== 12}
              >
                فعال‌سازی مسابقه
              </button>

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
