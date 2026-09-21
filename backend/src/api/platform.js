/**
 * The platform panel's API: where you, and only you, manage the white-label
 * sites. Mounted under /api/platform by server.js and reachable only on the
 * default site, signed in as an account in PLATFORM_ADMIN_EMAILS (see
 * isPlatformAdmin in tenancy/registry.js). A client's own admins manage
 * their users and subscriptions from /api/admin on their own domain, and can
 * never see this.
 *
 * Tenants are suspended rather than deleted: deleting a tenant row would
 * orphan a database full of someone's customers, and that is a decision to
 * take by hand in Supabase, not with one click.
 */
import { createServiceClient, platformDb } from '../supabaseClient.js';
import { encryptSecret } from '../tenancy/secrets.js';
import { runWithTenant } from '../tenancy/context.js';
import { DEFAULT_TENANT_ID, allTenants, normalizeHost, refreshTenants, tenantById } from '../tenancy/registry.js';
import { safeHttpsUrl } from '../security.js';

const TENANT_ID = /^[a-z0-9][a-z0-9-]{1,30}$/;
const HOSTNAME = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// Brand colors end up inside a <style> block on every page of that site, so
// anything that could close the block or start a new rule is refused: only
// color syntax (hex, rgb/hsl/oklch functions, numbers, %, spaces) gets through.
const CSS_COLOR = /^[#a-z0-9(),.%\s/-]{1,64}$/i;
const CSS_VAR_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_JSON_BYTES = 20_000;

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
    this.userMessage = message;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalString = (value, max, field) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new BadRequest(`${field}: نص أطول من المسموح`);
  return value.trim();
};
const optionalUrl = (value, field) => {
  if (value == null || value === '') return null;
  // A site-relative path ("/brands/x/logo.svg") or an https URL — never
  // javascript:, data: or plain http.
  if (typeof value === 'string' && /^\/[A-Za-z0-9/_.-]{1,200}$/.test(value) && !value.includes('..')) return value;
  const url = safeHttpsUrl(value);
  if (!url) throw new BadRequest(`${field}: لازم رابط https أو مسار يبدأ بـ /`);
  return url;
};

