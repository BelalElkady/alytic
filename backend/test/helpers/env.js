/**
 * Test environment bootstrap — must be the FIRST import in every test file.
 *
 * Each test file runs in its own Node process (the default `node --test`
 * isolation), so these module-level side effects give that file a private
 * bar-cache directory. Importing any `src/` module before this file would
 * bake the production paths into the singletons.
 *
 * The database is the shared test Supabase project (TEST_SUPABASE_URL /
 * TEST_SUPABASE_SERVICE_ROLE_KEY, see test-database.js), never production.
 * Isolation comes from every test creating its own randomly-generated user
 * (see `uniqueEmail()` in helpers/server.js) rather than from a fresh database.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useTestDatabase } from './test-database.js';

// Also blanks OPENROUTER_API_KEY, ANTHROPIC_API_KEY and RESEND_API_KEY, so no
// test can spend AI credits or send a real email.
useTestDatabase();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alytic-test-'));

// The E2E server script pre-sets this for its own persistent sandbox; unit and
// API suites get a fresh one per file/process.
process.env.ALYTIC_BARS_DIR ??= path.join(root, 'bars');
process.env.SESSION_SECRET ??= 'alytic-test-session-secret';
process.env.FRONTEND_URL ??= 'http://localhost:8080';

try {
  fs.mkdirSync(process.env.ALYTIC_BARS_DIR, { recursive: true });
} catch {
  /* parallel workers may race — harmless */
}

export const TEST_ROOT = root;
export const TEST_BARS_DIR = process.env.ALYTIC_BARS_DIR;
