import { useCallback, useEffect, useState } from "react";
import {
  executeAdminChainWalletWithdrawal,
  getAdminChainWalletWithdrawals,
  reconcileAdminChainWalletWithdrawal,
  recoverAdminChainWalletWithdrawal,
  reviewAdminChainWalletWithdrawal,
  type AdminChainWalletWithdrawal,
} from "../services/api";

type Props = { fa: boolean };

export default function WalletChainWithdrawalReview({ fa }: Props) {
  const [rows, setRows] = useState<AdminChainWalletWithdrawal[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const copy = {
    title: fa ? "درخواست‌های برداشت چندشبکه‌ای" : "Multi-chain withdrawal requests",
    help: fa ? "ابتدا درخواست رزروشده را بررسی و تأیید یا رد کن. اجرای تراکنش فقط با آمادگی عملیاتی کامل ممکن است." : "Review and approve or reject reserved requests first. Broadcasting is blocked until production readiness is explicitly enabled.",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    reason: fa ? "دلیل بررسی / تأیید (حداقل ۸ نویسه)" : "Review or approval reason (at least 8 characters)",
    noRows: fa ? "درخواستی ثبت نشده است." : "No withdrawal requests.",
    approve: fa ? "تأیید درخواست" : "Approve",
    reject: fa ? "رد و آزادسازی رزرو" : "Reject & release reserve",
    execute: fa ? "ارسال تراکنش" : "Execute transaction",
    reconcile: fa ? "بررسی وضعیت بلاکچین" : "Reconcile chain status",
    recover: fa ? "بازیابی امن درخواست مشخص‌شده" : "Recover this verified pre-broadcast request",
    recoveryConfirm: fa ? "فقط در صورتی ادامه بده که تأیید می‌کنی همین درخواست ۴ POL بازیابی شود. پس از بازیابی، ارسال تراکنش یک اقدام جداگانه خواهد بود." : "Recover only this verified 4 POL request. Recovery does not send funds; execution will be a separate action.",
    status: fa ? "وضعیت" : "Status",
    user: fa ? "کاربر" : "User",
    amount: fa ? "مبلغ" : "Amount",
    destination: fa ? "آدرس مقصد" : "Destination",
    fee: fa ? "کارمزد تخمینی / واقعی" : "Estimated / actual fee",
    tx: fa ? "هش تراکنش" : "Transaction hash",
    requested: fa ? "زمان درخواست" : "Requested",
    noReason: fa ? "ابتدا دلیل بررسی را وارد کن." : "Enter a review reason first.",
    saved: fa ? "عملیات ثبت شد." : "Action recorded.",
    errorText: fa ? "عملیات برداشت ناموفق بود." : "Withdrawal action failed.",
    requiresManual: fa ? "این درخواست در مرحله امضا/ارسال نامطمئن مانده و نیازمند بررسی دستی است؛ دوباره اجرا نکن." : "This request has an uncertain signing/broadcast outcome and needs manual review. Do not execute it again.",
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getAdminChainWalletWithdrawals());
      setError("");
    } catch {
      setError(copy.errorText);
    } finally {
      setLoading(false);
    }
  }, [copy.errorText]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act = async (id: string, operation: "APPROVE" | "REJECT" | "EXECUTE" | "RECONCILE" | "RECOVER") => {
    if ((operation === "APPROVE" || operation === "REJECT" || operation === "RECOVER") && reason.trim().length < 8) {
      setError(copy.noReason);
      return;
    }
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      if (operation === "APPROVE" || operation === "REJECT") {
        await reviewAdminChainWalletWithdrawal(id, operation, reason.trim());
        setReason("");
      } else if (operation === "RECOVER") {
        await recoverAdminChainWalletWithdrawal(id, reason.trim());
        setReason("");
      } else if (operation === "EXECUTE") {
        await executeAdminChainWalletWithdrawal(id);
      } else {
        await reconcileAdminChainWalletWithdrawal(id);
      }
      setNotice(copy.saved);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.errorText);
    } finally {
      setBusyId("");
    }
  };

  return <section className="admin-panel admin-chain-withdrawals">
    <div className="admin-treasury-deposits__heading">
      <div><h2>{copy.title}</h2><p className="admin-footnote">{copy.help}</p></div>
      <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "…" : copy.refresh}</button>
    </div>
    <label className="wallet-form-field"><span>{copy.reason}</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>
    {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
    {notice && <p className="admin-message" role="status">{notice}</p>}
    {loading && rows.length === 0 ? <p>{fa ? "در حال دریافت..." : "Loading..."}</p> :
      rows.length === 0 ? <p className="admin-empty">{copy.noRows}</p> :
      <div className="admin-settings-list">
        {rows.map((row) => <article className="admin-setting-row admin-chain-withdrawal-card" key={row.id}>
          <div className="admin-chain-withdrawal-card__content">
            <div className="admin-treasury-deposit-row__top">
              <strong>{row.amount} {row.asset} · {row.network}</strong>
              <span className={row.status === "CONFIRMED" ? "wallet-network-status wallet-network-status--active" : "wallet-network-status"}>{row.status}</span>
            </div>
            <small>{copy.user}: {row.username} · {row.email}</small>
            <small>{copy.destination}: {row.destinationAddress}</small>
            <small>{copy.fee}: {row.estimatedFee ?? "—"} {row.feeAsset ?? ""} / {row.actualFee ?? "—"}</small>
            <small>{copy.requested}: {new Date(row.requestedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>
            {row.failureCode && <small>{row.failureCode}</small>}
            {row.transactionHash && <code>{copy.tx}: {row.transactionHash}</code>}
            {row.status === "SIGNING" && <p className="wallet-warning">{copy.requiresManual}</p>}
          </div>
          <div className="admin-wallet-network-actions">
            {row.status === "RESERVED" && <>
              <button type="button" disabled={Boolean(busyId)} onClick={() => void act(row.id, "APPROVE")}>{busyId === row.id ? "…" : copy.approve}</button>
              <button type="button" disabled={Boolean(busyId)} onClick={() => void act(row.id, "REJECT")}>{copy.reject}</button>
            </>}
            {row.status === "APPROVED" && <button type="button" disabled={Boolean(busyId)} onClick={() => void act(row.id, "EXECUTE")}>{busyId === row.id ? "…" : copy.execute}</button>}
            {row.id === "ab79dd7e-fa69-4c16-8a5d-b7eb3ebee5a1" &&
              row.status === "SIGNING" &&
              row.failureCode === "SIGNING_OR_BROADCAST_OUTCOME_UNCERTAIN" &&
              !row.transactionHash && !row.broadcastAt &&
              <button type="button" disabled={Boolean(busyId) || reason.trim().length < 8}
                onClick={() => {
                  if (window.confirm(copy.recoveryConfirm)) void act(row.id, "RECOVER");
                }}>{busyId === row.id ? "…" : copy.recover}</button>}
            {row.status === "BROADCAST" && <button type="button" disabled={Boolean(busyId)} onClick={() => void act(row.id, "RECONCILE")}>{busyId === row.id ? "…" : copy.reconcile}</button>}
          </div>
        </article>)}
      </div>}
  </section>;
}
