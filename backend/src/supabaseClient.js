import { createClient } from '@supabase/supabase-js';
import { currentTenant } from './tenancy/context.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'محتاج SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في .env — من Project Settings → API في لوحة Supabase.',
  );
}

const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };

// Service-role key: the backend is the only thing that talks to Supabase and
// already enforces its own auth/session layer, so requests here bypass row
// level security by design rather than acting as any particular end user.
export const createServiceClient = (url, key) => createClient(url, key, CLIENT_OPTIONS);

/**
 * The platform database — the one in .env. It holds three kinds of data:
 *  - the tenant registry (tenants, tenant_domains — see supabase/platform.sql),
 *  - the market data every tenant shares (market reports, AI stop plans,
 *    fundamentals, index lists, custom stocks, the ai_spend log), so the AI
 *    cost of the daily market work is paid once, not once per client,
 *  - and the default tenant's own users/portfolios (the original site).
 */
export const platformDb = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let warnedNoContext = false;

/**
 * The database of the tenant this code runs for (see tenancy/context.js).
 * Outside any tenant context — the CLI, a unit test, a one-off script — it is
 * the platform database, which is also the default tenant's. Inside a request
 * that should never happen; the warning is there so a code path that lost its
 * context shows up in the logs instead of quietly writing to the wrong site.
 */
export function currentDb() {
  const tenant = currentTenant();
  if (tenant) return tenant.db;
  if (!warnedNoContext && process.env.NODE_ENV === 'production') {
    warnedNoContext = true;
    console.warn('[tenancy] DB call with no tenant context — using the platform database.', new Error().stack);
  }
  return platformDb;
}

/**
 * Stands in for a single client everywhere tenant data is read or written
 * (src/db.js, support attachments, blog images): each property access is
 * forwarded to the current tenant's client.
 */
export const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = currentDb();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
