import { currentTenant } from '../tenancy/context.js';
import { PAGE_KEYS, PANEL_KEYS } from './features.js';

/**
 * The per-feature caps for each tier. 'free' is the 5-trading-day trial
 * (see TRIAL_DAYS/trialInfo in src/api/server.js) — it needs no purchase, so
 * it has no matching PLANS entry below. 'long' and 'trader' are the two paid
 * tiers, each sold at a monthly and a yearly price (see PLANS). Every count
 * resets on the 1st of the calendar month (Cairo time) — see usageFor() in
 * src/api/server.js — except the free tier, which never resets since the
 * trial itself is a one-time window.
 */
export const TIERS = {
  free: { key: 'free', label: 'الباقة المجانية', screenshots: 2, recommendations: 15, cashScans: 3, marketAnalysis: 3 },
  long: { key: 'long', label: 'باقة النفس الطويل', screenshots: 7, recommendations: 230, cashScans: 10, marketAnalysis: 30 },
  trader: { key: 'trader', label: 'باقة الحريفة', screenshots: 12, recommendations: 550, cashScans: 20, marketAnalysis: 70 },
};

export const TIER_KEYS = ['free', 'long', 'trader'];
export const CAP_KINDS = ['screenshots', 'recommendations', 'cashScans', 'marketAnalysis'];

/**
 * Everything about a tier the platform panel can change, as the code ships it:
 * the four monthly caps, how many Portfolios, what is locked (see
 * src/billing/features.js — nothing by default), and the pricing card's text.
 * These are the fallback for a fresh database, the CLI and tests; the live
 * values are these, then the platform-wide settings, then the site's own
 * overrides (see resolveTiers).
 */
const DEFAULT_CARDS = {
  free: {
    name: TIERS.free.label,
    note: 'بدون بطاقة، بكل المزايا بحدود التجربة. بتتحسب أيام التداول بس — العطلات والإجازات مش بتتحسب.',
  },
  long: { name: TIERS.long.label, note: 'لمستثمر متوسط وطويل المدى.' },
  trader: { name: TIERS.trader.label, note: 'للمضارب النشط ومتوسط وطويل المدى.' },
};
const DEFAULT_PORTFOLIOS = { free: 1, long: 1, trader: 3 };

export const DEFAULT_TIER_SETTINGS = Object.fromEntries(TIER_KEYS.map((key) => [key, {
  caps: Object.fromEntries(CAP_KINDS.map((kind) => [kind, TIERS[key][kind]])),
  portfolios: DEFAULT_PORTFOLIOS[key],
  locked: { pages: [], panels: [] },
  card: { ...DEFAULT_CARDS[key], bullets: [] },
}]));

export const TIER_LIMITS = {
  cap: { min: 0, max: 100_000 },
  portfolios: { min: 1, max: 10 },
  name: 40,
  note: 160,
  bullets: 10,
  bullet: 120,
};

