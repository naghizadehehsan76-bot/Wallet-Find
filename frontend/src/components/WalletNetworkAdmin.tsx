import { useCallback, useEffect, useState } from "react";
import {
  getAdminWalletNetworkRegistry,
  emergencyPauseAllWalletOperations,
  resumeWalletOperations,
  updateAdminWalletAsset,
  updateAdminWalletNetwork,
  type AdminWalletNetworkRegistry,
} from "../services/api";

type Props = { fa: boolean };
type NetworkPatch = { isEnabled?: boolean; depositEnabled?: boolean; withdrawalEnabled?: boolean; finalityDepth?: number };
type AssetPatch = { depositEnabled?: boolean; withdrawalEnabled?: boolean; confirmationCount?: number; minDeposit?: string | null };

export default function WalletNetworkAdmin({ fa }: Props) {
  const [registry, setRegistry] = useState<AdminWalletNetworkRegistry | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pauseBusy, setPauseBusy] = useState(false);

  const copy = {
    title: fa ? "مدیریت شبکه‌ها و دارایی‌های کیف پول" : "Wallet networks and assets",
    help: fa ? "فعال‌سازی واریز و برداشت تنها پس از عبور از دروازه‌های آمادگی عملیاتی مجاز است. همهٔ تغییرات مدیریتی ثبت می‌شوند." : "Deposits and withdrawals can only be enabled after production-readiness gates are satisfied. All changes are audited.",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    reason: fa ? "دلیل تغییر مدیریتی (حداقل ۸ نویسه)" : "Reason for admin change (at least 8 characters)",
    enabled: fa ? "فعال" : "Enabled",
    disabled: fa ? "غیرفعال" : "Disabled",
    network: fa ? "شبکه" : "Network",
    deposits: fa ? "واریز شبکه" : "Network deposits",
    withdrawals: fa ? "برداشت شبکه" : "Network withdrawals",
    activation: fa ? "فعال‌سازی شبکه" : "Enable network",
    disableNetwork: fa ? "غیرفعال‌سازی شبکه" : "Disable network",
    depositToggle: fa ? "تغییر وضعیت واریز" : "Toggle deposits",
    withdrawalToggle: fa ? "تغییر وضعیت برداشت" : "Toggle withdrawals",
    assets: fa ? "دارایی‌ها" : "Assets",
    confirmations: fa ? "تأییدهای لازم" : "Confirmations required",
    address: fa ? "قرارداد" : "Contract",
    minDeposit: fa ? "حداقل واریز (Atomic)" : "Minimum deposit (atomic)",
    verification: fa ? "اعتبارسنجی" : "Verification",
    scanner: fa ? "وضعیت اسکنر" : "Scanner status",
    adapter: fa ? "Adapter واریز" : "Deposit adapter",
    withdrawalAdapter: fa ? "Adapter برداشت" : "Withdrawal adapter",
    ready: fa ? "آماده" : "Ready",
    notImplemented: fa ? "هنوز پیاده‌سازی نشده" : "Not implemented",
    cursor: fa ? "آخرین موقعیت پردازش‌شده" : "Last processed position",
    noCursor: fa ? "هنوز راه‌اندازی نشده" : "Not initialized",
    lastSuccessfulScan: fa ? "آخرین اسکن موفق" : "Last successful scan",
    addresses: fa ? "آدرس‌های ثبت‌شده" : "Registered addresses",
    depositsCount: fa ? "تعداد واریزها" : "Deposit records",
    withdrawalCount: fa ? "تعداد برداشت‌ها" : "Withdrawal records",
    depositsGate: fa ? "آمادگی اسکن واریز" : "Deposit scanner ready",
    withdrawalsGate: fa ? "آمادگی برداشت" : "Withdrawal engine ready",
    save: fa ? "ثبت تغییر" : "Save change",
    missingReason: fa ? "ابتدا دلیل تغییر را وارد کن." : "Enter a reason before changing a setting.",
    updated: fa ? "تنظیمات ذخیره شد." : "Settings updated.",
    errorText: fa ? "ذخیره یا دریافت تنظیمات ناموفق بود." : "Could not load or save wallet settings.",
    pending: fa ? "در انتظار اعتبارسنجی" : "Pending verification",
    review: fa ? "نیازمند بررسی" : "Review required",
    verified: fa ? "تأیید شده" : "Verified",
    emergencyTitle: fa ? "توقف اضطراری کل کیف پول" : "Global wallet emergency pause",
    emergencyHelp: fa ? "واریز و برداشت شبکه‌های قدیمی و جدید را فوراً متوقف می‌کند. تراکنش‌های ارسال‌شده لغو نمی‌شوند و باید جداگانه تطبیق داده شوند." : "Immediately stops legacy and generic wallet deposits and withdrawals. Already broadcast transactions are not cancelled and must be reconciled separately.",
    pause: fa ? "توقف اضطراری" : "Emergency pause",
    resume: fa ? "رفع قفل اضطراری" : "Release emergency lock",
    paused: fa ? "توقف اضطراری فعال است" : "Emergency pause is active",
    notPaused: fa ? "توقف اضطراری فعال نیست" : "Emergency pause is not active",
    confirmPause: fa ? "تمام واریزها و برداشت‌های کیف پول متوقف شوند؟ این عملیات نیازمند بازبینی دستی برای فعال‌سازی مجدد است." : "Stop all wallet deposits and withdrawals? Manual review is required before reactivation.",
    confirmResume: fa ? "قفل اضطراری آزاد شود؟ تمام شبکه‌ها و دارایی‌ها همچنان غیرفعال باقی می‌مانند." : "Release the emergency lock? All networks and assets will remain disabled.",
    pausedDone: fa ? "توقف اضطراری ثبت شد." : "Emergency pause recorded.",
    resumedDone: fa ? "قفل اضطراری آزاد شد؛ شبکه‌ها همچنان خاموش هستند." : "Emergency lock released; all network and asset switches remain off.",
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRegistry(await getAdminWalletNetworkRegistry());
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

  const saveNetwork = async (networkId: string, patch: NetworkPatch) => {
    if (reason.trim().length < 8) {
      setError(copy.missingReason);
      return;
    }
    setSaving(networkId);
    try {
      await updateAdminWalletNetwork(networkId, { ...patch, reason: reason.trim() });
      setReason("");
      setNotice(copy.updated);
      setError("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.errorText);
    } finally {
      setSaving("");
    }
  };

  const saveAsset = async (assetId: string, patch: AssetPatch) => {
    if (reason.trim().length < 8) {
      setError(copy.missingReason);
      return;
    }
    setSaving(assetId);
    try {
      await updateAdminWalletAsset(assetId, { ...patch, reason: reason.trim() });
      setReason("");
      setNotice(copy.updated);
      setError("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.errorText);
    } finally {
      setSaving("");
    }
  };

  const emergencyAction = async (operation: "PAUSE" | "RESUME") => {
    if (reason.trim().length < 8 || pauseBusy) {
      setError(copy.missingReason);
      return;
    }
    const confirmed = window.confirm(operation === "PAUSE" ? copy.confirmPause : copy.confirmResume);
    if (!confirmed) return;
    setPauseBusy(true);
    setError("");
    setNotice("");
    try {
      if (operation === "PAUSE") {
        await emergencyPauseAllWalletOperations(reason.trim());
        setNotice(copy.pausedDone);
      } else {
        await resumeWalletOperations(reason.trim());
        setNotice(copy.resumedDone);
      }
      setReason("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.errorText);
    } finally {
      setPauseBusy(false);
    }
  };

  const gate = (value: boolean) => value ? copy.enabled : copy.disabled;
  const statusClass = (value: boolean) => value ? "wallet-network-status wallet-network-status--active" : "wallet-network-status";

  return <section className="admin-panel admin-wallet-network-admin">
    <div className="admin-treasury-deposits__heading">
      <div><h2>{copy.title}</h2><p className="admin-footnote">{copy.help}</p></div>
      <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "…" : copy.refresh}</button>
    </div>

    <label className="wallet-form-field">
      <span>{copy.reason}</span>
      <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
    </label>
    {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
    {notice && <p className="admin-message" role="status">{notice}</p>}

    {registry && <article className="admin-setting-row admin-wallet-emergency-panel">
      <div>
        <strong>{copy.emergencyTitle}</strong>
        <p className="admin-footnote">{copy.emergencyHelp}</p>
        <span className={registry.globalEmergencyPause.active ? "wallet-network-status" : "wallet-network-status wallet-network-status--active"}>
          {registry.globalEmergencyPause.active ? copy.paused : copy.notPaused}
        </span>
      </div>
      <div className="admin-wallet-network-actions">
        {!registry.globalEmergencyPause.active
          ? <button type="button" className="wallet-danger-button" disabled={pauseBusy || Boolean(saving)} onClick={() => void emergencyAction("PAUSE")}>
              {pauseBusy ? "…" : copy.pause}
            </button>
          : <button type="button" disabled={pauseBusy || Boolean(saving)} onClick={() => void emergencyAction("RESUME")}>
              {pauseBusy ? "…" : copy.resume}
            </button>}
      </div>
    </article>}

    {registry && <div className="wallet-network-gates">
      <span className={statusClass(registry.activationGates.depositsReady)}>{copy.depositsGate}: {gate(registry.activationGates.depositsReady)}</span>
      <span className={statusClass(registry.activationGates.withdrawalsReady)}>{copy.withdrawalsGate}: {gate(registry.activationGates.withdrawalsReady)}</span>
    </div>}

    {loading && !registry && <p>{fa ? "در حال دریافت..." : "Loading..."}</p>}
    {registry?.networks.map((network) => <article className="admin-setting-row admin-wallet-network-card" key={network.id}>
      <div className="admin-wallet-network-card__content">
        <div className="admin-treasury-deposit-row__top">
          <strong>{network.displayName} ({network.networkKey})</strong>
          <span className={statusClass(network.isEnabled)}>{gate(network.isEnabled)}</span>
        </div>
        <small>{network.id} · {network.family}{network.chainId !== null ? " · chain " + network.chainId : ""}</small>
        <div className="wallet-network-gates">
          <span className={statusClass(network.depositEnabled)}>{copy.deposits}: {gate(network.depositEnabled)}</span>
          <span className={statusClass(network.withdrawalEnabled)}>{copy.withdrawals}: {gate(network.withdrawalEnabled)}</span>
        </div>
        <small>{copy.adapter}: {network.adapterReady ? copy.ready : copy.notImplemented} · {copy.withdrawalAdapter}: {network.withdrawalAdapterReady ? copy.ready : copy.notImplemented}</small>
        <small>{copy.confirmations}: {network.finalityDepth}</small>
        <small>{copy.addresses}: {network.counts.addresses} · {copy.depositsCount}: {network.counts.deposits} · {copy.withdrawalCount}: {network.counts.withdrawals}</small>
        <small>{copy.scanner}: {network.scanner ? copy.enabled : copy.noCursor}</small>
        {network.scanner && <small>{copy.cursor}: {network.scanner.cursorPosition} · {copy.lastSuccessfulScan}: {network.scanner.lastSuccessfulScanAt ? new Date(network.scanner.lastSuccessfulScanAt).toLocaleString(fa ? "fa-IR" : "en-GB") : copy.noCursor}</small>}
        <div className="admin-wallet-network-actions">
          <button type="button" disabled={Boolean(saving) || (!network.isEnabled && !network.adapterReady)} onClick={() => void saveNetwork(network.id, { isEnabled: !network.isEnabled })}>
            {saving === network.id ? "…" : network.isEnabled ? copy.disableNetwork : copy.activation}
          </button>
          <button type="button" disabled={Boolean(saving) || !network.isEnabled} onClick={() => void saveNetwork(network.id, { depositEnabled: !network.depositEnabled })}>
            {copy.depositToggle}
          </button>
          <button type="button" disabled={Boolean(saving) || !network.isEnabled || !network.withdrawalAdapterReady} onClick={() => void saveNetwork(network.id, { withdrawalEnabled: !network.withdrawalEnabled })}>
            {copy.withdrawalToggle}
          </button>
        </div>

        <h4>{copy.assets}</h4>
        {network.assets.map((asset) => <div className="wallet-admin-asset-row" key={asset.id}>
          <div>
            <strong>{asset.displayName} ({asset.symbol})</strong>
            <small>{asset.assetType} · {asset.decimals} decimals · {asset.issuerClassification}</small>
            {asset.contractAddress && <code>{asset.contractAddress}</code>}
            <small>{copy.verification}: {asset.verificationStatus === "VERIFIED" ? copy.verified : asset.verificationStatus === "REVIEW_REQUIRED" ? copy.review : copy.pending}</small>
            <small>{copy.confirmations}: {asset.confirmationCount} · {copy.minDeposit}: {asset.minDepositAtomic ?? "—"}</small>
            <div className="wallet-network-gates">
              <span className={statusClass(asset.depositEnabled)}>{copy.deposits}: {gate(asset.depositEnabled)}</span>
              <span className={statusClass(asset.withdrawalEnabled)}>{copy.withdrawals}: {gate(asset.withdrawalEnabled)}</span>
            </div>
          </div>
          <div className="admin-wallet-network-actions">
            <button type="button" disabled={Boolean(saving) || !network.isEnabled || !network.depositEnabled || asset.verificationStatus !== "VERIFIED"} onClick={() => void saveAsset(asset.id, { depositEnabled: !asset.depositEnabled })}>
              {fa ? "تغییر واریز" : "Toggle deposit"}
            </button>
            <button type="button" disabled={Boolean(saving) || !network.isEnabled || !network.withdrawalAdapterReady || !network.withdrawalEnabled || asset.verificationStatus !== "VERIFIED"} onClick={() => void saveAsset(asset.id, { withdrawalEnabled: !asset.withdrawalEnabled })}>
              {fa ? "تغییر برداشت" : "Toggle withdrawal"}
            </button>
          </div>
        </div>)}
      </div>
    </article>)}
    {registry && <p className="admin-footnote">{fa ? "آخرین بروزرسانی: " : "Updated: "}{new Date(registry.generatedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</p>}
  </section>;
}
