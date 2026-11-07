import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useI18n } from "../i18n";
import { getAdminPanelCopy } from "../i18n/admin-panel-overrides";
import {
  getAdminAuditLogs,
  getAdminOverview,
  getAdminProjectProfitPool,
  provisionPrizeTreasuryWallet,
  getPrizeTreasuryWallet,
  getTreasuryPrizeFunding,
  allocateTreasuryPrizeFunding,
  reconcileTreasuryAccounting,
  type TreasuryPrizeFundingSnapshot,
  type PrizeTreasuryProvisionResult,
  getAdminUsers,
  getAdminWalletAccounts,
  getAdminWalletAccountTransactions,
  type AdminWalletAccount,
  type AdminWalletAccountHistory,
  getAdminSourceVisitReport,
  getActiveContest,
  getSystemSettings,
  saveSystemSetting,
  type AdminAuditLog,
  type AdminOverview,
  type AdminProjectProfitPool,
  type AdminUserSummary,
  type AdminSourceVisitReport,
  type SystemSettingRecord,
} from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";
import { CHALLENGE_LANGUAGES, getChallengeLanguageName, isChallengeLanguage, type ChallengeLanguage } from "../i18n/challenge-languages";

type AdminDestination = "home" | "admin-manage";

type Props = { onNavigate: (page: AdminDestination) => void };
type Section = "overview" | "users" | "finance" | "prizes" | "ads" | "security" | "support" | "wallets" | "settings" | "audit";

const DEFAULT_EN_SOURCES = ["https://en.wikipedia.org/w/api.php", "https://www.gutenberg.org/cache/epub/11/pg11.txt", "https://www.gutenberg.org/cache/epub/1342/pg1342.txt", "https://www.gutenberg.org/cache/epub/84/pg84.txt", "https://www.gutenberg.org/cache/epub/1661/pg1661.txt", "https://en.wikipedia.org/wiki/Artificial_intelligence", "https://en.wikipedia.org/wiki/Paris", "https://en.wikipedia.org/wiki/Albert_Einstein", "https://en.wikipedia.org/wiki/History_of_science"];
const DEFAULT_FA_SOURCES = ["https://fa.wikipedia.org/w/api.php", "https://fa.wikipedia.org/wiki/ایران", "https://fa.wikipedia.org/wiki/تهران", "https://fa.wikipedia.org/wiki/فردوسی", "https://fa.wikipedia.org/wiki/شاهنامه", "https://fa.wikipedia.org/wiki/هوش_مصنوعی"];
const DEFAULT_OTHER_SOURCES: Partial<Record<ChallengeLanguage, string[]>> = Object.fromEntries(CHALLENGE_LANGUAGES.filter(({ code }) => code !== "fa" && code !== "en").map(({ code }) => [code, ["https://" + (code === "zh-CN" ? "zh" : code) + ".wikipedia.org/w/api.php"]]));
function sourceHostname(value: string): string {
  try { return new URL(value).hostname; } catch { return value; }
}

const CHALLENGE_INTERVAL_MS = 15 * 60_000;

type ChallengeScheduleAnchor = {
  challengeNumber: number;
  startsAt: string;
};

function formatLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const localDate = new Date(timestamp - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function challengeNumberForDateTime(
  value: string,
  anchor: ChallengeScheduleAnchor | null,
): number | null {
  if (!value || !anchor) return null;
  const selectedMs = new Date(value).getTime();
  const anchorMs = new Date(anchor.startsAt).getTime();
  if (!Number.isFinite(selectedMs) || !Number.isFinite(anchorMs)) return null;
  const difference = selectedMs - anchorMs;
  if (difference < CHALLENGE_INTERVAL_MS || difference % CHALLENGE_INTERVAL_MS !== 0) return null;
  return anchor.challengeNumber + difference / CHALLENGE_INTERVAL_MS;
}

function dateTimeForChallengeNumber(
  value: string,
  anchor: ChallengeScheduleAnchor | null,
): string {
  if (!value || !anchor) return "";
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= anchor.challengeNumber) return "";
  const anchorMs = new Date(anchor.startsAt).getTime();
  if (!Number.isFinite(anchorMs)) return "";
  return formatLocalDateTimeInput(anchorMs + (number - anchor.challengeNumber) * CHALLENGE_INTERVAL_MS);
}

type ScheduledSourceAssignment = {
  id: string;
  language: ChallengeLanguage;
  url: string;
  challengeNumber: number;
  startsAt: string;
  sequence: number;
};

function parseScheduledSourceAssignments(value: string | undefined): ScheduledSourceAssignment[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ScheduledSourceAssignment => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<ScheduledSourceAssignment>;
      const start = typeof row.startsAt === "string" ? Date.parse(row.startsAt) : Number.NaN;
      return typeof row.id === "string" &&
        isChallengeLanguage(row.language) &&
        typeof row.url === "string" && row.url.startsWith("https://") &&
        Number.isInteger(row.challengeNumber) && Number(row.challengeNumber) > 0 &&
        Number.isFinite(start) && Number.isInteger(row.sequence) &&
        Number(row.sequence) >= 1 && Number(row.sequence) <= 12;
    });
  } catch { return []; }
}
function parseSourceUrls(value: string | undefined, fallback: string[]): string[] {
  if (!value) return [...fallback];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.startsWith("https://")))] : [...fallback];
  } catch { return [...fallback]; }
}

function formatDuration(milliseconds: number, fa: boolean): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const result = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return fa ? result.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]) : result;
}

