import { useI18n } from "../i18n";
import { CHALLENGE_LANGUAGES } from "../i18n/challenge-languages";

function LanguageSwitcher() {
  const { language, changeLanguage, isRTL } = useI18n();
  return (
    <label className="language-switcher" aria-label={isRTL ? "تغییر زبان رابط" : "Interface language"}>
      <span className="sr-only">{isRTL ? "زبان رابط" : "Interface language"}</span>
      <select value={language} onChange={(event) => changeLanguage(event.target.value as typeof language)}>
        {CHALLENGE_LANGUAGES.map(({ code, nativeName }) => (
          <option key={code} value={code}>{nativeName}</option>
        ))}
      </select>
    </label>
  );
}

export default LanguageSwitcher;