/** Only the brand fields the frontend knows how to use, each checked for shape. */
export function sanitizeBrand(input) {
  if (input == null) return {};
  if (!isPlainObject(input)) throw new BadRequest('brand لازم يكون object');
  const brand = {};
  const name = optionalString(input.name, 60, 'brand.name');
  if (name) brand.name = name;
  const tagline = optionalString(input.tagline, 120, 'brand.tagline');
  if (tagline) brand.tagline = tagline;
  const description = optionalString(input.description, 300, 'brand.description');
  if (description) brand.description = description;
  const logoUrl = optionalUrl(input.logoUrl, 'brand.logoUrl');
  if (logoUrl) brand.logoUrl = logoUrl;
  const faviconUrl = optionalUrl(input.faviconUrl, 'brand.faviconUrl');
  if (faviconUrl) brand.faviconUrl = faviconUrl;
  if (input.emailColor != null && input.emailColor !== '') {
    if (!/^#[0-9a-f]{3,8}$/i.test(String(input.emailColor))) throw new BadRequest('brand.emailColor لازم يكون hex زي #1d4ed8');
    brand.emailColor = input.emailColor;
  }
  for (const key of ['colors', 'darkColors']) {
    if (input[key] == null) continue;
    if (!isPlainObject(input[key])) throw new BadRequest(`brand.${key} لازم يكون object`);
    const colors = {};
    for (const [name, value] of Object.entries(input[key])) {
      if (!CSS_VAR_NAME.test(name)) throw new BadRequest(`brand.${key}: اسم لون غير صالح: ${name}`);
      if (typeof value !== 'string' || !CSS_COLOR.test(value)) throw new BadRequest(`brand.${key}.${name}: قيمة لون غير صالحة`);
      colors[name] = value.trim();
    }
    brand[key] = colors;
  }
  if (input.analytics != null) {
    if (!isPlainObject(input.analytics)) throw new BadRequest('brand.analytics لازم يكون object');
    const analytics = {};
    if (input.analytics.gaId) {
      if (!/^G-[A-Z0-9]{4,20}$/.test(String(input.analytics.gaId))) throw new BadRequest('brand.analytics.gaId غير صالح (G-XXXXXXX)');
      analytics.gaId = input.analytics.gaId;
    }
    if (input.analytics.adsClient) {
      if (!/^ca-pub-\d{10,20}$/.test(String(input.analytics.adsClient))) throw new BadRequest('brand.analytics.adsClient غير صالح (ca-pub-...)');
      analytics.adsClient = input.analytics.adsClient;
    }
    brand.analytics = analytics;
  }
  return brand;
}

/** Only the config fields the backend reads, each checked for shape. */
export function sanitizeConfig(input) {
  if (input == null) return {};
  if (!isPlainObject(input)) throw new BadRequest('config لازم يكون object');
  const config = {};
  if (input.appUrl) {
    const url = safeHttpsUrl(input.appUrl);
    if (!url) throw new BadRequest('config.appUrl لازم يكون رابط https');
    config.appUrl = url.replace(/\/+$/, '');
  }
  const emailFrom = optionalString(input.emailFrom, 200, 'config.emailFrom');
  if (emailFrom) {
    if (!/^[^<>\r\n]{1,80}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(emailFrom)) throw new BadRequest('config.emailFrom بالشكل: Name <no-reply@domain.com>');
    config.emailFrom = emailFrom;
  }
  for (const key of ['contactEmail', 'supportNotifyEmail']) {
    const value = optionalString(input[key], 254, `config.${key}`);
    if (!value) continue;
    if (!EMAIL.test(value)) throw new BadRequest(`config.${key}: إيميل غير صالح`);
    config[key] = value.toLowerCase();
  }
  if (input.adminEmails != null) {
    if (!Array.isArray(input.adminEmails) || input.adminEmails.length > 50) throw new BadRequest('config.adminEmails لازم تكون قائمة إيميلات');
    config.adminEmails = input.adminEmails.map((email) => {
      const value = String(email).trim().toLowerCase();
      if (!EMAIL.test(value)) throw new BadRequest(`config.adminEmails: إيميل غير صالح: ${value}`);
      return value;
    });
  }
  if (input.instapay != null) {
    if (!isPlainObject(input.instapay)) throw new BadRequest('config.instapay لازم يكون object');
    config.instapay = {
      address: optionalString(input.instapay.address, 120, 'config.instapay.address'),
      accountName: optionalString(input.instapay.accountName, 120, 'config.instapay.accountName'),
    };
  }
  const googleClientId = optionalString(input.googleClientId, 200, 'config.googleClientId');
  if (googleClientId) {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(googleClientId)) throw new BadRequest('config.googleClientId غير صالح');
    config.googleClientId = googleClientId;
  }
  if (input.prices != null) {
    if (!isPlainObject(input.prices)) throw new BadRequest('config.prices لازم يكون object');
    config.prices = {};
    for (const [key, value] of Object.entries(input.prices)) {
      const price = Number(value);
      if (!/^[a-zA-Z_]{1,40}$/.test(key) || !Number.isFinite(price) || price < 0 || price > 1_000_000) throw new BadRequest(`config.prices.${key} غير صالح`);
      config.prices[key] = price;
    }
  }
  if (input.features != null) {
    if (!isPlainObject(input.features)) throw new BadRequest('config.features لازم يكون object');
    config.features = {};
    for (const key of ['blog']) if (key in input.features) config.features[key] = Boolean(input.features[key]);
  }
  return config;
}

function sanitizeDomains(input) {
  if (!Array.isArray(input) || input.length > 20) throw new BadRequest('domains لازم تكون قائمة (بحد أقصى 20)');
  const domains = [...new Set(input.map((value) => normalizeHost(value)))];
  for (const domain of domains) {
    if (!domain || !HOSTNAME.test(domain)) throw new BadRequest(`دومين غير صالح: ${domain}`);
  }
  return domains;
}

const checkSize = (value, field) => {
  if (JSON.stringify(value).length > MAX_JSON_BYTES) throw new BadRequest(`${field} أكبر من المسموح`);
};

/**
 * Proves a client database is reachable with the key given and already has
 * schema.sql applied, before it is saved: a tenant that can't read its own
 * users table would only fail later, in front of that client's customers.
 */
async function checkTenantDatabase(url, key) {
  const parsed = safeHttpsUrl(url);
  if (!parsed || !/\.supabase\.(co|in)$/i.test(new URL(parsed).hostname) && process.env.ALLOW_ANY_TENANT_DB_HOST !== '1') {
    throw new BadRequest('supabaseUrl لازم يكون رابط مشروع Supabase (https://xxxx.supabase.co)');
  }
  const client = createServiceClient(parsed, key);
  const { error } = await client.from('users').select('id', { count: 'exact', head: true });
  if (error) throw new BadRequest(`مش قادر أوصل لقاعدة بيانات العميل أو schema.sql مش متطبّق فيها: ${error.message}`);
  return parsed;
}

