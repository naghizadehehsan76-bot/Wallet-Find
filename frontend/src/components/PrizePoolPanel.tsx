import { useCallback, useEffect, useState } from "react";
import { getPrizePool, settlePrizePool, testFundPrizePool, type PrizePoolResult } from "../services/api";

type Props = { contestId: string; contestStatus: string };

export default function PrizePoolPanel({ contestId, contestStatus }: Props) {
  const [data, setData] = useState<PrizePoolResult | null>(null);
  const [amount, setAmount] = useState("100.000000");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isFa = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  const refresh = useCallback(async () => {
    try {
      setData(await getPrizePool(contestId));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "REQUEST_FAILED");
    }
  }, [contestId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function fund() {
    setLoading(true); setMessage(""); setError("");
    try {
      await testFundPrizePool(contestId, amount);
      setMessage(isFa ? "صندوق آزمایشی شارژ شد؛ هیچ توکن واقعی منتقل نشده است." : "Test pool funded; no real tokens were transferred.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "REQUEST_FAILED");
    } finally { setLoading(false); }
  }

  async function settle() {
    if (!window.confirm(isFa ? "تسویهٔ آزمایشی ثبت شود؟ هیچ پرداخت واقعی انجام نمی‌شود." : "Run simulated settlement? No real payment will be made.")) return;
    setLoading(true); setMessage(""); setError("");
    try {
      const result = await settlePrizePool(contestId);
      setMessage(isFa
        ? `تسویهٔ آزمایشی انجام شد؛ ${result.awards.length} جایزه ثبت شد.`
        : `Simulated settlement complete; ${result.awards.length} awards recorded.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "REQUEST_FAILED");
    } finally { setLoading(false); }
  }

  return (
    <section className="info-panel" style={{ display: "block", marginTop: 24, textAlign: "start" }}>
      <div className="eyebrow">{isFa ? "حسابداری آزمایشی" : "TEST ACCOUNTING"}</div>
      <h2 className="page-title" style={{ marginTop: 8 }}>{isFa ? "صندوق جایزه" : "Prize pool"}</h2>
      <p className="hero-description">
        {isFa
          ? "تمام مبالغ این بخش فرضی‌اند. این محیط فقط دفترکل و محاسبهٔ جایزه را آزمایش می‌کند و هیچ USDT واقعی ارسال نمی‌شود."
          : "All amounts here are simulated. This tests accounting only and never transfers real USDT."}
      </p>
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "16px 0" }}>
          {[
            [isFa ? "موجودی کل" : "Total pool", data.pool.total],
            [isFa ? "قابل تخصیص" : "Available", data.pool.available],
            [isFa ? "جایزه‌های ثبت‌شده" : "Awards recorded", data.pool.awarded],
            [isFa ? "انتقال به دور بعد" : "Rollover out", data.pool.rolloverOut],
          ].map(([label, value]) => (
            <div key={label} className="stat-card"><strong>{value} USDT</strong><span>{label}</span></div>
          ))}
        </div>
      )}
      <label className="field" style={{ display: "block", marginBottom: 10 }}>
        <span>{isFa ? "مبلغ شارژ فرضی (USDT)" : "Simulated funding amount (USDT)"}</span>
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" disabled={loading || data?.pool.status === "SETTLED"} />
      </label>
      <div className="cta-group">
        <button className="cta-button cta-button--ghost" type="button" onClick={() => void fund()} disabled={loading || data?.pool.status === "SETTLED"}>
          {loading ? (isFa ? "در حال انجام..." : "Working...") : (isFa ? "شارژ آزمایشی صندوق" : "Fund test pool")}
        </button>
        <button className="cta-button" type="button" onClick={() => void settle()} disabled={loading || data?.pool.status === "SETTLED" || (contestStatus !== "finished" && data?.pool.status !== "SETTLED")}>
          {isFa ? "محاسبه و ثبت جوایز آزمایشی" : "Calculate & record test awards"}
        </button>
      </div>
      {data?.pool.status !== "SETTLED" && contestStatus !== "finished" && (
        <p className="inline-feedback">{isFa ? "برای تسویه، ابتدا دور را پایان بده." : "Finish the round before settlement."}</p>
      )}
      {message && <p className="inline-feedback">{message}</p>}
      {error && <p className="inline-feedback">{error}</p>}
      {data?.awards.length ? (
        <div style={{ marginTop: 14 }}>
          <h3 className="section-heading">{isFa ? "جوایز محاسبه‌شده (فرضی)" : "Calculated awards (simulated)"}</h3>
          {data.awards.map((award, index) => (
            <div key={`${award.username}-${index}`} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{award.rank}. {award.username}</span><strong>{award.amount} USDT</strong>
            </div>
          ))}
        </div>
      ) : null}
      {data?.ledger.length ? (
        <details style={{ marginTop: 12 }}>
          <summary>{isFa ? "نمایش دفترکل تراکنش‌های فرضی" : "View simulated ledger"}</summary>
          {data.ledger.map((entry) => (
            <div key={entry.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <strong>{entry.type} · {entry.amount} USDT</strong>
              <div className="date">{entry.note}</div>
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}
