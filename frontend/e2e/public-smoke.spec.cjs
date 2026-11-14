const { test, expect } = require("@playwright/test");

const locales = [
  { code: "fa", direction: "rtl" },
  { code: "en", direction: "ltr" },
  { code: "de", direction: "ltr" },
  { code: "es", direction: "ltr" },
  { code: "fr", direction: "ltr" },
  { code: "ar", direction: "rtl" },
  { code: "tr", direction: "ltr" },
  { code: "pt", direction: "ltr" },
  { code: "ru", direction: "ltr" },
  { code: "zh-CN", direction: "ltr" },
];

test("public pages render without uncaught browser errors", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const route of ["/", "/leaderboard", "/rewards", "/help", "/terms", "/rules", "/auth"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main h1").first(), `heading on ${route}`).toBeVisible();
    await expect(page.locator("#root")).not.toBeEmpty();
  }

  expect(pageErrors).toEqual([]);
});

test("all ten interface languages initialize with the correct direction", async ({ page }) => {
  for (const locale of locales) {
    await page.goto("/");
    await page.evaluate((code) => {
      localStorage.setItem("walletFindLanguage", code);
      localStorage.setItem("walletFindContestLanguage", code);
    }, locale.code);
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.locator("html")).toHaveAttribute("lang", locale.code);
    await expect(page.locator("html")).toHaveAttribute("dir", locale.direction);
    await expect(page.locator("main h1").first()).toBeVisible();
  }
});

test("interface and challenge language pickers can both be changed", async ({ page }) => {
  await page.goto("/");
  await page.locator(".global-sidebar-trigger").click();

  const pickers = page.locator(".wf-language-picker__trigger");
  await expect(pickers).toHaveCount(2);

  await pickers.nth(0).click();
  await page.getByRole("option", { name: "Deutsch" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("walletFindLanguage"))).toBe("de");

  await pickers.nth(1).click();
  await page.getByRole("option", { name: "العربية" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("walletFindContestLanguage"))).toBe("ar");
});

test("protected pages send signed-out visitors to authentication", async ({ page }) => {
  for (const route of ["/competition", "/profile", "/wallet", "/admin"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/auth\/?$/);
    await expect(page.locator("main h1").first()).toBeVisible();
  }
});

test("public API endpoints respond with valid success envelopes", async ({ request }) => {
  for (const endpoint of [
    "/api/stats/site",
    "/api/stats/prize-pools?language=fa",
    "/api/stats/prize-pools?language=en",
  ]) {
    const response = await request.get(endpoint, { timeout: 30_000 });
    expect(response.status(), endpoint).toBe(200);
    const body = await response.json();
    expect(body.success, endpoint).toBe(true);
    expect(body.data).toBeTruthy();
  }
});

test("profile and admin APIs reject unauthenticated requests", async ({ request }) => {
  const profile = await request.get("/api/profile/me");
  const admin = await request.get("/api/admin/overview");

  expect(profile.status()).toBe(401);
  expect(admin.status()).toBe(401);
});

test("mobile navigation opens and public content remains visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("main h1").first()).toBeVisible();
  const menu = page.locator(".global-sidebar-trigger");
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.locator(".global-sidebar.global-sidebar--open")).toBeVisible();
});
