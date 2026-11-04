import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fa } from "./translations/fa";
import { en } from "./translations/en";
import { CHALLENGE_LANGUAGES, isChallengeLanguage, type ChallengeLanguage } from "./challenge-languages";
import { updateLanguagePreferences } from "../services/api";

export const languages = {
  fa: fa as Translation,
  en: en as Translation,
  de: en as Translation,
  es: en as Translation,
  fr: en as Translation,
  ar: en as Translation,
  tr: en as Translation,
  pt: en as Translation,
  ru: en as Translation,
  "zh-CN": en as Translation,
} satisfies Record<ChallengeLanguage, Translation>;

export type Language = ChallengeLanguage;
export type Translation = typeof fa;

type I18nContextValue = {
  language: Language;
  translation: Translation;
  changeLanguage: (language: Language) => void;
  challengeLanguage: ChallengeLanguage;
  changeChallengeLanguage: (language: ChallengeLanguage) => void;
  isRTL: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function getTranslation(language: Language): Translation {
  return languages[language];
}

export function isRTL(language: Language): boolean {
  return language === "fa" || language === "ar";
}

function detectBrowserLanguage(): Language {
  if (typeof navigator === "undefined") return "fa";
  const candidates = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (normalized === "zh-cn" || normalized.startsWith("zh-hans")) return "zh-CN";
    const base = normalized.split("-")[0];
    const match = CHALLENGE_LANGUAGES.find((item) => item.code.toLowerCase() === base);
    if (match) return match.code;
  }
  return "en";
}

function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "fa";
  const saved = window.localStorage.getItem("walletFindLanguage");
  return isChallengeLanguage(saved) ? saved : detectBrowserLanguage();
}

function getInitialChallengeLanguage(uiLanguage: Language): ChallengeLanguage {
  if (typeof window === "undefined") return uiLanguage;
  const saved = window.localStorage.getItem("walletFindContestLanguage");
  return isChallengeLanguage(saved) ? saved : uiLanguage;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
  const [challengeLanguage, setChallengeLanguage] = useState<ChallengeLanguage>(() => getInitialChallengeLanguage(getInitialLanguage()));

  const persistPreferences = useCallback((ui: Language, challenge: ChallengeLanguage) => {
    window.localStorage.setItem("walletFindLanguage", ui);
    window.localStorage.setItem("walletFindContestLanguage", challenge);
    if (window.localStorage.getItem("walletFindToken")) {
      void updateLanguagePreferences(ui, challenge).catch(() => {
        // Keep local preferences available during temporary API failures.
      });
    }
  }, []);

  const changeLanguage = useCallback((nextLanguage: Language) => {
    setLanguage(nextLanguage);
    persistPreferences(nextLanguage, challengeLanguage);
  }, [challengeLanguage, persistPreferences]);

  const changeChallengeLanguage = useCallback((nextLanguage: ChallengeLanguage) => {
    setChallengeLanguage(nextLanguage);
    persistPreferences(language, nextLanguage);
  }, [language, persistPreferences]);

  useEffect(() => {
    const handlePreferencesLoaded = (event: Event) => {
      const detail = (event as CustomEvent<{ uiLanguage?: string; challengeLanguage?: string }>).detail;
      if (isChallengeLanguage(detail?.uiLanguage)) setLanguage(detail.uiLanguage);
      if (isChallengeLanguage(detail?.challengeLanguage)) setChallengeLanguage(detail.challengeLanguage);
    };
    window.addEventListener("wallet-find:preferences-loaded", handlePreferencesLoaded);
    return () => window.removeEventListener("wallet-find:preferences-loaded", handlePreferencesLoaded);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = isRTL(language) ? "rtl" : "ltr";
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      translation: getTranslation(language),
      changeLanguage,
      challengeLanguage,
      changeChallengeLanguage,
      isRTL: isRTL(language),
    }),
    [language, changeLanguage, challengeLanguage, changeChallengeLanguage],
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
