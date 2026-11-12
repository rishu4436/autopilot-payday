import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/demo",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [3100, 3101].map((port) => ({
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    env: { APP_MODE: "demo", APP_ORIGIN: `http://127.0.0.1:${port}`, LIVE_OPERATIONS: "false", DATABASE_URL: "", PGLITE_DIR: mkdtempSync(join(tmpdir(), "payday-e2e-")), COOKIE_SECURE: "false" },
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  })),
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
    { name: "mobile", use: { ...devices["Pixel 5"], baseURL: "http://127.0.0.1:3101" } },
  ],
});
