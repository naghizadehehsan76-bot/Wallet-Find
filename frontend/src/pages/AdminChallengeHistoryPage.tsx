import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { getChallengeLanguageName, isChallengeLanguage } from "../i18n/challenge-languages";
import {
  getAdminChallengeHistory,
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
  const [data, setData] = useState<AdminChallengeHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const copy = {
    title: fa ? "تاریخچهٔ چالش‌ها" : "Challenge history",
    subtitle: fa ? "فهرست صفحه‌بندی‌شدهٔ چالش‌هایی که حداقل یک شرکت‌کننده داشته‌اند" : "A paginated list of challenges that had at least one participant",
    back: fa ? "بازگشت به تبلیغات و چالش‌ها" : "Back to Ads & Challenges",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    loading: fa ? "در حال دریافت تاریخچه…" : "Loading challenge history…",
    loadError: fa ? "دریافت تاریخچهٔ چالش‌ها ناموفق بود." : "Could not load challenge history.",
    empty: fa ? "هنوز چالشی با شرکت‌کننده برای نمایش وجود ندارد." : "No challenges with participants are available yet.",
    note: fa ? "این صفحه فقط سوابق را می‌خواند. هیچ چالشی یا سابقهٔ مالی از دیتابیس حذف یا بایگانی نمی‌شود." : "This page is read-only. No challenges or financial records are deleted or archived.",
    challenge: fa ? "چالش" : "Challenge",
    language: fa ? "زبان" : "Language",
    status: fa ? "وضعیت" : "Status",
    start: fa ? "زمان شروع" : "Started",
    submissions: fa ? "تعداد پاسخ‌ها" : "Submissions",
    clues: fa ? "خانه‌ها" : "Clues",
    finished: fa ? "پایان‌یافته" : "Finished",
    active: fa ? "در حال اجرا" : "Active",
    page: fa ? "صفحه" : "Page",
    of: fa ? "از" : "of",
    previous: fa ? "قبلی" : "Previous",
    next: fa ? "بعدی" : "Next",
    records: fa ? "چالش دارای شرکت‌کننده" : "challenges with participants",
    statusUnknown: fa ? "نامشخص" : "Unknown",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getAdminChallengeHistory(page);
      setData(result);
      if (result.page !== page) setPage(result.page);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [page, copy.loadError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const items = data?.items ?? [];
  const number = (value: number) => value.toLocaleString(locale);

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

      <p className="admin-challenge-history__safety">{copy.note}</p>

      <div className="admin-challenge-history__toolbar">
        <span>{number(data?.total ?? 0)} {copy.records}</span>
        <button type="button" className="admin-challenge-history__refresh" onClick={() => void load()} disabled={loading}>
          {copy.refresh}
        </button>
      </div>

      {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
      {loading ? <LoadingIndicator label={copy.loading} /> : null}
      {!loading && items.length === 0 && <p className="admin-empty">{copy.empty}</p>}

      {!loading && items.length > 0 && (
        <div className="admin-challenge-history__table-wrap">
          <table className="admin-challenge-history__table">
            <thead>
              <tr>
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
                    <strong>{item.challengeNumber === null ? "—" : number(item.challengeNumber)}</strong>
                    <small>{item.title}</small>
                  </td>
                  <td>{isChallengeLanguage(item.language) ? getChallengeLanguageName(item.language) : item.language}</td>
                  <td>
                    <span className={`admin-challenge-history__status admin-challenge-history__status--${item.status.toLowerCase()}`}>
                      {item.status === "FINISHED" ? copy.finished : item.status === "ACTIVE" ? copy.active : copy.statusUnknown}
                    </span>
                  </td>
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
        <span>{copy.page} {number(data?.page ?? page)} {copy.of} {number(data?.pageCount ?? 1)}</span>
        <div>
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>
            {copy.previous}
          </button>
          <button type="button" onClick={() => setPage((current) => Math.min(data?.pageCount ?? 1, current + 1))} disabled={page >= (data?.pageCount ?? 1) || loading}>
            {copy.next}
          </button>
        </div>
      </div>
    </section>
  );
}
