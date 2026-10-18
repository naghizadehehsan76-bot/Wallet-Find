import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fa } from "./translations/fa";
import { en } from "./translations/en";

export const languages = {
  fa,
  en,
} as const;

export type Language = keyof typeof languages;
export type Translation = typeof fa;

type I18nContextValue = {
  language: Language;
  translation: Translation;
  changeLanguage: (language: Language) => void;
  isRTL: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function getTranslation(language: Language): Translation {
  return languages[language] as Translation;
}

export function isRTL(language: Language): boolean {
  return language === "fa";
}

function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "fa";

  const saved = window.localStorage.getItem("walletFindLanguage");
  return saved === "en" || saved === "fa" ? saved : "fa";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);

  const changeLanguage = useCallback((nextLanguage: Language) => {
    setLanguage(nextLanguage);
    window.localStorage.setItem("walletFindLanguage", nextLanguage);
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
      isRTL: isRTL(language),
    }),
    [language, changeLanguage],
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return context;
}
