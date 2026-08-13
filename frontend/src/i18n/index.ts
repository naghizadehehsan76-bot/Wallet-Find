import { useState } from "react";
import { fa } from "./translations/fa";
import { en } from "./translations/en";

export const languages = {
  fa,
  en,
} as const;

export type Language = keyof typeof languages;

export type Translation = typeof fa;

export function getTranslation(
  language: Language,
): Translation {
  return languages[language] as Translation;
}

export function isRTL(language: Language): boolean {
  return language === "fa";
}

export function useI18n() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("walletFindLanguage");

    return saved === "en" || saved === "fa"
      ? saved
      : "fa";
  });

  const translation = getTranslation(language);

  function changeLanguage(
    nextLanguage: Language,
  ) {
    setLanguage(nextLanguage);
    localStorage.setItem(
      "walletFindLanguage",
      nextLanguage,
    );
  }

  return {
    language,
    translation,
    changeLanguage,
    isRTL: isRTL(language),
  };
}
