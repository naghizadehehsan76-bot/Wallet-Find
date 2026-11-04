export const CHALLENGE_LANGUAGES = [
  { code: "fa", nativeName: "فارسی" },
  { code: "en", nativeName: "English" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
  { code: "fr", nativeName: "Français" },
  { code: "ar", nativeName: "العربية" },
  { code: "tr", nativeName: "Türkçe" },
  { code: "pt", nativeName: "Português" },
  { code: "ru", nativeName: "Русский" },
  { code: "zh-CN", nativeName: "简体中文" },
] as const;

export type ChallengeLanguage = (typeof CHALLENGE_LANGUAGES)[number]["code"];

export function isChallengeLanguage(value: string | null | undefined): value is ChallengeLanguage {
  return CHALLENGE_LANGUAGES.some((language) => language.code === value);
}

export function getChallengeLanguageName(code: ChallengeLanguage): string {
  return CHALLENGE_LANGUAGES.find((language) => language.code === code)?.nativeName ?? code;
}
