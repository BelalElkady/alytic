/**
 * Playwright end-to-end tests.
 *
 * Boots the REAL stack exactly as production runs it: the Express backend on
 * :3111 (against the real Supabase project and fixture bars, so no market
 * data is fetched for held positions) and the TanStack Start dev server on
 * :8181 with its /api/public proxy pointed at that backend. Tests drive the
 * browser the way a user would — through the Arabic UI.
 */
import { defineConfig } from "@playwright/test";

import { newTestRunId } from "./backend/test/helpers/test-database.js";

// Set once in the main process before any worker, web server or teardown
// starts; they all inherit it, so cleanup only removes this run's accounts.
process.env.TEST_RUN_ID ??= newTestRunId();

const BACKEND_PORT = process.env.E2E_BACKEND_PORT ?? 3111;
const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT ?? 8181;

export default defineConfig({
  testDir: "tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.mjs",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 1 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "tests/e2e/report" }]]
    : [["list"]],
  outputDir: "tests/e2e/.tmp/test-results",
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    locale: "ar-EG",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The browser never reaches the internet. AdSense (__root.tsx) and the
    // landing's YouTube embed keep polling Google, so goto()'s "networkidle"
    // wait would time out at random.
    launchOptions: { args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"] },
  },
  webServer: [
    {
      command: `node tests/e2e/backend-server.mjs`,
      // SENTRY_DSN="" keeps test traffic out of Sentry (see backend/src/instrument.js).
      env: { PORT: String(BACKEND_PORT), E2E_SKIP_RATE_LIMITS: "1", SENTRY_DSN: "" },
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `bun run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: "frontend",
      // Same for the SSR server (SENTRY_DSN) and the browser bundle (VITE_SENTRY_DISABLED).
      env: { ALYTIC_API_URL: `http://127.0.0.1:${BACKEND_PORT}`, SENTRY_DSN: "", VITE_SENTRY_DISABLED: "1" },
      url: `http://127.0.0.1:${FRONTEND_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});