async function assertDomainsFree(domains, tenantId) {
  if (!domains.length) return;
  const { data, error } = await platformDb.from('tenant_domains').select('domain, tenant_id').in('domain', domains);
  if (error) throw new Error(error.message);
  const taken = data.filter((row) => row.tenant_id !== tenantId);
  if (taken.length) throw new BadRequest(`الدومين ده مستخدم لعميل تاني: ${taken.map((row) => `${row.domain} (${row.tenant_id})`).join(', ')}`);
  const defaultHosts = tenantById(DEFAULT_TENANT_ID)?.domains ?? [];
  if (tenantId !== DEFAULT_TENANT_ID) {
    const clash = domains.filter((domain) => defaultHosts.includes(domain));
    if (clash.length) throw new BadRequest(`الدومين ده بتاع الموقع الأساسي: ${clash.join(', ')}`);
  }
}

async function replaceDomains(tenantId, domains) {
  await assertDomainsFree(domains, tenantId);
  const removed = await platformDb.from('tenant_domains').delete().eq('tenant_id', tenantId);
  if (removed.error) throw new Error(removed.error.message);
  if (domains.length) {
    const inserted = await platformDb.from('tenant_domains').insert(domains.map((domain) => ({ domain, tenant_id: tenantId })));
    if (inserted.error) throw new Error(inserted.error.message);
  }
}

