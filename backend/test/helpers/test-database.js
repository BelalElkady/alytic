/**
 * Where every test suite's data goes: the test Supabase project, never
 * production — and with every paid or outward-facing service switched off.
 *
 * Shared by test/helpers/env.js (node:test), the Playwright backend and
 * helpers in tests/e2e, and scripts/cleanup-test-data.js, so none of them can
 * fall back to the SUPABASE_URL in backend/.env: that one is production.
 * Dependency-free on purpose, because the E2E files outside backend/ import
 * it too and can't resolve backend's packages.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tags the accounts one test run registers. The test project is shared, so
 * two runs can overlap (a pull request and a merge to main); cleanup deletes
 * only its own run's accounts (see scripts/cleanup-test-data.js), never the
 * ones another run is still using. scripts/run-tests.mjs and
 * playwright.config.ts set TEST_RUN_ID once per run, and every process they
 * start inherits it. Hex only, so it is safe inside an ILIKE pattern.
 */
export const testRunId = () => process.env.TEST_RUN_ID || 'local';
export const newTestRunId = () => crypto.randomBytes(4).toString('hex');

/** A fresh `@test.local` address carrying this run's tag. */
export const testEmail = (prefix) => `${prefix}-${testRunId()}-${crypto.randomUUID()}@test.local`;

const PRODUCTION_PROJECT_REF = 'xssjwnevhbpcdmtbatiy';
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');

/** Paid (OpenRouter: real AI credits) or reach real people (Resend: email). */
const BLOCKED_KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY'];

function readEnvFile() {
  const vars = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(TEST_SUPABASE_URL|TEST_SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no backend/.env — the TEST_* variables must come from the environment (CI) */
  }
  return vars;
}

/** The project ref a legacy JWT service-role key was issued for, if it is one. */
function keyProjectRef(key) {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).ref ?? null;
  } catch {
    return null;
  }
}

/** The test project's URL and service-role key, or a thrown error explaining what is missing. */
export function resolveTestDatabase() {
  const file = readEnvFile();
  const url = process.env.TEST_SUPABASE_URL || file.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || file.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Tests need TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY — the test project, not production — in backend/.env or the environment.',
    );
  }
  const ref = keyProjectRef(key);
  if (url.includes(PRODUCTION_PROJECT_REF) || ref === PRODUCTION_PROJECT_REF) {
    throw new Error(`The test database settings point at production (${PRODUCTION_PROJECT_REF}); tests must never run there.`);
  }
  if (ref && !url.includes(ref)) {
    throw new Error(`TEST_SUPABASE_SERVICE_ROLE_KEY belongs to project ${ref}, but TEST_SUPABASE_URL is ${url}.`);
  }
  return { url, key };
}

/**
 * Points this process at the test project and blanks the paid keys. Must run
 * before anything imports src/ (supabaseClient.js reads its settings at load).
 * Plain assignment, not `??=`: dotenv never overrides a variable that is
 * already set, so this also stops backend/.env from supplying production's
 * Supabase settings or a real AI key later.
 */
export function useTestDatabase() {
  const { url, key } = resolveTestDatabase();
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  for (const name of BLOCKED_KEYS) process.env[name] = '';
  return { url, key };
}
