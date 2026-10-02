import { createServiceClient, platformDb } from '../supabaseClient.js';
import { INSTAPAY } from '../billing/plans.js';
import { decryptSecret } from './secrets.js';

/**
 * The list of white-label sites this one backend serves, and how to reach
 * each one's database.
 *
 * Every tenant runs the same code and the same schema (supabase/schema.sql)
 * in its own Supabase project; the platform database (.env's SUPABASE_URL)
 * keeps the registry itself in `tenants` / `tenant_domains` (see
 * supabase/platform.sql). You add, rebrand or suspend a client from the
 * platform panel (/api/platform/*) — clients never get the platform
 * database's key or anyone else's.
 *
 * The default tenant is the original site. Its data lives in the platform
 * database, and it exists even before platform.sql is applied, built from the
 * same env vars the app always used — so this branch runs unchanged as a
 * single site until a second tenant is added.
 *
 * Lookups are synchronous against an in-memory snapshot, refreshed every ten
 * minutes and right after any platform-panel change, so resolving the tenant
 * adds no database round trip to a request.
 */

const IS_PROD = process.env.NODE_ENV === 'production';
export const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? 'egxpert';
// Only a safety net: panel changes refresh at once (see above). Every refresh
// is two Supabase requests, so a tight interval costs log quota around the clock.
const REFRESH_MS = 10 * 60_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const listEnv = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** "https://www.Example.com:443/x" or "Example.com:8080" -> "example.com". www. is folded onto the bare domain. */
export function normalizeHost(value) {
  if (!value) return null;
  let host = String(value).trim().toLowerCase();
  try {
    if (host.includes('://')) host = new URL(host).host;
  } catch {
    return null;
  }
  host = host.split(',')[0].trim();
  if (host.startsWith('[')) host = host.slice(0, host.indexOf(']') + 1);
  else host = host.replace(/:\d+$/, '');
  return host.replace(/^www\./, '') || null;
}

const PLATFORM_APP_URL = process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:8080';

/** The address part of EMAIL_FROM, reused (under the tenant's own display name) for tenants with no sender of their own. */
const PLATFORM_FROM_ADDRESS = (process.env.EMAIL_FROM ?? 'EGXpert <onboarding@resend.dev>').match(/<([^>]+)>/)?.[1]
  ?? process.env.EMAIL_FROM
  ?? 'onboarding@resend.dev';

/** What the original site looked like before white-labelling — the defaults every brand field falls back to. */
const DEFAULT_BRAND = {
  name: 'EGXpert',
  tagline: 'خبير البورصة المصرية',
  description: 'مكتب تحليل وإدارة محفظة البورصة المصرية: مراكزك، وقف الخسارة، الأهداف والتوصيات اليومية.',
  logoUrl: null,
  faviconUrl: '/favicon.svg',
  colors: {},
  analytics: { gaId: 'G-789W810GMB', adsClient: 'ca-pub-8353018708854851' },
  social: { instagram: 'https://www.instagram.com/egxpertapp/', facebook: 'https://www.facebook.com/egxpertapp/' },
};

function defaultConfigFromEnv() {
  return {
    appUrl: PLATFORM_APP_URL,
    emailFrom: process.env.EMAIL_FROM ?? null,
    contactEmail: process.env.CONTACT_EMAIL ?? 'info@egxpert.com',
    supportNotifyEmail: process.env.SUPPORT_NOTIFY_EMAIL ?? 'belal.elkady4@gmail.com',
    adminEmails: listEnv(process.env.ADMIN_EMAILS ?? 'belal.elkady4@gmail.com'),
    marketerEmails: listEnv(process.env.MARKETER_EMAILS ?? ''),
    instapay: { address: INSTAPAY.address, accountName: INSTAPAY.accountName },
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? null,
    prices: {},
    features: { blog: true },
  };
}

/**
 * Turns a `tenants` row (or nothing, for the default tenant before
 * platform.sql exists) into the object the rest of the app reads. Brand and
 * config are merged over the defaults field by field, so a tenant row only
 * has to hold what differs.
 */
