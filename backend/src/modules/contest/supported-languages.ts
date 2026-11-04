export const CHALLENGE_LANGUAGES = [
  "fa",
  "en",
  "de",
  "es",
  "fr",
  "ar",
  "tr",
  "pt",
  "ru",
  "zh-CN",
] as const;

export type ChallengeLanguage = (typeof CHALLENGE_LANGUAGES)[number];

const WIKIPEDIA_LANGUAGE_CODES: Record<ChallengeLanguage, string> = {
  fa: "fa",
  en: "en",
  de: "de",
  es: "es",
  fr: "fr",
  ar: "ar",
  tr: "tr",
  pt: "pt",
  ru: "ru",
  "zh-CN": "zh",
};

export const CHALLENGE_LANGUAGE_NAMES: Record<ChallengeLanguage, string> = {
  fa: "فارسی",
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  ar: "العربية",
  tr: "Türkçe",
  pt: "Português",
  ru: "Русский",
  "zh-CN": "简体中文",
};

export function isChallengeLanguage(value: unknown): value is ChallengeLanguage {
  return typeof value === "string" &&
    (CHALLENGE_LANGUAGES as readonly string[]).includes(value);
}

export function getWikipediaLanguageCode(language: ChallengeLanguage): string {
  return WIKIPEDIA_LANGUAGE_CODES[language];
}

export function getWikipediaDomain(language: ChallengeLanguage): string {
  return `${getWikipediaLanguageCode(language)}.wikipedia.org`;
}