/** What the panel shows for one tenant. Never the database key, only whether one is set. */
function describe(tenant, row) {
  return {
    id: tenant?.id ?? row.id,
    name: row?.name ?? tenant?.name,
    status: tenant?.status ?? row?.status,
    loaded: Boolean(tenant),
    isDefault: tenant?.isDefault ?? row?.id === DEFAULT_TENANT_ID,
    domains: tenant?.domains ?? [],
    appUrl: tenant?.appUrl ?? null,
    supabaseUrl: row?.supabase_url ?? null,
    hasDatabaseKey: Boolean(row?.supabase_key_enc),
    brand: row?.brand_json ?? {},
    config: row?.config_json ?? {},
    effectiveBrand: tenant?.brand ?? null,
    notes: row?.notes ?? null,
    createdAt: row?.created_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

async function tenantRows() {
  const { data, error } = await platformDb.from('tenants').select('*').order('created_at');
  if (error) {
    console.error('[platform] tenants table:', error.message);
    throw new Error('جدول العملاء مش موجود — طبّق platform.sql على قاعدة البيانات الأساسية الأول');
  }
  return data;
}

export function mountPlatformRoutes(app, { wrap }) {
  app.get('/api/platform/tenants', wrap(async (_req, res) => {
    const rows = await tenantRows();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const loaded = allTenants();
    const list = loaded.map((tenant) => describe(tenant, byId.get(tenant.id)));
    // Rows that exist but failed to load (bad key, missing database) still
    // show up, so a broken client is visible instead of silently missing.
    for (const row of rows) if (!loaded.some((t) => t.id === row.id)) list.push(describe(null, row));
    res.json({ tenants: list });
  }));

  app.post('/api/platform/tenants', wrap(async (req, res) => {
    const body = req.body ?? {};
    const id = String(body.id ?? '').trim().toLowerCase();
    if (!TENANT_ID.test(id)) throw new BadRequest('id: حروف إنجليزي صغيرة وأرقام و - بس (2 لـ 31 حرف)');
    if (id === DEFAULT_TENANT_ID) throw new BadRequest('ده الموقع الأساسي — عدّله بـ PATCH بدل ما تنشئه');
    const name = optionalString(body.name, 80, 'name');
    if (!name) throw new BadRequest('name مطلوب');
    const domains = sanitizeDomains(body.domains ?? []);
    if (!domains.length) throw new BadRequest('لازم دومين واحد على الأقل');
    const brand = sanitizeBrand(body.brand);
    const config = sanitizeConfig(body.config);
    checkSize(brand, 'brand');
    checkSize(config, 'config');
    if (typeof body.supabaseServiceKey !== 'string' || body.supabaseServiceKey.length < 20) throw new BadRequest('supabaseServiceKey مطلوب');
    const supabaseUrl = await checkTenantDatabase(body.supabaseUrl, body.supabaseServiceKey);
    await assertDomainsFree(domains, id);

    const inserted = await platformDb.from('tenants').insert({
      id,
      name,
      supabase_url: supabaseUrl,
      supabase_key_enc: encryptSecret(body.supabaseServiceKey),
      brand_json: brand,
      config_json: config,
      status: body.status === 'suspended' ? 'suspended' : 'active',
      notes: optionalString(body.notes, 2000, 'notes'),
    });
    if (inserted.error) {
      if (inserted.error.code === '23505') throw new BadRequest('فيه عميل بنفس الـ id');
      throw new Error(inserted.error.message);
    }
    await replaceDomains(id, domains);
    await refreshTenants();
    const { data: row } = await platformDb.from('tenants').select('*').eq('id', id).maybeSingle();
    res.status(201).json({ tenant: describe(tenantById(id), row) });
  }));

  app.patch('/api/platform/tenants/:id', wrap(async (req, res) => {
    const id = req.params.id;
    const body = req.body ?? {};
    const isDefault = id === DEFAULT_TENANT_ID;
    const { data: existing, error } = await platformDb.from('tenants').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!existing && !isDefault) return res.status(404).json({ error: 'العميل ده مش موجود' });

    const patch = { updated_at: new Date().toISOString() };
    if ('name' in body) {
      const name = optionalString(body.name, 80, 'name');
      if (!name) throw new BadRequest('name مطلوب');
      patch.name = name;
    }
    // brand/config replace the stored object as a whole: the panel always
    // sends the full object it shows, so a field removed there is removed here.
    if ('brand' in body) {
      patch.brand_json = sanitizeBrand(body.brand);
      checkSize(patch.brand_json, 'brand');
    }
    if ('config' in body) {
      patch.config_json = sanitizeConfig(body.config);
      checkSize(patch.config_json, 'config');
    }
    if ('notes' in body) patch.notes = optionalString(body.notes, 2000, 'notes');
    if ('status' in body) {
      if (isDefault) throw new BadRequest('الموقع الأساسي مينفعش يتوقف من هنا');
      if (!['active', 'suspended'].includes(body.status)) throw new BadRequest('status: active أو suspended');
      patch.status = body.status;
    }
    if ('supabaseUrl' in body || 'supabaseServiceKey' in body) {
      if (isDefault) throw new BadRequest('بيانات الموقع الأساسي في .env، مش هنا');
      if (typeof body.supabaseServiceKey !== 'string' || body.supabaseServiceKey.length < 20) {
        throw new BadRequest('لتغيير قاعدة البيانات ابعت supabaseUrl و supabaseServiceKey مع بعض');
      }
      patch.supabase_url = await checkTenantDatabase(body.supabaseUrl ?? existing.supabase_url, body.supabaseServiceKey);
      patch.supabase_key_enc = encryptSecret(body.supabaseServiceKey);
    }

    if (existing) {
      const updated = await platformDb.from('tenants').update(patch).eq('id', id);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      // First customisation of the default site: its row holds only brand and
      // config overrides — its database is always the platform's own.
      const inserted = await platformDb.from('tenants').insert({ id, name: patch.name ?? 'EGXpert', ...patch });
      if (inserted.error) throw new Error(inserted.error.message);
    }
    if ('domains' in body) await replaceDomains(id, sanitizeDomains(body.domains));
    await refreshTenants();
    const { data: row } = await platformDb.from('tenants').select('*').eq('id', id).maybeSingle();
    res.json({ tenant: describe(tenantById(id), row) });
  }));

  // Headline numbers for one client: size of their user base, how many pay,
  // and what their AI usage cost you over the last N days.
  app.get('/api/platform/tenants/:id/stats', wrap(async (req, res) => {
    const tenant = tenantById(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'العميل ده مش موجود أو مش متحمّل' });
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const counts = await runWithTenant(tenant, async () => {
      const [users, paying] = await Promise.all([
        tenant.db.from('users').select('id', { count: 'exact', head: true }).neq('id', 'local'),
        tenant.db.from('subscriptions').select('user_id', { count: 'exact', head: true }).gt('current_period_end', new Date().toISOString()),
      ]);
      if (users.error) throw new Error(users.error.message);
      if (paying.error) throw new Error(paying.error.message);
      return { users: users.count ?? 0, activeSubscriptions: paying.count ?? 0 };
    });

    let spend = platformDb.from('ai_spend').select('usage_json').gte('created_at', since).limit(100_000);
    spend = tenant.isDefault ? spend.is('tenant_id', null) : spend.eq('tenant_id', tenant.id);
    const { data: rows, error } = await spend;
    if (error) throw new Error(error.message);
    const aiCostUsd = rows.reduce((sum, row) => sum + (Number(row.usage_json?.cost) || 0), 0);

    res.json({ id: tenant.id, days, ...counts, aiCalls: rows.length, aiCostUsd: Math.round(aiCostUsd * 10000) / 10000 });
  }));
}
