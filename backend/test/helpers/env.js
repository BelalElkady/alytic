/**
 * Test environment bootstrap — must be the FIRST import in every test file.
 *
 * Each test file runs in its own Node process (the default `node --test`
 * isolation), so these module-level side effects give that file a private
 * bar-cache directory. Importing any `src/` module before this file would
 * bake the production paths into the singletons.
 *
 * Unlike the old SQLite setup, there is no throwaway-file database anymore —
 * Supabase (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, loaded from
 * backend/.env below) is a shared cloud Postgres. Isolation instead comes
 * from every test creating its own randomly-generated user (see
 * `uniqueEmail()` in helpers/server.js) rather than from a fresh database.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Tests must never see a real AI key. A plain `import 'dotenv/config'` would
// pull the developer's real OPENROUTER_API_KEY out of backend/.env — and
// because ES module imports execute before any other code in this file
// regardless of source order, that would happen *before* the blanking
// assignments below could ever run, silently letting AI-backed tests fire
// real OpenRouter requests. So this reads backend/.env itself, off the
// process env entirely, and only lifts out the two Supabase keys tests
// actually need.
const backendEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
try {
  const parsed = dotenv.parse(fs.readFileSync(backendEnvPath));
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (parsed[key]) process.env[key] ??= parsed[key];
  }
} catch {
  /* no backend/.env — SUPABASE_* must already be set another way (e.g. CI secrets) */
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('محتاج SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في backend/.env عشان تشتغل الاختبارات.');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alytic-test-'));

// The E2E server script pre-sets this for its own persistent sandbox; unit and
// API suites get a fresh one per file/process.
process.env.ALYTIC_BARS_DIR ??= path.join(root, 'bars');
process.env.SESSION_SECRET ??= 'alytic-test-session-secret';
process.env.FRONTEND_URL ??= 'http://localhost:8080';

// Tests must never see a real key. Nothing has touched process.env from
// backend/.env at this point (see above), so this is the only source.
process.env.OPENROUTER_API_KEY ??= '';
process.env.ANTHROPIC_API_KEY ??= '';
process.env.RESEND_API_KEY ??= '';

try {
  fs.mkdirSync(process.env.ALYTIC_BARS_DIR, { recursive: true });
} catch {
  /* parallel workers may race — harmless */
}

export const TEST_ROOT = root;
export const TEST_BARS_DIR = process.env.ALYTIC_BARS_DIR;