import { useEffect, useState } from "react";
import { getPrizePool, type PrizePoolResult } from "../services/api";

type Props = { contestId: string; contestStatus: string };

export default function PrizePoolPanel({ contestId }: Props) {
  const [data, setData] = useState<PrizePoolResult | null>(null);
  const [error, setError] = useState("");
  const isFa = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  useEffect(() => {
    let cancelled = false;
    void getPrizePool(contestId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "REQUEST_FAILED");
      });
    return () => { cancelled = true; };
  }, [contestId]);

  return (
    <section className="info-panel" style={{ display: "block", marginTop: 24, textAlign: "start" }}>
      <div className="eyebrow">{isFa ? "صندوق جوایز" : "PRIZE POOL"}</div>
      <h2 className="page-title" style={{ marginTop: 8 }}>{isFa ? "موجودی واقعی جوایز" : "Real prize funds"}</h2>
      <p className="hero-description">
        {isFa
          ? "فقط تتر واقعیِ واریزشده و تأییدشده در صندوق قابل تخصیص است. برای هر دور حداکثر ۱ تتر از موجودی واقعی کنار گذاشته می‌شود. تا زمان فعال‌شدن واریز و پرداخت واقعی، هیچ جایزه‌ای پرداخت نمی‌شود."
          : "Only real, confirmed USDT deposits can be allocated. Up to 1 USDT is reserved from the real global fund for each round. No prizes are paid until real deposit and payout processing is operational."}
      </p>
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "16px 0" }}>
          <div className="stat-card"><strong>{data.pool.total} USDT</strong><span>{isFa ? "موجودی اختصاص‌یافته به این دور" : "Allocated to this round"}</span></div>
          <div className="stat-card"><strong>{data.pool.available} USDT</strong><span>{isFa ? "موجودی قابل‌استفاده" : "Available"}</span></div>
        </div>
      )}
      {error && <p className="inline-feedback">{error}</p>}
    </section>
  );
}
