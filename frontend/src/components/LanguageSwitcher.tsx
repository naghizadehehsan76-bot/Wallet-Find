import { useEffect, useRef, useState } from "react";
import { useI18n, type Language } from "../i18n";
import { CHALLENGE_LANGUAGES, type ChallengeLanguage } from "../i18n/challenge-languages";

const LANGUAGE_FLAGS: Record<ChallengeLanguage, string> = {
  fa: "🇮🇷",
  en: "🇬🇧",
  de: "🇩🇪",
  es: "🇪🇸",
  fr: "🇫🇷",
  ar: "🇸🇦",
  tr: "🇹🇷",
  pt: "🇧🇷",
  ru: "🇷🇺",
  "zh-CN": "🇨🇳",
};

type PickerKind = "ui" | "challenge";

function LanguagePicker({
  kind,
  value,
  onChange,
  isRTL,
}: {
  kind: PickerKind;
  value: ChallengeLanguage;
  onChange: (value: ChallengeLanguage) => void;
  isRTL: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = CHALLENGE_LANGUAGES.find((item) => item.code === value) ?? CHALLENGE_LANGUAGES[0];
  const label = kind === "ui"
    ? (isRTL ? "زبان محیط کاربری" : "Interface language")
    : (isRTL ? "زبان چالش" : "Challenge language");

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="wf-language-picker" ref={rootRef}>
      <span className="wf-language-picker__label">{label}</span>
      <button
        type="button"
        className="wf-language-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label + ": " + current.nativeName}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="wf-language-picker__current">
          <span className="wf-language-picker__flag" aria-hidden="true">{LANGUAGE_FLAGS[value]}</span>
          <span className="wf-language-picker__name">{current.nativeName}</span>
        </span>
        <span className={"wf-language-picker__chevron" + (open ? " is-open" : "")} aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="wf-language-picker__menu" role="listbox" aria-label={label} dir={isRTL ? "rtl" : "ltr"}>
          {CHALLENGE_LANGUAGES.map(({ code, nativeName }) => (
            <button
              type="button"
              role="option"
              aria-selected={value === code}
              key={code}
              className={"wf-language-picker__option" + (value === code ? " is-selected" : "")}
              onClick={() => {
                onChange(code);
                setOpen(false);
              }}
            >
              <span className="wf-language-picker__flag" aria-hidden="true">{LANGUAGE_FLAGS[code]}</span>
              <span>{nativeName}</span>
              {value === code && <span className="wf-language-picker__check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChallengeLanguagePicker({
  onLanguageChange,
}: {
  onLanguageChange?: (value: ChallengeLanguage) => void;
}) {
  const { challengeLanguage, changeChallengeLanguage, isRTL } = useI18n();

  return (
    <LanguagePicker
      kind="challenge"
      value={challengeLanguage}
      onChange={onLanguageChange ?? changeChallengeLanguage}
      isRTL={isRTL}
    />
  );
}

function LanguageSwitcher() {
  const { language, changeLanguage, challengeLanguage, changeChallengeLanguage, isRTL } = useI18n();

  return (
    <div className="wf-language-settings" aria-label={isRTL ? "تنظیم زبان‌ها" : "Language settings"}>
      <LanguagePicker
        kind="ui"
        value={language}
        onChange={(next) => changeLanguage(next as Language)}
        isRTL={isRTL}
      />
      <LanguagePicker
        kind="challenge"
        value={challengeLanguage}
        onChange={changeChallengeLanguage}
        isRTL={isRTL}
      />
    </div>
  );
}

export default LanguageSwitcher;
