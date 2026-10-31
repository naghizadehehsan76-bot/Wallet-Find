import { useCallback, useEffect, useState } from "react";
import { getAdminWalletWithdrawals, reviewAdminWalletWithdrawal, type AdminWalletWithdrawal } from "../services/api";

type Props = { fa: boolean };

export default function WalletWithdrawalReview({ fa }: Props) {
  const [rows, setRows] = useState<AdminWalletWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const copy = {
    title: fa ? "درخواست‌های برداشت" : "Withdrawal requests",
    help: fa ? "تأیید فقط اجازه ورود درخواست به مرحله بعدی را ثبت می‌کند؛ هیچ انتقالی روی بلاکچین انجام نمی‌شود. رد درخواست مبلغ رزروشده را آزاد می‌کند." : "Approval only records authorization for the next processing stage; it does not send an on-chain transfer. Rejection releases the reserved amount.",
    empty: fa ? "درخواست برداشت در انتظار بررسی وجود ندارد." : "There are no withdrawal requests awaiting review.",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    approve: fa ? "تأیید درخواست" : "Approve request",
    reject: fa ? "رد درخواست" : "Reject request",
    requested: fa ? "در انتظار بررسی" : "Awaiting review",
    approved: fa ? "تأیید شده؛ منتظر پردازش فنی" : "Approved; awaiting technical processing",
    user: fa ? "کاربر" : "User",
    amount: fa ? "مبلغ" : "Amount",
    destination: fa ? "آدرس مقصد" : "Destination address",
    date: fa ? "زمان درخواست" : "Requested",
    loadError: fa ? "دریافت درخواست‌ها ناموفق بود." : "Could not load withdrawal requests.",
    actionError: fa ? "ثبت تصمیم مدیریتی ناموفق بود. فهرست را به‌روزرسانی کن." : "Could not save the admin decision. Refresh the list.",
    approvedNotice: fa ? "درخواست تأیید شد؛ انتقال هنوز انجام نشده است." : "Request approved; no transfer has been sent.",
    rejectedNotice: fa ? "درخواست رد شد و مبلغ رزروشده آزاد شد." : "Request rejected and reserved funds released.",
    rejectPrompt: fa ? "دلیل رد درخواست (اختیاری):" : "Reason for rejection (optional):",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setRows(await getAdminWalletWithdrawals()); }
    catch { setError(copy.loadError); }
    finally { setLoading(false); }
  }, [copy.loadError]);

  useEffect(() => { void load(); }, [load]);

  async function review(row: AdminWalletWithdrawal, decision: "APPROVE" | "REJECT") {
    const reason = decision === "REJECT" ? window.prompt(copy.rejectPrompt) : undefined;
    if (decision === "REJECT" && reason === null) return;
    setBusyId(row.id);
    setError("");
    setNotice("");
    try {
      await reviewAdminWalletWithdrawal(row.id, decision, reason || undefined);
      setNotice(decision === "APPROVE" ? copy.approvedNotice : copy.rejectedNotice);
      await load();
    } catch { setError(copy.actionError); }
    finally { setBusyId(null); }
  }

  return (
    <section className="admin-panel">
      <div className="admin-source-report__heading">
        <div>
          <h2>{copy.title}</h2>
          <p className="admin-footnote">{copy.help}</p>
        </div>
        <button className="admin-refresh" type="button" onClick={() => void load()} disabled={loading}>{copy.refresh}</button>
      </div>
      {error && <div className="admin-message admin-message--error" role="alert">{error}</div>}
      {notice && <div className="admin-message" role="status">{notice}</div>}
      {loading ? <p className="admin-empty">{fa ? "در حال دریافت…" : "Loading…"}</p> : rows.length === 0 ? <p className="admin-empty">{copy.empty}</p> : (
        <div className="admin-settings-list">
          {rows.map((row) => (
            <article className="admin-setting-row admin-wallet-row" key={row.id}>
              <div>
                <strong>{row.username} · {Number(row.amount).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT0</strong>
                <small>{copy.user}: {row.email}</small>
                <small>{row.network} · {row.asset}</small>
                <small>{copy.destination}</small>
                <code>{row.destinationAddress}</code>
                <small>{copy.date}: {new Date(row.requestedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>
                <small>{row.status === "REQUESTED" ? copy.requested : copy.approved}</small>
                {row.transactionHash && <code>{row.transactionHash}</code>}
              </div>
              {row.status === "REQUESTED" && (
                <div className="cta-group">
                  <button className="cta-button" type="button" onClick={() => void review(row, "APPROVE")} disabled={busyId !== null}>{busyId === row.id ? "…" : copy.approve}</button>
                  <button className="cta-button cta-button--ghost" type="button" onClick={() => void review(row, "REJECT")} disabled={busyId !== null}>{copy.reject}</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
