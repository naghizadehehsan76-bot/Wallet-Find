import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  activateContest,
  createClue,
  createContest,
  finishContest,
} from "../services/api";
import { useI18n } from "../i18n";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { localizeApiError } from "../i18n/localize";

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
  sourceUrl: string;
  hintAnchor: string;
};

type ContestStatus = "draft" | "scheduled" | "active" | "finished";

const emptyClue = (): ClueDraft => ({
  content: "",
  correctAnswer: "",
  sourceUrl: "",
  hintAnchor: "",
});

function toIsoOrUndefined(value: string) {
  if (!value) return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

function AdminPage({ onNavigate }: AdminPageProps) {
  const { language, translation: t } = useI18n();
  const isPersian = language === "fa";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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
        (clue) =>
          clue.content.trim() &&
          clue.correctAnswer.trim() &&
          clue.sourceUrl.trim() &&
          clue.hintAnchor.trim().length >= 25,
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
          ? t.admin.createdScheduled
          : t.admin.createdDraft,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "REQUEST_FAILED",
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
          sourceUrl: clue.sourceUrl.trim(),
          hintAnchor: clue.hintAnchor.trim(),
          type: "WEB_PAGE",
        });
      }

      setMessage(
        status === "scheduled"
          ? t.admin.cluesScheduled
          : t.admin.cluesReady,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "REQUEST_FAILED",
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
      setMessage(t.admin.activated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "REQUEST_FAILED",
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
      setMessage(t.admin.finished);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "REQUEST_FAILED",
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
          <span>12Keys {isPersian ? "مدیریت" : "Admin"}</span>
        </div>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <button className="wallet-pill" type="button" onClick={() => onNavigate("profile")}>
            {t.admin.back}
          </button>
        </div>
      </header>

      <main className="page">
        <section className="comp-head">
          <div>
            <h1 className="page-title">{t.admin.pageTitle}</h1>
            <div className="date">
              {t.admin.subtitle}
            </div>
          </div>
          <div className="prize">
            <strong>{t.admin.status[status]}</strong>
            <span>{validClues.toLocaleString(isPersian ? "fa-IR" : "en-US")}/12 {isPersian ? "سرنخ" : "clues"}</span>
          </div>
        </section>

        <form onSubmit={handleCreateContest}>
          <div className="field">
            <label htmlFor="contest-title">{t.admin.titleLabel}</label>
            <input
              id="contest-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t.admin.titlePlaceholder}
              minLength={3}
              maxLength={200}
              required
              disabled={Boolean(contestId)}
            />
          </div>

          <div className="field">
            <label htmlFor="contest-description">{t.admin.descriptionLabel}</label>
            <textarea
              id="contest-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t.admin.descriptionPlaceholder}
              maxLength={2000}
              rows={3}
              disabled={Boolean(contestId)}
            />
          </div>

          {!contestId && (
            <>
              <div className="field">
                <label htmlFor="contest-start">{t.admin.startsLabel}</label>
                <input
                  id="contest-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="contest-end">{t.admin.endsLabel}</label>
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
            {contestId ? t.admin.created : t.admin.create}
          </button>
        </form>

        {contestId && (
          <>
            <div className="section-title">{t.admin.roundsTitle}</div>

            <section className="admin-clues-grid">
              {clues.map((clue, index) => (
                <article className="admin-clue-card" key={index}>
                  <div className="keycell-top">
                    <div className="keycell-number mono">{index + 1}</div>
                    <div className="keycell-status">{isPersian ? "متن" : "TEXT"}</div>
                  </div>
                  <textarea
                    rows={3}
                    placeholder={t.admin.clueText}
                    value={clue.content}
                    onChange={(event) =>
                      updateClue(index, "content", event.target.value)
                    }
                    disabled={loading || status !== "draft"}
                  />
                  <input
                    type="text"
                    placeholder={t.admin.answerPlaceholder}
                    value={clue.correctAnswer}
                    onChange={(event) =>
                      updateClue(index, "correctAnswer", event.target.value)
                    }
                    disabled={loading || status !== "draft"}
                  />
                  <input
                    type="url"
                    placeholder={t.admin.sourcePlaceholder}
                    value={clue.sourceUrl}
                    onChange={(event) =>
                      updateClue(index, "sourceUrl", event.target.value)
                    }
                    disabled={loading || status !== "draft"}
                  />
                  <textarea
                    rows={2}
                    minLength={25}
                    placeholder={t.admin.anchorPlaceholder}
                    value={clue.hintAnchor}
                    onChange={(event) =>
                      updateClue(index, "hintAnchor", event.target.value)
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
                {t.admin.publish}
              </button>

              {!isScheduled && status === "draft" && (
                <button
                  className="cta-button cta-button--ghost"
                  type="button"
                  onClick={() => void handleActivate()}
                  disabled={loading || validClues !== 12}
                >
                  {t.admin.activate}
                </button>
              )}

              {isScheduled && (
                <div className="inline-feedback">
                  {t.admin.scheduledNotice}
                </div>
              )}

              <button
                className="cta-button cta-button--ghost"
                type="button"
                onClick={() => void handleFinish()}
                disabled={loading || status !== "active"}
              >
                {t.admin.finish}
              </button>
            </div>
          </>
        )}

        {message && <div className="inline-feedback">{message}</div>}
        {error && <div className="inline-feedback">{localizeApiError(error, language)}</div>}
      </main>
    </div>
  );
}

export default AdminPage;
