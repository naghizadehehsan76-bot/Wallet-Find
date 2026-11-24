import { useCallback, useEffect, useState, type ReactNode } from "react";
import AuthPage from "./pages/AuthPage";
import CompetitionPage from "./pages/CompetitionPage";
import KeyStagePage from "./pages/KeyStagePage";
import LeaderboardPage from "./pages/LeaderboardPage";
import ProfilePage from "./pages/ProfilePage";
import AdminPage from "./pages/AdminPage";
import AdminControlCenter from "./pages/AdminControlCenter";
import WalletPage from "./pages/WalletPage";
import { useI18n, type Language } from "./i18n";
import { getPageCopy } from "./i18n/page-overrides";
import SharedLanguageSwitcher from "./components/LanguageSwitcher";
import LoadingIndicator from "./components/LoadingIndicator";
import { getProfile, getPublicPrizePoolStats, getPublicSiteStats, sendOnlineHeartbeat, logout, type AuthUser, type PublicPrizePoolStats, type PublicSiteStats } from "./services/api";
import "./App.css";

type AuthMode = "login" | "signup";

type Page =
  | "home"
  | "auth"
  | "competition"
  | "key"
  | "leaderboard"
  | "profile"
  | "wallet"
  | "rewards"
  | "help"
  | "terms"
  | "rules"
  | "admin"
  | "admin-manage";

const faSteps = [
  { number: "۰۱", title: "عبارت دقیق راهنما را در صفحهٔ منبع پیدا کن.", description: "پاسخ، نخستین واژه ای است که پس از عبارت راهنما می آید" },
  { number: "۰۲", title: "خود واژه را کامل وارد کن؛ نه عبارت راهنما را.", description: "هنگام وارد کردن پاسخ، لازم نیست علائم نگارشی مثل نقطه (.)، ویرگول (،)، دونقطه (:) یا علامت سؤال (؟) را بنویسی؛ فقط خود کلمه را وارد می‌کنی." },
  { number: "۰۳", title: "۱۲ واژه را به‌ترتیب حل کن.", description: "پاسخ درست خانهٔ بعدی را باز می‌کند؛ پاسخ اشتباه این کار را نمی‌کند." },
];

const enSteps = [
  { number: "01", title: "Find the exact hint phrase on the source page.", description: "The answer is the first matching word in the challenge language immediately after the phrase." },
  { number: "02", title: "Enter the complete word, not the hint phrase.", description: "When entering your answer, you do not need to type punctuation such as a period (.), comma (,), colon (:), or question mark (?); enter only the word itself." },
  { number: "03", title: "Solve all 12 words in order.", description: "A correct answer unlocks the next box; a wrong answer does not." },
];

