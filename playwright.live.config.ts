import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e", outputDir: "test-results/live", testMatch: "**/*.live.ts", timeout: 120_000, expect: { timeout: 20_000 }, workers: 1,
  use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 }, baseURL: "http://127.0.0.1:3102", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "pnpm exec tsx scripts/test-live-web-server.ts", env: { PAYDAY_SYNTHETIC_TEST: "true" }, url: "http://127.0.0.1:3102/api/health", reuseExistingServer: false, timeout: 120_000 },
});
