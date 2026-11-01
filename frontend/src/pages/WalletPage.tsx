import { useCallback, useEffect, useMemo, useState } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";
import { getWallet, type WalletAssetSummary, type WalletResult } from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type Page = "home" | "auth" | "competition" | "key" | "leaderboard" | "profile" | "wallet";
type Props = { onNavigate: (page: Page) => void };
type WalletView = "overview" | "deposit" | "withdraw";

export default function WalletPage({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const [wallet, setWallet] = useState<WalletResult | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<WalletView>("overview");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const copy = useMemo(() => ({
    title: fa ? "کیف پول من" : "My wallet",
    balance: fa ? "موجودی کل" : "Balance",
    available: fa ? "موجودی قابل برداشت" : "Available balance",
    deposit: fa ? "واریز" : "Deposit",
    withdraw: fa ? "برداشت" : "Withdraw",
    history: fa ? "تاریخچه تراکنش‌ها" : "Transaction history",
    empty: fa ? "برای این دارایی هنوز تراکنشی ثبت نشده است." : "No transactions for this asset yet.",
    noAssets: fa ? "هنوز دارایی فعالی برای این کیف پول پیکربندی نشده است." : "No wallet assets are currently configured.",
    loading: fa ? "در حال دریافت کیف پول..." : "Loading wallet...",
    error: fa ? "دریافت اطلاعات کیف پول ناموفق بود." : "Unable to load wallet information.",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    network: fa ? "شبکه" : "Network",
    asset: fa ? "دارایی" : "Asset",
    selectAsset: fa ? "انتخاب دارایی و شبکه" : "Select asset and network",
    depositTitle: fa ? "واریز ارز دیجیتال" : "Crypto deposit",
    withdrawTitle: fa ? "برداشت ارز دیجیتال" : "Crypto withdrawal",
    depositIntro: fa ? "فقط دارایی و شبکهٔ نمایش‌داده‌شده را به آدرس خود ارسال کنید." : "Send only the asset on the exact network shown below to your wallet address.",
    withdrawIntro: fa ? "مقدار و آدرس مقصد را با دقت وارد کنید." : "Enter the amount and destination address carefully.",
    receiveAddress: fa ? "آدرس دریافت شما" : "Your deposit address",
    copyAddress: fa ? "کپی آدرس" : "Copy address",
    copied: fa ? "آدرس کپی شد" : "Address copied",
    amount: fa ? "مقدار" : "Amount",
    destination: fa ? "آدرس مقصد" : "Destination address",
    fee: fa ? "کارمزد شبکه" : "Network fee",
    youReceive: fa ? "مقدار دریافتی" : "You will receive",
    continue: fa ? "ادامه" : "Continue",
    unavailable: fa ? "غیرفعال" : "Disabled",
    depositDisabled: fa ? "واریز برای این دارایی و شبکه فعال نیست. هیچ وجهی ارسال نکنید." : "Deposits are not enabled for this asset and network. Do not send funds.",
    withdrawDisabled: fa ? "برداشت هنوز غیرفعال است؛ امکان ارسال ارز از کیف پول وجود ندارد." : "Withdrawals are currently disabled; outgoing transfers are unavailable.",
    depositReady: fa ? "واریز این دارایی پس از تأییدهای شبکه به‌صورت خودکار ثبت می‌شود." : "This asset is credited automatically after the required canonical network confirmations.",
    nativeAsset: fa ? "دارایی بومی شبکه؛ قرارداد توکن ندارد." : "Native network asset; no token contract.",
    tokenContract: fa ? "آدرس قرارداد توکن" : "Token contract address",
    confirmations: fa ? "تأییدهای لازم شبکه" : "Required network confirmations",
    status: fa ? "وضعیت واریز" : "Deposit status",
    active: fa ? "فعال" : "Enabled",
    safeWithdraw: fa ? "برداشت غیرفعال" : "Withdrawals disabled",
    type: fa ? "نوع" : "Type",
    date: fa ? "تاریخ" : "Date",
    amountColumn: fa ? "مقدار" : "Amount",
    back: fa ? "بازگشت به کیف پول" : "Back to wallet",
  }), [fa]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setWallet(await getWallet()); setError(""); }
    catch { setError(copy.error); }
    finally { setRefreshing(false); }
  }, [copy.error]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const assets = wallet?.assets ?? [];
    if (assets.length > 0 && !assets.some((asset) => asset.assetId === selectedAssetId)) {
      setSelectedAssetId(assets[0]!.assetId);
    }
  }, [wallet, selectedAssetId]);

  const fmt = (value: string) => {
    const [wholeText = "0", fractionText = ""] = String(value).split(".");
    let whole = 0n;
    try { whole = BigInt(wholeText || "0"); } catch { whole = 0n; }
    const localizedWhole = new Intl.NumberFormat(fa ? "fa-IR" : "en-US").format(whole);
    const fraction = fractionText.slice(0, 6).replace(/0+$/, "");
    return localizedWhole + (fraction ? (fa ? "٫" : ".") + fraction : "");
  };

  const assets = wallet?.assets ?? [];
  const selectedAsset: WalletAssetSummary | undefined = assets.find((asset) => asset.assetId === selectedAssetId) ?? assets[0];
  const selectedNetwork = selectedAsset
    ? wallet?.supportedNetworks?.find((network) => network.chainId === selectedAsset.chainId)
    : undefined;
  const address = wallet?.walletAddress ?? null;
  const depositEnabled = Boolean(selectedAsset?.depositEnabled && selectedNetwork?.depositEnabled);
  const withdrawalEnabled = Boolean(selectedAsset?.withdrawalEnabled && selectedNetwork?.withdrawalEnabled);
  const selectedTransactions = wallet?.transactions.filter((item) =>
    selectedAsset ? item.assetId === selectedAsset.assetId : false
  ) ?? [];

  const copyAddress = async () => {
    if (!address || !depositEnabled) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch { setCopied(false); }
  };

  const assetLabel = (asset: WalletAssetSummary) => asset.symbol + " · " + asset.networkName;

  return <div className="app-shell wallet-page">
    <header className="topbar"><button className="brand brand--home" type="button" aria-label={copy.title} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button></header>
    <main className="page wallet-exchange">
      <div className="wallet-page-heading">
        <div><div className="section-title">{copy.title}</div><p>{depositEnabled ? copy.depositReady : copy.depositDisabled}</p></div>
        <button type="button" className="wallet-refresh" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "…" : "↻"} {copy.refresh}</button>
      </div>

      {!wallet && !error && <div className="inline-feedback"><LoadingIndicator label={copy.loading} /></div>}
      {error && <p className="inline-feedback wallet-error" role="alert">{error}</p>}

      {wallet && view === "overview" && <>
        <section className="wallet-exchange-balance">
          <div className="wallet-exchange-balance__top"><span>{copy.balance}</span><span className="wallet-safe-pill">● {depositEnabled ? copy.active : copy.unavailable}</span></div>
          <div className="wallet-form-field wallet-asset-picker">
            <label>{copy.selectAsset}</label>
            <select value={selectedAsset?.assetId ?? ""} onChange={event => setSelectedAssetId(event.target.value)} disabled={assets.length === 0}>
              {assets.length === 0 ? <option value="">{copy.noAssets}</option> : assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{assetLabel(asset)}</option>)}
            </select>
          </div>
          <div className="wallet-exchange-balance__value">{fmt(selectedAsset?.balance ?? "0")} <small>{selectedAsset?.symbol ?? "—"}</small></div>
          <div className="wallet-exchange-balance__available">{copy.available}: <strong>{fmt(selectedAsset?.availableBalance ?? "0")} {selectedAsset?.symbol ?? ""}</strong></div>
          <div className="wallet-exchange-actions">
            <button type="button" className="wallet-action wallet-action--deposit" onClick={() => setView("deposit")} disabled={!selectedAsset}><span>↓</span>{copy.deposit}</button>
            <button type="button" className="wallet-action wallet-action--withdraw" onClick={() => setView("withdraw")} disabled={!withdrawalEnabled}><span>↑</span>{copy.withdraw}</button>
          </div>
        </section>

        {selectedAsset && <section className="wallet-network-card">
          <div className="wallet-card-heading"><h2>{fa ? "شبکه و دارایی" : "Network & asset"}</h2><span className={depositEnabled ? "wallet-network-status wallet-network-status--active" : "wallet-network-status"}>{depositEnabled ? copy.active : copy.unavailable}</span></div>
          <div className="wallet-network-row"><span>{copy.network}</span><strong><i className="wallet-network-dot" />{selectedAsset.networkName}</strong></div>
          <div className="wallet-network-row"><span>{copy.asset}</span><strong>{selectedAsset.displayName} ({selectedAsset.symbol})</strong></div>
          <div className="wallet-network-row"><span>{copy.status}</span><strong className={depositEnabled ? "wallet-status-on" : "wallet-status-off"}>{depositEnabled ? copy.active : copy.unavailable}</strong></div>
          <div className="wallet-network-row"><span>{copy.withdraw}</span><strong className="wallet-status-off">{withdrawalEnabled ? copy.active : copy.safeWithdraw}</strong></div>
        </section>}

        <section className="wallet-history wallet-exchange-history">
          <div className="wallet-card-heading"><h2>{copy.history}</h2><span>{selectedTransactions.length}</span></div>
          {selectedTransactions.length === 0 ? <div className="wallet-empty"><span>↔</span><p>{copy.empty}</p></div> : <div className="wallet-table">
            <div className="wallet-table-head"><span>{copy.type}</span><span>{copy.date}</span><span>{copy.amountColumn}</span></div>
            {selectedTransactions.map(item => <article className="wallet-transaction" key={item.id}>
              <div><strong>{item.type}</strong><small>{item.status}</small></div>
              <small>{new Date(item.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}</small>
              <b>{fmt(item.amount)} <small>{item.currency}</small></b>
            </article>)}
          </div>}
        </section>
      </>}

      {wallet && view === "deposit" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--deposit">↓</div>
        <h1>{copy.depositTitle}</h1><p className="wallet-flow-intro">{copy.depositIntro}</p>
        {selectedAsset ? <>
          <div className="wallet-form-field"><label>{copy.network}</label><div className="wallet-select-static"><span className="wallet-network-dot" />{selectedAsset.networkName}</div></div>
          <div className="wallet-form-field"><label>{copy.asset}</label><div className="wallet-select-static">{selectedAsset.displayName} ({selectedAsset.symbol})</div></div>
          <div className="wallet-deposit-address">
            <label>{copy.receiveAddress}</label>
            {address ? <><code>{address}</code><button type="button" onClick={() => void copyAddress()} disabled={!depositEnabled || copied}>{copied ? "✓ " + copy.copied : copy.copyAddress}</button></> : <p>{copy.depositDisabled}</p>}
          </div>
          {depositEnabled ? <>
            <div className="wallet-network-row"><span>{copy.confirmations}</span><strong>{selectedAsset.networkName}</strong></div>
            <div className="wallet-deposit-address"><label>{copy.tokenContract}</label><code>{selectedAsset.isNative ? copy.nativeAsset : selectedAsset.contractAddress}</code></div>
            <div className="wallet-warning"><strong>⚠ {fa ? "نکتهٔ مهم" : "Important"}</strong><p>{copy.depositReady} {selectedAsset.isNative ? copy.nativeAsset : ""}</p></div>
          </> : <div className="wallet-warning"><strong>⚠ {copy.unavailable}</strong><p>{copy.depositDisabled}</p></div>}
          <button type="button" className="wallet-submit" disabled>{depositEnabled ? (fa ? "منتظر واریز شبکه" : "Awaiting on-chain deposit") : copy.unavailable}</button>
        </> : <div className="wallet-warning"><strong>⚠ {copy.unavailable}</strong><p>{copy.noAssets}</p></div>}
      </section>}

      {wallet && view === "withdraw" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--withdraw">↑</div>
        <h1>{copy.withdrawTitle}</h1><p className="wallet-flow-intro">{copy.withdrawIntro}</p>
        <div className="wallet-warning"><strong>⚠ {copy.unavailable}</strong><p>{copy.withdrawDisabled}</p></div>
        <div className="wallet-form-field"><label>{copy.amount}</label><div className="wallet-input-wrap"><input inputMode="decimal" value={withdrawAmount} onChange={event => setWithdrawAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /><span>{selectedAsset?.symbol ?? "—"}</span></div><small>{copy.available}: {fmt(selectedAsset?.availableBalance ?? "0")} {selectedAsset?.symbol ?? ""}</small></div>
        <div className="wallet-form-field"><label>{copy.destination}</label><input className="wallet-address-input" value={withdrawAddress} onChange={event => setWithdrawAddress(event.target.value)} placeholder="0x..." autoComplete="off" /></div>
        <div className="wallet-fee-row"><span>{copy.fee}</span><strong>—</strong></div>
        <div className="wallet-fee-row"><span>{copy.youReceive}</span><strong>{withdrawAmount && Number.isFinite(Number(withdrawAmount)) ? fmt(withdrawAmount) : "0.00"} {selectedAsset?.symbol ?? ""}</strong></div>
        <button type="button" className="wallet-submit" disabled>{copy.continue}</button>
      </section>}
    </main>
    <BottomNav activePage="wallet" onNavigate={onNavigate} />
  </div>;
}
