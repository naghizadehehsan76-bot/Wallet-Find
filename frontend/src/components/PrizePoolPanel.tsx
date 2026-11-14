import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { getPrizePool, type PrizePoolResult } from "../services/api";

type Props = { contestId: string; contestStatus: string };

export default function PrizePoolPanel({ contestId }: Props) {
  const [data, setData] = useState<PrizePoolResult | null>(null);
  const [error, setError] = useState("");
  const { language } = useI18n();
  const isFa = language === "fa";

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
          ? "مبنای محاسبهٔ جوایز هر چالش ۰٫۱ USDT است و در شروع چالش رزرو نمی‌شود. پس از پایان چالش، فقط مجموع جوایز قابل‌پرداخت از صندوق جهانی مشترک کسر می‌شود؛ در صورت ناکافی‌بودن موجودی، تسویه منتظر می‌ماند."
          : "Each challenge uses 0.1 USDT as its prize-calculation basis; it is not reserved when the challenge starts. After the challenge ends, only payable awards are debited from the shared global fund. Settlement waits if the fund balance is insufficient."}
      </p>
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "16px 0" }}>
          <div className="stat-card"><strong>{data.pool.awarded} USDT</strong><span>{isFa ? "مجموع جوایز ثبت‌شده برای این چالش" : "Awards recorded for this challenge"}</span></div>
          <div className="stat-card"><strong>{data.pool.status}</strong><span>{isFa ? "وضعیت تسویه" : "Settlement status"}</span></div>
        </div>
      )}
      {error && <p className="inline-feedback">{error}</p>}
    </section>
  );
}
