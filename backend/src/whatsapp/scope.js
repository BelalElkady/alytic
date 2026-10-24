import { normalizePhone } from '../phone.js';

const PRODUCTION_PROJECT = 'xssjwnevhbpcdmtbatiy';

/**
 * Who WhatsApp messages may go to, from the environment.
 *
 * - live: this is production (NODE_ENV=production on the production
 *   database). Only then is the test clock (`?at=`) ignored.
 * - everyone: every eligible user may be messaged. True only when live and
 *   WHATSAPP_ALLOWLIST_ONLY isn't "true" — so a production pilot can stay on
 *   the team's numbers until the flag is removed.
 * - Otherwise only WHATSAPP_ALLOWED_PHONES are ever messaged, and with no list
 *   nothing is (canSend false).
 */
export function sendingScope(env = process.env) {
  const live = env.NODE_ENV === 'production' && String(env.SUPABASE_URL ?? '').includes(PRODUCTION_PROJECT);
  const allowlistOnly = String(env.WHATSAPP_ALLOWLIST_ONLY ?? '').trim().toLowerCase() === 'true';
  const everyone = live && !allowlistOnly;
  const allowed = new Set(String(env.WHATSAPP_ALLOWED_PHONES ?? '').split(',').map((p) => normalizePhone(p)).filter(Boolean));
  return {
    live,
    everyone,
    canSend: everyone || allowed.size > 0,
    allows: (phone) => everyone || allowed.has(phone),
  };
}
