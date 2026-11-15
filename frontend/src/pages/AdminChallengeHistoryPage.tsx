import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { getChallengeLanguageName, isChallengeLanguage } from "../i18n/challenge-languages";
import {
  getAdminChallengeHistory,
  updateAdminChallengeHistory,
  type AdminChallengeHistoryItem,
  type AdminChallengeHistoryPage,
} from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type Props = { onBack: () => void };

function formatDate(value: string | null, locale: string): string {
  return value ? new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function AdminChallengeHistoryPage({ onBack }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const locale = fa ? "fa-IR" : "en-GB";
  const [page, setPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [data, setData] = useState<AdminChallengeHistoryPage | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const copy = {
    title: fa ? "تاریخچهٔ چالش‌ها" : "Challenge history",
    subtitle: fa ? "مشاهده و مدیریت سوابق چالش‌های پایان‌یافته و لغوشده" : "Review and manage completed and cancelled challenge records",
    back: fa ? "بازگشت به تبلیغات و چالش‌ها" : "Back to Ads & Challenges",
    active: fa ? "در تاریخچه" : "In history",
    archived: fa ? "بایگانی‌شده" : "Archived",
    showArchived: fa ? "نمایش بایگانی" : "View archived",
    showActive: fa ? "نمایش تاریخچه" : "View history",
    allOnPage: fa ? "انتخاب همهٔ این صفحه" : "Select this page",
    selected: fa ? "انتخاب‌شده" : "selected",
    archiveSelected: fa ? "حذف موارد انتخاب‌شده از تاریخچه" : "Remove selected from history",
    restoreSelected: fa ? "بازگردانی موارد انتخاب‌شده" : "Restore selected",
    archiveAll: fa ? "حذف همهٔ تاریخچه" : "Remove all history",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    loading: fa ? "در حال دریافت تاریخچه…" : "Loading challenge history…",
    loadError: fa ? "دریافت تاریخچهٔ چالش‌ها ناموفق بود." : "Could not load challenge history.",
    empty: fa ? "در این بخش موردی برای نمایش وجود ندارد." : "There are no challenge records to show here.",
    safeNote: fa ? "فقط چالش‌های پایان‌یافته یا لغوشده قابل بایگانی هستند. چالش‌های فعال و زمان‌بندی‌شده و تمام سوابق مالی محفوظ می‌مانند. بایگانی قابل‌بازیابی است." : "Only finished or cancelled challenges can be archived. Active and scheduled challenges and all financial records are preserved. Archiving is reversible.",
    challenge: fa ? "چالش" : "Challenge",
    language: fa ? "زبان" : "Language",
    status: fa ? "وضعیت" : "Status",
    start: fa ? "زمان شروع" : "Started",
    submissions: fa ? "پاسخ‌ها" : "Answers",
    clues: fa ? "خانه‌ها" : "Clues",
    finished: fa ? "پایان‌یافته" : "Finished",
    cancelled: fa ? "لغوشده" : "Cancelled",
    page: fa ? "صفحه" : "Page",
    of: fa ? "از" : "of",
    confirmArchiveSelected: fa ? "موارد انتخاب‌شده از تاریخچه پنهان شوند؟ سوابق مالی و اطلاعات اصلی برای حسابرسی نگهداری می‌شوند و امکان بازگردانی وجود دارد." : "Remove the selected challenges from history? Financial records and source data will be retained for audit, and the action can be reversed.",
    confirmArchiveAll: fa ? "تمام چالش‌های پایان‌یافته و لغوشده از تاریخچه پنهان شوند؟ چالش فعال و چالش‌های زمان‌بندی‌شده دست‌نخورده می‌مانند. هیچ سابقهٔ مالی حذف نمی‌شود." : "Remove every finished and cancelled challenge from history? Active and scheduled challenges will remain untouched. No financial records will be deleted.",
    confirmRestore: fa ? "موارد انتخاب‌شده دوباره به تاریخچه برگردند؟" : "Restore the selected challenges to history?",
    archiveSuccess: (count: string) => fa ? `${count} چالش از تاریخچه حذف شد. اطلاعات اصلی و مالی حفظ شدند.` : `${count} challenge(s) removed from history. Source and financial records were preserved.`,
    restoreSuccess: (count: string) => fa ? `${count} چالش به تاریخچه بازگردانده شد.` : `${count} challenge(s) restored to history.`,
    failed: fa ? "عملیات انجام نشد. اتصال سرور را بررسی و دوباره تلاش کن." : "The operation failed. Check the server connection and try again.",
    statusUnknown: fa ? "نامشخص" : "Unknown",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getAdminChallengeHistory(page, showArchived);
      setData(result);
      if (result.page !== page) setPage(result.page);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [page, showArchived, copy.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  const allCurrentPageSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));

  function toggleItem(id: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? (current.includes(id) ? current : [...current, id])
      : current.filter((value) => value !== id));
  }

  async function runAction(action: "ARCHIVE" | "RESTORE", all = false) {
    if (saving) return;
    const ids = all ? undefined : selectedIds;
    if (!all && (!ids || ids.length === 0)) return;
    const confirmation = action === "ARCHIVE"
      ? (all ? copy.confirmArchiveAll : copy.confirmArchiveSelected)
      : copy.confirmRestore;
    if (!window.confirm(confirmation)) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateAdminChallengeHistory({
        action,
        ...(all ? { all: true } : { ids }),
      });
      setSelectedIds([]);
      const count = result.changedCount.toLocaleString(locale);
      setNotice(action === "ARCHIVE" ? copy.archiveSuccess(count) : copy.restoreSuccess(count));
      await load();
    } catch {
      setError(copy.failed);
    } finally {
      setSaving(false);
    }
  }

  const number = (value: number) => value.toLocaleString(locale);
  const currentTotal = showArchived ? (data?.archivedCount ?? 0) : (data?.activeCount ?? 0);

  return (
    <section className="admin-panel admin-challenge-history">
      <div className="admin-challenge-history__heading">
        <div>
          <p className="admin-challenge-history__eyebrow">WALLET-FIND / CHALLENGE HISTORY</p>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <button className="admin-challenge-history__back" type="button" onClick={onBack}>{copy.back}</button>
      </div>

      <div className="admin-challenge-history__summary">
        <article>
          <span>{copy.active}</span>
          <strong>{number(data?.activeCount ?? 0)}</strong>
        </article>
        <article>
          <span>{copy.archived}</span>
          <strong>{number(data?.archivedCount ?? 0)}</strong>
        </article>
      </div>

      <p className="admin-challenge-history__safety">{copy.safeNote}</p>

      <div className="admin-challenge-history__toolbar">
        <div className="admin-challenge-history__view-switch">
          <button type="button" className={!showArchived ? "is-active" : ""} onClick={() => { setShowArchived(false); setPage(1); setSelectedIds([]); setNotice(""); }}>
            {copy.showActive}
          </button>
          <button type="button" className={showArchived ? "is-active" : ""} onClick={() => { setShowArchived(true); setPage(1); setSelectedIds([]); setNotice(""); }}>
            {copy.showArchived}
          </button>
        </div>
        <button type="button" className="admin-challenge-history__refresh" onClick={() => void load()} disabled={loading || saving}>
          {copy.refresh}
        </button>
      </div>

      {notice && <p className="admin-message" role="status">{notice}</p>}
      {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}

      {!showArchived && (
        <div className="admin-challenge-history__bulk">
          <label>
            <input
              type="checkbox"
              checked={allCurrentPageSelected}
              disabled={items.length === 0 || loading || saving}
              onChange={(event) => {
                const pageIds = items.map((item) => item.id);
                setSelectedIds((current) => event.target.checked
                  ? [...new Set([...current, ...pageIds])]
                  : current.filter((id) => !pageIds.includes(id)));
              }}
            />
            {copy.allOnPage}
          </label>
          <span>{number(selectedIds.length)} {copy.selected}</span>
          <div className="admin-challenge-history__actions">
            <button type="button" onClick={() => void runAction("ARCHIVE")} disabled={selectedIds.length === 0 || saving || loading}>
              {copy.archiveSelected}
            </button>
            <button type="button" className="is-danger" onClick={() => void runAction("ARCHIVE", true)} disabled={(data?.activeCount ?? 0) === 0 || saving || loading}>
              {copy.archiveAll} ({number(data?.activeCount ?? 0)})
            </button>
          </div>
        </div>
      )}

      {showArchived && selectedIds.length > 0 && (
        <div className="admin-challenge-history__bulk">
          <span>{number(selectedIds.length)} {copy.selected}</span>
          <div className="admin-challenge-history__actions">
            <button type="button" onClick={() => void runAction("RESTORE")} disabled={saving || loading}>{copy.restoreSelected}</button>
          </div>
        </div>
      )}

      {loading && !data ? <LoadingIndicator label={copy.loading} /> : null}
      {!loading && items.length === 0 && <p className="admin-empty">{copy.empty}</p>}

      {items.length > 0 && (
        <div className="admin-challenge-history__table-wrap">
          <table className="admin-challenge-history__table">
            <thead>
              <tr>
                <th aria-label={copy.allOnPage}></th>
                <th>{copy.challenge}</th>
                <th>{copy.language}</th>
                <th>{copy.status}</th>
                <th>{copy.start}</th>
                <th>{copy.submissions}</th>
                <th>{copy.clues}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: AdminChallengeHistoryItem) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      disabled={saving}
                      aria-label={`${copy.challenge} ${item.challengeNumber ?? item.title}`}
                      onChange={(event) => toggleItem(item.id, event.target.checked)}
                    />
                  </td>
                  <td>
                    <strong>{item.challengeNumber === null ? "—" : number(item.challengeNumber)}</strong>
                    <small>{item.title}</small>
                  </td>
                  <td>{isChallengeLanguage(item.language) ? getChallengeLanguageName(item.language) : item.language}</td>
                  <td><span className={`admin-challenge-history__status admin-challenge-history__status--${item.status.toLowerCase()}`}>{item.status === "FINISHED" ? copy.finished : item.status === "CANCELLED" ? copy.cancelled : copy.statusUnknown}</span></td>
                  <td>{formatDate(item.startsAt, locale)}</td>
                  <td>{number(item.submissionCount)}</td>
                  <td>{number(item.clueCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-challenge-history__pagination">
        <span>{number(currentTotal)} {fa ? "مورد" : "records"} · {copy.page} {number(data?.page ?? 1)} {copy.of} {number(data?.pageCount ?? 1)}</span>
        <div>
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading || saving}>{fa ? "قبلی" : "Previous"}</button>
          <button type="button" onClick={() => setPage((current) => Math.min(data?.pageCount ?? 1, current + 1))} disabled={page >= (data?.pageCount ?? 1) || loading || saving}>{fa ? "بعدی" : "Next"}</button>
        </div>
      </div>
    </section>
  );
}