function HomePage({
  onNavigate,
  onAuth,
  language,
  isLoggedIn,
}: {
  onNavigate: (page: Page) => void;
  onAuth: (mode: AuthMode) => void;
  language: Language;
  isLoggedIn: boolean;
}) {
  const { translation: t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [siteStats, setSiteStats] = useState<PublicSiteStats | null>(null);
  const [prizePoolStats, setPrizePoolStats] = useState<PublicPrizePoolStats | null>(null);
  const isPersian = language === "fa";
  const isHomeRTL = language === "fa" || language === "ar";
  const homeCopy = getPageCopy(language, "homePage");
  const localizeDigits = (value: string) => isPersian
    ? value
        .replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])
        .replace(/[٠-٩]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"["٠١٢٣٤٥٦٧٨٩".indexOf(digit)])
    : value
        .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const formatHomeNumber = (value: number) =>
    localizeDigits(value.toLocaleString(isPersian ? "fa-IR" : "en-US"));
  const formatPrizeAmount = (value: string) => {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? localizeDigits(amount.toLocaleString(isPersian ? "fa-IR" : "en-US", { maximumFractionDigits: 2 }))
      : "—";
  };

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;

    async function refreshPublicSiteStats() {
      if (refreshing) return;
      refreshing = true;
      try {
        const latestStats = await getPublicSiteStats();
        if (!cancelled) setSiteStats(latestStats);
      } catch {
        // Keep the most recent confirmed statistics while the API is unavailable.
      } finally {
        refreshing = false;
      }
    }

    void refreshPublicSiteStats();
    const intervalId = window.setInterval(() => void refreshPublicSiteStats(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;

    async function refreshPrizePoolStats() {
      if (refreshing) return;
      refreshing = true;
      try {
        const latestStats = await getPublicPrizePoolStats(isPersian ? "fa" : "en");
        if (!cancelled) setPrizePoolStats(latestStats);
      } catch {
        // Keep the last confirmed pool values if the API is briefly unavailable.
      } finally {
        refreshing = false;
      }
    }

    void refreshPrizePoolStats();
    const intervalId = window.setInterval(() => void refreshPrizePoolStats(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isPersian]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);
  const stats = [
    {
      value: siteStats ? formatHomeNumber(siteStats.onlineUsers) : "—",
      label: homeCopy.onlineUsers ?? (isPersian ? "کاربران آنلاین" : "Online users"),
      secondaryValue: siteStats ? formatHomeNumber(siteStats.totalUsers) : "—",
      secondaryLabel: homeCopy.totalSiteUsers ?? (isPersian ? "کل کاربران سایت" : "Total site users"),
    },
    {
      value: prizePoolStats ? `${formatPrizeAmount(prizePoolStats.totalPool)} USDT` : "—",
      label: homeCopy.globalPrizeFund ?? (isPersian ? "موجودی صندوق کلی جایزه" : "Available global prize fund"),
    },
    {
      value: prizePoolStats ? `${formatPrizeAmount(prizePoolStats.totalPrizesAwarded)} USDT` : "—",
      label: homeCopy.totalPrizesPaid ?? (isPersian ? "مجموع جوایز ثبت‌شده" : "Total awards recorded"),
    },
  ];
  const [guidePage, setGuidePage] = useState(0);
  const guideCopy = ({
    fa: {
      heading: "راهنمای تصویری حل چالش", page: "صفحه", firstTitle: "۱. از راهنما تا اولین پاسخ",
      firstText: "برای شروع چالش و پیدا کردن کلمه ی اول عبارتی که در بخش راهنما میبینید را یادداشت کنید و در ادامه به صفحه ی منبع سرنخ رفته و به دنبال عبارت سرنخ بگردید. پاسخ هر خانه اولین کلمه (که میتواند حروف اضافه چسبیده به آن هم شاملش باش) بعد از عبارت سرنخ است.",
      secondTitle: "۲. پاسخ را در خانه وارد کن", secondText: "فقط اولین کلمه پس از عبارت سرنخ را وارد کن. با ثبت پاسخ درست، خانه بعدی برایت باز می‌شود.",
      thirdTitle: "۳. هر ۱۲ خانه را کامل کن", thirdText: "خانه‌ها را به‌ترتیب حل کن. پس از ثبت پاسخ خانه دوازدهم، نتیجه و رتبه‌ات مشخص می‌شود.",
      hint: "عبارت راهنما", source: "صفحه منبع سرنخ", answer: "کلمه پاسخ", previous: "قبلی", next: "بعدی"
    },
    en: {
      heading: "Visual Challenge Guide", page: "Page", firstTitle: "1. From the guide to your first answer",
      firstText: "To start the challenge and find the first word, note the phrase shown in the Guide section. Then open the clue source page and search for that exact phrase. The answer for each box is the first word immediately after the clue phrase (including any attached preposition).",
      secondTitle: "2. Enter your answer", secondText: "Enter only the first word after the clue phrase. A correct answer unlocks the next box.",
      thirdTitle: "3. Complete all 12 boxes", thirdText: "Solve the boxes in order. Your result and rank are determined as soon as you submit the twelfth answer.",
      hint: "Guide phrase", source: "Clue source page", answer: "Answer word", previous: "Previous", next: "Next"
    },
    de: {
      heading: "Visuelle Anleitung zur Challenge", page: "Seite", firstTitle: "1. Vom Hinweis zur ersten Antwort",
      firstText: "Notiere zum Start der Challenge die Formulierung im Hinweisbereich. Öffne anschließend die Quellseite und suche genau nach dieser Formulierung. Die Antwort für jedes Feld ist das erste Wort direkt nach der Hinweisformulierung (einschließlich eines angefügten Präpositionswortes).",
      secondTitle: "2. Antwort eingeben", secondText: "Gib nur das erste Wort nach der Hinweisformulierung ein. Eine richtige Antwort entsperrt das nächste Feld.",
      thirdTitle: "3. Alle 12 Felder lösen", thirdText: "Löse die Felder der Reihe nach. Dein Ergebnis und Rang stehen fest, sobald du die zwölfte Antwort abgeschickt hast.",
      hint: "Hinweisformulierung", source: "Hinweis-Quellseite", answer: "Antwortwort", previous: "Zurück", next: "Weiter"
    },
    es: {
      heading: "Guía visual del desafío", page: "Página", firstTitle: "1. De la guía a tu primera respuesta",
      firstText: "Para comenzar el desafío y encontrar la primera palabra, anota la frase que aparece en la sección Guía. Después, abre la página fuente de la pista y busca esa frase exacta. La respuesta de cada casilla es la primera palabra que aparece justo después de la frase (también puede incluir una preposición unida a ella).",
      secondTitle: "2. Introduce tu respuesta", secondText: "Introduce solo la primera palabra después de la frase de la pista. Una respuesta correcta desbloquea la siguiente casilla.",
      thirdTitle: "3. Completa las 12 casillas", thirdText: "Resuelve las casillas en orden. Tu resultado y clasificación se determinan al enviar la duodécima respuesta.",
      hint: "Frase guía", source: "Página fuente de la pista", answer: "Palabra de respuesta", previous: "Anterior", next: "Siguiente"
    },
    fr: {
      heading: "Guide visuel du défi", page: "Page", firstTitle: "1. Du guide à votre première réponse",
      firstText: "Pour commencer le défi et trouver le premier mot, notez l’expression affichée dans la section Guide. Ouvrez ensuite la page source de l’indice et recherchez cette expression exacte. La réponse de chaque case est le premier mot qui suit immédiatement l’expression (y compris une préposition qui y serait attachée).",
      secondTitle: "2. Saisissez votre réponse", secondText: "Saisissez uniquement le premier mot après l’expression indice. Une bonne réponse déverrouille la case suivante.",
      thirdTitle: "3. Terminez les 12 cases", thirdText: "Résolvez les cases dans l’ordre. Votre résultat et votre classement sont déterminés dès l’envoi de la douzième réponse.",
      hint: "Expression du guide", source: "Page source de l’indice", answer: "Mot réponse", previous: "Précédent", next: "Suivant"
    },
    ar: {
      heading: "الدليل المرئي لحل التحدي", page: "صفحة", firstTitle: "١. من الدليل إلى الإجابة الأولى",
      firstText: "لبدء التحدي والعثور على الكلمة الأولى، دوّن العبارة الظاهرة في قسم الدليل. ثم افتح صفحة مصدر التلميح وابحث عن العبارة نفسها. إجابة كل خانة هي أول كلمة تأتي مباشرة بعد عبارة التلميح، وقد تشمل حرف جر متصلاً بها.",
      secondTitle: "٢. أدخل إجابتك", secondText: "أدخل الكلمة الأولى فقط بعد عبارة التلميح. الإجابة الصحيحة تفتح الخانة التالية.",
      thirdTitle: "٣. أكمل الخانات الاثنتي عشرة", thirdText: "حل الخانات بالترتيب. تظهر نتيجتك وترتيبك فور إرسال إجابة الخانة الثانية عشرة.",
      hint: "عبارة الدليل", source: "صفحة مصدر التلميح", answer: "كلمة الإجابة", previous: "السابق", next: "التالي"
    },
    tr: {
      heading: "Görsel Meydan Okuma Rehberi", page: "Sayfa", firstTitle: "1. Rehberden ilk cevabına",
      firstText: "Meydan okumaya başlamak ve ilk kelimeyi bulmak için Rehber bölümünde gösterilen ifadeyi not et. Ardından ipucu kaynak sayfasını aç ve bu ifadeyi aynen ara. Her kutunun cevabı, ipucu ifadesinden hemen sonra gelen ilk kelimedir (kelimeye bitişik bir edat da dahil olabilir).",
      secondTitle: "2. Cevabını gir", secondText: "İpucu ifadesinden sonraki yalnızca ilk kelimeyi gir. Doğru cevap bir sonraki kutunun kilidini açar.",
      thirdTitle: "3. 12 kutunun tamamını çöz", thirdText: "Kutuları sırayla çöz. On ikinci cevabı gönderdiğinde sonucun ve sıralaman belirlenir.",
      hint: "Rehber ifadesi", source: "İpucu kaynak sayfası", answer: "Cevap kelimesi", previous: "Önceki", next: "Sonraki"
    },
    pt: {
      heading: "Guia visual do desafio", page: "Página", firstTitle: "1. Do guia à primeira resposta",
      firstText: "Para começar o desafio e encontrar a primeira palavra, anote a frase exibida na seção Guia. Depois, abra a página de origem da pista e procure exatamente essa frase. A resposta de cada caixa é a primeira palavra logo após a frase da pista (incluindo uma preposição ligada a ela, se houver).",
      secondTitle: "2. Insira sua resposta", secondText: "Digite apenas a primeira palavra após a frase da pista. Uma resposta correta desbloqueia a próxima caixa.",
      thirdTitle: "3. Complete as 12 caixas", thirdText: "Resolva as caixas em ordem. Seu resultado e sua classificação são definidos assim que você enviar a décima segunda resposta.",
      hint: "Frase do guia", source: "Página de origem da pista", answer: "Palavra-resposta", previous: "Anterior", next: "Próxima"
    },
    ru: {
      heading: "Наглядное руководство по испытанию", page: "Страница", firstTitle: "1. От подсказки к первому ответу",
      firstText: "Чтобы начать испытание и найти первое слово, запишите фразу из раздела «Подсказка». Затем откройте страницу-источник подсказки и найдите точное совпадение этой фразы. Ответ для каждой ячейки — первое слово сразу после фразы (включая присоединённый предлог, если он есть).",
      secondTitle: "2. Введите ответ", secondText: "Введите только первое слово после фразы-подсказки. Правильный ответ откроет следующую ячейку.",
      thirdTitle: "3. Заполните все 12 ячеек", thirdText: "Решайте ячейки по порядку. Результат и место определяются сразу после отправки двенадцатого ответа.",
      hint: "Фраза-подсказка", source: "Страница-источник", answer: "Слово-ответ", previous: "Назад", next: "Далее"
    },
    zh: {
      heading: "挑战图解指南", page: "页", firstTitle: "1. 从提示到第一个答案",
      firstText: "开始挑战并寻找第一个单词时，请记下“指南”区域显示的短语。然后打开线索来源页面，搜索完全相同的短语。每个方格的答案是该短语后面紧接着出现的第一个单词（也可能包含与其连写的介词）。",
      secondTitle: "2. 输入答案", secondText: "只输入线索短语后面的第一个单词。回答正确后，下一格将解锁。",
      thirdTitle: "3. 完成全部 12 个方格", thirdText: "请按顺序解答方格。提交第十二个答案后，系统会立即确定你的结果和排名。",
      hint: "指南短语", source: "线索来源页面", answer: "答案单词", previous: "上一页", next: "下一页"
    }
  })[language] ?? ({
    heading: "Visual Challenge Guide", page: "Page", firstTitle: "1. From the guide to your first answer",
    firstText: "Note the phrase shown in the Guide section, then find that exact phrase on the clue source page. The answer is the first word immediately after the clue phrase, including any attached preposition.",
    secondTitle: "2. Enter your answer", secondText: "Enter only the first word after the clue phrase. A correct answer unlocks the next box.",
    thirdTitle: "3. Complete all 12 boxes", thirdText: "Solve the boxes in order. Your rank is determined after the twelfth answer.",
    hint: "Guide phrase", source: "Clue source page", answer: "Answer word", previous: "Previous", next: "Next"
  });
  const guidePages = [
    { title: guideCopy.firstTitle, text: guideCopy.firstText },
    { title: guideCopy.secondTitle, text: guideCopy.secondText },
    { title: guideCopy.thirdTitle, text: guideCopy.thirdText },
  ];
  const steps = isPersian ? faSteps : enSteps;

  return (
    <div className="app-shell home-shell">
      <header className="topbar home-topbar">
        <div className="home-topbar__brand">
          <button
            className="sidebar-toggle"
            type="button"
            aria-controls="home-sidebar"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? t.sidebar.closeMenu : t.sidebar.openMenu}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? "×" : "☰"}
          </button>
          <button className="brand brand--home" type="button" aria-label={t.navigation.home} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button>
        </div>
      </header>

      <div className={`home-content${mobileMenuOpen ? " home-content--menu-open" : ""}`}>
        {mobileMenuOpen && (
          <button
            className="sidebar-backdrop"
            type="button"
            aria-label={t.sidebar.closeMenu}
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        <aside
          id="home-sidebar"
          className="home-sidebar"
          aria-label={t.sidebar.title}
          aria-hidden={!mobileMenuOpen}
        >
          <button type="button" className="sidebar-brand sidebar-brand--home" aria-label={t.navigation.home} onClick={() => { onNavigate("home"); setMobileMenuOpen(false); }}><strong><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></strong></button>
          <p className="sidebar-kicker">{t.sidebar.title}</p>
          <nav className="sidebar-nav">
            <button type="button" className="sidebar-link" onClick={() => { onNavigate("leaderboard"); setMobileMenuOpen(false); }}>
              <span aria-hidden="true">🏆</span><span>{t.sidebar.leaderboard}</span>
            </button>
            <button type="button" className="sidebar-link" onClick={() => { onNavigate("rewards"); setMobileMenuOpen(false); }}>
              <span aria-hidden="true">✦</span><span>{t.sidebar.rewards}</span>
            </button>
            <button type="button" className="sidebar-link" onClick={() => { onNavigate("help"); setMobileMenuOpen(false); }}>
              <span aria-hidden="true">?</span><span>{t.sidebar.helpCenter}</span>
            </button>
            <button type="button" className="sidebar-link" onClick={() => { onNavigate("terms"); setMobileMenuOpen(false); }}>
              <span aria-hidden="true">≡</span><span>{t.sidebar.termsOfUse}</span>
            </button>
          </nav>
          <div className="sidebar-divider" />
          {!isLoggedIn && (
            <div className="sidebar-auth">
              <button type="button" className="sidebar-login" onClick={() => { onAuth("login"); setMobileMenuOpen(false); }}>
                {t.sidebar.login}
              </button>
              <button type="button" className="sidebar-signup" onClick={() => { onAuth("signup"); setMobileMenuOpen(false); }}>
                {t.sidebar.signup}
              </button>
            </div>
          )}
          <p className="sidebar-footer">{t.sidebar.footer}</p>
        </aside>

        <main className="page home-page">
        <section className="home-showcase">
          <img className="home-concept-vector" src="/images/home-concept.svg" alt={homeCopy.alt ?? (isPersian ? "تصویر نئونی کیف پول و ذره‌بین" : "Neon wallet and magnifying glass illustration")} />
          <h1 className="home-concept-title" lang={language} dir={isHomeRTL ? "rtl" : "ltr"}>
            {isPersian ? <>کیف پول رو پیدا کن، <span>کریپتو بگیر</span></> : (homeCopy.heroTitle ?? <>FIND THE WALLET, <span>GET CRYPTO</span></>)}
          </h1>
          <p className="home-concept-tagline" lang={language} dir={isHomeRTL ? "rtl" : "ltr"}>
            {isPersian ? <>هر روز سرنخ‌های رسیدن به کیف پول رو بهت میدیم<br />هر چقدر سریعتر باشی درآمدت بیشتره.</> : (homeCopy.heroTagline ?? <>We give you clues to find wallet every day...<br />The faster you are, the more you earn.</>)}
          </p>
        </section>

        <section className="home-guide-book" aria-label={guideCopy.heading} dir={isHomeRTL ? "rtl" : "ltr"}>
          <div className="home-guide-book__heading">
            <div>
              <span className="home-guide-book__eyebrow">WALLET-FIND GUIDE</span>
              <h2>{guideCopy.heading}</h2>
            </div>
            <span className="home-guide-book__counter">{guideCopy.page} {localizeDigits(String(guidePage + 1))} / {localizeDigits("3")}</span>
          </div>
          <div className="home-guide-book__page">
            <div className="home-guide-book__visual" aria-label={guidePages[guidePage].title}>
            {guidePage === 0 ? (
              <div className="guide-visual">
                <div className="guide-visual__panel"><span>{guideCopy.hint}</span><strong>“the clue phrase”</strong><i>⌕</i></div>
                <div className="guide-visual__connector">↓</div>
                <div className="guide-visual__panel"><span>{guideCopy.source}</span><p>... <mark>the clue phrase</mark> <b>answer</b> continues ...</p><small>{guideCopy.answer}: <b>answer</b></small></div>
              </div>
            ) : guidePage === 1 ? (
              <div className="guide-visual">
                <div className="guide-visual__caption">{guideCopy.answer}</div>
                <div className="guide-visual__answer-box">answer <span>✓</span></div>
                <div className="guide-visual__connector">↓</div>
                <div className="guide-visual__unlock"><span className="is-done">1</span><span className="is-done">2</span><span className="is-open">3</span><span className="is-locked">4</span></div>
                <small className="guide-visual__note">{isPersian ? "پاسخ درست، خانه بعدی را باز می‌کند" : "A correct answer unlocks the next box"}</small>
              </div>
            ) : (
              <div className="guide-visual">
                <div className="guide-visual__finish-title">{isPersian ? "چالش تکمیل شد" : "Challenge completed"} <span>✓</span></div>
                <div className="guide-visual__finish-grid">{Array.from({length:12}).map((_,i)=><span key={i}>{i+1}</span>)}</div>
                <div className="guide-visual__rank">{isPersian ? "رتبه شما" : "Your rank"} <b>#1</b></div>
              </div>
            )}
          </div>
            <div className="home-guide-book__copy">
              <span className="home-guide-book__step">{localizeDigits(String(guidePage + 1).padStart(2, "0"))}</span>
              <h3>{guidePages[guidePage].title}</h3>
              <p>{guidePages[guidePage].text}</p>
            </div>
          </div>
          <div className="home-guide-book__footer">
            <button type="button" onClick={() => setGuidePage((page) => Math.max(0, page - 1))} disabled={guidePage === 0}>‹ {guideCopy.previous}</button>
            <div className="home-guide-book__dots" aria-label={guideCopy.page}>
              {guidePages.map((_, index) => <button key={index} type="button" className={guidePage === index ? "is-active" : ""} aria-label={`${guideCopy.page} ${index + 1}`} aria-current={guidePage === index ? "page" : undefined} onClick={() => setGuidePage(index)} />)}
            </div>
            <button type="button" onClick={() => setGuidePage((page) => Math.min(2, page + 1))} disabled={guidePage === 2}>{guideCopy.next} ›</button>
          </div>
        </section>

        <section className="cta-group">
          <button className="cta-button" type="button" onClick={() => onNavigate("competition")}>{homeCopy.enterChallenge ?? (isPersian ? "ورود به چالش امشب" : "Enter Challenge")}</button>
          <button className="cta-button cta-button--ghost" type="button" onClick={() => onNavigate("rules")}>{homeCopy.rules ?? (isPersian ? "روش و قوانین چالش" : "How to Play & Challenge Rules")}</button>
        </section>





        <section className="stat-row">
          {stats.map((stat) => (
            "secondaryValue" in stat ? (
              <div className="stat-card stat-card--paired" key={stat.label}>
                <div className="stat-card__user-metric">
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </div>
                <div className="stat-card__user-metric">
                  <strong>{stat.secondaryValue}</strong>
                  <span>{stat.secondaryLabel}</span>
                </div>
              </div>
            ) : (
              <div className="stat-card" key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            )
          ))}
        </section>

        <section className="how-section">
          <h2 className="section-heading">{homeCopy.howWorks ?? (isPersian ? "چالش چطور کار می‌کند" : "How the challenge works")}</h2>
          <div className="steps">
            {steps.map((step) => <article className="step" key={step.number}><div className="step-number mono">{step.number}</div><div className="step-content"><p>{step.title}</p><small>{step.description}</small></div></article>)}
          </div>
        </section>
        </main>
      </div>
      <BottomNavShim activePage="home" onNavigate={onNavigate} />
    </div>
  );
}

function InfoPage({
  kind,
  onNavigate,
}: {
  kind: "rewards" | "help" | "terms";
  onNavigate: (page: Page) => void;
}) {
  const { translation: t } = useI18n();
  const content = t.infoPages[kind];
  const icon = kind === "rewards" ? "✦" : kind === "help" ? "?" : "≡";

  return (
    <div className="app-shell info-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={t.navigation.home} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button>
        
      </header>
      <main className="page info-page">
        <button className="back-button" type="button" onClick={() => onNavigate("home")}>
          ‹ {t.navigation.home}
        </button>
        <div className="eyebrow">{t.sidebar.title}</div>
        <h1 className="info-title">{content.title}</h1>
        <p className="info-description">{content.description}</p>
        <section className="info-panel">
          <span className="info-panel__icon" aria-hidden="true">{icon}</span>
          <p>{content.detail}</p>
        </section>
        {kind === "rewards" && (
          <div className="rewards-explainer">
            <section className="info-panel rewards-explainer__section">
              <h2>{t.infoPages.rewards.fundingTitle}</h2>
              <p>{t.infoPages.rewards.fundingDetail}</p>
            </section>
            <section className="info-panel rewards-explainer__section">
              <h2>{t.infoPages.rewards.distributionTitle}</h2>
              <ul>
                <li>{t.infoPages.rewards.distributionFirst}</li>
                <li>{t.infoPages.rewards.distributionRemainder}</li>
                <li>{t.infoPages.rewards.distributionTies}</li>
              </ul>
            </section>
            <section className="info-panel rewards-explainer__section">
              <h2>{t.infoPages.rewards.rolloverTitle}</h2>
              <p>{t.infoPages.rewards.rolloverDetail}</p>
            </section>
            <section className="info-panel rewards-explainer__section">
              <h2>{t.infoPages.rewards.statusTitle}</h2>
              <p>{t.infoPages.rewards.statusDetail}</p>
            </section>
          </div>
        )}
        {kind === "rewards" && (
          <button className="cta-button" type="button" onClick={() => onNavigate("competition")}>
            {t.navigation.competition}
          </button>
        )}
      </main>
    </div>
  );
}

function ContestRulesPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { translation: t } = useI18n();
  const rules = t.contestRules;

  return (
    <div className="app-shell info-shell">
      <header className="topbar">
        <button className="brand brand--home" type="button" aria-label={t.navigation.home} onClick={() => onNavigate("home")}><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></button>
      </header>
      <main className="page info-page challenge-rules-page">
        <button className="back-button" type="button" onClick={() => onNavigate("home")}>
          ‹ {t.navigation.home}
        </button>
        <div className="eyebrow">{rules.kicker}</div>
        <h1 className="info-title">{rules.title}</h1>
        <p className="info-description">{rules.description}</p>

        <section className="challenge-rules-list" aria-label={rules.stepsTitle}>
          {rules.steps.map((step, index) => (
            <article className="challenge-rule-step" key={step.title}>
              <span className="challenge-rule-step__number mono">{String(index + 1).padStart(2, "0")}</span>
              <div className="challenge-rule-step__copy">
                <h2>{step.title}</h2>
                <p>{step.description}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="challenge-rules-reward">
          <h2>{rules.rewardsTitle}</h2>
          <p>{rules.rewardsDetail}</p>
        </section>
        <p className="challenge-rules-notice" role="note">{rules.previewNotice}</p>
        <button className="cta-button" type="button" onClick={() => onNavigate("competition")}>
          START CHALLENGE
        </button>
      </main>
    </div>
  );
}

type GlobalSidebarProps = {
  currentPage: Page;
  isLoggedIn: boolean;
  onNavigate: (page: Page) => void;
  onAuth: (mode: AuthMode) => void;
  onLogout: () => void;
};

function GlobalSidebar({ currentPage, isLoggedIn, onNavigate, onAuth, onLogout }: GlobalSidebarProps) {
  const { translation: t, language } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  function navigateTo(page: Page) {
    onNavigate(page);
    setIsOpen(false);
  }

  const items: { page: Page; icon: string; label: string }[] = [
    { page: "home", icon: "⌂", label: t.navigation.home },
    { page: "competition", icon: "🔑", label: language === "en" ? "START CHALLENGE" : t.navigation.competition },
    { page: "rules", icon: "ⓘ", label: t.contestRules.title },
    { page: "leaderboard", icon: "🏆", label: t.sidebar.leaderboard },
    { page: "rewards", icon: "✦", label: t.sidebar.rewards },
    { page: "wallet", icon: "◈", label: t.navigation.wallet },
    { page: "profile", icon: "◎", label: t.navigation.profile },
    { page: "help", icon: "?", label: t.sidebar.helpCenter },
    { page: "terms", icon: "≡", label: t.sidebar.termsOfUse },
    ...(isLoggedIn && (JSON.parse(localStorage.getItem("walletFindUser") ?? "{}") as { role?: string }).role === "ADMIN"
      ? [{ page: "admin" as Page, icon: "⚙", label: language === "fa" ? "پنل مدیریت" : "Admin panel" }]
      : []),
  ];

  return (
    <>
      {isOpen && (
        <button className="global-sidebar-backdrop" type="button" aria-label={t.sidebar.closeMenu} onClick={() => setIsOpen(false)} />
      )}
      {!isOpen && (
        <button
          className={"global-sidebar-trigger" + (currentPage === "home" ? " global-sidebar-trigger--home" : "")}
          type="button"
          aria-controls="global-sidebar"
          aria-expanded={false}
          aria-label={t.sidebar.openMenu}
          onClick={() => setIsOpen(true)}
        >
          ☰
        </button>
      )}
      <aside
        id="global-sidebar"
        className={"global-sidebar" + (isOpen ? " global-sidebar--open" : "")}
        aria-label={t.sidebar.title}
        aria-hidden={!isOpen}
      >
        <div className="global-sidebar__header">
          <button type="button" className="sidebar-brand sidebar-brand--home" aria-label={t.navigation.home} onClick={() => navigateTo("home")}><strong><span className="brand-wallet">Wallet</span><span className="brand-find">Find</span></strong></button>
          <button type="button" className="global-sidebar__close" onClick={() => setIsOpen(false)} aria-label={t.sidebar.closeMenu}>×</button>
        </div>
        <div className="sidebar-home-tools" aria-label={language === "fa" ? "تنظیمات سریع" : "Quick settings"}>
          <SharedLanguageSwitcher />
        </div>
        <p className="sidebar-kicker">{t.sidebar.title}</p>
        <nav className="sidebar-nav">
          {items.map((item) => (
            <button
              key={item.page}
              type="button"
              className={"sidebar-link" + (currentPage === item.page ? " sidebar-link--active" : "")}
              onClick={() => navigateTo(item.page)}
              aria-current={currentPage === item.page ? "page" : undefined}
            >
              <span className={"sidebar-link__icon" + (item.page === "competition" ? " sidebar-link__icon--challenge" : item.page === "leaderboard" ? " sidebar-link__icon--leaderboard" : item.page === "wallet" ? " sidebar-link__icon--wallet" : item.page === "profile" ? " sidebar-link__icon--profile" : "")} aria-hidden="true">{item.page === "competition" ? <svg className="sidebar-link__key-svg" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="2.5"/><path d="M11.3 11.3 20 20m-4-4 2.2-2.2m-.2 4.2 2.2-2.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg> : item.page === "wallet" ? <svg className="sidebar-link__wallet-svg" viewBox="0 0 24 24" fill="none"><path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 8v11a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 15h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg> : item.page === "profile" ? <svg className="sidebar-link__profile-svg" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> : <span className="sidebar-link__glyph">{item.icon}</span>}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-auth">
          {isLoggedIn ? (
            <button type="button" className="sidebar-login sidebar-logout" onClick={() => { onLogout(); setIsOpen(false); }}>
              {t.profile.logout}
            </button>
          ) : (
            <>
              <button type="button" className="sidebar-login" onClick={() => { onAuth("login"); setIsOpen(false); }}>{t.sidebar.login}</button>
              <button type="button" className="sidebar-signup" onClick={() => { onAuth("signup"); setIsOpen(false); }}>{t.sidebar.signup}</button>
            </>
          )}
        </div>
        <p className="sidebar-footer">{t.sidebar.footer}</p>
      </aside>
    </>
  );
}

const PAGE_PATHS: Record<Page, string> = {
  home: "/",
  auth: "/auth",
  competition: "/competition",
  key: "/competition/key",
  leaderboard: "/leaderboard",
  profile: "/profile",
  wallet: "/wallet",
  rewards: "/rewards",
  help: "/help",
  terms: "/terms",
  rules: "/rules",
  admin: "/admin",
  "admin-manage": "/admin/manage",
};

const PATH_PAGES: Record<string, Page> = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([page, route]) => [route, page as Page]),
) as Record<string, Page>;

function getPageFromPath(pathname: string): Page | null {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (["/wallet/deposit", "/wallet/withdraw", "/wallet/history"].includes(normalizedPath)) return "wallet";
  return PATH_PAGES[normalizedPath] ?? null;
}

function getPathFromPage(page: Page): string {
  return PAGE_PATHS[page] ?? "/";
}

function isPublicPage(page: Page): boolean {
  return ["home", "auth", "leaderboard", "rewards", "help", "terms", "rules"].includes(page);
}

function App() {
  const { language, isRTL } = useI18n();
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "unauthenticated">(
    () => safelyReadSavedUser() ? "checking" : "unauthenticated",
  );
  const [authNotice, setAuthNotice] = useState("");
  const initialSavedUser = safelyReadSavedUser();
  const initialIsAdmin = initialSavedUser?.role === "ADMIN";

  const [page, setPageState] = useState<Page>(() => {
    const hasSavedSession = Boolean(safelyReadSavedUser());
    const requestedPage = getPageFromPath(window.location.pathname);

    if (window.location.pathname === "/admin-setup") {
      const destination = initialIsAdmin && hasSavedSession ? "admin" : "home";
      window.history.replaceState({}, "", getPathFromPage(destination));
      return destination;
    }

    if (requestedPage) {
      if (!hasSavedSession && !isPublicPage(requestedPage)) return "auth";
      if ((requestedPage === "admin" || requestedPage === "admin-manage") && !initialIsAdmin) return hasSavedSession ? "home" : "auth";
      return requestedPage;
    }

    // Keep compatibility with an older in-app session if the browser opens an unknown legacy URL.
    let savedPage: Page | null = null;
    try {
      const saved = sessionStorage.getItem("walletFindCurrentPage");
      if (saved && Object.prototype.hasOwnProperty.call(PAGE_PATHS, saved)) savedPage = saved as Page;
    } catch {
      // Fall back to the default page when session storage is unavailable.
    }

    if (hasSavedSession && savedPage && (savedPage !== "admin" && savedPage !== "admin-manage" || initialIsAdmin)) return savedPage;
    if (!hasSavedSession && savedPage && isPublicPage(savedPage)) return savedPage;
    return hasSavedSession ? "competition" : "home";
  });
  const navigatePage = useCallback((nextPage: Page) => {
    const nextPath = getPathFromPage(nextPage);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ walletFindPage: nextPage }, "", nextPath);
    }
    setPageState(nextPage);
  }, []);
  const [authMode, setAuthMode] = useState<AuthMode>(() =>
    safelyReadSavedUser() ? "login" : "signup",
  );

  useEffect(() => {
    // Remove the legacy browser-stored bearer credential after migration.
    localStorage.removeItem("walletFindToken");
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem("walletFindCurrentPage", page);
    } catch {
      // Navigation still works if the browser blocks session storage.
    }

    const canonicalPath = getPathFromPage(page);
    const isWalletSubpage = page === "wallet" && /^\/wallet\/(deposit|withdraw|history)\/?$/.test(window.location.pathname);
    if (!isWalletSubpage && window.location.pathname !== canonicalPath) {
      window.history.replaceState({ walletFindPage: page }, "", canonicalPath);
    }
  }, [page]);

  useEffect(() => {
    const handlePopState = () => {
      const requestedPage = getPageFromPath(window.location.pathname) ?? "home";
      const hasSavedSession = Boolean(safelyReadSavedUser());
      const userIsAdmin = safelyReadSavedUser()?.role === "ADMIN";

      if (!hasSavedSession && !isPublicPage(requestedPage)) {
        setPageState("auth");
        return;
      }
      if ((requestedPage === "admin" || requestedPage === "admin-manage") && !userIsAdmin) {
        setPageState(hasSavedSession ? "home" : "auth");
        return;
      }
      setPageState(requestedPage);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
  }, [language, isRTL]);

  const handleSessionExpired = useCallback(() => {
    localStorage.removeItem("walletFindUser");
    setAuthStatus("unauthenticated");
    setAuthMode("login");
    setAuthNotice("SESSION_EXPIRED");
    navigatePage("auth");
  }, [navigatePage]);

  useEffect(() => {
    const handleSessionExpiredEvent = () => handleSessionExpired();
    window.addEventListener("wallet-find:session-expired", handleSessionExpiredEvent);
    return () => window.removeEventListener("wallet-find:session-expired", handleSessionExpiredEvent);
  }, [handleSessionExpired, navigatePage]);

  useEffect(() => {
    if (!safelyReadSavedUser()) return;

    let cancelled = false;
    getProfile()
      .then((profile) => {
        if (cancelled) return;
        localStorage.setItem("walletFindUser", JSON.stringify({
          id: profile.id,
          email: profile.email,
          username: profile.username,
          role: profile.role,
          createdAt: profile.createdAt,
        }));
        setAuthStatus("authenticated");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        if (
          message === "SESSION_EXPIRED" ||
          message === "TOKEN_EXPIRED" ||
          message === "INVALID_TOKEN" ||
          message === "INVALID_AUTHORIZATION_HEADER" ||
          message === "AUTHENTICATION_REQUIRED"
        ) {
          handleSessionExpired();
          return;
        }
        if (message === "USER_NOT_FOUND") {
          localStorage.removeItem("walletFindUser");
          setAuthStatus("unauthenticated");
          setAuthMode("signup");
          setAuthNotice("");
          navigatePage("auth");
          return;
        }

        // Keep a previously confirmed local session during temporary network/server failures.
        if (safelyReadSavedUser()) {
          setAuthStatus("authenticated");
        } else {
          setAuthStatus("unauthenticated");
          setAuthMode("signup");
          navigatePage("auth");
        }
      });

    return () => { cancelled = true; };
  }, [handleSessionExpired, navigatePage]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    getProfile().then((profile) => {
      if (cancelled) return;
      window.dispatchEvent(new CustomEvent("wallet-find:preferences-loaded", {
        detail: { uiLanguage: profile.uiLanguage, challengeLanguage: profile.challengeLanguage },
      }));
    }).catch(() => {
      // Keep the device's saved locale if the preference endpoint is temporarily unavailable.
    });
    return () => { cancelled = true; };
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;

    let cancelled = false;
    let inFlight = false;

    async function recordOnlinePresence() {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await sendOnlineHeartbeat();
      } catch {
        // Presence is best-effort; temporary failures must not interrupt navigation.
      } finally {
        inFlight = false;
      }
    }

    void recordOnlinePresence();
    const intervalId = window.setInterval(() => void recordOnlinePresence(), 30000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void recordOnlinePresence();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authStatus]);

  const savedUser = safelyReadSavedUser();
  const isAdmin = authStatus === "authenticated" && savedUser?.role === "ADMIN";

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    navigatePage("auth");
  }

  function handleAuthenticated(user: AuthUser) {
    localStorage.setItem("walletFindUser", JSON.stringify(user));
    setAuthNotice("");
    setAuthStatus("authenticated");
    navigatePage("competition");
  }

  function handleLogout() {
    void logout().catch(() => undefined);
    localStorage.removeItem("walletFindUser");
    setAuthNotice("");
    setAuthStatus("unauthenticated");
    setAuthMode("signup");
    navigatePage("auth");
  }

  const isLoggedIn = authStatus === "authenticated";
  if (authStatus === "checking") {
    return (
      <div className="app-shell session-checking">
        <LoadingIndicator />
      </div>
    );
  }

  let currentView: ReactNode;

  if (page === "auth") {
    currentView = <AuthPage initialMode={authMode} initialNotice={authNotice} onAuthenticated={handleAuthenticated} onOpenTerms={() => navigatePage("terms")} onBack={() => {
      if (!isLoggedIn) {
        setAuthMode("signup");
        navigatePage("auth");
      } else {
        navigatePage("home");
      }
    }} />;
  } else if (page === "admin" && isAdmin) {
    currentView = <AdminControlCenter onNavigate={navigatePage} />;
  } else if (page === "admin-manage" && isAdmin) {
    currentView = <AdminPage onNavigate={navigatePage} />;
  } else if (page === "competition") {
    currentView = isLoggedIn
      ? <CompetitionPage onNavigate={navigatePage} />
      : <AuthPage initialMode="signup" onAuthenticated={handleAuthenticated} onOpenTerms={() => navigatePage("terms")} onBack={() => navigatePage("auth")} />;
  } else if (page === "leaderboard") {
    currentView = <LeaderboardPage onNavigate={navigatePage} />;
  } else if (page === "profile") {
    currentView = isLoggedIn
      ? <ProfilePage onNavigate={navigatePage} onLogout={handleLogout} />
      : <AuthPage initialMode="signup" onAuthenticated={handleAuthenticated} onOpenTerms={() => navigatePage("terms")} onBack={() => navigatePage("auth")} />;
  } else if (page === "key") {
    currentView = <KeyStagePage onNavigate={navigatePage} />;
  } else if (page === "rewards" || page === "help" || page === "terms") {
    currentView = <InfoPage kind={page} onNavigate={navigatePage} />;
  } else if (page === "rules") {
    currentView = <ContestRulesPage onNavigate={navigatePage} />;
  } else if (page === "wallet") {
    currentView = isLoggedIn
      ? <WalletPage onNavigate={navigatePage} />
      : <AuthPage initialMode="signup" onAuthenticated={handleAuthenticated} onOpenTerms={() => navigatePage("terms")} onBack={() => navigatePage("auth")} />;
  } else {
    currentView = <HomePage onNavigate={navigatePage} onAuth={openAuth} language={language} isLoggedIn={isLoggedIn} />;
  }

  return (
    <>
      <GlobalSidebar
        currentPage={page}
        isLoggedIn={isLoggedIn}
        onNavigate={(nextPage) => {
          if (!isLoggedIn && ["competition", "profile", "wallet", "key"].includes(nextPage)) {
            setAuthMode("signup");
            navigatePage("auth");
            return;
          }
          navigatePage(nextPage);
        }}
        onAuth={openAuth}
        onLogout={handleLogout}
      />
      {currentView}
    </>
  );
}

function safelyReadSavedUser(): { id?: string; email?: string; username?: string; role?: string; createdAt?: string } | null {
  try {
    const raw = localStorage.getItem("walletFindUser");
    return raw ? JSON.parse(raw) as { id?: string; email?: string; username?: string; role?: string; createdAt?: string } : null;
  } catch {
    localStorage.removeItem("walletFindUser");
    return null;
  }
}

function BottomNavShim({ activePage, onNavigate }: { activePage: Page; onNavigate: (page: Page) => void }) {
  const { translation: t } = useI18n();
  return (
    <nav className="bottom-nav" aria-label={t.navigation.ariaLabel}>
      <button className={`nav-item ${activePage === "home" ? "nav-item--active" : ""}`} onClick={() => onNavigate("home")} type="button" aria-current={activePage === "home" ? "page" : undefined}><span className="nav-icon" aria-hidden="true">⌂</span><span>{t.navigation.home}</span></button>
      <button className={`nav-item ${activePage === "leaderboard" ? "nav-item--active" : ""}`} onClick={() => onNavigate("leaderboard")} type="button" aria-current={activePage === "leaderboard" ? "page" : undefined}><span className="nav-icon nav-icon--leaderboard" aria-hidden="true"><span className="nav-icon__trophy">🏆</span></span><span>{t.navigation.leaderboard}</span></button>
      <button className={`nav-item ${activePage === "competition" ? "nav-item--active" : ""}`} onClick={() => onNavigate("competition")} type="button" aria-current={activePage === "competition" ? "page" : undefined}><span className="nav-icon nav-icon--challenge" aria-hidden="true"><svg className="nav-icon__key-svg" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="2.5"/><path d="M11.3 11.3 20 20m-4-4 2.2-2.2m-.2 4.2 2.2-2.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span>{t.navigation.competition}</span></button>
      <button className={`nav-item ${activePage === "wallet" ? "nav-item--active" : ""}`} onClick={() => onNavigate("wallet")} type="button" aria-current={activePage === "wallet" ? "page" : undefined}><span className="nav-icon nav-icon--wallet" aria-hidden="true"><svg className="nav-icon__wallet-svg" viewBox="0 0 24 24" fill="none"><path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 8v11a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 15h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></span><span>{t.navigation.wallet}</span></button>
      <button className={`nav-item ${activePage === "profile" ? "nav-item--active" : ""}`} onClick={() => onNavigate("profile")} type="button" aria-current={activePage === "profile" ? "page" : undefined}><span className="nav-icon nav-icon--profile" aria-hidden="true"><svg className="nav-icon__profile-svg" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span><span>{t.navigation.profile}</span></button>
    </nav>
  );
}

export default App;
