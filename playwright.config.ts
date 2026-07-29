import { devices, defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  // Serve a production build rather than `next dev`. The dev server compiles
  // routes on demand and swaps chunks over HMR, which under parallel Playwright
  // load surfaces first-compile latency and intermittent `ChunkLoadError`s —
  // flakiness that has nothing to do with the app. A production build ships
  // content-hashed, static chunks with no HMR client, so navigation is
  // deterministic. The test-only session route stays available because it is
  // gated at runtime by `APP_ENV=test`, which the e2e harness sets.
  webServer: {
    command:
      "pnpm build && pnpm exec next start --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/today",
    reuseExistingServer: !process.env.CI,
    // Allow for the one-time production build before the server is ready.
    timeout: 240_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
