type UiLanguage = "fa" | "en";

const apiErrors: Record<string, { fa: string; en: string }> = {
  ACTIVE_CONTEST_NOT_FOUND: { fa: "در حال حاضر چالش فعالی پیدا نشد. کمی بعد دوباره تلاش کن.", en: "No active challenge was found. Please try again shortly." },
  CONTEST_NOT_STARTED: { fa: "چالش هنوز شروع نشده است.", en: "The challenge has not started yet." },
  CONTEST_FINISHED: { fa: "این چالش به پایان رسیده است.", en: "This challenge has ended." },
  CONTEST_NOT_FOUND: { fa: "چالش پیدا نشد.", en: "Challenge not found." },
  CONTEST_NOT_ACTIVE: { fa: "این چالش فعال نیست.", en: "This challenge is not active." },
  CONTEST_REQUIRES_12_CLUES: { fa: "این چالش هنوز ۱۲ سرنخ کامل ندارد.", en: "This challenge does not have all 12 clues yet." },
  CONTEST_NOT_COMPLETED_BY_USER: { fa: "برای شروع چالش بعدی باید هر ۱۲ راند چالش فعلی را کامل کنی.", en: "Complete all 12 rounds of the current challenge before starting the next one." },
  NEXT_CONTEST_GENERATION_FAILED: { fa: "فعلاً ساخت چالش بعدی ممکن نشد. چند لحظه بعد دوباره تلاش کن.", en: "The next challenge could not be generated right now. Please try again shortly." },
  NEXT_CONTEST_FAILED: { fa: "شروع چالش بعدی ناموفق بود. دوباره تلاش کن.", en: "Could not start the next challenge. Please try again." },
  CONTEST_CLUES_LOCKED: { fa: "سرنخ‌های این چالش دیگر قابل ویرایش نیستند.", en: "The clues for this challenge can no longer be edited." },
  CONTEST_ALREADY_SOLVED: { fa: "این راند قبلاً حل شده است.", en: "This round has already been solved." },
  CLUE_NOT_CURRENT: { fa: "ابتدا باید راند فعلی را حل کنی.", en: "You must solve the current round first." },
  CLUE_NOT_PUBLISHED: { fa: "این سرنخ هنوز منتشر نشده است.", en: "This clue has not been published yet." },
  AUTHENTICATION_REQUIRED: { fa: "برای ادامه وارد حساب خودت شو.", en: "Please sign in to continue." },
  EMAIL_NOT_REGISTERED: { fa: "این ایمیل ثبت‌نام نشده است. ابتدا ثبت‌نام کنید.", en: "This email is not registered. Please sign up first." },
  INVALID_PASSWORD: { fa: "رمز عبور اشتباه است. دوباره تلاش کنید.", en: "Incorrect password. Please try again." },
  EMAIL_OR_USERNAME_ALREADY_EXISTS: { fa: "این ایمیل یا نام کاربری قبلاً ثبت شده است.", en: "This email or username is already registered." },
  TOKEN_EXPIRED: { fa: "نشست ورودت منقضی شده است؛ دوباره وارد حساب شو.", en: "Your session has expired. Please sign in again." },
  INVALID_TOKEN: { fa: "نشست ورود معتبر نیست؛ دوباره وارد حساب شو.", en: "Your session is invalid. Please sign in again." },
  INVALID_AUTHORIZATION_HEADER: { fa: "اطلاعات ورود معتبر نیست؛ دوباره وارد حساب شو.", en: "Your sign-in credentials are invalid. Please sign in again." },
  ADMIN_ACCESS_REQUIRED: { fa: "این بخش فقط برای مدیر سایت در دسترس است.", en: "This section is available to site administrators only." },
  FIXED_TEST_POOL_AMOUNT: { fa: "مبلغ صندوق هر دور در مرحلهٔ آزمایشی ثابت و برابر با ۱۰۰ USDT فرضی است.", en: "The simulated prize pool is fixed at 100 USDT per round during testing." },
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

const knownUiTexts: Record<string, { fa: string; en: string }> = {
  "در حال همگام‌سازی وضعیت چالش؛ دوباره خودکار تلاش می‌کنیم.": { fa: "در حال همگام‌سازی وضعیت چالش؛ دوباره خودکار تلاش می‌کنیم.", en: "Syncing challenge status. Retrying automatically." },
  "Syncing challenge status. Retrying automatically.": { fa: "در حال همگام‌سازی وضعیت چالش؛ دوباره خودکار تلاش می‌کنیم.", en: "Syncing challenge status. Retrying automatically." },
  "چالش آماده است؛ از اولین کلمه‌ی حل‌نشده شروع کن.": { fa: "چالش آماده است؛ از اولین کلمه‌ی حل‌نشده شروع کن.", en: "The challenge is ready. Start with your first unsolved word." },
  "The challenge is ready. Start with your first unsolved word.": { fa: "چالش آماده است؛ از اولین کلمه‌ی حل‌نشده شروع کن.", en: "The challenge is ready. Start with your first unsolved word." },
  "ثبت شد؛ دور بعد در زمان ثابت شروع می‌شود. صفحه به‌صورت خودکار آماده خواهد شد.": { fa: "ثبت شد؛ دور بعد در زمان ثابت شروع می‌شود. صفحه به‌صورت خودکار آماده خواهد شد.", en: "Scheduled. The next round starts at its fixed boundary; this page will update automatically." },
  "Scheduled. The next round starts at its fixed boundary; this page will update automatically.": { fa: "ثبت شد؛ دور بعد در زمان ثابت شروع می‌شود. صفحه به‌صورت خودکار آماده خواهد شد.", en: "Scheduled. The next round starts at its fixed boundary; this page will update automatically." },
  "راند بعدی هنوز آماده‌ی انتشار نیست؛ صفحه به‌صورت خودکار بررسی می‌شود.": { fa: "راند بعدی هنوز آماده‌ی انتشار نیست؛ صفحه به‌صورت خودکار بررسی می‌شود.", en: "The next round is not published yet. This page will check automatically." },
  "The next round is not published yet. This page will check automatically.": { fa: "راند بعدی هنوز آماده‌ی انتشار نیست؛ صفحه به‌صورت خودکار بررسی می‌شود.", en: "The next round is not published yet. This page will check automatically." },
  "خطا در دریافت چالش": { fa: "خطا در دریافت چالش", en: "Unable to load the challenge." },
  "Unable to load the challenge.": { fa: "خطا در دریافت چالش", en: "Unable to load the challenge." },
  "راند جدید آماده است؛ راهنما را بخوان و کلمه را پیدا کن.": { fa: "راند جدید آماده است؛ راهنما را بخوان و کلمه را پیدا کن.", en: "The next round is ready. Read the hint and find the word." },
  "The next round is ready. Read the hint and find the word.": { fa: "راند جدید آماده است؛ راهنما را بخوان و کلمه را پیدا کن.", en: "The next round is ready. Read the hint and find the word." },
  "تبریک! هر ۱۲ راند را کامل کردی.": { fa: "تبریک! هر ۱۲ راند را کامل کردی.", en: "Congratulations! You completed all 12 rounds." },
  "Congratulations! You completed all 12 rounds.": { fa: "تبریک! هر ۱۲ راند را کامل کردی.", en: "Congratulations! You completed all 12 rounds." },
  "ارتباط موقتاً قطع شده؛ دوباره به‌صورت خودکار تلاش می‌کنیم.": { fa: "ارتباط موقتاً قطع شده؛ دوباره به‌صورت خودکار تلاش می‌کنیم.", en: "Connection interrupted. Retrying automatically." },
  "Connection interrupted. Retrying automatically.": { fa: "ارتباط موقتاً قطع شده؛ دوباره به‌صورت خودکار تلاش می‌کنیم.", en: "Connection interrupted. Retrying automatically." },
  "چالش بعدی آماده است؛ راند اول را شروع کن.": { fa: "چالش بعدی آماده است؛ راند اول را شروع کن.", en: "The next challenge is ready. Start with round one." },
  "The next challenge is ready. Start with round one.": { fa: "چالش بعدی آماده است؛ راند اول را شروع کن.", en: "The next challenge is ready. Start with round one." },
  "فعلاً ساخت چالش بعدی ممکن نشد. چند لحظه بعد دوباره تلاش کن.": { fa: "فعلاً ساخت چالش بعدی ممکن نشد. چند لحظه بعد دوباره تلاش کن.", en: "The next challenge could not be generated right now. Please try again shortly." },
  "The next challenge could not be generated right now. Please try again shortly.": { fa: "فعلاً ساخت چالش بعدی ممکن نشد. چند لحظه بعد دوباره تلاش کن.", en: "The next challenge could not be generated right now. Please try again shortly." },
  "برای شروع چالش بعدی باید هر ۱۲ راند چالش فعلی را کامل کنی.": { fa: "برای شروع چالش بعدی باید هر ۱۲ راند چالش فعلی را کامل کنی.", en: "Complete all 12 rounds of the current challenge before starting the next one." },
  "Complete all 12 rounds of the current challenge before starting the next one.": { fa: "برای شروع چالش بعدی باید هر ۱۲ راند چالش فعلی را کامل کنی.", en: "Complete all 12 rounds of the current challenge before starting the next one." },
  "نشست ورودت منقضی شده است؛ دوباره وارد حساب شو.": { fa: "نشست ورودت منقضی شده است؛ دوباره وارد حساب شو.", en: "Your session has expired. Please sign in again." },
  "Your session has expired. Please sign in again.": { fa: "نشست ورودت منقضی شده است؛ دوباره وارد حساب شو.", en: "Your session has expired. Please sign in again." },
  "شروع چالش بعدی ناموفق بود. دوباره تلاش کن.": { fa: "شروع چالش بعدی ناموفق بود. دوباره تلاش کن.", en: "Could not start the next challenge. Please try again." },
  "Could not start the next challenge. Please try again.": { fa: "شروع چالش بعدی ناموفق بود. دوباره تلاش کن.", en: "Could not start the next challenge. Please try again." },
  "کلمه‌ی انگلیسی را در کادر مربوط به همین راند وارد کن.": { fa: "کلمه‌ی انگلیسی را در کادر مربوط به همین راند وارد کن.", en: "Type the English word into the box for this round." },
  "Type the English word into the box for this round.": { fa: "کلمه‌ی انگلیسی را در کادر مربوط به همین راند وارد کن.", en: "Type the English word into the box for this round." },
  "پاسخ غلط است. کلمه را در همین کادر اصلاح کن و دوباره بررسی کن.": { fa: "پاسخ غلط است. کلمه را در همین کادر اصلاح کن و دوباره بررسی کن.", en: "Incorrect answer. Edit the word in this box and try again." },
  "Incorrect answer. Edit the word in this box and try again.": { fa: "پاسخ غلط است. کلمه را در همین کادر اصلاح کن و دوباره بررسی کن.", en: "Incorrect answer. Edit the word in this box and try again." },
  "پاسخ درست بود! تبریک، هر ۱۲ راند را کامل کردی.": { fa: "پاسخ درست بود! تبریک، هر ۱۲ راند را کامل کردی.", en: "Correct answer! Congratulations, you completed all 12 rounds." },
  "Correct answer! Congratulations, you completed all 12 rounds.": { fa: "پاسخ درست بود! تبریک، هر ۱۲ راند را کامل کردی.", en: "Correct answer! Congratulations, you completed all 12 rounds." },
  "پاسخ درست بود! کلمه در کادر سبز باقی می‌ماند.": { fa: "پاسخ درست بود! کلمه در کادر سبز باقی می‌ماند.", en: "Correct answer! The word stays green in its box." },
  "Correct answer! The word stays green in its box.": { fa: "پاسخ درست بود! کلمه در کادر سبز باقی می‌ماند.", en: "Correct answer! The word stays green in its box." },
  "خطا در ثبت پاسخ": { fa: "خطا در ثبت پاسخ", en: "Unable to submit the answer." },
  "Unable to submit the answer.": { fa: "خطا در ثبت پاسخ", en: "Unable to submit the answer." },
  "چالش زمان‌بندی شد. پس از تکمیل ۱۲ سرنخ، فعال‌سازی به‌صورت خودکار انجام می‌شود.": { fa: "چالش زمان‌بندی شد. پس از تکمیل ۱۲ سرنخ، فعال‌سازی به‌صورت خودکار انجام می‌شود.", en: "The challenge is scheduled. It will activate automatically after all 12 clues are complete." },
  "The challenge is scheduled. It will activate automatically after all 12 clues are complete.": { fa: "چالش زمان‌بندی شد. پس از تکمیل ۱۲ سرنخ، فعال‌سازی به‌صورت خودکار انجام می‌شود.", en: "The challenge is scheduled. It will activate automatically after all 12 clues are complete." },
  "چالش ساخته شد. حالا ۱۲ سرنخ را ثبت کن.": { fa: "چالش ساخته شد. حالا ۱۲ سرنخ را ثبت کن.", en: "Challenge created. Now add all 12 clues." },
  "Challenge created. Now add all 12 clues.": { fa: "چالش ساخته شد. حالا ۱۲ سرنخ را ثبت کن.", en: "Challenge created. Now add all 12 clues." },
  "هر ۱۲ سرنخ ثبت شد. Scheduler چالش را در زمان تعیین‌شده فعال می‌کند.": { fa: "هر ۱۲ سرنخ ثبت شد. Scheduler چالش را در زمان تعیین‌شده فعال می‌کند.", en: "All 12 clues have been saved. The scheduler will activate the challenge at the scheduled time." },
  "All 12 clues have been saved. The scheduler will activate the challenge at the scheduled time.": { fa: "هر ۱۲ سرنخ ثبت شد. Scheduler چالش را در زمان تعیین‌شده فعال می‌کند.", en: "All 12 clues have been saved. The scheduler will activate the challenge at the scheduled time." },
  "هر ۱۲ سرنخ ثبت شد. چالش آماده فعال‌سازی است.": { fa: "هر ۱۲ سرنخ ثبت شد. چالش آماده فعال‌سازی است.", en: "All 12 clues have been saved. The challenge is ready to activate." },
  "All 12 clues have been saved. The challenge is ready to activate.": { fa: "هر ۱۲ سرنخ ثبت شد. چالش آماده فعال‌سازی است.", en: "All 12 clues have been saved. The challenge is ready to activate." },
  "چالش فعال شد و بازیکنان می‌توانند وارد شوند.": { fa: "چالش فعال شد و بازیکنان می‌توانند وارد شوند.", en: "The challenge is active and players can join." },
  "The challenge is active and players can join.": { fa: "چالش فعال شد و بازیکنان می‌توانند وارد شوند.", en: "The challenge is active and players can join." },
  "چالش پایان یافت.": { fa: "چالش پایان یافت.", en: "The challenge has ended." },
  "The challenge has ended.": { fa: "چالش پایان یافت.", en: "The challenge has ended." },
  "Find the English word immediately after the phrase shown in the hint.": { fa: "کلمه‌ی انگلیسی را که بلافاصله پس از عبارت راهنما آمده است پیدا کن.", en: "Find the English word immediately after the phrase shown in the hint." },
  "کلمه‌ی انگلیسی را که بلافاصله پس از عبارت راهنما آمده است پیدا کن.": { fa: "کلمه‌ی انگلیسی را که بلافاصله پس از عبارت راهنما آمده است پیدا کن.", en: "Find the English word immediately after the phrase shown in the hint." },
};

export function localizeUiMessage(message: string, language: UiLanguage): string {
  return knownUiTexts[message]?.[language] ?? message;
}

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
  const knownText = knownUiTexts[message];
  if (knownText) return knownText[language];
  if (/^[A-Z][A-Z0-9_]+$/.test(message)) {
    return language === "fa"
      ? "مشکلی رخ داد. لطفاً دوباره تلاش کن."
      : "Something went wrong. Please try again.";
  }
  const hasPersianText = /[\u0600-\u06FF]/.test(message);
  const hasLatinText = /[A-Za-z]/.test(message);
  if ((language === "fa" && hasLatinText && !hasPersianText) ||
      (language === "en" && hasPersianText && !hasLatinText)) {
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
    normalized === "چالش واژه‌یابی انگلیسی wallet find" ||
    normalized === "مسابقه واژه‌یابی انگلیسی wallet find" ||
    normalized === "wallet find english word-finding challenge" ||
    normalized === "wallet find english word-finding contest"
  ) {
    return language === "fa"
      ? "چالش واژه‌یابی انگلیسی Wallet Find"
      : "Wallet Find English Word-Finding Challenge";
  }
  return title ?? (language === "fa" ? "چالش واژه‌یابی" : "Word-Finding Challenge");
}
