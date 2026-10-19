import { useI18n } from "../i18n";

function LanguageSwitcher() {
  const { language, changeLanguage } = useI18n();
  const isPersian = language === "fa";

  return (
    <div className="language-switcher" role="group" aria-label={isPersian ? "تغییر زبان" : "Change language"}>
      <button
        type="button"
        className={language === "fa" ? "active" : ""}
        aria-pressed={language === "fa"}
        onClick={() => changeLanguage("fa")}
      >
        {isPersian ? "فارسی" : "Persian"}
      </button>
      <button
        type="button"
        className={language === "en" ? "active" : ""}
        aria-pressed={language === "en"}
        onClick={() => changeLanguage("en")}
      >
        {isPersian ? "انگلیسی" : "English"}
      </button>
    </div>
  );
}

export default LanguageSwitcher;