export default function AdminControlCenter({ onNavigate }: Props) {
  const { language } = useI18n();
  const fa = language === "fa";
  const [section, setSection] = useState<Section>("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [projectProfitPool, setProjectProfitPool] = useState<AdminProjectProfitPool | null>(null);
  const [settings, setSettings] = useState<SystemSettingRecord[]>([]);
  const [treasury, setTreasury] = useState<PrizeTreasuryProvisionResult | null>(null);
  const [treasuryLoading, setTreasuryLoading] = useState(false);
  const [treasuryFunding, setTreasuryFunding] = useState<TreasuryPrizeFundingSnapshot | null>(null);
  const [treasuryFundingLoading, setTreasuryFundingLoading] = useState(false);
  const [treasuryFundingError, setTreasuryFundingError] = useState(false);
  const [treasuryReconciling, setTreasuryReconciling] = useState(false);
  const [treasuryAllocationAmount, setTreasuryAllocationAmount] = useState("");
  const [treasuryAllocating, setTreasuryAllocating] = useState(false);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [walletAccounts, setWalletAccounts] = useState<AdminWalletAccount[]>([]);
  const [walletAccountsLoading, setWalletAccountsLoading] = useState(false);
  const [walletAccountsError, setWalletAccountsError] = useState("");
  const [walletAccountSearch, setWalletAccountSearch] = useState("");
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [walletHistory, setWalletHistory] = useState<AdminWalletAccountHistory | null>(null);
  const [walletHistoryLoading, setWalletHistoryLoading] = useState(false);
  const [walletHistoryError, setWalletHistoryError] = useState("");
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [sourceVisitReport, setSourceVisitReport] = useState<AdminSourceVisitReport | null>(null);
  const [sourceVisitLoading, setSourceVisitLoading] = useState(false);
  const [sourceVisitError, setSourceVisitError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [sourceUrlsEn, setSourceUrlsEn] = useState<string[]>(DEFAULT_EN_SOURCES);
  const [sourceUrlsFa, setSourceUrlsFa] = useState<string[]>(DEFAULT_FA_SOURCES);
  const [sourceDraftEn, setSourceDraftEn] = useState("");
  const [sourceDraftFa, setSourceDraftFa] = useState("");
  const [sourceUrlsOther, setSourceUrlsOther] = useState<Partial<Record<ChallengeLanguage, string[]>>>({});
  const [sourceDraftOther, setSourceDraftOther] = useState<Partial<Record<ChallengeLanguage, string>>>({});
  const [scheduledSources, setScheduledSources] = useState<ScheduledSourceAssignment[]>([]);
  const [scheduledSourceUrl, setScheduledSourceUrl] = useState("");
  const [scheduledSourceLanguage, setScheduledSourceLanguage] = useState<ChallengeLanguage>("en");
  const [scheduledChallengeNumber, setScheduledChallengeNumber] = useState("");
  const [scheduledChallengeStart, setScheduledChallengeStart] = useState("");
  const [scheduledClueSequence, setScheduledClueSequence] = useState("1");
  const [challengeScheduleAnchor, setChallengeScheduleAnchor] = useState<ChallengeScheduleAnchor | null>(null);
  const [challengeScheduleLoading, setChallengeScheduleLoading] = useState(false);
  const [challengeScheduleUnavailable, setChallengeScheduleUnavailable] = useState(false);

  const copy = {
    title: fa ? "مرکز کنترل Wallet-Find" : "Wallet-Find Control Center",
    subtitle: fa ? "مدیریت مرکزی سایت، تنظیمات و رویدادهای مدیریتی" : "Central administration for site settings and operational activity",
    overview: fa ? "نمای کلی" : "Overview",
    usersTab: fa ? "مدیریت کاربران" : "Users",
    finance: fa ? "کیف پول و تراکنش‌ها" : "Wallets & Transactions",
    prizes: fa ? "صندوق جوایز و تسویه" : "Prize pool & settlement",
    ads: fa ? "تبلیغات و اسپانسرها" : "Ads & sponsors",
    security: fa ? "امنیت و ضدتقلب" : "Security & anti-fraud",
    support: fa ? "پشتیبانی و گزارش‌ها" : "Support & reports",
    settings: fa ? "تنظیمات سایت" : "Site settings",
    wallets: fa ? "خزانه و جوایز" : "Treasury & Prizes",
    treasuryTitle: fa ? "خزانه اصلی جوایز (Polygon)" : "Main prize treasury (Polygon)",
    treasuryLiveBalance: fa ? "موجودی واقعی خزانه (USDT0)" : "Live treasury balance (USDT0)",
    treasuryDepositTitle: fa ? "واریزهای خزانه" : "Treasury deposits",
    treasuryDepositHelp: fa ? "واریزها به‌صورت خودکار از بلاک‌چین شناسایی می‌شوند. پس از ۱۲۸ تأیید شبکه، دفتر حسابداری خزانه به‌روزرسانی می‌شود." : "Deposits are detected automatically from Polygon. Treasury accounting is credited after 128 network confirmations.",
    treasuryNoDeposits: fa ? "هنوز واریزی برای خزانه شناسایی نشده است." : "No treasury deposits detected yet.",
    treasuryDepositRefresh: fa ? "به‌روزرسانی واریزها" : "Refresh deposits",
    treasuryDepositAmount: fa ? "مبلغ" : "Amount",
    treasuryDepositStatus: fa ? "وضعیت" : "Status",
    treasuryDepositConfirmations: fa ? "تأییدها" : "Confirmations",
    treasuryDepositDate: fa ? "زمان شناسایی" : "Detected",
    treasuryDepositError: fa ? "دریافت تاریخچه واریزهای خزانه ناموفق بود." : "Could not load treasury deposit history.",
    treasuryNetworkInstruction: fa ? "فقط USDT0 روی شبکه Polygon PoS به این آدرس ارسال شود. از شبکه‌های دیگر استفاده نکن." : "Send only USDT0 on Polygon PoS to this address. Do not use another network.",
    treasuryContract: fa ? "قرارداد توکن USDT0" : "USDT0 token contract",
    treasuryAllocated: fa ? "تخصیص‌یافته به صندوق جوایز" : "Allocated to prize fund",
    treasuryFree: fa ? "موجودی آزاد خزانه" : "Unallocated treasury balance",
    internalPrizeBalance: fa ? "موجودی داخلی صندوق جوایز" : "Internal prize fund balance",
    fundingAmount: fa ? "مبلغ تخصیص (USDT)" : "Allocation amount (USDT)",
    allocateFunding: fa ? "تخصیص به صندوق جوایز" : "Allocate to prize fund",
    fundingHelp: fa ? "آدرس زیر تنها آدرس واریز بلاک‌چینی است. صندوق جوایز حساب داخلی است؛ تخصیص فقط ثبت حسابداری است و انتقالی روی بلاک‌چین انجام نمی‌دهد." : "The treasury address below is the only on-chain deposit address. The prize fund is an internal ledger; allocation is accounting only and makes no blockchain transfer.",
    treasuryHelp: fa ? "این عملیات یک کیف پول مستقل برای نگهداری جوایز در Turnkey ایجاد می‌کند. فعلاً هیچ وجهی منتقل نمی‌شود و قابلیت برداشت یا امضای تراکنش فعال نمی‌شود." : "This creates a dedicated Turnkey wallet for prize funds. No funds are transferred and signing or withdrawals are not enabled.",
    treasuryCreate: fa ? "ساخت خزانه Polygon" : "Create Polygon treasury",
    treasuryCreating: fa ? "در حال ساخت خزانه…" : "Creating treasury…",
    treasuryCreated: fa ? "خزانه با موفقیت ساخته شد." : "Treasury created successfully.",
    treasuryExisting: fa ? "خزانه از قبل وجود داشت؛ همان آدرس بازیابی شد." : "An existing treasury was found; its address was returned.",
    treasuryAddress: fa ? "آدرس عمومی خزانه" : "Treasury public address",
    treasuryWalletId: fa ? "شناسه کیف پول Turnkey" : "Turnkey wallet ID",
    treasuryStatus: fa ? "وضعیت" : "Status",
    treasuryError: fa ? "ساخت خزانه ناموفق بود. تنظیمات Turnkey و گزارش سرور را بررسی کن." : "Treasury creation failed. Check Turnkey configuration and server logs.",
    treasuryInProgress: fa ? "ساخت خزانه در حال انجام است؛ کمی بعد دوباره وضعیت را بررسی کن." : "Treasury creation is in progress; check again shortly.",
    treasuryNeedsReview: fa ? "وضعیت ساخت قبلی نیازمند بررسی دستی است؛ دوباره تلاش نکن." : "A previous creation attempt needs manual review; do not retry.",
    turnkeyNotConfigured: fa ? "تنظیمات اتصال Turnkey روی سرور کامل نیست." : "Turnkey is not fully configured on the server.",
    walletBalance: fa ? "موجودی ثبت‌شده" : "Recorded balance",
    walletAvailable: fa ? "موجودی قابل برداشت" : "Available balance",
    pendingDeposits: fa ? "واریزهای در انتظار" : "Pending deposits",
    pendingWithdrawals: fa ? "برداشت‌های در انتظار" : "Pending withdrawals",
    noWallets: fa ? "کاربری برای نمایش وجود ندارد." : "No users to display.",
    walletNote: fa ? "فقط تراکنش‌های واقعی و تأییدشده باید در این فهرست موجودی ایجاد کنند؛ واریز و برداشت شبکه هنوز فعال نیست." : "Only real, verified transactions may create balances; on-chain deposits and withdrawals are not operational yet.",
    audit: fa ? "گزارش فعالیت‌ها" : "Activity log",
    users: fa ? "کاربران" : "Users",
    userEmail: fa ? "ایمیل" : "Email",
    userCreated: fa ? "تاریخ ساخت حساب" : "Account created",
    userBalance: fa ? "موجودی کیف پول" : "Wallet balance",
    userParticipation: fa ? "تعداد چالش‌های شرکت‌شده" : "Challenges joined",
    userCompleted: fa ? "دورهای تکمیل‌شده" : "Rounds completed",
    userBestTime: fa ? "بهترین زمان تکمیل دور" : "Best round completion time",
    userSearchPlaceholder: fa ? "جست‌وجو با ایمیل یا نام کاربری…" : "Search by email or username…",
    noMatchingUsers: fa ? "کاربری با این مشخصات پیدا نشد." : "No users match this search.",
    notAvailable: fa ? "ثبت نشده" : "Not recorded",
    contests: fa ? "چالش‌های ثبت‌شده" : "Challenges",
    active: fa ? "چالش فعال" : "Active challenges",
    submissions: fa ? "پاسخ‌های ثبت‌شده" : "Answer submissions",
    adOrders: fa ? "سفارش‌های تبلیغاتی" : "Ad orders",
    pendingPayments: fa ? "پرداخت‌های تبلیغاتی در انتظار" : "Pending ad payments",
    reload: fa ? "به‌روزرسانی اطلاعات" : "Refresh data",
    newSetting: fa ? "افزودن تنظیم" : "Add setting",
    keyLabel: fa ? "کلید تنظیم (انگلیسی و بدون فاصله)" : "Setting key (English, no spaces)",
    valueLabel: fa ? "مقدار" : "Value",
    save: fa ? "ذخیره" : "Save setting",
    saving: fa ? "در حال ذخیره…" : "Saving…",
    saved: fa ? "تنظیم ذخیره شد." : "Setting saved.",
    empty: fa ? "هنوز تنظیمی ثبت نشده است." : "No settings have been saved yet.",
    noLogs: fa ? "هنوز رویداد مدیریتی ثبت نشده است." : "No administrative events found.",
    action: fa ? "عملیات" : "Action",
    entity: fa ? "بخش" : "Area",
    actor: fa ? "انجام‌دهنده" : "Actor",
    date: fa ? "زمان" : "Time",
    modules: fa ? "بخش‌های قابل توسعه" : "Control modules",
    sponsors: fa ? "اسپانسرها" : "Sponsors",
    planned: fa ? "در مراحل بعدی پیاده‌سازی می‌شود" : "Planned for a later implementation phase",
    back: fa ? "بازگشت به سایت" : "Back to site",
    loading: fa ? "در حال دریافت اطلاعات…" : "Loading dashboard…",
    refreshError: fa ? "دریافت اطلاعات ناموفق بود. دسترسی مدیر و اتصال سرور را بررسی کن." : "Could not load dashboard data. Check admin access and server connectivity.",
    keyError: fa ? "کلید باید با حرف انگلیسی شروع شود و فقط شامل حروف، عدد، نقطه، خط تیره یا زیرخط باشد." : "Key must start with a letter and contain only letters, numbers, dots, dashes or underscores.",
    poolTitle: fa ? "صندوق کلی جایزهٔ آزمایشی" : "Simulated global prize fund",
    poolHelp: fa ? "روزانه ۵۰ USDT فرضی به‌عنوان واریزی اسپانسرها و سرمایه‌گذاران ثبت می‌شود؛ ۵٪ بلافاصله به صندوق سود سهام پروژه و ۹۵٪ به صندوق کلی می‌رود. در شروع هر دور، ۱٪ موجودی صندوق کلی به آن دور اختصاص می‌یابد. اگر هیچ‌کس در دور پاسخی ثبت نکند، کل تخصیص استفاده‌نشده به صندوق کلی بازمی‌گردد." : "A simulated 50 USDT sponsor/investor contribution is recorded each UTC day; 5% immediately goes to the project dividend fund and 95% to the global fund. At each round's start, 1% of the global balance is allocated to that round. If nobody submits an answer, the unused allocation returns to the global fund.",
    poolFixed: fa ? "واریزی روزانه: ۵۰ USDT فرضی · سهم صندوق سهام: ۵٪ · تخصیص هر دور: ۱٪ موجودی صندوق کلی" : "Daily contribution: 50 simulated USDT · Dividend share: 5% · Each round: 1% of global balance",
    poolFixedError: fa ? "شارژ روزانه و درصد تخصیص هر دور طبق قواعد آزمایشی ثابت است." : "Daily funding and the per-round allocation are fixed by the test model.",
    challengeAnchorProtected: fa ? "مبنای شماره‌گذاری چالش‌ها تنظیم داخلی سیستم است و از این فرم قابل تغییر نیست." : "The challenge numbering anchor is an internal setting and cannot be changed here.",
    conceptTitle: fa ? "بخش در حال طراحی" : "Module concept",
    conceptBody: fa ? "این بخش فعلاً فقط به‌عنوان جایگاه در پنل مدیریت اضافه شده است. قابلیت‌ها و عملیات آن در مراحل بعدی، جداگانه طراحی و پیاده‌سازی می‌شوند." : "This section is currently a placeholder in the admin panel. Its tools and workflows will be designed and implemented separately in later phases.",
    usersBody: fa ? "جست‌وجو و مشاهدهٔ کاربران، نقش‌ها، وضعیت حساب، تأیید ایمیل و محدودیت‌های دسترسی." : "Search users, review roles and account status, email verification, and access restrictions.",
    financeBody: fa ? "بررسی تراکنش‌ها، درخواست‌های واریز و برداشت، دفترکل و مغایرت‌های مالی." : "Review transactions, deposit and withdrawal requests, the ledger, and financial discrepancies.",
    prizesBody: fa ? "مشاهدهٔ صندوق کلی، تخصیص ۱٪ به هر دور، جوایز ثبت‌شده و کنترل مدیریتی صندوق سود سهام پروژه." : "Inspect the global fund, 1% per-round allocations, participant awards, and admin-only project dividend fund.",
    projectProfitTitle: fa ? "صندوق سود سهام پروژه (فقط مدیر)" : "Project dividend fund (admin only)",
    projectProfitBalance: fa ? "موجودی فعلی صندوق" : "Current fund balance",
    projectProfitTotal: fa ? "مجموع سهم‌های واریزشده" : "Total contribution shares",
    projectProfitLedger: fa ? "آخرین ثبت‌های صندوق" : "Recent fund ledger entries",
    projectProfitEmpty: fa ? "هنوز ثبت مالی برای این صندوق وجود ندارد." : "No ledger entries for this fund yet.",
    simulatedFundsNote: fa ? "این مبالغ آزمایشی‌اند؛ انتقال واقعی USDT انجام نمی‌شود." : "These are simulated amounts; no real USDT is transferred.",
    adsBody: fa ? "منابع فعال ساخت سرنخ برای هر زبان را ببین، آدرس منابع جدید اضافه کن یا منابع را حذف کن. منابع سفارشی باید صفحهٔ HTTPS عمومی و دارای متن قابل خواندن باشند." : "Review enabled clue sources for each language, add source URLs, or remove sources. Custom sources must be public HTTPS pages with readable text.",
    sourceEn: fa ? "منابع چالش انگلیسی" : "English challenge sources",
    sourceFa: fa ? "منابع چالش فارسی" : "Persian challenge sources",
    addSource: fa ? "افزودن منبع" : "Add source",
    saveSources: fa ? "ذخیره منابع" : "Save sources",
    removeSource: fa ? "حذف" : "Remove",
    sourceUrl: fa ? "آدرس کامل منبع HTTPS" : "Full HTTPS source URL",
    sourceSaved: fa ? "فهرست منابع ذخیره شد؛ در ساخت دورهای بعدی استفاده می‌شود." : "Source lists saved. They will be used for future rounds.",
    scheduledSourcesTitle: fa ? "پیوند منابع برای چالش‌های آینده" : "Source links for future challenges",
    scheduledSourcesHelp: fa ? "برای هر پیوند، شمارهٔ چالش آینده، زمان شروع و خانه‌ای را مشخص کن که پاسخ آن از همین منبع ساخته شود. زمان باید روی مرز ۱۵ دقیقه‌ای باشد و شمارهٔ چالش با شماره‌گذاری واقعی همان زمان مطابقت داشته باشد؛ فقط در صورت تطبیق هر دو مقدار، منبع اعمال می‌شود." : "For each link, choose the future challenge number, start time, and clue cell that must use this source. The start must align to a 15-minute boundary, and the challenge number must match the actual round number at that time; the assignment is applied only when both match.",
    scheduledSourceUrl: fa ? "لینک منبع HTTPS" : "HTTPS source link",
    scheduledChallengeNumber: fa ? "شماره چالش آینده" : "Future challenge number",
    scheduledChallengeStart: fa ? "تاریخ و ساعت شروع چالش" : "Challenge start date and time",
    scheduledClueSequence: fa ? "شماره خانه (۱ تا ۱۲)" : "Clue cell (1–12)",
    challengeScheduleHelp: fa ? "شماره و زمان برگزاری بر اساس چالش فعال و فاصلهٔ ثابت ۱۵ دقیقه‌ای محاسبه می‌شوند. تغییر هرکدام، مورد دیگر را خودکار به‌روزرسانی می‌کند." : "The challenge number and start time are calculated from the active challenge using the fixed 15-minute interval. Changing either field automatically updates the other.",
    challengeScheduleLoading: fa ? "در حال دریافت زمان‌بندی چالش فعال…" : "Loading the active challenge schedule…",
    challengeScheduleUnavailable: fa ? "زمان‌بندی چالش فعال دریافت نشد؛ همگام‌سازی خودکار موقتاً در دسترس نیست. پنل را به‌روزرسانی کن." : "Could not load the active challenge schedule, so automatic syncing is unavailable. Refresh the admin panel.",
    challengeScheduleReference: fa ? "مبنای محاسبه" : "Schedule reference",
    scheduledSourceLanguage: fa ? "زبان منبع" : "Source language",
    addScheduledSource: fa ? "افزودن لینک زمان‌بندی‌شده" : "Add scheduled source link",
    saveScheduledSources: fa ? "ذخیره زمان‌بندی منابع" : "Save source schedule",
    scheduledSourceSaved: fa ? "زمان‌بندی پیوندهای منابع ذخیره شد." : "Scheduled source links saved.",
    removeScheduledSource: fa ? "حذف پیوند برنامه‌ریزی‌شده" : "Remove scheduled link",
    noScheduledSources: fa ? "هنوز پیوندی برای چالش‌های آینده زمان‌بندی نشده است." : "No source links are scheduled for future challenges.",
    invalidScheduledSource: fa ? "لینک باید معتبر و با HTTPS شروع شود." : "Enter a valid HTTPS source link.",
    invalidScheduledChallenge: fa ? "شمارهٔ چالش باید عددی صحیح و بزرگ‌تر از شمارهٔ چالش فعال باشد." : "Challenge number must be a whole number greater than the active challenge number.",
    invalidScheduledSequence: fa ? "شماره خانه باید بین ۱ تا ۱۲ باشد." : "Clue cell must be between 1 and 12.",
    invalidScheduledStart: fa ? "زمان شروع باید در آینده و دقیقاً روی مرز ۱۵ دقیقه‌ای باشد (مثلاً 12:00، 12:15 یا 12:30)." : "Start time must be in the future and exactly on a 15-minute boundary (for example, 12:00, 12:15, or 12:30).",
    duplicateScheduledSource: fa ? "برای همین زبان، چالش و خانه قبلاً منبعی ثبت شده است." : "A source is already assigned to this language, challenge and clue cell.",
    invalidSource: fa ? "آدرس باید معتبر و با https:// شروع شود." : "Enter a valid URL beginning with https://.",
    noSources: fa ? "منبعی ثبت نشده است." : "No sources configured.",
    securityBody: fa ? "بررسی فعالیت مشکوک، تلاش‌های ورود، گزارش‌های ضدتقلب، مسدودسازی و کنترل دسترسی مدیران." : "Review suspicious activity, login attempts, anti-fraud alerts, account restrictions, and administrator access.",
    supportBody: fa ? "گزارش کلیک‌های خروجی از لینک منبع چالش برای ارزیابی اسپانسرها و تبلیغ‌دهندگان." : "Review outbound clicks from challenge source links for sponsor and advertiser reporting.",
    sourceReportTitle: fa ? "گزارش کلیک روی لینک‌های منبع" : "Challenge source-link click report",
    sourceReportHelp: fa ? "آمار کلی تمام رکوردهای ثبت‌شده و جزئیات ۵۰۰ کلیک اخیر را مشاهده کن. برای هر کاربر و هر خانه فقط یک کلیک شمرده می‌شود." : "Review lifetime totals and the 500 most recent click records. Each user is counted at most once per clue.",
    sourceReportError: fa ? "دریافت گزارش کلیک‌ها ناموفق بود؛ دسترسی مدیر و اتصال سرور را بررسی کن." : "Could not load click reporting. Check admin access and server connectivity.",
    sourceReportLoading: fa ? "در حال دریافت گزارش کلیک‌ها…" : "Loading click report…",
    refreshSourceReport: fa ? "به‌روزرسانی گزارش" : "Refresh report",
    exportSourceReport: fa ? "خروجی CSV برای اسپانسر" : "Export CSV for sponsor",
    totalSourceClicks: fa ? "کل کلیک‌های ثبت‌شده" : "Tracked source clicks",
    uniqueSourceVisitors: fa ? "کاربران یکتای کلیک‌کننده" : "Unique users clicking",
    advertiserSourceClicks: fa ? "کلیک‌های منتسب به سفارش تبلیغاتی" : "Advertiser-attributed clicks",
    advertiserSourceVisitors: fa ? "کاربران یکتای لینک تبلیغ‌دهنده" : "Unique visitors to advertiser links",
    partnerConfirmedVisits: fa ? "بازدید تأییدشده توسط تبلیغ‌دهنده" : "Advertiser-confirmed landings",
    pendingExternalVisits: fa ? "در انتظار تأیید API تبلیغ‌دهنده" : "Awaiting advertiser API confirmation",
    notConfiguredExternalVisits: fa ? "بدون اتصال API تبلیغ‌دهنده" : "Not yet connected to advertiser API",
    rejectedExternalVisits: fa ? "بازدید تأییدنشده/ردشده" : "Rejected external confirmations",
    verificationStatus: fa ? "وضعیت تأیید مقصد" : "External verification status",
    verificationConfirmed: fa ? "تأییدشده توسط تبلیغ‌دهنده" : "Confirmed by advertiser",
    verificationPending: fa ? "در انتظار تأیید" : "Pending confirmation",
    verificationNotConfigured: fa ? "API هنوز متصل نشده" : "API not configured yet",
    verificationRejected: fa ? "ردشده" : "Rejected",
    verificationTime: fa ? "زمان تأیید مقصد" : "External confirmation time",
    verificationProvider: fa ? "روش/سرویس تأیید" : "Verification provider/method",
    verificationReference: fa ? "شناسه مرجع تبلیغ‌دهنده" : "Advertiser reference ID",
    verificationHelp: fa ? "فقط رکوردهایی که پس از اتصال امن API تبلیغ‌دهنده وضعیت «تأییدشده» بگیرند، بازدید خارجی تأییدشده محسوب می‌شوند. تا قبل از دریافت مستندات و دسترسی API، این شمارنده‌ها جایگزین آمار کلیک نیستند." : "Only records marked confirmed after a secure advertiser API integration count as verified external landings. Until the API specification and access are supplied, these counters are not a substitute for click totals.",
    destinationPerformanceTitle: fa ? "آمار به تفکیک لینک مقصد" : "Performance by destination link",
    noDestinationPerformance: fa ? "هنوز کلیکی ثبت نشده است." : "No destination clicks have been recorded yet.",
    destinationRowsLimit: fa ? "۱۰۰ مقصد با بیشترین کلیک نمایش داده می‌شود." : "Showing the 100 destinations with the most clicks.",
    advertiserPerformance: fa ? "عملکرد لینک‌های منتسب به تبلیغ‌دهنده" : "Advertiser-attributed link performance",
    recentSourceVisits: fa ? "آخرین کلیک‌های ثبت‌شده" : "Recent tracked clicks",
    noSourceVisits: fa ? "هنوز کلیکی از لینک منبع ثبت نشده است." : "No source-link clicks have been recorded yet.",
    noAdvertiserVisits: fa ? "هنوز کلیکی به یک سفارش تبلیغاتی فعال منتسب نشده است. لینک‌ها فقط وقتی منتسب می‌شوند که منبع چالش به محتوای تبلیغ‌دهنده و مقصد متناظر آن متصل باشد." : "No clicks have been attributed to an active ad order yet. Attribution requires the clue to be linked to advertiser content whose destination matches the source URL.",
    reportUsername: fa ? "نام کاربری" : "Username",
    reportUserId: fa ? "شناسه کاربر" : "User ID",
    reportChallenge: fa ? "چالش" : "Challenge",
    reportLanguage: fa ? "زبان" : "Language",
    reportClue: fa ? "خانه" : "Clue",
    reportDestination: fa ? "مقصد" : "Destination",
    reportAdvertiser: fa ? "تبلیغ‌دهنده" : "Advertiser",
    reportClickTime: fa ? "زمان کلیک" : "Click time",
    reportAdOrder: fa ? "شناسه سفارش" : "Ad order",
    reportClickCount: fa ? "تعداد کلیک" : "Clicks",
    reportUniqueVisitors: fa ? "کاربران یکتا" : "Unique visitors",
    reportOrderStatus: fa ? "وضعیت سفارش" : "Order status",
    reportNoAdvertiser: fa ? "بدون انتساب تبلیغ‌دهنده" : "Not advertiser-attributed",
    reportProofNote: fa ? "این گزارش زمان و کاربرِ کلیک ثبت‌شده روی لینک داخل Wallet-Find را نشان می‌دهد. به‌تنهایی اثبات نمی‌کند که سایت خارجی کامل بارگذاری شده یا کاربر آن را مشاهده کرده است. ایمیل و نشانی IP برای این گزارش ذخیره نمی‌شود." : "This report records the user and time of a click on a Wallet-Find link. It does not independently prove that the external page fully loaded or was viewed. Email addresses and IP addresses are not stored for this report.",
    reportLimitNotice: fa ? "مجموع‌ها مربوط به کل سابقه هستند؛ فهرست و فایل CSV شامل حداکثر ۵۰۰ رکورد اخیر است." : "Totals cover all recorded history; the list and CSV include up to the 500 most recent records.",
    ...getAdminPanelCopy(language),
  };

  const loadSourceVisitReport = useCallback(async () => {
    setSourceVisitLoading(true);
    setSourceVisitError("");
    try {
      const report = await getAdminSourceVisitReport();
      setSourceVisitReport(report);
    } catch {
      setSourceVisitError(copy.sourceReportError);
    } finally {
      setSourceVisitLoading(false);
    }
  }, [copy.sourceReportError]);

  useEffect(() => {
    if (section !== "support") return;
    const timer = window.setTimeout(() => {
      void loadSourceVisitReport();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [section, loadSourceVisitReport]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [stats, settingRows, auditRows, userRows, profitPool] = await Promise.all([
        getAdminOverview(),
        getSystemSettings(),
        getAdminAuditLogs(),
        getAdminUsers(),
        getAdminProjectProfitPool(),
      ]);
      setOverview(stats);
      setSettings(settingRows);
      setSourceUrlsEn(parseSourceUrls(settingRows.find((setting) => setting.key === "clue_sources_en")?.value, DEFAULT_EN_SOURCES));
      setSourceUrlsFa(parseSourceUrls(settingRows.find((setting) => setting.key === "clue_sources_fa")?.value, DEFAULT_FA_SOURCES));
      setSourceUrlsOther(Object.fromEntries(CHALLENGE_LANGUAGES.filter(({ code }) => code !== "fa" && code !== "en").map(({ code }) => [
        code,
        parseSourceUrls(settingRows.find((setting) => setting.key === ("clue_sources_" + code))?.value, DEFAULT_OTHER_SOURCES[code] ?? []),
      ])));
      setScheduledSources(parseScheduledSourceAssignments(settingRows.find((setting) => setting.key === "scheduled_clue_sources")?.value));
      setLogs(auditRows);
      setUsers(userRows);
      setProjectProfitPool(profitPool);
    } catch {
      setError(copy.refreshError);
    } finally {
      setLoading(false);
    }
  }, [copy.refreshError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (section !== "wallets") return;
    let cancelled = false;
    let interval: number | undefined;
    const refresh = async () => {
      setTreasuryFundingLoading(true);
      try {
        const snapshot = await getTreasuryPrizeFunding();
        if (!cancelled) {
          setTreasuryFunding(snapshot);
          setTreasuryFundingError(false);
        }
      } catch {
        if (!cancelled) setTreasuryFundingError(true);
      } finally {
        if (!cancelled) setTreasuryFundingLoading(false);
      }
    };
    const timer = window.setTimeout(() => {
      getPrizeTreasuryWallet()
        .then((result) => { if (!cancelled) setTreasury(result); })
        .catch(() => { if (!cancelled) setTreasury(null); });
      void refresh();
      interval = window.setInterval(() => { void refresh(); }, 30_000);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [section]);

  useEffect(() => {
    if (section !== "ads") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setChallengeScheduleAnchor(null);
      setChallengeScheduleUnavailable(false);
      setChallengeScheduleLoading(true);
      // Avoid carrying a date/number calculated for the previous language's rounds.
      setScheduledChallengeNumber("");
      setScheduledChallengeStart("");

      getActiveContest(scheduledSourceLanguage)
        .then((contest) => {
          if (cancelled) return;
          if (contest.challengeNumber && contest.startsAt) {
            setChallengeScheduleAnchor({
              challengeNumber: contest.challengeNumber,
              startsAt: contest.startsAt,
            });
          } else {
            setChallengeScheduleUnavailable(true);
          }
        })
        .catch(() => {
          if (!cancelled) setChallengeScheduleUnavailable(true);
        })
        .finally(() => {
          if (!cancelled) setChallengeScheduleLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scheduledSourceLanguage, section]);

  function handleScheduledChallengeStartChange(value: string) {
    setScheduledChallengeStart(value);
    const challengeNumber = challengeNumberForDateTime(value, challengeScheduleAnchor);
    setScheduledChallengeNumber(challengeNumber === null ? "" : String(challengeNumber));
    setError("");
    setNotice("");
  }

  function handleScheduledChallengeNumberChange(value: string) {
    setScheduledChallengeNumber(value);
    setScheduledChallengeStart(dateTimeForChallengeNumber(value, challengeScheduleAnchor));
    setError("");
    setNotice("");
  }

  async function handleProvisionTreasury() {
    setTreasuryLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await provisionPrizeTreasuryWallet();
      setTreasury(result);
      setNotice(result.created ? copy.treasuryCreated : copy.treasuryExisting);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "TREASURY_CREATION_IN_PROGRESS" ? copy.treasuryInProgress :
        code === "TREASURY_CREATION_REQUIRES_REVIEW" ? copy.treasuryNeedsReview :
        code === "TURNKEY_NOT_CONFIGURED" ? copy.turnkeyNotConfigured : copy.treasuryError);
    } finally {
      setTreasuryLoading(false);
    }
  }

  async function handleTreasuryReconciliation() {
    setTreasuryReconciling(true);
    setError("");
    setNotice("");
    try {
      const result = await reconcileTreasuryAccounting();
      const snapshot = await getTreasuryPrizeFunding();
      setTreasuryFunding(snapshot);
      setTreasuryFundingError(false);
      setNotice(result.status === "MATCH"
        ? (fa ? "تطبیق خزانه موفق بود؛ موجودی شبکه و دفتر حسابداری برابرند." : "Treasury reconciliation passed; on-chain and ledger balances match.")
        : (fa ? "اختلاف حسابداری خزانه شناسایی شد؛ تا بررسی و اصلاح مجاز، تخصیص جایزه مسدود است." : "Treasury accounting mismatch detected; prize allocation is blocked pending review."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (fa ? "تطبیق خزانه ناموفق بود." : "Treasury reconciliation failed."));
    } finally {
      setTreasuryReconciling(false);
    }
  }

  async function handleTreasuryPrizeAllocation(event: FormEvent) {
    event.preventDefault();
    const amount = treasuryAllocationAmount.trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      setError(fa ? "مبلغ معتبر با حداکثر ۶ رقم اعشار وارد کن." : "Enter a valid amount with up to 6 decimal places.");
      return;
    }
    if (!treasuryFunding || treasuryFunding.accountingStatus !== "MATCH") {
      setError(fa ? "ابتدا باید تطبیق حسابداری خزانه موفق باشد." : "Treasury accounting must be reconciled before allocation.");
      return;
    }
    if (Number(amount) > Number(treasuryFunding.unallocatedTreasuryBalance)) {
      setError(fa ? "مبلغ از موجودی آزاد خزانه بیشتر است." : "The amount exceeds the unallocated treasury balance.");
      return;
    }
    setTreasuryAllocating(true);
    setError("");
    setNotice("");
    try {
      const snapshot = await allocateTreasuryPrizeFunding(amount);
      setTreasuryFunding(snapshot);
      setTreasuryFundingError(false);
      setTreasuryAllocationAmount("");
      setNotice(fa
        ? `تخصیص ${Number(snapshot.amount).toLocaleString("fa-IR", { maximumFractionDigits: 6 })} USDT به صندوق جوایز با موفقیت ثبت شد.`
        : `Successfully allocated ${snapshot.amount} USDT to the prize fund.`);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "TREASURY_ACCOUNTING_MISMATCH"
        ? (fa ? "تطبیق حسابداری خزانه معتبر نیست؛ تخصیص انجام نشد." : "Treasury accounting is not matched; no allocation was made.")
        : code === "INSUFFICIENT_UNALLOCATED_TREASURY_BALANCE" || code === "INSUFFICIENT_TREASURY_BALANCE"
          ? (fa ? "موجودی آزاد خزانه برای این مبلغ کافی نیست." : "Insufficient unallocated treasury balance.")
          : code === "INVALID_ALLOCATION_AMOUNT"
            ? (fa ? "مبلغ تخصیص معتبر نیست." : "The allocation amount is invalid.")
            : (fa ? "تخصیص به صندوق جوایز ناموفق بود." : "Prize fund allocation failed."));
    } finally {
      setTreasuryAllocating(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const normalizedKey = key.trim();
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(normalizedKey)) {
      setError(copy.keyError);
      return;
    }
    if (normalizedKey === "hypothetical_prize_pool_per_round") {
      setError(copy.poolFixedError);
      return;
    }
    if (normalizedKey.startsWith("challenge_schedule_anchor_")) {
      setError(copy.challengeAnchorProtected);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveSystemSetting(normalizedKey, value);
      setNotice(copy.saved);
      setKey("");
      setValue("");
      await load();
    } catch {
      setError(copy.refreshError);
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(setting: SystemSettingRecord) {
    const edited = window.prompt(fa ? "مقدار جدید برای " + setting.key : "New value for " + setting.key, setting.value);
    if (edited === null || edited === setting.value) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveSystemSetting(setting.key, edited);
      setNotice(copy.saved);
      await load();
    } catch {
      setError(copy.refreshError);
    } finally {
      setSaving(false);
    }
  }

  function updateSourceDraft(language: ChallengeLanguage, draft: string) {
    if (language === "fa") setSourceDraftFa(draft);
    else if (language === "en") setSourceDraftEn(draft);
    else setSourceDraftOther((current) => ({ ...current, [language]: draft }));
  }

  function removeSource(language: ChallengeLanguage, url: string) {
    if (language === "fa") setSourceUrlsFa((current) => current.filter((item) => item !== url));
    else if (language === "en") setSourceUrlsEn((current) => current.filter((item) => item !== url));
    else setSourceUrlsOther((current) => ({ ...current, [language]: (current[language] ?? []).filter((item) => item !== url) }));
  }

  function addSource(language: ChallengeLanguage) {
    const draft = (language === "fa"
      ? sourceDraftFa
      : language === "en"
        ? sourceDraftEn
        : sourceDraftOther[language] ?? "").trim();
    try {
      const parsed = new URL(draft);
      if (parsed.protocol !== "https:" || draft.length > 500) throw new Error("invalid");
    } catch {
      setError(copy.invalidSource);
      return;
    }
    if (language === "fa") {
      if (!sourceUrlsFa.includes(draft)) setSourceUrlsFa((current) => [...current, draft]);
    } else if (language === "en") {
      if (!sourceUrlsEn.includes(draft)) setSourceUrlsEn((current) => [...current, draft]);
    } else {
      setSourceUrlsOther((current) => ({ ...current, [language]: [...(current[language] ?? DEFAULT_OTHER_SOURCES[language] ?? []), draft].filter((url, index, all) => all.indexOf(url) === index) }));
    }
    updateSourceDraft(language, "");
    setError("");
    setNotice("");
  }

  function addScheduledSource(event: FormEvent) {
    event.preventDefault();
    const url = scheduledSourceUrl.trim();
    const challengeNumber = Number(scheduledChallengeNumber);
    const sequence = Number(scheduledClueSequence);
    const startsAtDate = new Date(scheduledChallengeStart);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || url.length > 500) throw new Error("INVALID_URL");
    } catch {
      setError(copy.invalidScheduledSource);
      return;
    }
    if (!challengeScheduleAnchor) {
      setError(copy.challengeScheduleUnavailable);
      return;
    }
    if (!Number.isInteger(challengeNumber) || challengeNumber <= challengeScheduleAnchor.challengeNumber) {
      setError(copy.invalidScheduledChallenge);
      return;
    }
    if (
      !scheduledChallengeStart ||
      Number.isNaN(startsAtDate.getTime()) ||
      startsAtDate.getTime() <= Date.now() ||
      startsAtDate.getTime() % CHALLENGE_INTERVAL_MS !== 0
    ) {
      setError(copy.invalidScheduledStart);
      return;
    }
    const derivedChallengeNumber = challengeNumberForDateTime(scheduledChallengeStart, challengeScheduleAnchor);
    if (derivedChallengeNumber === null || derivedChallengeNumber !== challengeNumber) {
      setError(copy.invalidScheduledStart);
      return;
    }
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 12) {
      setError(copy.invalidScheduledSequence);
      return;
    }
    const startsAt = startsAtDate.toISOString();
    const duplicate = scheduledSources.some((item) =>
      item.language === scheduledSourceLanguage &&
      item.challengeNumber === challengeNumber &&
      item.startsAt === startsAt &&
      item.sequence === sequence
    );
    if (duplicate) {
      setError(copy.duplicateScheduledSource);
      return;
    }
    setScheduledSources((current) => [...current, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      language: scheduledSourceLanguage,
      url,
      challengeNumber,
      startsAt,
      sequence,
    }].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.challengeNumber - b.challengeNumber || a.sequence - b.sequence));
    setScheduledSourceUrl("");
    setError("");
    setNotice("");
  }

  async function saveScheduledSources() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveSystemSetting("scheduled_clue_sources", JSON.stringify(scheduledSources));
      setNotice(copy.scheduledSourceSaved);
      await load();
    } catch {
      setError(copy.refreshError);
    } finally {
      setSaving(false);
    }
  }

  async function saveSources(language: ChallengeLanguage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const urls = language === "fa"
        ? sourceUrlsFa
        : language === "en"
          ? sourceUrlsEn
          : sourceUrlsOther[language] ?? DEFAULT_OTHER_SOURCES[language] ?? [];
      await saveSystemSetting("clue_sources_" + language, JSON.stringify(urls));
      setNotice(copy.sourceSaved);
      await load();
    } catch {
      setError(copy.refreshError);
    } finally {
      setSaving(false);
    }
  }

  function exportSourceVisitReportCsv() {
    if (!sourceVisitReport) return;
    const escapeCsv = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const headers = [
      "click_time",
      "username",
      "user_id",
      "challenge_title",
      "challenge_language",
      "challenge_start",
      "clue_number",
      "destination_url",
      "destination_host",
      "advertiser",
      "advertisement_order_id",
      "external_verification_status",
      "external_confirmed_at",
      "external_verification_provider",
      "external_reference_id",
    ];
    const rows = sourceVisitReport.recentVisits.map((visit) => [
      visit.createdAt,
      visit.username,
      visit.userId,
      visit.contestTitle,
      visit.contestLanguage,
      visit.contestStartsAt,
      visit.clueSequence,
      visit.sourceUrl,
      visit.sourceHostname,
      visit.advertiserName,
      visit.advertisementOrderId,
      visit.externalVerificationStatus,
      visit.externalConfirmedAt,
      visit.externalVerificationProvider,
      visit.externalReferenceId,
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `wallet-find-source-visits-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  const visibleSettings = settings.filter((setting) => setting.key !== "hypothetical_prize_pool_per_round" && !setting.key.startsWith("challenge_schedule_anchor_"));

  const metricCards = overview ? [
    { label: copy.users, value: overview.users, icon: "◎" },
    { label: copy.contests, value: overview.contests, icon: "▦" },
    { label: copy.active, value: overview.activeContests, icon: "●" },
    { label: copy.submissions, value: overview.submissions, icon: "⌁" },
    { label: copy.adOrders, value: overview.advertiserOrders, icon: "▤" },
    { label: copy.pendingPayments, value: overview.pendingAdPayments, icon: "◷" },
  ] : [];

  return (
    <div className="app-shell admin-center-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" onClick={() => onNavigate("home")} aria-label={copy.back}>
          <span className="brand-dot" />
          <span>Wallet Find <small>{fa ? "مدیریت" : "ADMIN"}</small></span>
        </button>
      </header>
      <main className="page admin-center">
        <div className="admin-center__heading">
          <div>
            <div className="eyebrow">WALLET-FIND / CONTROL</div>
            <h1 className="page-title">{copy.title}</h1>
            <p className="date">{copy.subtitle}</p>
          </div>
          <button className="admin-refresh" type="button" onClick={() => void load()} disabled={loading}>↻</button>
        </div>

        <nav className="admin-center__tabs" aria-label={copy.title}>
          {([
            ["overview", copy.overview],
            ["users", copy.usersTab],
            ["wallets", copy.wallets],
            ["finance", copy.finance],
            ["prizes", copy.prizes],
            ["ads", copy.ads],
            ["security", copy.security],
            ["support", copy.support],
            ["settings", copy.settings],
            ["audit", copy.audit],
          ] as [Section, string][]).map(([item, label]) => (
            <button key={item} type="button" className={section === item ? "is-active" : ""} onClick={() => setSection(item)}>
              {label}
            </button>
          ))}
        </nav>

        {error && <div className="admin-message admin-message--error" role="alert">{error}</div>}
        {notice && <div className="admin-message" role="status">{notice}</div>}
        {loading && !overview ? <div className="admin-empty"><LoadingIndicator label={copy.loading} /></div> : null}

        {section === "overview" && (
          <>
            <section className="admin-metrics-grid">
              {metricCards.map((card) => (
                <article className="admin-metric-card" key={card.label}>
                  <span className="admin-metric-card__icon">{card.icon}</span>
                  <span className="admin-metric-card__label">{card.label}</span>
                  <strong>{card.value.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
                </article>
              ))}
            </section>
            <h2 className="section-title">{copy.modules}</h2>
            <section className="admin-module-grid">
              {[
                { icon: "◈", label: copy.finance },
                { icon: "✦", label: copy.sponsors },
                { icon: "▣", label: copy.ads },
                { icon: "⌑", label: copy.security },
              ].map((module) => (
                <article className="admin-module-card" key={module.label}>
                  <span>{module.icon}</span>
                  <strong>{module.label}</strong>
                  <small>{copy.planned}</small>
                </article>
              ))}
            </section>
            {overview?.generatedAt && <p className="admin-footnote">{fa ? "آخرین بروزرسانی: " : "Last refreshed: "}{new Date(overview.generatedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</p>}
          </>
        )}

        {section === "users" && (
          <section className="admin-panel">
            <h2>{copy.usersTab} ({users.length.toLocaleString(fa ? "fa-IR" : "en-US")})</h2>
            <input className="admin-user-search" type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder={copy.userSearchPlaceholder} aria-label={copy.userSearchPlaceholder} />
            {users.filter((user) => { const query = userSearch.trim().toLocaleLowerCase(); return !query || user.email.toLocaleLowerCase().includes(query) || user.username.toLocaleLowerCase().includes(query); }).length === 0 ? <p className="admin-empty">{copy.noMatchingUsers}</p> : (
              <div className="admin-settings-list">
                {users.filter((user) => { const query = userSearch.trim().toLocaleLowerCase(); return !query || user.email.toLocaleLowerCase().includes(query) || user.username.toLocaleLowerCase().includes(query); }).map((user) => (
                  <article className="admin-setting-row admin-user-row" key={user.id}>
                    <div className="admin-user-row__details">
                      <strong>{user.username} <small>({user.role})</small></strong>
                      <small>{copy.userEmail}: {user.email}</small>
                      <small>{copy.userCreated}: {new Date(user.createdAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>
                      <small>{copy.userBalance}: {Number(user.walletBalance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT</small>
                      <small>{copy.walletAvailable}: {Number(user.availableBalance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT</small>
                      <small>{copy.userParticipation}: {user.contestsParticipated.toLocaleString(fa ? "fa-IR" : "en-US")}</small>
                      <small>{copy.userCompleted}: {user.completedContests.toLocaleString(fa ? "fa-IR" : "en-US")}</small>
                      <small>{copy.userBestTime}: {user.bestCompletionTimeMs === null ? copy.notAvailable : formatDuration(user.bestCompletionTimeMs, fa)}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {section === "ads" && (
          <section className="admin-panel">
            <h2>{copy.ads}</h2>
            <p className="admin-footnote">{copy.adsBody}</p>
            <div className="admin-setting-form">
              <h3>{copy.scheduledSourcesTitle}</h3>
              <p className="admin-footnote">{copy.scheduledSourcesHelp}</p>
              <form onSubmit={addScheduledSource}>
                <label>{copy.scheduledSourceUrl}
                  <input type="url" value={scheduledSourceUrl} onChange={(event) => setScheduledSourceUrl(event.target.value)} placeholder="https://..." required />
                </label>
                <label>{copy.scheduledSourceLanguage}
                  <select value={scheduledSourceLanguage} onChange={(event) => {
                    const selected = event.target.value;
                    if (isChallengeLanguage(selected)) setScheduledSourceLanguage(selected);
                  }}>
                    {CHALLENGE_LANGUAGES.map(({ code, nativeName }) => <option key={code} value={code}>{nativeName}</option>)}
                  </select>
                </label>
                <p className="admin-footnote">{copy.challengeScheduleHelp}</p>
                {challengeScheduleLoading && <p className="admin-footnote">{copy.challengeScheduleLoading}</p>}
                {challengeScheduleUnavailable && <p className="admin-message admin-message--error" role="alert">{copy.challengeScheduleUnavailable}</p>}
                {challengeScheduleAnchor && (
                  <p className="admin-footnote">
                    {copy.challengeScheduleReference}: {fa ? "چالش" : "Challenge"} {challengeScheduleAnchor.challengeNumber.toLocaleString(fa ? "fa-IR" : "en-US")} · {new Date(challengeScheduleAnchor.startsAt).toLocaleString(fa ? "fa-IR" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                )}
                <label>{copy.scheduledChallengeNumber}
                  <input
                    type="number"
                    min={challengeScheduleAnchor ? challengeScheduleAnchor.challengeNumber + 1 : 1}
                    max={1000000}
                    step={1}
                    value={scheduledChallengeNumber}
                    onChange={(event) => handleScheduledChallengeNumberChange(event.target.value)}
                    required
                    disabled={!challengeScheduleAnchor || challengeScheduleLoading}
                  />
                </label>
                <label>{copy.scheduledChallengeStart}
                  <input
                    type="datetime-local"
                    step={900}
                    value={scheduledChallengeStart}
                    onChange={(event) => handleScheduledChallengeStartChange(event.target.value)}
                    required
                    disabled={!challengeScheduleAnchor || challengeScheduleLoading}
                  />
                </label>
                <label>{copy.scheduledClueSequence}
                  <select value={scheduledClueSequence} onChange={(event) => setScheduledClueSequence(event.target.value)}>
                    {Array.from({ length: 12 }, (_, index) => (
                      <option key={index + 1} value={String(index + 1)}>{(index + 1).toLocaleString(fa ? "fa-IR" : "en-US")}</option>
                    ))}
                  </select>
                </label>
                <button className="cta-button" type="submit" disabled={saving || challengeScheduleLoading || !challengeScheduleAnchor}>{copy.addScheduledSource}</button>
              </form>
              {scheduledSources.length === 0 ? <p className="admin-empty">{copy.noScheduledSources}</p> : (
                <div className="admin-settings-list">
                  {scheduledSources.map((item) => (
                    <article className="admin-setting-row" key={item.id}>
                      <div>
                        <strong>{getChallengeLanguageName(item.language)} · {fa ? "چالش" : "Challenge"} {item.challengeNumber.toLocaleString(fa ? "fa-IR" : "en-US")} · {fa ? "خانه" : "Cell"} {item.sequence.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
                        <small>{new Date(item.startsAt).toLocaleString(fa ? "fa-IR" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</small>
                        <code>{item.url}</code>
                      </div>
                      <button type="button" onClick={() => { setScheduledSources((current) => current.filter((entry) => entry.id !== item.id)); setError(""); setNotice(""); }} disabled={saving}>{copy.removeScheduledSource}</button>
                    </article>
                  ))}
                </div>
              )}
              <button className="cta-button" type="button" onClick={() => void saveScheduledSources()} disabled={saving}>{saving ? copy.saving : copy.saveScheduledSources}</button>
            </div>
            {CHALLENGE_LANGUAGES.map(({ code, nativeName }) => {
              const urls = code === "en"
                ? sourceUrlsEn
                : code === "fa"
                  ? sourceUrlsFa
                  : sourceUrlsOther[code] ?? DEFAULT_OTHER_SOURCES[code] ?? [];
              const draft = code === "en"
                ? sourceDraftEn
                : code === "fa"
                  ? sourceDraftFa
                  : sourceDraftOther[code] ?? "";
              return (
                <div className="admin-setting-form" key={code}>
                  <h3>{nativeName}</h3>
                  <form onSubmit={(event) => { event.preventDefault(); addSource(code); }}>
                    <label>{copy.sourceUrl}<input type="url" value={draft} onChange={(event) => updateSourceDraft(code, event.target.value)} placeholder="https://..." /></label>
                    <button className="cta-button" type="submit" disabled={saving}>{copy.addSource}</button>
                  </form>
                  {urls.length === 0 ? <p className="admin-empty">{copy.noSources}</p> : (
                    <div className="admin-settings-list">
                      {urls.map((url) => (
                        <article className="admin-setting-row" key={url}>
                          <div><strong>{sourceHostname(url)}</strong><code>{url}</code></div>
                          <button type="button" onClick={() => removeSource(code, url)} disabled={saving}>{copy.removeSource}</button>
                        </article>
                      ))}
                    </div>
                  )}
                  <button className="cta-button" type="button" onClick={() => void saveSources(code)} disabled={saving}>{saving ? copy.saving : copy.saveSources}</button>
                </div>
              );
            })}
          </section>
        )}

        {section === "prizes" && (
          <section className="admin-panel">
            <h2>{copy.projectProfitTitle}</h2>
            <p className="admin-footnote">{copy.simulatedFundsNote}</p>
            <div className="admin-metrics-grid">
              <article className="admin-metric-card">
                <span className="admin-metric-card__label">{copy.projectProfitBalance}</span>
                <strong>{projectProfitPool ? Number(projectProfitPool.balance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + " USDT" : "—"}</strong>
              </article>
              <article className="admin-metric-card">
                <span className="admin-metric-card__label">{copy.projectProfitTotal}</span>
                <strong>{projectProfitPool ? Number(projectProfitPool.totalContributed).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + " USDT" : "—"}</strong>
              </article>
            </div>
            <h3>{copy.projectProfitLedger}</h3>
            {!projectProfitPool || projectProfitPool.ledger.length === 0 ? <p className="admin-empty">{copy.projectProfitEmpty}</p> : (
              <div className="admin-settings-list">
                {projectProfitPool.ledger.map((entry) => (
                  <article className="admin-setting-row" key={entry.id}>
                    <div>
                      <strong>{Number(entry.amount).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT</strong>
                      <small>{fa ? "سهم ۵٪ از واریزی اسپانسر/سرمایه‌گذار" : entry.type} · {new Date(entry.effectiveAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>
                      <small>{fa ? "انتقال خودکار سهم صندوق سود سهام؛ این مبلغ آزمایشی است و انتقال واقعی انجام نشده." : entry.note}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {section === "finance" && (
          <section className="admin-panel admin-user-wallets">
            <div className="admin-user-wallets__heading">
              <div>
                <h2>{fa ? "کیف پول‌های کاربران" : "User Wallets"}</h2>
                <p className="admin-footnote">{fa ? "کیف پول‌های ایجادشده برای کاربران و سوابق واقعی ثبت‌شده در دفترکل و شبکه‌ها." : "Provisioned user wallets and their recorded ledger and on-chain activity."}</p>
              </div>
              <button type="button" onClick={() => { setSelectedWalletId(""); setWalletHistory(null); void loadWalletAccounts(); }} disabled={walletAccountsLoading}>
                {walletAccountsLoading ? (fa ? "در حال دریافت…" : "Loading…") : (fa ? "به‌روزرسانی" : "Refresh")}
              </button>
            </div>

            <input
              className="admin-user-search"
              type="search"
              value={walletAccountSearch}
              onChange={(event) => setWalletAccountSearch(event.target.value)}
              placeholder={fa ? "جست‌وجوی نام، ایمیل یا آدرس کیف پول" : "Search username, email, or wallet address"}
              aria-label={fa ? "جست‌وجوی کیف پول کاربران" : "Search user wallets"}
            />

            {walletAccountsLoading && walletAccounts.length === 0 && <div className="admin-empty"><LoadingIndicator label={fa ? "در حال دریافت کیف پول‌ها…" : "Loading wallets…"} /></div>}
            {walletAccountsError && <div className="admin-message admin-message--error" role="alert">{walletAccountsError}</div>}
            {!walletAccountsLoading && !walletAccountsError && walletAccounts.length === 0 && (
              <p className="admin-empty">{fa ? "هنوز کیف پولی برای کاربران ایجاد نشده است." : "No user wallets have been created yet."}</p>
            )}

            {walletAccounts.filter((wallet) => {
              const query = walletAccountSearch.trim().toLocaleLowerCase();
              return !query || wallet.username.toLocaleLowerCase().includes(query) ||
                wallet.email.toLocaleLowerCase().includes(query) || wallet.address.toLocaleLowerCase().includes(query) ||
                wallet.addresses.some((address) => address.address.toLocaleLowerCase().includes(query));
            }).map((wallet) => (
              <article className="admin-user-wallet-card" key={wallet.id}>
                <div className="admin-user-wallet-card__top">
                  <div className="admin-user-wallet-card__owner">
                    <strong>{wallet.username}</strong>
                    <small>{wallet.email}</small>
                  </div>
                  <span className={wallet.status === "ACTIVE" ? "is-active" : "is-inactive"}>{wallet.status}</span>
                </div>
                <div className="admin-user-wallet-card__address">
                  <span>{fa ? "آدرس اصلی کیف پول" : "Primary wallet address"}</span>
                  <code>{wallet.address}</code>
                </div>
                {wallet.addresses.length > 0 && (
                  <div className="admin-user-wallet-card__networks">
                    {wallet.addresses.map((address) => (
                      <div key={address.id}>
                        <span>{address.network.displayName}{address.network.chainId ? " · " + address.network.chainId : ""}</span>
                        <code>{address.address}</code>
                      </div>
                    ))}
                  </div>
                )}
                <div className="admin-user-wallet-card__metrics">
                  <span>{fa ? "شبکه‌ها" : "Networks"}: {wallet.networkAccounts.length}</span>
                  <span>{fa ? "واریزها" : "Deposits"}: {wallet.counts.chainDeposits + wallet.counts.deposits}</span>
                  <span>{fa ? "برداشت‌ها" : "Withdrawals"}: {wallet.counts.chainWithdrawals + wallet.counts.withdrawals}</span>
                </div>
                {wallet.balances.length > 0 ? (
                  <div className="admin-user-wallet-card__balances">
                    {wallet.balances.map((balance) => (
                      <div key={balance.networkId + ":" + balance.assetId}>
                        <span>{balance.network} · {balance.asset}</span>
                        <strong>{Number(balance.total).toLocaleString(fa ? "fa-IR" : "en-US", { maximumFractionDigits: 8 })}</strong>
                        <small>{fa ? "قابل برداشت" : "Available"}: {balance.available} · {fa ? "رزرو" : "Reserved"}: {balance.reserved}</small>
                      </div>
                    ))}
                  </div>
                ) : <p className="admin-footnote">{fa ? "برای این کیف پول هنوز موجودی در دفترکل جدید ثبت نشده است." : "No posted balance is recorded in the current wallet ledger yet."}</p>}
                <button className="admin-user-wallet-card__history-button" type="button" onClick={() => void openWalletHistory(wallet.id)}>
                  {fa ? "مشاهده تراکنش‌های این کیف پول" : "View this wallet's transactions"}
                </button>
              </article>
            ))}

            {selectedWalletId && (
              <section className="admin-wallet-history">
                <div className="admin-user-wallets__heading">
                  <div>
                    <h3>{fa ? "سوابق اختصاصی کیف پول" : "Wallet Transaction History"}</h3>
                    {walletHistory && <p className="admin-footnote">{walletHistory.wallet.username} · {walletHistory.wallet.email}</p>}
                  </div>
                  <button type="button" onClick={() => { setSelectedWalletId(""); setWalletHistory(null); setWalletHistoryError(""); }}>
                    {fa ? "بستن سوابق" : "Close history"}
                  </button>
                </div>
                {walletHistoryLoading && <div className="admin-empty"><LoadingIndicator label={fa ? "در حال دریافت سوابق تراکنش‌ها…" : "Loading transaction history…"} /></div>}
                {walletHistoryError && <div className="admin-message admin-message--error" role="alert">{walletHistoryError}</div>}
                {walletHistory && (
                  <>
                    <div className="admin-user-wallet-card__address">
                      <span>{fa ? "آدرس کیف پول" : "Wallet address"}</span>
                      <code>{walletHistory.wallet.address}</code>
                    </div>
                    {walletHistory.balances.length > 0 && (
                      <div className="admin-user-wallet-card__balances">
                        {walletHistory.balances.map((balance) => (
                          <div key={balance.networkId + ":" + balance.assetId}>
                            <span>{balance.network} · {balance.asset}</span>
                            <strong>{balance.total}</strong>
                            <small>{fa ? "قابل استفاده" : "Available"}: {balance.available} · {fa ? "رزرو" : "Reserved"}: {balance.reserved}</small>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="admin-footnote">{fa ? "تعداد رکوردهای نمایش‌داده‌شده: " : "Records shown: "}{walletHistory.transactionCount.toLocaleString(fa ? "fa-IR" : "en-US")} · {fa ? "شامل رویدادهای زنجیره‌ای و دفترکل داخلی." : "Includes on-chain events and internal ledger entries."}</p>
                    {walletHistory.transactions.length === 0 ? (
                      <p className="admin-empty">{fa ? "برای این کیف پول هنوز تراکنشی ثبت نشده است." : "No transactions are recorded for this wallet yet."}</p>
                    ) : (
                      <div className="admin-wallet-history__list">
                        {walletHistory.transactions.map((transaction) => (
                          <article className="admin-wallet-history__item" key={transaction.id}>
                            <div className="admin-wallet-history__item-heading">
                              <strong>{transaction.type} · {transaction.asset}</strong>
                              <span>{transaction.status}</span>
                            </div>
                            <div className="admin-wallet-history__item-meta">
                              <span>{transaction.network ?? (fa ? "دفترکل داخلی" : "Internal ledger")}</span>
                              <span>{new Date(transaction.createdAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</span>
                            </div>
                            <strong className="admin-wallet-history__amount">{transaction.amount} {transaction.asset}</strong>
                            {transaction.fee && <small>{fa ? "کارمزد" : "Fee"}: {transaction.fee}</small>}
                            {transaction.transactionHash && (
                              <div className="admin-wallet-history__hash">
                                <small>{fa ? "هش تراکنش" : "Transaction hash"}</small>
                                {transaction.explorerUrl
                                  ? <a href={transaction.explorerUrl} target="_blank" rel="noreferrer">{transaction.transactionHash}</a>
                                  : <code>{transaction.transactionHash}</code>}
                              </div>
                            )}
                            {transaction.destinationAddress && <small>{fa ? "مقصد" : "Destination"}: <code>{transaction.destinationAddress}</code></small>}
                            {transaction.confirmations !== null && <small>{fa ? "تأییدیه‌ها" : "Confirmations"}: {transaction.confirmations}</small>}
                            {transaction.note && <small className="admin-wallet-history__note">{transaction.note}</small>}
                            <small>{fa ? "منبع رکورد" : "Record source"}: {transaction.source}</small>
                          </article>
                        ))}
                      </div>
                    )}
                    <p className="admin-footnote">{fa ? "آخرین به‌روزرسانی: " : "Last updated: "}{new Date(walletHistory.generatedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</p>
                  </>
                )}
              </section>
            )}
          </section>
        )}

        {section === "security" && (
          <section className="admin-panel">
            <h2>{copy.security}</h2>
            <p>{copy.conceptTitle}</p>
            <p className="admin-footnote">{copy.securityBody}</p>
            <p className="admin-footnote">{copy.conceptBody}</p>
          </section>
        )}

        {section === "support" && (
          <section className="admin-panel admin-source-report">
            <div className="admin-source-report__heading">
              <div>
                <h2>{copy.sourceReportTitle}</h2>
                <p className="admin-footnote">{copy.sourceReportHelp}</p>
              </div>
              <div className="admin-source-report__actions">
                <button className="admin-refresh" type="button" onClick={() => void loadSourceVisitReport()} disabled={sourceVisitLoading}>↻ {copy.refreshSourceReport}</button>
                <button className="cta-button" type="button" onClick={exportSourceVisitReportCsv} disabled={!sourceVisitReport || sourceVisitReport.recentVisits.length === 0}>{copy.exportSourceReport}</button>
              </div>
            </div>
            {sourceVisitLoading && !sourceVisitReport && <div className="admin-empty"><LoadingIndicator label={copy.sourceReportLoading} /></div>}
            {sourceVisitError && <div className="admin-message admin-message--error" role="alert">{sourceVisitError}</div>}
            {sourceVisitReport && (
              <>
                <section className="admin-metrics-grid admin-source-report__metrics">
                  {[
                    { label: copy.totalSourceClicks, value: sourceVisitReport.summary.totalClicks },
                    { label: copy.uniqueSourceVisitors, value: sourceVisitReport.summary.uniqueVisitors },
                    { label: copy.advertiserSourceClicks, value: sourceVisitReport.summary.advertiserAttributedClicks },
                    { label: copy.advertiserSourceVisitors, value: sourceVisitReport.summary.advertiserUniqueVisitors },
                    { label: copy.partnerConfirmedVisits, value: sourceVisitReport.summary.partnerConfirmedVisits },
                    { label: copy.pendingExternalVisits, value: sourceVisitReport.summary.pendingExternalVerificationVisits },
                    { label: copy.notConfiguredExternalVisits, value: sourceVisitReport.summary.notConfiguredExternalVerificationVisits },
                    { label: copy.rejectedExternalVisits, value: sourceVisitReport.summary.rejectedExternalVerificationVisits },
                  ].map((metric) => (
                    <article className="admin-metric-card" key={metric.label}>
                      <span className="admin-metric-card__label">{metric.label}</span>
                      <strong>{metric.value.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
                    </article>
                  ))}
                </section>
                <p className="admin-footnote">{copy.reportProofNote}</p>
                <p className="admin-footnote">{sourceVisitReport.verificationNote}</p>
                <p className="admin-footnote">{copy.verificationHelp}</p>
                <p className="admin-footnote">{copy.reportLimitNotice}</p>

                <h3>{copy.destinationPerformanceTitle}</h3>
                {sourceVisitReport.destinationPerformance.length === 0 ? (
                  <p className="admin-empty">{copy.noDestinationPerformance}</p>
                ) : (
                  <>
                    <div className="admin-settings-list">
                      {sourceVisitReport.destinationPerformance.slice(0, 100).map((destination) => (
                        <article className="admin-setting-row" key={destination.sourceUrl}>
                          <div>
                            <strong>{destination.sourceHostname}</strong>
                            <small>{copy.reportClickCount}: {destination.clickCount.toLocaleString(fa ? "fa-IR" : "en-US")} · {copy.reportUniqueVisitors}: {destination.uniqueVisitors.toLocaleString(fa ? "fa-IR" : "en-US")}</small>
                            <code>{destination.sourceUrl}</code>
                          </div>
                        </article>
                      ))}
                    </div>
                    {sourceVisitReport.destinationPerformance.length > 100 && <p className="admin-footnote">{copy.destinationRowsLimit}</p>}
                  </>
                )}

                <h3>{copy.advertiserPerformance}</h3>
                {sourceVisitReport.advertiserPerformance.length === 0 ? (
                  <p className="admin-empty">{copy.noAdvertiserVisits}</p>
                ) : (
                  <div className="admin-settings-list">
                    {sourceVisitReport.advertiserPerformance.map((performance) => (
                      <article className="admin-setting-row" key={performance.advertisementOrderId}>
                        <div>
                          <strong>{performance.advertiserName}{performance.contentTitle ? " · " + performance.contentTitle : ""}</strong>
                          <small>{copy.reportAdOrder}: {performance.advertisementOrderId}</small>
                          <small>{copy.reportClickCount}: {performance.clickCount.toLocaleString(fa ? "fa-IR" : "en-US")} · {copy.reportUniqueVisitors}: {performance.uniqueVisitors.toLocaleString(fa ? "fa-IR" : "en-US")}</small>
                          <small>{copy.reportOrderStatus}: {performance.orderStatus}</small>
                          {performance.destinationUrl && <code>{performance.destinationUrl}</code>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <h3 className="admin-source-report__recent-title">{copy.recentSourceVisits} ({sourceVisitReport.recentVisits.length.toLocaleString(fa ? "fa-IR" : "en-US")})</h3>
                {sourceVisitReport.recentVisits.length === 0 ? (
                  <p className="admin-empty">{copy.noSourceVisits}</p>
                ) : (
                  <div className="admin-settings-list">
                    {sourceVisitReport.recentVisits.slice(0, 100).map((visit) => (
                      <article className="admin-setting-row admin-source-visit-row" key={visit.id}>
                        <div>
                          <strong>{visit.username} · {copy.reportClue} {visit.clueSequence.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
                          <small>{copy.reportUserId}: {visit.userId ?? copy.notAvailable}</small>
                          <small>{copy.reportChallenge}: {visit.contestTitle} · {visit.contestLanguage === "fa" ? (fa ? "فارسی" : "Persian") : (fa ? "انگلیسی" : "English")}</small>
                          {visit.contestStartsAt && <small>{fa ? "شروع چالش" : "Challenge start"}: {new Date(visit.contestStartsAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>}
                          <small>{copy.reportAdvertiser}: {visit.advertiserName ?? copy.reportNoAdvertiser}</small>
                          <small>{copy.reportClickTime}: {new Date(visit.createdAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>
                          <small>{copy.verificationStatus}: {visit.externalVerificationStatus === "CONFIRMED" ? copy.verificationConfirmed : visit.externalVerificationStatus === "PENDING" ? copy.verificationPending : visit.externalVerificationStatus === "REJECTED" ? copy.verificationRejected : copy.verificationNotConfigured}</small>
                          {visit.externalConfirmedAt && <small>{copy.verificationTime}: {new Date(visit.externalConfirmedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>}
                          {visit.externalVerificationProvider && <small>{copy.verificationProvider}: {visit.externalVerificationProvider}</small>}
                          {visit.externalReferenceId && <small>{copy.verificationReference}: {visit.externalReferenceId}</small>}
                          <small>{copy.reportDestination}: {visit.sourceHostname}</small>
                          <code>{visit.sourceUrl}</code>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {sourceVisitReport.recentVisits.length > 100 && (
                  <p className="admin-footnote">{fa ? "۱۰۰ رکورد اخیر در صفحه نمایش داده می‌شود؛ فایل CSV تا ۵۰۰ رکورد را دربرمی‌گیرد." : "The page shows the latest 100 records; the CSV includes up to 500 records."}</p>
                )}
                {sourceVisitReport.generatedAt && <p className="admin-footnote">{fa ? "آخرین به‌روزرسانی: " : "Report generated: "}{new Date(sourceVisitReport.generatedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</p>}
              </>
            )}
          </section>
        )}

        {section === "wallets" && (
          <section className="admin-panel admin-wallet-overview">
            <div className="admin-wallet-overview__heading">
              <div>
                <h2>{copy.treasuryTitle}</h2>
                <p className="admin-footnote">{fa ? "نمای خلاصهٔ خزانه جوایز؛ اطلاعات فنی در بخش جزئیات قرار دارد." : "A clear overview of the prize treasury, with technical information kept in the details section."}</p>
              </div>
              {treasury && <span className="admin-wallet-overview__status">{treasury.status === "ACTIVE" ? (fa ? "فعال" : "Active") : treasury.status}</span>}
            </div>

            {!treasury && (
              <div className="admin-wallet-overview__empty">
                <p className="admin-footnote">{copy.treasuryHelp}</p>
                <button className="cta-button" type="button" onClick={() => void handleProvisionTreasury()} disabled={treasuryLoading}>
                  {treasuryLoading ? copy.treasuryCreating : copy.treasuryCreate}
                </button>
              </div>
            )}

            {treasury && (
              <>
                <div className="admin-wallet-overview__balance">
                  <div>
                    <span>{copy.treasuryLiveBalance}</span>
                    <strong>
                      {treasuryFunding
                        ? Number(treasuryFunding.onChainBalance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + " USDT0"
                        : treasuryFundingLoading
                          ? (fa ? "در حال دریافت…" : "Loading…")
                          : treasuryFundingError
                            ? (fa ? "دریافت موجودی ناموفق بود" : "Balance unavailable")
                            : "—"}
                    </strong>
                    {treasuryFunding?.updatedAt && <small>{fa ? "آخرین بررسی: " : "Last checked: "}{new Date(treasuryFunding.updatedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small>}
                  </div>
                  <button type="button" onClick={() => { setTreasuryFundingLoading(true); void getTreasuryPrizeFunding().then((snapshot) => { setTreasuryFunding(snapshot); setTreasuryFundingError(false); }).catch(() => setTreasuryFundingError(true)).finally(() => setTreasuryFundingLoading(false)); }} disabled={treasuryFundingLoading}>
                    {treasuryFundingLoading ? (fa ? "در حال به‌روزرسانی…" : "Refreshing…") : (fa ? "به‌روزرسانی" : "Refresh")}
                  </button>
                </div>

                {treasuryFunding && (
                  <>
                    <div className="admin-wallet-overview__metrics">
                      <article><span>{copy.treasuryAllocated}</span><strong>{Number(treasuryFunding.allocatedToPrizeFund).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT0</strong></article>
                      <article><span>{copy.treasuryFree}</span><strong>{Number(treasuryFunding.accountingStatus === "MATCH" ? treasuryFunding.unallocatedTreasuryBalance : "0").toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT0</strong></article>
                      <article><span>{copy.internalPrizeBalance}</span><strong>{Number(treasuryFunding.prizeFundBalance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT</strong></article>
                    </div>

                    <div className="admin-wallet-overview__reconciliation">
                      <div className="admin-wallet-overview__reconciliation-heading">
                        <strong>{fa ? "وضعیت تطبیق حسابداری" : "Accounting reconciliation"}</strong>
                        <span className={treasuryFunding.accountingStatus === "MATCH" ? "is-match" : "is-warning"}>
                          {treasuryFunding.accountingStatus === "MATCH" ? (fa ? "منطبق" : "Matched") : (fa ? "نیازمند بررسی" : "Needs review")}
                        </span>
                      </div>
                      <div className="admin-wallet-overview__reconciliation-values">
                        <div><span>{fa ? "موجودی دفتر خزانه" : "Treasury ledger balance"}</span><strong>{Number(treasuryFunding.treasuryLedgerBalance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT0</strong></div>
                        <div><span>{fa ? "اختلاف حسابداری" : "Accounting difference"}</span><strong>{Number(treasuryFunding.accountingDifference).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT0</strong></div>
                        {treasuryFunding.accountingStatus !== "MATCH" && (
                          <div><span>{fa ? "موجودی در انتظار تطبیق" : "Balance pending reconciliation"}</span><strong>{Math.abs(Number(treasuryFunding.accountingDifference)).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT0</strong></div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <div className="admin-wallet-overview__actions">
                  <button className="cta-button" type="button" onClick={() => void handleTreasuryReconciliation()} disabled={treasuryReconciling || treasuryFundingLoading}>
                    {treasuryReconciling ? (fa ? "در حال تطبیق…" : "Reconciling…") : (fa ? "بررسی و تطبیق موجودی" : "Reconcile balances")}
                  </button>
                  <button type="button" onClick={() => { void navigator.clipboard?.writeText(treasury.address); setNotice(fa ? "آدرس کپی شد." : "Address copied."); }}>
                    {fa ? "کپی آدرس خزانه" : "Copy treasury address"}
                  </button>
                </div>

                <details className="admin-wallet-overview__details">
                  <summary>{fa ? "جزئیات فنی و آدرس خزانه" : "Technical details & treasury address"}</summary>
                  <div>
                    <span>{copy.treasuryAddress}</span><code>{treasury.address}</code>
                    <span>{copy.treasuryWalletId}</span><code>{treasury.walletId}</code>
                    <span>{fa ? "شبکه" : "Network"}</span><strong>Polygon · {treasury.chainId}</strong>
                    {treasuryFunding && <><span>{fa ? "بلوک مبنای بررسی" : "Snapshot block"}</span><strong>{treasuryFunding.snapshotBlockNumber}</strong></>}
                  </div>
                </details>
              </>
            )}
            <section className="admin-wallet-allocation-card">
              <div className="admin-wallet-allocation-card__heading">
                <div>
                  <h2>{fa ? "تخصیص از خزانه به صندوق جوایز" : "Allocate treasury funds to prize pool"}</h2>
                  <p>{fa ? "مبلغ موردنظر را از موجودی آزاد خزانه به موجودی داخلی صندوق جوایز منتقل کن." : "Move an amount from the treasury's unallocated balance into the internal prize fund."}</p>
                </div>
                <span>{fa ? "USDT" : "USDT"}</span>
              </div>
              <div className="admin-wallet-allocation-card__balances">
                <div>
                  <span>{fa ? "موجودی آزاد خزانه" : "Available treasury balance"}</span>
                  <strong>{treasuryFunding
                    ? Number(treasuryFunding.accountingStatus === "MATCH" ? treasuryFunding.unallocatedTreasuryBalance : "0").toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + " USDT0"
                    : "—"}</strong>
                </div>
                <div>
                  <span>{fa ? "موجودی صندوق جوایز" : "Prize fund balance"}</span>
                  <strong>{treasuryFunding
                    ? Number(treasuryFunding.prizeFundBalance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + " USDT"
                    : "—"}</strong>
                </div>
              </div>
              <div className="admin-wallet-allocation-card__status">
                <span className={treasuryFunding?.accountingStatus === "MATCH" ? "is-match" : "is-warning"}>
                  {treasuryFunding?.accountingStatus === "MATCH"
                    ? (fa ? "تطبیق حسابداری موفق" : "Accounting matched")
                    : (fa ? "تخصیص تا زمان تطبیق مسدود است" : "Allocation blocked until reconciliation")}
                </span>
                <p>{fa
                  ? "این عملیات فقط ثبت حسابداری داخلی است و هیچ تراکنش یا انتقالی روی شبکه Polygon انجام نمی‌دهد."
                  : "This is an internal accounting entry only. It does not create an on-chain Polygon transaction or transfer."}</p>
              </div>
              <form className="admin-wallet-allocation-card__form" onSubmit={handleTreasuryPrizeAllocation}>
                <label htmlFor="treasury-prize-allocation-amount">{fa ? "مبلغ تخصیص (USDT)" : "Allocation amount (USDT)"}</label>
                <div className="admin-wallet-allocation-card__input-row">
                  <input
                    id="treasury-prize-allocation-amount"
                    type="number"
                    inputMode="decimal"
                    min="0.000001"
                    step="0.000001"
                    max={treasuryFunding?.accountingStatus === "MATCH" ? treasuryFunding.unallocatedTreasuryBalance : "0"}
                    value={treasuryAllocationAmount}
                    onChange={(event) => setTreasuryAllocationAmount(event.target.value)}
                    placeholder={fa ? "مثلاً ۱۰ یا ۰٫۵" : "e.g. 10 or 0.5"}
                    disabled={!treasuryFunding || treasuryAllocating}
                    required
                  />
                  <button
                    className="cta-button"
                    type="submit"
                    disabled={!treasury || !treasuryFunding || treasuryFunding.accountingStatus !== "MATCH" || Number(treasuryFunding.unallocatedTreasuryBalance) <= 0 || !treasuryAllocationAmount.trim() || treasuryAllocating || treasuryFundingLoading}
                  >
                    {treasuryAllocating
                      ? (fa ? "در حال تخصیص…" : "Allocating…")
                      : (fa ? "تخصیص به صندوق جوایز" : "Allocate to prize fund")}
                  </button>
                </div>
                <small>{fa
                  ? "مبلغ باید مثبت و حداکثر دارای ۶ رقم اعشار باشد؛ سقف تخصیص برابر موجودی آزاد خزانه است."
                  : "Enter a positive amount with up to 6 decimal places. The maximum is the treasury's available balance."}</small>
              </form>
            </section>
          </section>
        )}

        {section === "settings" && (
          <section className="admin-panel">
            <h2>{copy.settings}</h2>
            <section className="admin-setting-form">
              <h3>{copy.poolTitle}</h3>
              <p><strong>{copy.poolFixed}</strong></p>
              <p className="admin-footnote">{copy.poolHelp}</p>
            </section>
            <form className="admin-setting-form" onSubmit={handleSave}>
              <label>{copy.keyLabel}<input value={key} onChange={(event) => setKey(event.target.value)} required maxLength={80} autoComplete="off" /></label>
              <label>{copy.valueLabel}<textarea value={value} onChange={(event) => setValue(event.target.value)} required maxLength={4000} rows={3} /></label>
              <button className="cta-button" type="submit" disabled={saving}>{saving ? copy.saving : copy.save}</button>
            </form>
            <div className="admin-settings-list">
              {visibleSettings.length === 0 && <p className="admin-empty">{copy.empty}</p>}
              {visibleSettings.map((setting) => (
                <article className="admin-setting-row" key={setting.key}>
                  <div><strong>{setting.key}</strong><code>{setting.value}</code><small>{new Date(setting.updatedAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</small></div>
                  <button type="button" onClick={() => void handleEdit(setting)} disabled={saving}>{fa ? "ویرایش" : "Edit"}</button>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "audit" && (
          <section className="admin-panel">
            <h2>{copy.audit}</h2>
            {logs.length === 0 ? <p className="admin-empty">{copy.noLogs}</p> : (
              <div className="admin-audit-list">
                {logs.map((log) => (
                  <article className="admin-audit-row" key={log.id}>
                    <div className="admin-audit-row__top"><strong>{log.action}</strong><time>{new Date(log.createdAt).toLocaleString(fa ? "fa-IR" : "en-GB")}</time></div>
                    <p>{copy.entity}: {log.entity}{log.entityId ? " · " + log.entityId : ""}</p>
                    <small>{copy.actor}: {log.user?.username ?? log.user?.email ?? (fa ? "سیستم" : "System")}</small>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
