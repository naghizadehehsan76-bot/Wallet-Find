type UiLanguage = "fa" | "en";

const apiErrors: Record<string, { fa: string; en: string }> = {
  ACTIVE_CONTEST_NOT_FOUND: { fa: "در حال حاضر مسابقه‌ی فعالی پیدا نشد. کمی بعد دوباره تلاش کن.", en: "No active contest was found. Please try again shortly." },
  CONTEST_NOT_STARTED: { fa: "مسابقه هنوز شروع نشده است.", en: "The contest has not started yet." },
  CONTEST_FINISHED: { fa: "این مسابقه به پایان رسیده است.", en: "This contest has ended." },
  CONTEST_NOT_FOUND: { fa: "مسابقه پیدا نشد.", en: "Contest not found." },
  CONTEST_NOT_ACTIVE: { fa: "این مسابقه فعال نیست.", en: "This contest is not active." },
  CONTEST_REQUIRES_12_CLUES: { fa: "این مسابقه هنوز ۱۲ سرنخ کامل ندارد.", en: "This contest does not have all 12 clues yet." },
  CONTEST_NOT_COMPLETED_BY_USER: { fa: "برای شروع مسابقه‌ی بعدی باید هر ۱۲ راند مسابقه‌ی فعلی را کامل کنی.", en: "Complete all 12 rounds of the current contest before starting the next one." },
  NEXT_CONTEST_GENERATION_FAILED: { fa: "فعلاً ساخت مسابقه‌ی بعدی ممکن نشد. چند لحظه بعد دوباره تلاش کن.", en: "The next contest could not be generated right now. Please try again shortly." },
  NEXT_CONTEST_FAILED: { fa: "شروع مسابقه‌ی بعدی ناموفق بود. دوباره تلاش کن.", en: "Could not start the next contest. Please try again." },
  CONTEST_CLUES_LOCKED: { fa: "سرنخ‌های این مسابقه دیگر قابل ویرایش نیستند.", en: "The clues for this contest can no longer be edited." },
  CONTEST_ALREADY_SOLVED: { fa: "این راند قبلاً حل شده است.", en: "This round has already been solved." },
  CLUE_NOT_CURRENT: { fa: "ابتدا باید راند فعلی را حل کنی.", en: "You must solve the current round first." },
  CLUE_NOT_PUBLISHED: { fa: "این سرنخ هنوز منتشر نشده است.", en: "This clue has not been published yet." },
  AUTHENTICATION_REQUIRED: { fa: "برای ادامه وارد حساب خودت شو.", en: "Please sign in to continue." },
  TOKEN_EXPIRED: { fa: "نشست ورودت منقضی شده است؛ دوباره وارد حساب شو.", en: "Your session has expired. Please sign in again." },
  INVALID_TOKEN: { fa: "نشست ورود معتبر نیست؛ دوباره وارد حساب شو.", en: "Your session is invalid. Please sign in again." },
  INVALID_AUTHORIZATION_HEADER: { fa: "اطلاعات ورود معتبر نیست؛ دوباره وارد حساب شو.", en: "Your sign-in credentials are invalid. Please sign in again." },
  ADMIN_ACCESS_REQUIRED: { fa: "این بخش فقط برای مدیر سایت در دسترس است.", en: "This section is available to site administrators only." },
  INVALID_INPUT: { fa: "اطلاعات واردشده معتبر نیست. موارد را بررسی کن.", en: "Some of the entered information is invalid. Please check it." },
  INVALID_START_TIME: { fa: "زمان شروع معتبر نیست.", en: "The start time is invalid." },
  INVALID_END_TIME: { fa: "زمان پایان معتبر نیست.", en: "The end time is invalid." },
  END_TIME_MUST_BE_AFTER_START_TIME: { fa: "زمان پایان باید بعد از زمان شروع باشد.", en: "The end time must be after the start time." },
  REQUEST_FAILED: { fa: "درخواست ناموفق بود. دوباره تلاش کن.", en: "The request failed. Please try again." },
  INVALID_SERVER_RESPONSE: { fa: "پاسخ سرور قابل خواندن نیست. دوباره تلاش کن.", en: "The server response could not be read. Please try again." },
  MISSING_RESPONSE_DATA: { fa: "اطلاعات موردنیاز از سرور دریافت نشد.", en: "The server did not return the expected data." },
  INTERNAL_SERVER_ERROR: { fa: "خطای داخلی سرور رخ داد. کمی بعد دوباره تلاش کن.", en: "A server error occurred. Please try again shortly." },
  NETWORK_ERROR: { fa: "اتصال به سرور برقرار نشد. اتصال اینترنت را بررسی کن.", en: "Could not connect to the server. Check your internet connection." },
};

export function localizeApiError(error: unknown, language: UiLanguage): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  if (!message) {
    return language === "fa"
      ? "مشکلی رخ داد. لطفاً دوباره تلاش کن."
      : "Something went wrong. Please try again.";
  }
  const localized = apiErrors[message];
  if (localized) return localized[language];
  if (/^[A-Z][A-Z0-9_]+$/.test(message)) {
    return language === "fa"
      ? "مشکلی رخ داد. لطفاً دوباره تلاش کن."
      : "Something went wrong. Please try again.";
  }
  return message;
}

export function localizeContestTitle(title: string | null | undefined, language: UiLanguage): string {
  const normalized = title?.trim().toLocaleLowerCase();
  if (
    !normalized ||
    normalized === "مسابقه واژه‌یابی انگلیسی wallet find" ||
    normalized === "wallet find english word-finding contest"
  ) {
    return language === "fa"
      ? "مسابقه واژه‌یابی انگلیسی Wallet Find"
      : "Wallet Find English Word-Finding Contest";
  }
  return title ?? (language === "fa" ? "مسابقه واژه‌یابی" : "Word-Finding Contest");
}
