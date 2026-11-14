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
          ? "مبنای محاسبهٔ جوایز هر مسابقه ۰٫۱ USDT0 است. مجموع جوایز قابل‌پرداخت از صندوق جهانی واقعی و تأییدشده کسر می‌شود؛ اگر موجودی کافی نباشد، تسویه تا تأمین موجودی لازم انجام نمی‌شود."
          : "The prize calculation budget is fixed at 0.1 USDT0 per contest. Only the total payable awards are debited from the verified global fund; settlement waits if the available balance is insufficient."}
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
