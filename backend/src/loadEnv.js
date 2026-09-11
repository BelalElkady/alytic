/**
 * Loads backend/.env by an absolute path anchored to this file's own
 * location on disk — not `process.cwd()`.
 *
 * A plain `import 'dotenv/config'` (what this replaces) resolves `.env`
 * relative to wherever the process happens to be *launched from*. That works
 * by accident in local dev when you always `cd backend && npm run serve`,
 * but starting the server from a different working directory — the repo
 * root, a deploy script, a process manager with its own WorkingDirectory —
 * silently finds nothing. dotenv does not throw when the file is missing, so
 * every secret (RESEND_API_KEY, OPENROUTER_API_KEY, SUPABASE_*, ...) quietly
 * comes up `undefined` and everything gated on it degrades with no error:
 * email sends fall back to a console.log, AI features report "no API key".
 *
 * Import this — not 'dotenv/config' — as the very first import in any entry
 * point (server.js, cli.js), so its module body runs before any other
 * imported module reads `process.env` at its own top level.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });
