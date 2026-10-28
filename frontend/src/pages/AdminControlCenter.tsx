import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useI18n } from "../i18n";
import {
  getAdminAuditLogs,
  getAdminOverview,
  getAdminProjectProfitPool,
  getAdminWallets,
  getAdminUsers,
  getActiveContest,
  getSystemSettings,
  saveSystemSetting,
  type AdminAuditLog,
  type AdminOverview,
  type AdminProjectProfitPool,
  type AdminWalletSummary,
  type AdminUserSummary,
  type SystemSettingRecord,
} from "../services/api";
import LoadingIndicator from "../components/LoadingIndicator";

type AdminDestination = "home" | "admin-manage";

type Props = { onNavigate: (page: AdminDestination) => void };
type Section = "overview" | "users" | "finance" | "prizes" | "ads" | "security" | "support" | "wallets" | "settings" | "audit";

const DEFAULT_EN_SOURCES = ["https://en.wikipedia.org/w/api.php", "https://www.gutenberg.org/cache/epub/11/pg11.txt", "https://www.gutenberg.org/cache/epub/1342/pg1342.txt", "https://www.gutenberg.org/cache/epub/84/pg84.txt", "https://www.gutenberg.org/cache/epub/1661/pg1661.txt", "https://en.wikipedia.org/wiki/Artificial_intelligence", "https://en.wikipedia.org/wiki/Paris", "https://en.wikipedia.org/wiki/Albert_Einstein", "https://en.wikipedia.org/wiki/History_of_science"];
const DEFAULT_FA_SOURCES = ["https://fa.wikipedia.org/w/api.php", "https://fa.wikipedia.org/wiki/ایران", "https://fa.wikipedia.org/wiki/تهران", "https://fa.wikipedia.org/wiki/فردوسی", "https://fa.wikipedia.org/wiki/شاهنامه", "https://fa.wikipedia.org/wiki/هوش_مصنوعی"];
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
  language: "en" | "fa";
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
        (row.language === "en" || row.language === "fa") &&
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
  const [wallets, setWallets] = useState<AdminWalletSummary[]>([]);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
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
  const [scheduledSources, setScheduledSources] = useState<ScheduledSourceAssignment[]>([]);
  const [scheduledSourceUrl, setScheduledSourceUrl] = useState("");
  const [scheduledSourceLanguage, setScheduledSourceLanguage] = useState<"en" | "fa">("en");
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
    finance: fa ? "امور مالی" : "Finance",
    prizes: fa ? "صندوق جوایز و تسویه" : "Prize pool & settlement",
    ads: fa ? "تبلیغات و اسپانسرها" : "Ads & sponsors",
    security: fa ? "امنیت و ضدتقلب" : "Security & anti-fraud",
    support: fa ? "پشتیبانی و گزارش‌ها" : "Support & reports",
    settings: fa ? "تنظیمات سایت" : "Site settings",
    wallets: fa ? "کیف پول و تراکنش‌ها" : "Wallets & transactions",
    walletBalance: fa ? "موجودی آزمایشی" : "Simulated balance",
    walletAvailable: fa ? "موجودی قابل برداشت" : "Available balance",
    pendingDeposits: fa ? "واریزهای در انتظار" : "Pending deposits",
    pendingWithdrawals: fa ? "برداشت‌های در انتظار" : "Pending withdrawals",
    noWallets: fa ? "کاربری برای نمایش وجود ندارد." : "No users to display.",
    walletNote: fa ? "این فهرست فقط دفترکل آزمایشی را نشان می‌دهد؛ پرداخت واقعی انجام نمی‌شود." : "This list shows simulated ledger balances only; no real payments are made.",
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
    supportBody: fa ? "مدیریت پیام‌های پشتیبانی، گزارش خطا، شکایت‌ها و درخواست‌های کاربران." : "Handle support messages, bug reports, complaints, and user requests.",
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [stats, settingRows, auditRows, walletRows, userRows, profitPool] = await Promise.all([
        getAdminOverview(),
        getSystemSettings(),
        getAdminAuditLogs(),
        getAdminWallets(),
        getAdminUsers(),
        getAdminProjectProfitPool(),
      ]);
      setOverview(stats);
      setSettings(settingRows);
      setSourceUrlsEn(parseSourceUrls(settingRows.find((setting) => setting.key === "clue_sources_en")?.value, DEFAULT_EN_SOURCES));
      setSourceUrlsFa(parseSourceUrls(settingRows.find((setting) => setting.key === "clue_sources_fa")?.value, DEFAULT_FA_SOURCES));
      setScheduledSources(parseScheduledSourceAssignments(settingRows.find((setting) => setting.key === "scheduled_clue_sources")?.value));
      setLogs(auditRows);
      setWallets(walletRows);
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
    if (section !== "ads") return;
    let cancelled = false;
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

    return () => { cancelled = true; };
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

  function addSource(language: "en" | "fa") {
    const draft = (language === "fa" ? sourceDraftFa : sourceDraftEn).trim();
    try {
      const parsed = new URL(draft);
      if (parsed.protocol !== "https:" || draft.length > 500) throw new Error("invalid");
    } catch {
      setError(copy.invalidSource);
      return;
    }
    if (language === "fa") {
      if (!sourceUrlsFa.includes(draft)) setSourceUrlsFa((current) => [...current, draft]);
      setSourceDraftFa("");
    } else {
      if (!sourceUrlsEn.includes(draft)) setSourceUrlsEn((current) => [...current, draft]);
      setSourceDraftEn("");
    }
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

  async function saveSources(language: "en" | "fa") {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveSystemSetting(language === "fa" ? "clue_sources_fa" : "clue_sources_en", JSON.stringify(language === "fa" ? sourceUrlsFa : sourceUrlsEn));
      setNotice(copy.sourceSaved);
      await load();
    } catch {
      setError(copy.refreshError);
    } finally {
      setSaving(false);
    }
  }

  const visibleSettings = settings.filter((setting) => setting.key !== "hypothetical_prize_pool_per_round");

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
            ["finance", copy.finance],
            ["wallets", copy.wallets],
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
                  <select value={scheduledSourceLanguage} onChange={(event) => setScheduledSourceLanguage(event.target.value as "en" | "fa")}>
                    <option value="en">{copy.sourceEn}</option>
                    <option value="fa">{copy.sourceFa}</option>
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
                        <strong>{item.language === "fa" ? copy.sourceFa : copy.sourceEn} · {fa ? "چالش" : "Challenge"} {item.challengeNumber.toLocaleString(fa ? "fa-IR" : "en-US")} · {fa ? "خانه" : "Cell"} {item.sequence.toLocaleString(fa ? "fa-IR" : "en-US")}</strong>
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
            {([
              { language: "en" as const, title: copy.sourceEn, urls: sourceUrlsEn, setUrls: setSourceUrlsEn, draft: sourceDraftEn, setDraft: setSourceDraftEn },
              { language: "fa" as const, title: copy.sourceFa, urls: sourceUrlsFa, setUrls: setSourceUrlsFa, draft: sourceDraftFa, setDraft: setSourceDraftFa },
            ]).map((sourceGroup) => (
              <div className="admin-setting-form" key={sourceGroup.language}>
                <h3>{sourceGroup.title}</h3>
                <form onSubmit={(event) => { event.preventDefault(); addSource(sourceGroup.language); }}>
                  <label>{copy.sourceUrl}<input type="url" value={sourceGroup.draft} onChange={(event) => sourceGroup.setDraft(event.target.value)} placeholder="https://..." /></label>
                  <button className="cta-button" type="submit" disabled={saving}>{copy.addSource}</button>
                </form>
                {sourceGroup.urls.length === 0 ? <p className="admin-empty">{copy.noSources}</p> : (
                  <div className="admin-settings-list">
                    {sourceGroup.urls.map((url) => (
                      <article className="admin-setting-row" key={url}>
                        <div><strong>{sourceHostname(url)}</strong><code>{url}</code></div>
                        <button type="button" onClick={() => sourceGroup.setUrls((current) => current.filter((item) => item !== url))} disabled={saving}>{copy.removeSource}</button>
                      </article>
                    ))}
                  </div>
                )}
                <button className="cta-button" type="button" onClick={() => void saveSources(sourceGroup.language)} disabled={saving}>{saving ? copy.saving : copy.saveSources}</button>
              </div>
            ))}
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

        {(["finance", "security", "support"] as Section[]).includes(section) && (
          <section className="admin-panel">
            <h2>{({
              finance: copy.finance,
              prizes: copy.prizes,
              ads: copy.ads,
              security: copy.security,
              support: copy.support,
            } as Record<string, string>)[section]}</h2>
            <p>{copy.conceptTitle}</p>
            <p className="admin-footnote">{({
              finance: copy.financeBody,
              prizes: copy.prizesBody,
              ads: copy.adsBody,
              security: copy.securityBody,
              support: copy.supportBody,
            } as Record<string, string>)[section]}</p>
            <p className="admin-footnote">{copy.conceptBody}</p>
          </section>
        )}

        {section === "wallets" && (
          <section className="admin-panel">
            <h2>{copy.wallets}</h2>
            <p className="admin-footnote">{copy.walletNote}</p>
            {wallets.length === 0 ? <p className="admin-empty">{copy.noWallets}</p> : (
              <div className="admin-settings-list">
                {wallets.map((wallet) => (
                  <article className="admin-setting-row admin-wallet-row" key={wallet.userId}>
                    <div>
                      <strong>{wallet.username}</strong>
                      <small>{wallet.email}</small>
                      <code>{copy.walletBalance}: {Number(wallet.balance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT</code>
                      <code>{copy.walletAvailable}: {Number(wallet.availableBalance).toLocaleString(fa ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT</code>
                      <small>{copy.pendingDeposits}: {wallet.pendingDepositRequests} · {copy.pendingWithdrawals}: {wallet.pendingWithdrawalRequests}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
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
