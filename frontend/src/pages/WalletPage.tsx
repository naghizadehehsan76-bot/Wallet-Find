import { useCallback, useEffect, useMemo, useState } from "react";
import BottomNav from "../components/BottomNav";
import { useI18n } from "../i18n";
import { getWallet, requestWalletWithdrawal, type WalletNetworkView, type WalletAssetView, type WalletResult } from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type Page = "home" | "auth" | "competition" | "key" | "leaderboard" | "profile" | "wallet";
type Props = { onNavigate: (page: Page) => void };
type WalletView = "overview" | "deposit" | "withdraw";

function formatExactAmount(value: string, locale: string): string {
  const input = String(value ?? "0").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(input)) return "0";

  const negative = input.startsWith("-");
  const unsigned = negative ? input.slice(1) : input;
  const [wholePart = "0", fractionPart = ""] = unsigned.split(".");
  const groupedWhole = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(BigInt(wholePart || "0"));
  const digitFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: false,
  });
  const localizedFraction = fractionPart.replace(/0+$/, "").replace(/[0-9]/g, (digit) =>
    digitFormatter.format(BigInt(digit)),
  );
  const decimalSeparator = new Intl.NumberFormat(locale).formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";
  const sign = negative ? "-" : "";
  return sign + groupedWhole + (localizedFraction ? decimalSeparator + localizedFraction : "");
}

