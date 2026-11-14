const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 2,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL || "https://wallet-find.onrender.com",
    browserName: "chromium",
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
