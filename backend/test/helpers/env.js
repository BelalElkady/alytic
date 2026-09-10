/**
 * Test environment bootstrap — must be the FIRST import in every test file.
 *
 * Each test file runs in its own Node process (the default `node --test`
 * isolation), so these module-level side effects give that file a private
 * throwaway SQLite database and bar-cache directory. Importing any `src/`
 * module before this file would bake the production paths into the singletons.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alytic-test-'));

// The E2E server script pre-sets these for its own persistent sandbox; unit and
// API suites get a fresh one per file/process.
process.env.ALYTIC_DB_PATH ??= path.join(root, 'alytic.db');
process.env.ALYTIC_BARS_DIR ??= path.join(root, 'bars');
process.env.SESSION_SECRET ??= 'alytic-test-session-secret';
process.env.FRONTEND_URL ??= 'http://localhost:8080';

// Tests must never see a real key: dotenv (loaded by server.js) would otherwise
// pick up the developer's real OPENROUTER_API_KEY from backend/.env. An empty
// string is "present" for dotenv, so it keeps our override.
process.env.OPENROUTER_API_KEY ??= '';
process.env.ANTHROPIC_API_KEY ??= '';

try {
  fs.mkdirSync(process.env.ALYTIC_BARS_DIR, { recursive: true });
} catch {
  /* parallel workers may race — harmless */
}

export const TEST_ROOT = root;
export const TEST_DB_PATH = process.env.ALYTIC_DB_PATH;
export const TEST_BARS_DIR = process.env.ALYTIC_BARS_DIR;