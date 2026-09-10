/**
 * Standalone backend for the E2E suite.
 *
 * Boots the real Express app, but pointed at a throwaway SQLite database and a
 * bar-cache directory pre-seeded with deterministic fixtures — so desk flows
 * that analyze held positions run entirely offline. Every E2E run starts from
 * a clean database.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT ?? 3111);
const TMP = path.join(ROOT, "tests", "e2e", ".tmp");
const DB_PATH = path.join(TMP, "alytic.db");
const BARS_DIR = path.join(TMP, "bars");

fs.rmSync(DB_PATH, { force: true });
fs.rmSync(`${DB_PATH}-wal`, { force: true });
fs.rmSync(`${DB_PATH}-shm`, { force: true });
fs.mkdirSync(BARS_DIR, { recursive: true });

// Must be set BEFORE importing anything from the backend: db.js and cache.js
// resolve their paths from the environment at module load.
process.env.ALYTIC_DB_PATH = DB_PATH;
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