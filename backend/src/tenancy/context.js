import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which tenant (white-label site) the code running right now is serving.
 *
 * Set once per HTTP request by the tenant middleware in src/api/server.js and
 * by background jobs that loop over tenants (daily close, blog cron). Every
 * database call goes through the `supabase` proxy in src/supabaseClient.js,
 * which reads the tenant from here — so the ~60 functions in src/db.js stay
 * written as if there were one database, and still hit the right one.
 *
 * AsyncLocalStorage follows promises and timers, but not events emitted by a
 * stream that was created before the context was entered. A request body
 * parsed by a route-level `express.raw()` finishes on such an event, which is
 * why wrap() in server.js re-enters the context from req.tenant before
 * running each handler.
 */
const storage = new AsyncLocalStorage();

export function runWithTenant(tenant, fn) {
  return storage.run(tenant, fn);
}

/** @returns {object|null} the tenant this code runs for, or null outside any request or tenant loop. */
export function currentTenant() {
  return storage.getStore() ?? null;
}