class TierSettingsError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
    this.userMessage = message;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const wholeNumber = (value, { min, max }, field) => {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new TierSettingsError(`${field}: رقم صحيح من ${min} لـ ${max}`);
  return n;
};
const text = (value, max, field, { required = false } = {}) => {
  if (typeof value !== 'string') throw new TierSettingsError(`${field}: لازم نص`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new TierSettingsError(`${field}: مطلوب`);
  if (trimmed.length > max) throw new TierSettingsError(`${field}: أطول من ${max} حرف`);
  return trimmed;
};
const keyList = (value, allowed, field) => {
  if (!Array.isArray(value)) throw new TierSettingsError(`${field}: لازم قائمة`);
  const unknown = value.find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new TierSettingsError(`${field}: مفتاح غير معروف: ${unknown}`);
  return [...new Set(value)];
};

/**
 * Checks one layer of tier settings (the platform-wide one, or a site's
 * overrides) and returns only the fields it set — both layers are partial.
 * Anything unknown is refused rather than dropped, so a typo in the panel
 * shows up as an error instead of a silently ignored edit.
 */
export function sanitizeTierSettings(input) {
  if (input == null) return {};
  if (!isPlainObject(input)) throw new TierSettingsError('tiers لازم يكون object');
  const out = {};
  for (const [tier, value] of Object.entries(input)) {
    if (!TIER_KEYS.includes(tier)) throw new TierSettingsError(`باقة غير معروفة: ${tier}`);
    if (!isPlainObject(value)) throw new TierSettingsError(`${tier} لازم يكون object`);
    const next = {};
    if (value.caps !== undefined) {
      if (!isPlainObject(value.caps)) throw new TierSettingsError(`${tier}.caps لازم يكون object`);
      next.caps = {};
      for (const [kind, cap] of Object.entries(value.caps)) {
        if (!CAP_KINDS.includes(kind)) throw new TierSettingsError(`${tier}.caps: نوع غير معروف: ${kind}`);
        next.caps[kind] = wholeNumber(cap, TIER_LIMITS.cap, `${tier}.caps.${kind}`);
      }
    }
    if (value.portfolios !== undefined) next.portfolios = wholeNumber(value.portfolios, TIER_LIMITS.portfolios, `${tier}.portfolios`);
    if (value.locked !== undefined) {
      if (!isPlainObject(value.locked)) throw new TierSettingsError(`${tier}.locked لازم يكون object`);
      next.locked = {};
      if (value.locked.pages !== undefined) next.locked.pages = keyList(value.locked.pages, PAGE_KEYS, `${tier}.locked.pages`);
      if (value.locked.panels !== undefined) next.locked.panels = keyList(value.locked.panels, PANEL_KEYS, `${tier}.locked.panels`);
    }
    if (value.card !== undefined) {
      if (!isPlainObject(value.card)) throw new TierSettingsError(`${tier}.card لازم يكون object`);
      next.card = {};
      if (value.card.name !== undefined) next.card.name = text(value.card.name, TIER_LIMITS.name, `${tier}.card.name`, { required: true });
      if (value.card.note !== undefined) next.card.note = text(value.card.note, TIER_LIMITS.note, `${tier}.card.note`);
      if (value.card.bullets !== undefined) {
        if (!Array.isArray(value.card.bullets) || value.card.bullets.length > TIER_LIMITS.bullets) {
          throw new TierSettingsError(`${tier}.card.bullets: قائمة بحد أقصى ${TIER_LIMITS.bullets} سطور`);
        }
        next.card.bullets = value.card.bullets
          .map((line, i) => text(line, TIER_LIMITS.bullet, `${tier}.card.bullets[${i}]`))
          .filter(Boolean);
      }
    }
    out[tier] = next;
  }
  return out;
}

/**
 * Defaults, then each layer in order (platform-wide, then the site's own),
 * merged field by field — except the lock lists and the bullets, which a layer
 * replaces whole so a site can unlock what the platform-wide settings lock.
 * Returns the TIERS shape (key, label, the four caps at the top level) plus
 * portfolios, locked and card, so every existing `TIERS[tier][kind]` read keeps
 * working. A layer that fails validation is skipped, never half-applied: a bad
 * row in the database must not take a tier's caps away.
 */
export function resolveTiers(...layers) {
  const merged = structuredClone(DEFAULT_TIER_SETTINGS);
  for (const layer of layers) {
    let clean;
    try {
      clean = sanitizeTierSettings(layer);
    } catch (err) {
      console.error(`[tiers] ignoring an invalid settings layer: ${err.message}`);
      continue;
    }
    for (const [tier, value] of Object.entries(clean)) {
      const target = merged[tier];
      if (value.caps) Object.assign(target.caps, value.caps);
      if (value.portfolios !== undefined) target.portfolios = value.portfolios;
      if (value.locked?.pages) target.locked.pages = value.locked.pages;
      if (value.locked?.panels) target.locked.panels = value.locked.panels;
      if (value.card) Object.assign(target.card, value.card);
    }
  }
  return Object.fromEntries(TIER_KEYS.map((key) => {
    const { caps, portfolios, locked, card } = merged[key];
    return [key, { key, label: card.name, ...caps, caps, portfolios, locked, card }];
  }));
}

const DEFAULT_RESOLVED = resolveTiers();

/**
 * The effective tier settings for a site: tenant.tiers, which the registry
 * resolves from the platform-wide settings and the site's overrides whenever
 * either changes. With no tenant (CLI, tests, background work outside a
 * request) it is the defaults above. Defaults to the tenant the running code
 * serves, so call sites deep inside request handling need no tenant argument.
 */
export const tiersFor = (tenant = currentTenant()) => tenant?.tiers ?? DEFAULT_RESOLVED;

/**
 * How many Portfolios a tier may hold (map #98 / issue #103). Defaults:
 * الحريفة gets 3, every other tier gets 1 — including a lapsed or
 * never-subscribed account, whose `tier` is `null`. Both are editable per
 * tier from the platform panel.
 */
export const portfolioCapFor = (tier, tenant = currentTenant()) => tiersFor(tenant)[tier]?.portfolios ?? 1;

/** Whether a tier is locked out of a page or panel (see src/billing/features.js). */
export const isLocked = (tier, kind, key, tenant = currentTenant()) => {
  const locked = tiersFor(tenant)[tier]?.locked;
  return Boolean(locked && (kind === 'page' ? locked.pages : locked.panels).includes(key));
};

/**
 * The price list. Subscriptions are arranged over the support chat and
 * activated by hand from the admin panel, so nothing here charges anyone —
 * these are the figures the "اشترك" screen quotes and the admin panel
 * defaults to. Four purchasable SKUs: each paid tier (see TIERS) at a
 * monthly or yearly length.
 *
 * Yearly saves against twelve monthly payments in both tiers (299 × 12 =
 * 3588 vs 2990; 499 × 12 = 5988 vs 4990) — customer-facing copy can quote
 * the exact EGP figure rather than a rounded percentage.
 */
export const PLANS = {
  long_monthly: { key: 'long_monthly', tier: 'long', label: 'النفس الطويل — شهري', priceEgp: 299, months: 1 },
  long_yearly: { key: 'long_yearly', tier: 'long', label: 'النفس الطويل — سنوي', priceEgp: 2990, months: 12 },
  trader_monthly: { key: 'trader_monthly', tier: 'trader', label: 'الحريفة — شهري', priceEgp: 499, months: 1 },
  trader_yearly: { key: 'trader_yearly', tier: 'trader', label: 'الحريفة — سنوي', priceEgp: 4990, months: 12 },
};

export const planFor = (key) => PLANS[String(key ?? '')] ?? null;

/**
 * One-time top-ups on top of a tier's monthly allowance for any of the four
 * capped features (see TIERS) — for an account that keeps running out before
 * the month resets. Arranged and paid the same manual way as a subscription
 * (support chat + InstaPay), then an admin adds the matching credits from
 * the admin panel (see CREDIT_KINDS/creditsOf in src/api/server.js) — there
 * is nothing here that grants anything by itself. Three sizes per feature.
 */
export const ADDONS = {
  screenshots: [
    { key: 'screenshots_quick', label: 'سريع', screenshots: 3, priceEgp: 20 },
    { key: 'screenshots_value', label: 'الأفضل قيمة', screenshots: 6, priceEgp: 39 },
    { key: 'screenshots_bulk', label: 'بالجملة', screenshots: 12, priceEgp: 75 },
  ],
  recommendations: [
    { key: 'recommendations_quick', label: 'سريع', recommendations: 50, priceEgp: 50 },
    { key: 'recommendations_value', label: 'الأفضل قيمة', recommendations: 100, priceEgp: 75 },
    { key: 'recommendations_bulk', label: 'بالجملة', recommendations: 150, priceEgp: 100 },
  ],
  cashScans: [
    { key: 'cashScans_quick', label: 'سريع', cashScans: 20, priceEgp: 25 },
    { key: 'cashScans_value', label: 'الأفضل قيمة', cashScans: 60, priceEgp: 50 },
    { key: 'cashScans_bulk', label: 'بالجملة', cashScans: 150, priceEgp: 80 },
  ],
  marketAnalysis: [
    { key: 'marketAnalysis_quick', label: 'سريع', marketAnalysis: 20, priceEgp: 25 },
    { key: 'marketAnalysis_value', label: 'الأفضل قيمة', marketAnalysis: 60, priceEgp: 50 },
    { key: 'marketAnalysis_bulk', label: 'بالجملة', marketAnalysis: 150, priceEgp: 80 },
  ],
};

/**
 * Where users send the transfer: an InstaPay payment link (or a plain
 * handle). A link is also exposed by /api/billing/plans as payLink for the
 * subscribe page's pay button; a plain handle is only handed out by the
 * support bot to a signed-in user. INSTAPAY_ADDRESS overrides the default
 * link, and a tenant sets its own in config.instapay.address.
 */
export const INSTAPAY = {
  address: process.env.INSTAPAY_ADDRESS ?? 'https://ipn.eg/S/hassansmm/instapay/3iUOPP',
  accountName: process.env.INSTAPAY_ACCOUNT_NAME ?? null,
};

/**
 * White-label sites sell the same tiers with the same caps, at their own
 * prices and into their own InstaPay account. A tenant's config.prices maps a
 * PLANS or ADDONS key to its price in EGP; any key it leaves out keeps the
 * price above. Without a tenant (CLI, tests) these return the defaults.
 */
const priceOverride = (tenant, key) => {
  const value = Number(tenant?.config?.prices?.[key]);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export function plansFor(tenant) {
  return Object.fromEntries(Object.entries(PLANS).map(([key, plan]) => {
    const price = priceOverride(tenant, key);
    return [key, price == null ? plan : { ...plan, priceEgp: price }];
  }));
}

export function addonsFor(tenant) {
  return Object.fromEntries(Object.entries(ADDONS).map(([feature, sizes]) => [
    feature,
    sizes.map((addon) => {
      const price = priceOverride(tenant, addon.key);
      return price == null ? addon : { ...addon, priceEgp: price };
    }),
  ]));
}

export const planForTenant = (tenant, key) => plansFor(tenant)[String(key ?? '')] ?? null;

export const instapayFor = (tenant) => tenant?.config?.instapay ?? INSTAPAY;

/**
 * The support WhatsApp line shown on the pricing page and the chat widget's
 * floating button. Digits only, country code first — the form wa.me links
 * require. Set WHATSAPP_NUMBER to change it without a frontend rebuild —
 * /api/support/contact hands it to the browser at runtime.
 */
export const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER ?? '201014879158';

/**
 * Calendar-month arithmetic that never rolls over: adding a month to Jan 31
 * lands on Feb 28/29, not Mar 3, so a subscription bought on the 31st keeps
 * renewing near month-end instead of drifting a day forward every period.
 */
export function addMonths(date, months) {
  const result = new Date(date.getTime());
  const targetDay = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  if (result.getUTCDate() < targetDay) result.setUTCDate(0);
  return result;
}