function buildTenant(row, { isDefault, domains, db }) {
  const brandIn = row?.brand_json ?? {};
  const configIn = row?.config_json ?? {};
  const base = isDefault ? defaultConfigFromEnv() : {
    appUrl: domains[0] ? `https://${domains[0]}` : null,
    emailFrom: null,
    contactEmail: null,
    supportNotifyEmail: null,
    adminEmails: [],
    marketerEmails: [],
    instapay: { address: null, accountName: null },
    googleClientId: null,
    prices: {},
    features: { blog: false },
  };
  const brand = {
    ...DEFAULT_BRAND,
    ...(isDefault ? {} : { analytics: {}, social: {} }),
    ...brandIn,
    colors: { ...(brandIn.colors ?? {}) },
  };
  if (!isDefault && !brandIn.name) brand.name = row?.name ?? brand.name;
  const config = {
    ...base,
    ...configIn,
    instapay: { ...base.instapay, ...(configIn.instapay ?? {}) },
    features: { ...base.features, ...(configIn.features ?? {}) },
    prices: { ...base.prices, ...(configIn.prices ?? {}) },
    adminEmails: (configIn.adminEmails ?? base.adminEmails).map((e) => String(e).trim().toLowerCase()).filter(Boolean),
    marketerEmails: (configIn.marketerEmails ?? base.marketerEmails).map((e) => String(e).trim().toLowerCase()).filter(Boolean),
  };
  config.emailFrom ??= `${brand.name} <${PLATFORM_FROM_ADDRESS}>`;
  // Without a contact/support address of their own, a client's messages still
  // reach someone: the platform's inbox, which is you.
  config.contactEmail ??= process.env.CONTACT_EMAIL ?? 'info@egxpert.com';
  config.supportNotifyEmail ??= process.env.SUPPORT_NOTIFY_EMAIL ?? 'belal.elkady4@gmail.com';
  return {
    id: row?.id ?? DEFAULT_TENANT_ID,
    name: row?.name ?? brand.name,
    status: isDefault ? 'active' : (row?.status ?? 'active'),
    isDefault,
    domains,
    appUrl: String(config.appUrl ?? PLATFORM_APP_URL).replace(/\/+$/, ''),
    brand,
    config,
    db,
  };
}

// Tenant clients are rebuilt only when the URL or sealed key changes, so a
// refresh every minute doesn't throw away connection state.
const clients = new Map(); // tenant id -> { url, keyEnc, client }
function clientFor(row) {
  const cached = clients.get(row.id);
  if (cached && cached.url === row.supabase_url && cached.keyEnc === row.supabase_key_enc) return cached.client;
  const client = createServiceClient(row.supabase_url, decryptSecret(row.supabase_key_enc));
  clients.set(row.id, { url: row.supabase_url, keyEnc: row.supabase_key_enc, client });
  return client;
}

const defaultDomains = () => [...new Set([PLATFORM_APP_URL, process.env.FRONTEND_URL].map(normalizeHost).filter(Boolean))];

let snapshot = buildSnapshot([], []);
let registryMissingLogged = false;
let refreshing = null;

function buildSnapshot(rows, domainRows) {
  const domainsByTenant = new Map();
  for (const { domain, tenant_id: tenantId } of domainRows) {
    const host = normalizeHost(domain);
    if (!host) continue;
    if (!domainsByTenant.has(tenantId)) domainsByTenant.set(tenantId, []);
    domainsByTenant.get(tenantId).push(host);
  }
  const defaultRow = rows.find((row) => row.id === DEFAULT_TENANT_ID) ?? null;
  const tenants = [buildTenant(defaultRow, {
    isDefault: true,
    domains: [...new Set([...defaultDomains(), ...(domainsByTenant.get(DEFAULT_TENANT_ID) ?? [])])],
    db: platformDb,
  })];
  for (const row of rows) {
    if (row.id === DEFAULT_TENANT_ID) continue;
    const domains = domainsByTenant.get(row.id) ?? [];
    if (!row.supabase_url || !row.supabase_key_enc) {
      console.error(`[tenancy] tenant ${row.id} has no database configured — skipped`);
      continue;
    }
    try {
      tenants.push(buildTenant(row, { isDefault: false, domains, db: clientFor(row) }));
    } catch (err) {
      console.error(`[tenancy] tenant ${row.id} could not be loaded: ${err.message}`);
    }
  }
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const byHost = new Map();
  for (const tenant of tenants) for (const host of tenant.domains) byHost.set(host, tenant);
  return { byId, byHost, tenants };
}

