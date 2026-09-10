/**
 * Standalone backend for the E2E suite.
 *
 * Boots the real Express app against the real Supabase project (see
 * backend/.env — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) with a bar-cache
 * directory pre-seeded with deterministic fixtures, so desk flows that
 * analyze held positions run entirely offline. Unlike the old SQLite setup,
 * the database itself is NOT reset per run — Supabase is a shared cloud
 * Postgres, not a throwaway file — so fixtures below use random per-run
 * emails/ids to stay isolated from earlier runs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT ?? 3111);
const TMP = path.join(ROOT, "tests", "e2e", ".tmp");
const BARS_DIR = path.join(TMP, "bars");

fs.mkdirSync(BARS_DIR, { recursive: true });

// This script lives outside backend/, so it can't resolve backend's `dotenv`
// package — a minimal inline parser reads just the Supabase credentials
// (never overriding an already-set env var, same as dotenv's own default).
// Must run BEFORE importing anything from the backend: supabaseClient.js
// resolves its config from the environment at module load.
try {
  const envText = fs.readFileSync(path.join(ROOT, "backend", ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = /^\s*(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*)\s*$/.exec(line);
    if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no backend/.env — the SUPABASE_* env vars must already be set another way */
}
process.env.ALYTIC_BARS_DIR = BARS_DIR;
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "alytic-e2e-session-secret";
process.env.FRONTEND_URL = `http://127.0.0.1:${process.env.E2E_FRONTEND_PORT ?? 8181}`;
process.env.PORT = String(PORT);

// Seed fixture bars for the codes the desk flows trade (deterministic synth
// series — reused from the backend unit-test helpers).
const { synthBars, writeBars } = await import(
  pathToFileURL(path.join(ROOT, "backend", "test", "helpers", "bars.js")).href
);
await writeBars("ABUK", synthBars({ sessions: 300, start: 100, driftPct: 0.12, seed: 99 }));
await writeBars("SWDY", synthBars({ sessions: 260, start: 80, driftPct: 0.05, seed: 98 }));

const { default: app } = await import(
  pathToFileURL(path.join(ROOT, "backend", "src", "api", "server.js")).href
);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e] Alytic backend listening on http://127.0.0.1:${PORT}`);
});