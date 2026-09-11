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
  },
  webServer: [
    {
      command: `node tests/e2e/backend-server.mjs`,
      env: { PORT: String(BACKEND_PORT) },
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `bun run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: "frontend",
      env: { ALYTIC_API_URL: `http://127.0.0.1:${BACKEND_PORT}` },
      url: `http://127.0.0.1:${FRONTEND_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});