const isMissingTable = (error) => error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message));

/** Re-reads the registry from the platform database. Safe to call often; concurrent calls share one read. */
export function refreshTenants() {
  refreshing ??= (async () => {
    try {
      const [tenants, domains] = await Promise.all([
        platformDb.from('tenants').select('*'),
        platformDb.from('tenant_domains').select('domain, tenant_id'),
      ]);
      const error = tenants.error ?? domains.error;
      if (error) {
        if (isMissingTable(error)) {
          if (!registryMissingLogged) console.log('[tenancy] supabase/platform.sql not applied — serving the default site only');
          registryMissingLogged = true;
          snapshot = buildSnapshot([], []);
          return;
        }
        throw new Error(error.message);
      }
      snapshot = buildSnapshot(tenants.data, domains.data);
    } catch (err) {
      // Keep serving the last good snapshot rather than dropping every client
      // because one refresh hit a network blip.
      console.error('[tenancy] refresh failed:', err.message);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

let timer = null;
/** Loads the registry once and keeps it fresh. Awaited before the server starts listening. */
export async function startTenantRegistry() {
  await refreshTenants();
  timer ??= setInterval(refreshTenants, REFRESH_MS);
  timer.unref?.();
}

export const defaultTenant = () => snapshot.byId.get(DEFAULT_TENANT_ID);
export const tenantById = (id) => snapshot.byId.get(id) ?? null;
export const allTenants = () => snapshot.tenants;
export const activeTenants = () => snapshot.tenants.filter((t) => t.status === 'active');

/**
 * Which tenant a request is for, from its host. Loopback is the default
 * tenant (the deploy host's own cron calls and local dev). An unknown host is
 * null in production — the site answers 404 rather than guessing — and the
 * default tenant elsewhere, so a dev machine or preview URL still works.
 */
export function tenantForHost(rawHost) {
  const host = normalizeHost(rawHost);
  if (!host || LOOPBACK_HOSTS.has(host)) return defaultTenant();
  return snapshot.byHost.get(host) ?? (IS_PROD ? null : defaultTenant());
}

/** The emails that may use the platform panel — you, not the clients' admins. */
const PLATFORM_ADMIN_EMAILS = new Set(
  listEnv(process.env.PLATFORM_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? 'belal.elkady4@gmail.com').map((e) => e.toLowerCase()),
);
export const isPlatformAdminEmail = (email) => PLATFORM_ADMIN_EMAILS.has(String(email).toLowerCase());
export function isPlatformAdmin(user, tenant) {
  return Boolean(tenant?.isDefault && user?.isAdmin && user.emailVerified && isPlatformAdminEmail(user.email));
}

/**
 * Who may edit the index lists and admin-added stocks. That is market data
 * shared by every site, so only the main site's admins — not a client's — and
 * not gated on PLATFORM_ADMIN_EMAILS, which is for the clients panel: an admin
 * account whose email isn't on that list still runs the main site's market data.
 */
export const canEditIndices = (user, tenant) => Boolean(tenant?.isDefault && user?.isAdmin && user.emailVerified);

/** What the browser may know about a tenant: branding and public switches — never keys, emails of staff or payment details. */
export function publicTenant(tenant) {
  return {
    id: tenant.id,
    name: tenant.brand.name,
    siteUrl: tenant.appUrl,
    brand: tenant.brand,
    contactEmail: tenant.config.contactEmail,
    googleClientId: tenant.config.googleClientId,
    features: tenant.config.features,
  };
}