export default function WalletPage({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const locale = fa ? "fa-IR" : "en-US";
  const [wallet, setWallet] = useState<WalletResult | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<WalletView>("overview");
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [expandedAssetId, setExpandedAssetId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawalIdempotencyKey, setWithdrawalIdempotencyKey] = useState("");
  const [withdrawalFeedback, setWithdrawalFeedback] = useState("");
  const [withdrawalError, setWithdrawalError] = useState("");

  const copy = useMemo(() => ({
    title: fa ? "کیف پول من" : "My wallet",
    balance: fa ? "موجودی دارایی‌ها" : "Asset balances",
    available: fa ? "قابل استفاده" : "Available",
    reserved: fa ? "رزروشده" : "Reserved",
    deposit: fa ? "واریز" : "Deposit",
    withdraw: fa ? "برداشت" : "Withdraw",
    history: fa ? "تاریخچه تراکنش‌های قدیمی" : "Legacy transaction history",
    empty: fa ? "هنوز تراکنشی ثبت نشده است." : "No transactions yet.",
    loading: fa ? "در حال دریافت کیف پول..." : "Loading wallet...",
    error: fa ? "دریافت اطلاعات کیف پول ناموفق بود." : "Unable to load wallet information.",
    refresh: fa ? "به‌روزرسانی" : "Refresh",
    network: fa ? "شبکه" : "Network",
    asset: fa ? "دارایی" : "Asset",
    depositTitle: fa ? "واریز ارز دیجیتال" : "Crypto deposit",
    withdrawTitle: fa ? "برداشت ارز دیجیتال" : "Crypto withdrawal",
    depositIntro: fa ? "شبکه و دارایی را دقیق انتخاب کنید و فقط همان دارایی را ارسال کنید." : "Select the exact network and asset, then send only that asset.",
    withdrawIntro: fa ? "مقدار و آدرس مقصد را با دقت وارد کنید." : "Enter the amount and destination address carefully.",
    receiveAddress: fa ? "آدرس دریافت شما" : "Your deposit address",
    copyAddress: fa ? "کپی آدرس" : "Copy address",
    copied: fa ? "آدرس کپی شد" : "Address copied",
    amount: fa ? "مقدار" : "Amount",
    destination: fa ? "آدرس مقصد" : "Destination address",
    fee: fa ? "کارمزد شبکه" : "Network fee",
    youReceive: fa ? "مقدار ارسالی" : "Amount to send",
    continue: fa ? "ادامه" : "Continue",
    unavailable: fa ? "غیرفعال" : "Disabled",
    enabled: fa ? "فعال" : "Enabled",
    depositDisabled: fa ? "واریز برای این دارایی و شبکه غیرفعال است. لطفاً هیچ وجهی ارسال نکنید." : "Deposits are disabled for this asset and network. Do not send funds.",
    withdrawDisabled: fa ? "برداشت برای این دارایی و شبکه هنوز فعال نیست." : "Withdrawals are not enabled for this asset and network.",
    depositReady: fa ? "واریز فقط برای دارایی‌هایی فعال است که وضعیت فعال بودن آن‌ها در زیر مشخص شده است." : "Deposits are available only for assets explicitly marked as enabled below.",
    depositWarning: fa ? "ارسال دارایی اشتباه یا استفاده از شبکهٔ اشتباه ممکن است باعث از دست رفتن دارایی شود." : "Sending the wrong asset or using the wrong network may result in lost funds.",
    confirmations: fa ? "تعداد تأییدهای لازم" : "Required confirmations",
    contract: fa ? "آدرس قرارداد توکن" : "Token contract address",
    noContract: fa ? "دارایی بومی شبکه؛ قرارداد توکن ندارد." : "Native network asset; no token contract.",
    noMinimum: fa ? "حداقل مبلغ واریز تعیین نشده است." : "No minimum deposit is configured.",
    minimum: fa ? "حداقل مبلغ واریز" : "Minimum deposit",
    status: fa ? "وضعیت" : "Status",
    type: fa ? "نوع" : "Type",
    date: fa ? "تاریخ" : "Date",
    amountColumn: fa ? "مقدار قدیمی" : "Legacy amount",
    back: fa ? "بازگشت به کیف پول" : "Back to wallet",
    noNetworks: fa ? "هنوز شبکه‌ای در رجیستری کیف پول وجود ندارد." : "No wallet networks are registered yet.",
    noAssets: fa ? "برای این شبکه دارایی ثبت نشده است." : "No assets are registered for this network.",
    noAddress: fa ? "آدرس کیف پول برای این شبکه ایجاد نشده است." : "A wallet address has not been provisioned for this network.",
    legacyNotice: fa ? "این مبلغ از سوابق قدیمی کیف پول می‌آید و در موجودی‌های on-chain چندارزی محاسبه نمی‌شود." : "This amount comes from legacy wallet records and is not included in the new on-chain asset balances.",
    verification: fa ? "وضعیت اعتبارسنجی" : "Verification",
    reviewRequired: fa ? "نیازمند بررسی" : "Review required",
    balanceNote: fa ? "موجودی هر ارز و شبکه جداگانه نگهداری می‌شود؛ مبالغ ارزهای مختلف با هم جمع نمی‌شوند." : "Balances are maintained separately for each asset and network; different currencies are not added together.",
    family: fa ? "نوع شبکه" : "Network type",
    depositAdapter: fa ? "آمادگی فنی واریز" : "Deposit adapter",
    withdrawalAdapter: fa ? "آمادگی فنی برداشت" : "Withdrawal adapter",
    adapterReady: fa ? "پیاده‌سازی شده" : "Implemented",
    adapterNotReady: fa ? "هنوز آماده نیست" : "Not implemented",
    native: fa ? "دارایی بومی" : "Native asset",
    token: fa ? "توکن" : "Token",
    addressUnavailable: fa ? "آدرس تا زمان فعال شدن واریز نمایش داده نمی‌شود." : "The address is hidden until deposits are enabled.",
    provisioningReview: fa ? "وضعیت کیف پول قبلی نیازمند بررسی مدیریتی است. برای جلوگیری از ساخت کیف پول یا آدرس تکراری، عملیات جدید این حساب محدود شده است." : "This account has an incomplete legacy custody record that requires admin review. New wallet provisioning is restricted to avoid duplicate custody identities or addresses.",
    legacyDepositMode: fa ? "این واریز از مسیر قدیمی و فعال Polygon USDT0 انجام می‌شود؛ موتور عمومی چندشبکه‌ای برای این دارایی هنوز فعال نشده است." : "This deposit uses the existing Polygon USDT0 compatibility scanner. The new generic multi-chain engine is not enabled for this asset.",
    legacyTag: fa ? "مسیر قدیمی Polygon" : "Legacy Polygon path",
    chainHistory: fa ? "تاریخچهٔ تراکنش‌های بلاکچینی" : "On-chain activity",
    noChainActivity: fa ? "هنوز واریز یا برداشت بلاکچینی ثبت نشده است." : "No on-chain deposits or withdrawals yet.",
    requestSent: fa ? "درخواست برداشت ثبت شد و برای بررسی مدیر در صف قرار گرفت." : "Withdrawal request recorded and queued for admin review.",
    submitWithdrawal: fa ? "ثبت درخواست برداشت" : "Submit withdrawal request",
    withdrawalPending: fa ? "درخواست در انتظار بررسی مدیر است." : "The request is awaiting admin review.",
    invalidWithdrawalAmount: fa ? "مقدار را به‌صورت عدد اعشاری معتبر وارد کنید." : "Enter a valid decimal amount.",
    invalidWithdrawalAddress: fa ? "آدرس مقصد را وارد کنید." : "Enter the destination address.",
    requestFailed: fa ? "ثبت درخواست برداشت ناموفق بود. دوباره بررسی کنید." : "Could not submit the withdrawal request. Please review the details.",
    estimatedFee: fa ? "کارمزد تخمینی" : "Estimated fee",
  }), [fa]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await getWallet();
      setWallet(result);
      setError("");
      setSelectedNetworkId((current) =>
        result.networks.some((network) => network.id === current)
          ? current
          : result.networks[0]?.id ?? "",
      );
    } catch {
      setError(copy.error);
    } finally {
      setRefreshing(false);
    }
  }, [copy.error]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const selectedNetwork: WalletNetworkView | null =
    wallet?.networks.find((network) => network.id === selectedNetworkId) ??
    wallet?.networks[0] ??
    null;
  const selectedAsset: WalletAssetView | null =
    selectedNetwork?.assets.find((asset) => asset.id === selectedAssetId) ??
    selectedNetwork?.assets[0] ??
    null;
  const depositEnabled = Boolean(selectedAsset?.depositEnabled);
  const withdrawalEnabled = Boolean(selectedAsset?.withdrawalEnabled);

  const fmt = useCallback((value: string) => formatExactAmount(value, locale), [locale]);

  const submitWithdrawal = async () => {
    if (!selectedNetwork || !selectedAsset || !withdrawalEnabled || submittingWithdrawal) return;
    if (!/^\\d+(?:\\.\\d+)?$/.test(withdrawAmount.trim())) {
      setWithdrawalError(copy.invalidWithdrawalAmount);
      setWithdrawalFeedback("");
      return;
    }
    if (!withdrawAddress.trim()) {
      setWithdrawalError(copy.invalidWithdrawalAddress);
      setWithdrawalFeedback("");
      return;
    }

    setSubmittingWithdrawal(true);
    setWithdrawalError("");
    setWithdrawalFeedback("");
    try {
      const idempotencyKey = withdrawalIdempotencyKey || crypto.randomUUID();
      if (!withdrawalIdempotencyKey) setWithdrawalIdempotencyKey(idempotencyKey);
      const result = await requestWalletWithdrawal({
        networkId: selectedNetwork.id,
        assetId: selectedAsset.id,
        amount: withdrawAmount.trim(),
        destinationAddress: withdrawAddress.trim(),
        idempotencyKey,
      });
      setWithdrawalFeedback(copy.requestSent + " " + result.status);
      setWithdrawalIdempotencyKey("");
      setWithdrawAmount("");
      await refresh();
    } catch {
      setWithdrawalError(copy.requestFailed);
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const copyAddress = async () => {
    const address = selectedNetwork?.address;
    if (!address || !depositEnabled) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const networkStatus = (enabled: boolean) => enabled ? copy.enabled : copy.unavailable;

  return <div className="app-shell wallet-page">
    <header className="topbar">
      <button className="brand brand--home" type="button" aria-label={copy.title} onClick={() => onNavigate("home")}>
        <span className="brand-wallet">Wallet</span><span className="brand-find">Find</span>
      </button>
    </header>

    <main className="page wallet-exchange">
      <div className="wallet-page-heading">
        <div>
          <div className="section-title">{copy.title}</div>
          <p>{copy.balanceNote}</p>
        </div>
        <button type="button" className="wallet-refresh" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "…" : "↻"} {copy.refresh}
        </button>
      </div>

      {!wallet && !error && <div className="inline-feedback"><LoadingIndicator label={copy.loading} /></div>}
      {error && <p className="inline-feedback wallet-error" role="alert">{error}</p>}
      {wallet?.walletProvisioningReviewRequired && <div className="wallet-warning" role="status"><strong>⚠ {copy.reviewRequired}</strong><p>{copy.provisioningReview}</p></div>}

      {wallet && view === "overview" && <>
        <section className="wallet-exchange-balance">
          <div className="wallet-exchange-balance__top">
            <span>{copy.balance}</span>
            <span className="wallet-safe-pill">{wallet.networks.length} {fa ? "شبکه" : "networks"}</span>
          </div>
          <div className="wallet-exchange-balance__available">{copy.balanceNote}</div>
          <div className="wallet-exchange-actions">
            <button type="button" className="wallet-action wallet-action--deposit" onClick={() => setView("deposit")}>
              <span>↓</span>{copy.deposit}
            </button>
            <button type="button" className="wallet-action wallet-action--withdraw" onClick={() => setView("withdraw")}>
              <span>↑</span>{copy.withdraw}
            </button>
          </div>
        </section>

        {wallet.networks.length === 0 && <section className="wallet-network-card"><p>{copy.noNetworks}</p></section>}

        <section className="wallet-assets-list" aria-label={fa ? "دارایی‌های کیف پول" : "Wallet assets"}>
          {wallet.networks.map((network) => <div className="wallet-assets-network" key={network.id}>
            <div className="wallet-assets-network__heading">
              <h2>{network.displayName}</h2>
              <span>{network.assets.length} {fa ? "دارایی" : "assets"}</span>
            </div>
            {network.assets.length === 0
              ? <p className="wallet-deposit-minimum">{copy.noAssets}</p>
              : network.assets.map((asset) => {
                const expanded = expandedAssetId === asset.id;
                const assetStatus = asset.verificationStatus === "VERIFIED";
                return <article className={expanded ? "wallet-asset-item is-expanded" : "wallet-asset-item"} key={asset.id}>
                  <button
                    type="button"
                    className="wallet-asset-summary"
                    aria-expanded={expanded}
                    aria-controls={`wallet-asset-details-${asset.id}`}
                    onClick={() => setExpandedAssetId((current) => current === asset.id ? "" : asset.id)}
                  >
                    <span className="wallet-asset-symbol">{asset.symbol.slice(0, 4)}</span>
                    <span className="wallet-asset-main">
                      <strong>{asset.displayName}</strong>
                      <small>{asset.symbol} · {network.displayName}</small>
                    </span>
                    <span className="wallet-asset-balance">
                      <strong>{fmt(asset.availableBalance)}</strong>
                      <small>{fa ? "قابل استفاده" : "Available"}</small>
                    </span>
                    <span className={expanded ? "wallet-asset-chevron is-open" : "wallet-asset-chevron"} aria-hidden="true">⌄</span>
                  </button>
                  {expanded && <div className="wallet-asset-details" id={`wallet-asset-details-${asset.id}`}>
                    <div className="wallet-asset-detail-row">
                      <span>{copy.available}</span><strong>{fmt(asset.availableBalance)} {asset.symbol}</strong>
                    </div>
                    <div className="wallet-asset-detail-row">
                      <span>{copy.reserved}</span><strong>{fmt(asset.reservedBalance)} {asset.symbol}</strong>
                    </div>
                    <div className="wallet-asset-detail-row">
                      <span>{copy.network}</span><strong>{network.displayName}</strong>
                    </div>
                    <div className="wallet-asset-detail-row">
                      <span>{copy.status}</span>
                      <strong className={assetStatus ? "wallet-status-on" : "wallet-status-off"}>
                        {assetStatus ? copy.enabled : copy.reviewRequired}
                      </strong>
                    </div>
                    <div className="wallet-asset-detail-row">
                      <span>{copy.deposit}</span>
                      <strong className={asset.depositEnabled ? "wallet-status-on" : "wallet-status-off"}>{networkStatus(asset.depositEnabled)}</strong>
                    </div>
                    <div className="wallet-asset-detail-row">
                      <span>{copy.withdraw}</span>
                      <strong className={asset.withdrawalEnabled ? "wallet-status-on" : "wallet-status-off"}>{networkStatus(asset.withdrawalEnabled)}</strong>
                    </div>
                    {asset.contractAddress && <div className="wallet-asset-detail-row wallet-asset-detail-row--contract">
                      <span>{copy.contract}</span><code>{asset.contractAddress}</code>
                    </div>}
                    {asset.legacyDepositMode && <p className="wallet-deposit-minimum">{copy.legacyDepositMode}</p>}
                    <div className="wallet-asset-actions">
                      <button type="button" className="wallet-action wallet-action--deposit" disabled={!asset.depositEnabled || !network.address} onClick={() => {
                        setSelectedNetworkId(network.id);
                        setSelectedAssetId(asset.id);
                        setView("deposit");
                      }}><span>↓</span>{copy.deposit}</button>
                      <button type="button" className="wallet-action wallet-action--withdraw" disabled={!asset.withdrawalEnabled} onClick={() => {
                        setSelectedNetworkId(network.id);
                        setSelectedAssetId(asset.id);
                        setView("withdraw");
                      }}><span>↑</span>{copy.withdraw}</button>
                    </div>
                    {!network.address && <p className="wallet-deposit-minimum">{copy.noAddress}</p>}
                  </div>}
                </article>;
              })}
          </div>)}
        </section>

        <section className="wallet-network-card">
          <div className="wallet-card-heading"><h2>{fa ? "سوابق قدیمی" : "Legacy records"}</h2></div>
          <div className="wallet-network-row">
            <span>{fa ? "موجودی قدیمی" : "Legacy balance"}</span>
            <strong>{fmt(wallet.legacyBalance)} {wallet.currency}</strong>
          </div>
          <p className="wallet-deposit-minimum">{copy.legacyNotice}</p>
        </section>

        <section className="wallet-history wallet-exchange-history">
          <div className="wallet-card-heading"><h2>{copy.chainHistory}</h2></div>
          {wallet.onChainDeposits.length === 0 && wallet.onChainWithdrawals.length === 0
            ? <div className="wallet-empty"><p>{copy.noChainActivity}</p></div>
            : <div className="wallet-table">
                {[...wallet.onChainDeposits, ...wallet.onChainWithdrawals]
                  .sort((a, b) => new Date(b.detectedAt ?? b.requestedAt ?? 0).getTime() - new Date(a.detectedAt ?? a.requestedAt ?? 0).getTime())
                  .map((item) => <article className="wallet-transaction" key={item.id}>
                    <div>
                      <strong>{item.type} · {item.asset}</strong>
                      <small>{item.network} · {item.status}</small>
                    </div>
                    <small>{new Date(item.detectedAt ?? item.requestedAt ?? 0).toLocaleString(locale)}</small>
                    <b>{fmt(item.amount)} {item.asset}</b>
                    {item.transactionHash && <a href={item.explorerUrl ?? undefined} target="_blank" rel="noreferrer">{item.transactionHash.slice(0, 12)}…</a>}
                  </article>)}
              </div>}
        </section>

        <section className="wallet-history wallet-exchange-history">
          <div className="wallet-card-heading"><h2>{copy.history}</h2><span>{wallet.transactions.length}</span></div>
          {wallet.transactions.length === 0 ? <div className="wallet-empty"><span>↔</span><p>{copy.empty}</p></div> : <div className="wallet-table">
            <div className="wallet-table-head"><span>{copy.type}</span><span>{copy.date}</span><span>{copy.amountColumn}</span></div>
            {wallet.transactions.map((item) => <article className="wallet-transaction" key={item.id}>
              <div><strong>{item.type}</strong><small>{item.status}</small></div>
              <small>{new Date(item.createdAt).toLocaleString(locale)}</small>
              <b>{fmt(item.amount)} <small>{item.currency}</small></b>
            </article>)}
          </div>}
        </section>
      </>}

      {wallet && view === "deposit" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--deposit">↓</div>
        <h1>{copy.depositTitle}</h1>
        <p className="wallet-flow-intro">{copy.depositIntro}</p>

        <div className="wallet-form-field">
          <label>{copy.network}</label>
          <select className="wallet-select-static" value={selectedNetwork?.id ?? ""} onChange={(event) => {
            setSelectedNetworkId(event.target.value);
            setSelectedAssetId("");
            setCopied(false);
          }}>
            {wallet.networks.map((network) => <option value={network.id} key={network.id}>{network.displayName}</option>)}
          </select>
        </div>

        <div className="wallet-form-field">
          <label>{copy.asset}</label>
          <select className="wallet-select-static" value={selectedAsset?.id ?? ""} onChange={(event) => setSelectedAssetId(event.target.value)}>
            {(selectedNetwork?.assets ?? []).map((asset) => <option value={asset.id} key={asset.id}>{asset.displayName} ({asset.symbol})</option>)}
          </select>
        </div>

        <div className="wallet-network-row">
          <span>{copy.status}</span>
          <strong className={depositEnabled ? "wallet-status-on" : "wallet-status-off"}>{networkStatus(depositEnabled)}</strong>
        </div>

        {depositEnabled && selectedNetwork?.address ? <>
          <div className="wallet-deposit-address">
            <label>{copy.receiveAddress}</label>
            <code>{selectedNetwork.address}</code>
            <button type="button" onClick={() => void copyAddress()} disabled={copied}>
              {copied ? "✓ " + copy.copied : copy.copyAddress}
            </button>
          </div>
          {selectedNetwork.legacyDepositMode || selectedAsset?.legacyDepositMode ? <div className="wallet-warning"><strong>{copy.legacyTag}</strong><p>{copy.legacyDepositMode}</p></div> : null}
          <div className="wallet-network-row">
            <span>{copy.confirmations}</span><strong>{selectedAsset?.confirmationCount ?? selectedNetwork.finalityDepth}</strong>
          </div>
          {selectedAsset?.contractAddress
            ? <div className="wallet-deposit-address"><label>{copy.contract}</label><code>{selectedAsset.contractAddress}</code></div>
            : <p className="wallet-deposit-minimum">{copy.noContract}</p>}
          <div className="wallet-network-row">
            <span>{copy.minimum}</span>
            <strong>{selectedAsset?.minDeposit ?? copy.noMinimum} {selectedAsset?.minDeposit ? selectedAsset.symbol : ""}</strong>
          </div>
          <div className="wallet-warning"><strong>⚠ {fa ? "نکتهٔ مهم" : "Important"}</strong><p>{copy.depositWarning}</p></div>
          <button type="button" className="wallet-submit" disabled>{fa ? "منتظر شناسایی و تأیید واریز شبکه" : "Awaiting on-chain deposit detection"}</button>
        </> : <div className="wallet-warning">
          <strong>⚠ {copy.unavailable}</strong>
          <p>{copy.depositDisabled}</p>
          {!selectedNetwork?.address && <p>{copy.addressUnavailable}</p>}
        </div>}
      </section>}

      {wallet && view === "withdraw" && <section className="wallet-flow-card">
        <button type="button" className="wallet-back" onClick={() => setView("overview")}>← {copy.back}</button>
        <div className="wallet-flow-icon wallet-flow-icon--withdraw">↑</div>
        <h1>{copy.withdrawTitle}</h1>
        <p className="wallet-flow-intro">{copy.withdrawIntro}</p>

        <div className="wallet-form-field">
          <label>{copy.network}</label>
          <select className="wallet-select-static" value={selectedNetwork?.id ?? ""} onChange={(event) => setSelectedNetworkId(event.target.value)}>
            {wallet.networks.map((network) => <option value={network.id} key={network.id}>{network.displayName}</option>)}
          </select>
        </div>
        <div className="wallet-form-field">
          <label>{copy.asset}</label>
          <select className="wallet-select-static" value={selectedAsset?.id ?? ""} onChange={(event) => setSelectedAssetId(event.target.value)}>
            {(selectedNetwork?.assets ?? []).map((asset) => <option value={asset.id} key={asset.id}>{asset.displayName} ({asset.symbol})</option>)}
          </select>
        </div>
        <div className="wallet-form-field">
          <label>{copy.amount}</label>
          <div className="wallet-input-wrap">
            <input
              inputMode="decimal"
              value={withdrawAmount}
              onChange={(event) => setWithdrawAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              disabled={!withdrawalEnabled}
            />
            <span>{selectedAsset?.symbol ?? ""}</span>
          </div>
          <small>{copy.available}: {selectedAsset ? fmt(selectedAsset.availableBalance) + " " + selectedAsset.symbol : "—"}</small>
        </div>
        <div className="wallet-form-field">
          <label>{copy.destination}</label>
          <input
            className="wallet-address-input"
            value={withdrawAddress}
            onChange={(event) => setWithdrawAddress(event.target.value)}
            placeholder={selectedNetwork?.family === "EVM" ? "0x..." : ""}
            autoComplete="off"
            disabled={!withdrawalEnabled}
          />
        </div>
        <div className="wallet-fee-row"><span>{copy.fee}</span><strong>—</strong></div>
        <div className="wallet-fee-row"><span>{copy.youReceive}</span><strong>{withdrawAmount || "0"} {selectedAsset?.symbol ?? ""}</strong></div>
        {withdrawalEnabled ? <div className="wallet-warning">
          <strong>{copy.estimatedFee}</strong>
          <p>{copy.withdrawalPending}</p>
        </div> : <div className="wallet-warning">
          <strong>⚠ {copy.unavailable}</strong>
          <p>{copy.withdrawDisabled}</p>
        </div>}
        {withdrawalError && <p className="inline-feedback wallet-error" role="alert">{withdrawalError}</p>}
        {withdrawalFeedback && <p className="inline-feedback" role="status">{withdrawalFeedback}</p>}
        <button
          type="button"
          className="wallet-submit"
          disabled={!withdrawalEnabled || submittingWithdrawal || !withdrawAmount.trim() || !withdrawAddress.trim()}
          onClick={() => void submitWithdrawal()}
        >
          {submittingWithdrawal ? "…" : copy.submitWithdrawal}
        </button>
      </section>}
    </main>
    <BottomNav activePage="wallet" onNavigate={onNavigate} />
  </div>;
}
