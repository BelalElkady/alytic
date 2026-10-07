import { platformDb, supabase } from './supabaseClient.js';
import { currentTenant } from './tenancy/context.js';
import { canonicalEmail } from './emailIdentity.js';
import { cairoToday } from './data/cache.js';
import { audienceMatches } from './announcementAudience.js';

function must(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

/**
 * Thrown when a write trips one of the users table's one-per-person unique
 * indexes (phone, email_canonical). The auth layer pre-checks both, so this
 * only fires when two requests race past the check — it is the backstop that
 * keeps the rule airtight. `field` is 'phone' or 'email'.
 */
export class DuplicateUserError extends Error {
  constructor(field) {
    super(`duplicate user ${field}`);
    this.field = field;
  }
}

function mustUnlessDuplicate(result, context) {
  if (result.error?.code === '23505') {
    throw new DuplicateUserError(String(result.error.message).includes('phone') ? 'phone' : 'email');
  }
  return must(result, context);
}

export async function getUserByEmail(email) {
  const { data, error } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (error) throw new Error(`getUserByEmail: ${error.message}`);
  return data;
}

/** Finds the account that owns any variant of this address (dots, +tags, googlemail) — see canonicalEmail. */
export async function getUserByCanonicalEmail(email) {
  const { data, error } = await supabase.from('users').select('*').eq('email_canonical', canonicalEmail(email)).maybeSingle();
  if (error) throw new Error(`getUserByCanonicalEmail: ${error.message}`);
  return data;
}

export async function getUserByPhone(phone) {
  const { data, error } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
  if (error) throw new Error(`getUserByPhone: ${error.message}`);
  return data;
}

export async function getUserById(id) {
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getUserById: ${error.message}`);
  return data;
}

// The signed-in user behind a session cookie, remembered for a short while.
// Every authenticated request (and every poll) resolves its session, and
// reading the users row each time was the bulk of the Supabase request
// volume. Every write to a users row in this file forgets that user at once,
// so a password reset, role change or deletion made through the app applies
// to the very next request; only a change made outside this process (SQL
// editor, another backend instance) can take up to the TTL to show.
const SESSION_USER_TTL_MS = 30_000;
const SESSION_USER_MAX = 10_000;
const sessionUsers = new Map();
// Bumped on every forget, which runs after the write lands, so a read already
// in flight during the write can't put the pre-write row back into the cache.
let sessionUserGeneration = 0;
const sessionUserKey = (id) => `${currentTenant()?.id ?? ''}:${id}`;

/** getUserById for resolving a session; see SESSION_USER_TTL_MS. Use getUserById anywhere a fresh row matters. */
export async function getSessionUser(id) {
  const key = sessionUserKey(id);
  const now = Date.now();
  const hit = sessionUsers.get(key);
  if (hit && hit.expires > now) return hit.user;
  const generation = sessionUserGeneration;
  const user = await getUserById(id);
  if (user && generation === sessionUserGeneration) {
    if (sessionUsers.size >= SESSION_USER_MAX) {
      for (const [k, entry] of sessionUsers) if (entry.expires <= now) sessionUsers.delete(k);
      if (sessionUsers.size >= SESSION_USER_MAX) sessionUsers.clear();
    }
    sessionUsers.set(key, { user, expires: now + SESSION_USER_TTL_MS });
  }
  return user;
}

function forgetSessionUser(id) {
  sessionUserGeneration += 1;
  sessionUsers.delete(sessionUserKey(id));
}

export async function getUserByGoogleId(googleId) {
  const { data, error } = await supabase.from('users').select('*').eq('google_id', googleId).maybeSingle();
  if (error) throw new Error(`getUserByGoogleId: ${error.message}`);
  return data;
}

export async function getUserByVerificationToken(token) {
  const { data, error } = await supabase.from('users').select('*').eq('verification_token', token).maybeSingle();
  if (error) throw new Error(`getUserByVerificationToken: ${error.message}`);
  return data;
}

export async function createUser(user) {
  const row = {
    id: user.id,
    email: user.email,
    email_canonical: canonicalEmail(user.email),
    name: user.name,
    phone: user.phone ?? null,
    signup_ip: user.signupIp ?? null,
    password_salt: user.passwordSalt,
    password_hash: user.passwordHash,
    google_id: user.googleId ?? null,
    email_verified: Boolean(user.emailVerified),
    verification_token: user.verificationToken ?? null,
    verification_token_expires: user.verificationTokenExpires ?? null,
    is_admin: Boolean(user.isAdmin),
    created_at: user.createdAt,
  };
  // Only sent when true, so signups keep working on a database that hasn't had
  // the is_marketer column applied yet.
  if (user.isMarketer) row.is_marketer = true;
  // The User's Portfolio is created by the database, not here: the
  // users_create_primary_portfolio trigger (supabase/schema.sql) inserts it
  // in this same statement, so an account can never exist without one —
  // primaryPortfolioIdFor throws for such a User and nothing lazily creates
  // one anymore.
  mustUnlessDuplicate(await supabase.from('users').insert(row), 'createUser');
}

/** `ip` is the caller's address (see clientIp in server.js); callers without one — scripts, tests — leave the stored value alone. */
export async function touchUserLogin(id, timestamp, ip) {
  const update = { last_login_at: timestamp };
  if (ip) update.last_login_ip = ip;
  must(await supabase.from('users').update(update).eq('id', id), 'touchUserLogin');
}

/** Stamps the account as seen at `timestamp` — the presence heartbeat, throttled by the caller. */
export async function touchUserSeen(id, timestamp) {
  must(await supabase.from('users').update({ last_seen_at: timestamp }).eq('id', id), 'touchUserSeen');
}

/** How many accounts reported in at or after `sinceIso` — the admin panel's signed-in "online now". */
export async function countUsersSeenSince(sinceIso) {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .gte('last_seen_at', sinceIso);
  if (error) throw new Error(`countUsersSeenSince: ${error.message}`);
  return count ?? 0;
}

export async function setVerificationToken(id, token, expiresAt) {
  must(
    await supabase.from('users').update({ verification_token: token, verification_token_expires: expiresAt }).eq('id', id),
    'setVerificationToken',
  );
  forgetSessionUser(id);
}

export async function getUserByResetToken(token) {
  const { data, error } = await supabase.from('users').select('*').eq('reset_token', token).maybeSingle();
  if (error) throw new Error(`getUserByResetToken: ${error.message}`);
  return data;
}

export async function setResetToken(id, token, expiresAt) {
  must(
    await supabase.from('users').update({ reset_token: token, reset_token_expires: expiresAt }).eq('id', id),
    'setResetToken',
  );
  forgetSessionUser(id);
}

/** Also clears the reset token so a used (or abandoned) link can't be replayed. */
export async function setUserPassword(id, { salt, hash }) {
  must(
    await supabase.from('users')
      .update({ password_salt: salt, password_hash: hash, reset_token: null, reset_token_expires: null })
      .eq('id', id),
    'setUserPassword',
  );
  forgetSessionUser(id);
}

export async function markEmailVerified(id) {
  must(
    await supabase.from('users')
      .update({ email_verified: true, verification_token: null, verification_token_expires: null })
      .eq('id', id),
    'markEmailVerified',
  );
  forgetSessionUser(id);
}

/** Attaches a Google account to an existing email/password user (same email on both). Google already confirmed the address. */
export async function linkGoogleAccount(id, googleId) {
  must(
    await supabase.from('users').update({ google_id: googleId, email_verified: true }).eq('id', id),
    'linkGoogleAccount',
  );
  forgetSessionUser(id);
}

/** Google sign-in never collects a phone number, so an account created that way needs this filled in afterward. */
export async function setUserPhone(id, phone) {
  mustUnlessDuplicate(await supabase.from('users').update({ phone }).eq('id', id), 'setUserPhone');
  forgetSessionUser(id);
}

/** Lets a signed-in account correct its own display name from the profile page. */
export async function setUserName(id, name) {
  must(await supabase.from('users').update({ name }).eq('id', id), 'setUserName');
  forgetSessionUser(id);
}

/**
 * The Portfolio a User lands on when nothing more specific is asked for —
 * the lowest-`ordinal`, non-deleted row. Every User has at least one after
 * Task 1's migration (see migrate-multi-portfolio.sql); a User with none is
 * a bug elsewhere (Task 8 verifies this against the real database), so this
 * throws rather than returning null like getPortfolioById does.
 */
export async function primaryPortfolioIdFor(userId) {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('ordinal', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`primaryPortfolioIdFor: ${error.message}`);
  if (!data) throw new Error(`primaryPortfolioIdFor: no Portfolio for user ${userId}`);
  return data.id;
}

/** @returns {{id:number,userId:string,name:string,style:string|null,ordinal:number,state:object,deletedAt:string|null}|null} the Portfolio row for this id, or null if it doesn't exist. */
export async function getPortfolioById(portfolioId) {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, user_id, name, style, ordinal, state_json, deleted_at')
    .eq('id', portfolioId)
    .maybeSingle();
  if (error) throw new Error(`getPortfolioById: ${error.message}`);
  if (!data) return null;
  return { id: data.id, userId: data.user_id, name: data.name, style: data.style, ordinal: data.ordinal, state: data.state_json, deletedAt: data.deleted_at };
}

/** @returns {Promise<{id:number,userId:string,name:string,style:string|null,ordinal:number,state:object}[]>} every non-soft-deleted Portfolio for this User, ordered by ordinal ascending. */
export async function listPortfoliosForUser(userId) {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, user_id, name, style, ordinal, state_json')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('ordinal', { ascending: true });
  if (error) throw new Error(`listPortfoliosForUser: ${error.message}`);
  return data.map((row) => ({ id: row.id, userId: row.user_id, name: row.name, style: row.style, ordinal: row.ordinal, state: row.state_json }));
}

/**
 * Inserts a new Portfolio row for this User at the given ordinal. The
 * caller (createPortfolioForUser in portfolio.js) computes the ordinal and
 * holds the per-user write lock, so two concurrent creates can never both
 * land at the same ordinal or both slip past the cap.
 */
export async function insertPortfolio(userId, { name, style, ordinal }) {
  const row = must(
    await supabase.from('portfolios').insert({ user_id: userId, name, style, ordinal })
      .select('id, user_id, name, style, ordinal, state_json, deleted_at').single(),
    'insertPortfolio',
  );
  return { id: row.id, userId: row.user_id, name: row.name, style: row.style, ordinal: row.ordinal, state: row.state_json, deletedAt: row.deleted_at };
}

/** Column-only update — name and/or style, never state_json. */
export async function updatePortfolioMeta(portfolioId, { name, style }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (style !== undefined) patch.style = style;
  const updated = must(
    await supabase.from('portfolios').update(patch).eq('id', portfolioId).select('id'),
    'updatePortfolioMeta',
  );
  if (!updated.length) throw new Error(`updatePortfolioMeta: no Portfolio with id ${portfolioId}`);
}

/** Soft-deletes a Portfolio (ADR 0002 §5) — sets deleted_at, never removes the row. */
export async function softDeletePortfolio(portfolioId) {
  const updated = must(
    await supabase.from('portfolios').update({ deleted_at: new Date().toISOString() }).eq('id', portfolioId).select('id'),
    'softDeletePortfolio',
  );
  if (!updated.length) throw new Error(`softDeletePortfolio: no Portfolio with id ${portfolioId}`);
}

/**
 * Update-only, unlike the old user_id-keyed putPortfolio: `id` is a
 * `generated always as identity` column, so there is no row to "insert" at a
 * caller-chosen id, and every caller resolves `portfolioId` from
 * `primaryPortfolioIdFor`/`getPortfolioById` first — the row always already
 * exists. Throws rather than silently no-opping if it somehow doesn't, so a
 * bad id surfaces immediately instead of losing a write.
 */
export async function putPortfolioById(portfolioId, state) {
  const now = new Date().toISOString();
  const stateJson = { ...state, updatedAt: now };
  const updated = must(
    await supabase.from('portfolios').update({ state_json: stateJson, updated_at: now }).eq('id', portfolioId).select('id'),
    'putPortfolioById',
  );
  if (!updated.length) throw new Error(`putPortfolioById: no Portfolio with id ${portfolioId}`);
}

/**
 * User-level usage/credits — the tier system's usage side, read off the
 * eleven `users` columns Task 1 added. Mirrors the old per-Portfolio
 * `usageFor` (backend/src/api/server.js, retired in Task 7): the four
 * `usage*` counters reset the moment the calendar month (Cairo time) changes
 * — lazily, on read, like credits used to be — so a stale stored month comes
 * back all-zero *without writing anything*; `month` in the returned object
 * is always the current month regardless. `credits` and the two
 * `lastX...At` timestamps are never month-scoped and always pass through
 * unchanged. None of the four usage counters or four credit counters are
 * ever null (default 0).
 */
const USER_USAGE_COLUMNS =
  'usage_month, usage_cash_scans, usage_recommendations, usage_screenshots, usage_market_analysis, credits_cash_scans, credits_recommendations, credits_screenshots, credits_market_analysis, last_cash_scan_at, last_market_scan_at';

/** Shared by getUserUsage and getAllUsers: the same row shape, from a single fetched row (or none). */
function usageRecordFrom(row, month) {
  const stale = row?.usage_month !== month;
  return {
    month,
    cashScans: stale ? 0 : row?.usage_cash_scans ?? 0,
    recommendations: stale ? 0 : row?.usage_recommendations ?? 0,
    screenshots: stale ? 0 : row?.usage_screenshots ?? 0,
    marketAnalysis: stale ? 0 : row?.usage_market_analysis ?? 0,
    credits: {
      cashScans: row?.credits_cash_scans ?? 0,
      recommendations: row?.credits_recommendations ?? 0,
      screenshots: row?.credits_screenshots ?? 0,
      marketAnalysis: row?.credits_market_analysis ?? 0,
    },
    lastCashScanAt: row?.last_cash_scan_at ?? null,
    lastMarketScanAt: row?.last_market_scan_at ?? null,
  };
}

export async function getUserUsage(userId) {
  const { data, error } = await supabase
    .from('users')
    .select(USER_USAGE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`getUserUsage: ${error.message}`);
  return usageRecordFrom(data, cairoToday().slice(0, 7));
}

/**
 * Writes every usage/credits column, including whatever `month` the caller
 * passed — callers always pass `getUserUsage`'s own current-month output
 * back (see `bumpUsage`'s contract, Task 7), so this never needs to do the
 * rollover check itself. Throws if no such User exists, rather than
 * silently writing nothing — like putPortfolioById.
 */
export async function putUserUsage(userId, usage) {
  const updated = must(
    await supabase
      .from('users')
      .update({
        usage_month: usage.month,
        usage_cash_scans: usage.cashScans,
        usage_recommendations: usage.recommendations,
        usage_screenshots: usage.screenshots,
        usage_market_analysis: usage.marketAnalysis,
        credits_cash_scans: usage.credits.cashScans,
        credits_recommendations: usage.credits.recommendations,
        credits_screenshots: usage.credits.screenshots,
        credits_market_analysis: usage.credits.marketAnalysis,
        last_cash_scan_at: usage.lastCashScanAt,
        last_market_scan_at: usage.lastMarketScanAt,
      })
      .eq('id', userId)
      .select('id'),
    'putUserUsage',
  );
  forgetSessionUser(userId);
  if (!updated.length) throw new Error(`putUserUsage: no User with id ${userId}`);
}

/** @returns {object|null} the stored report for that day/style, or null if never generated. */
export async function getMarketReport(reportDate, style) {
  const { data, error } = await platformDb
    .from('market_reports')
    .select('*')
    .eq('report_date', reportDate)
    .eq('style', style)
    .maybeSingle();
  if (error) throw new Error(`getMarketReport: ${error.message}`);
  if (!data) return null;
  return { ...data.report_json, _meta: { model: data.model, generatedAt: data.generated_at, usage: data.usage_json ?? null } };
}

/**
 * Stores today's report. Insert-if-absent is deliberate: two requests racing
 * to generate the same (date, style) on a quiet morning must not let the
 * second, slightly-different generation silently replace the first —
 * whichever writes first is what every user sees for the rest of the day.
 * @returns {boolean} true if this call's report was the one actually stored.
 */
export async function putMarketReport(reportDate, style, report, model, usage) {
  const { data, error } = await platformDb
    .from('market_reports')
    .upsert(
      {
        report_date: reportDate,
        style,
        report_json: report,
        model: model ?? null,
        usage_json: usage ?? null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'report_date,style', ignoreDuplicates: true },
    )
    .select('report_date');
  if (error) throw new Error(`putMarketReport: ${error.message}`);
  return data.length > 0;
}

/** @returns {object|null} the AI-determined entry-plan stop for that stock/style/day, or null if never generated. See stopPlanner.js. */
export async function getStopPlan(code, style, reportDate) {
  const { data, error } = await platformDb
    .from('ai_stop_plans')
    .select('*')
    .eq('code', code)
    .eq('style', style)
    .eq('report_date', reportDate)
    .maybeSingle();
  if (error) throw new Error(`getStopPlan: ${error.message}`);
  if (!data) return null;
  return { stop: data.stop, basis: data.basis };
}

/**
 * Every (code, style) pair already generated for that day — just enough to
 * compute what's still missing, without pulling every row's full payload.
 * Used by the pre-warm cron (see agent/stopPlanWarmer.js) to find the next
 * batch to generate.
 */
export async function getStopPlanCoverage(reportDate) {
  const { data, error } = await platformDb.from('ai_stop_plans').select('code, style').eq('report_date', reportDate);
  if (error) throw new Error(`getStopPlanCoverage: ${error.message}`);
  return data ?? [];
}

/**
 * Stores today's AI-determined entry-plan stop for one stock/style. Same
 * insert-if-absent reasoning as putMarketReport: shared across every user, so
 * whichever request wins the race is what everyone reads for the rest of the day.
 */
export async function putStopPlan(code, style, reportDate, stop, basis, model, usage) {
  const { data, error } = await platformDb
    .from('ai_stop_plans')
    .upsert(
      {
        code,
        style,
        report_date: reportDate,
        stop,
        basis,
        model: model ?? null,
        usage_json: usage ?? null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'code,style,report_date', ignoreDuplicates: true },
    )
    .select('code');
  if (error) throw new Error(`putStopPlan: ${error.message}`);
  return data.length > 0;
}

/**
 * Records one AI call's cost, tagged by which feature made it — see ai_spend
 * in schema.sql. Called fire-and-forget from clientOpenRouter.js; errors are
 * the caller's problem to log, never this function's to throw, since a spend
 * row is telemetry, not something any feature should fail over.
 */
export async function logAiSpend(feature, model, usage) {
  // Always the platform database, tagged with the tenant that made the call,
  // so every client's AI cost is in one place. The default site's rows keep
  // a null tenant_id, as every row did before tenants existed.
  const tenant = currentTenant();
  const row = { feature, model: model ?? null, usage_json: usage ?? null };
  if (tenant && !tenant.isDefault) row.tenant_id = tenant.id;
  const { error } = await platformDb.from('ai_spend').insert(row);
  if (error) throw new Error(`logAiSpend: ${error.message}`);
}

/**
 * The oanor call count for one billing period (see data/live-quote-pool.js),
 * or null if nothing was recorded for it yet. Platform-wide: every site shares
 * the one oanor key, so the count lives in the platform database untagged.
 */
export async function getOanorUsage(periodStart) {
  const { data, error } = await platformDb.from('oanor_usage').select('*').eq('period_start', periodStart).maybeSingle();
  if (error) throw new Error(`getOanorUsage: ${error.message}`);
  if (!data) return null;
  return {
    calls: data.calls,
    quota: data.quota,
    reason: data.rollback_reason,
    exhaustedAt: data.exhausted_at,
  };
}

/** Overwrites the oanor call count and rollback state for one billing period. */
export async function putOanorUsage(periodStart, { calls, quota, reason, exhaustedAt }) {
  const { error } = await platformDb.from('oanor_usage').upsert(
    {
      period_start: periodStart,
      calls,
      quota: quota ?? null,
      rollback_reason: reason ?? null,
      exhausted_at: exhaustedAt ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'period_start' },
  );
  if (error) throw new Error(`putOanorUsage: ${error.message}`);
}

/** @returns {object|null} cached fundamentals for one ticker, or null if never fetched. */
export async function getFundamentalsCache(code) {
  const { data, error } = await platformDb.from('fundamentals_cache').select('*').eq('code', code).maybeSingle();
  if (error) throw new Error(`getFundamentalsCache: ${error.message}`);
  if (!data) return null;
  return { ...data.data_json, _fetchedAt: data.fetched_at };
}

/** Overwrites the cached fundamentals for one ticker. */
export async function putFundamentalsCache(code, data) {
  const { error } = await platformDb
    .from('fundamentals_cache')
    .upsert({ code, data_json: data, fetched_at: new Date().toISOString() }, { onConflict: 'code' });
  if (error) throw new Error(`putFundamentalsCache: ${error.message}`);
}

/**
 * @returns {object|null} the stored review for that Portfolio/day/style, or
 *   null if none is stored, or if one is stored but for a different
 *   portfolio (the caller must compare portfolioHash itself — this just
 *   returns whatever row exists so the caller can decide).
 */
export async function getPortfolioReview(portfolioId, reportDate, style) {
  const { data, error } = await supabase
    .from('portfolio_reviews')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .eq('report_date', reportDate)
    .eq('style', style)
    .maybeSingle();
  if (error) throw new Error(`getPortfolioReview: ${error.message}`);
  if (!data) return null;
  return {
    ...data.review_json,
    portfolioHash: data.portfolio_hash,
    _meta: { ...data.review_json._meta, model: data.model, generatedAt: data.generated_at, usage: data.usage_json ?? null },
  };
}

/**
 * Stores today's review for this Portfolio/style, replacing whatever was
 * there — unlike putMarketReport this is a per-Portfolio row, so there is no
 * cross-request race to protect against with insert-if-absent; the latest
 * generation for a changed portfolio should simply win. `user_id` is kept
 * denormalized on the row (see ADR 0002 §4), so it's looked up here from the
 * Portfolio itself rather than trusted from the caller.
 */
export async function putPortfolioReview(portfolioId, reportDate, style, portfolioHash, review, model, usage) {
  // Only the owner is needed — not the whole state_json getPortfolioById reads.
  const { data: owner, error: ownerError } = await supabase
    .from('portfolios')
    .select('user_id')
    .eq('id', portfolioId)
    .maybeSingle();
  if (ownerError) throw new Error(`putPortfolioReview: ${ownerError.message}`);
  if (!owner) throw new Error(`putPortfolioReview: no Portfolio with id ${portfolioId}`);
  const { error } = await supabase.from('portfolio_reviews').upsert(
    {
      portfolio_id: portfolioId,
      user_id: owner.user_id,
      report_date: reportDate,
      style,
      portfolio_hash: portfolioHash,
      review_json: review,
      model: model ?? null,
      usage_json: usage ?? null,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'portfolio_id,report_date,style' },
  );
  if (error) throw new Error(`putPortfolioReview: ${error.message}`);
}

/**
 * True when the failure is "this table was never created" rather than a real
 * query error. The subscription tables ship in supabase/schema.sql, which is
 * applied by hand, so a backend deploy can legitimately reach production
 * before the migration does. Treating that as "no subscriptions exist" is not
 * a guess — a table that doesn't exist holds no rows — and it keeps an
 * un-migrated deploy on the free trial instead of failing every request.
 * PGRST205 is PostgREST's schema-cache miss; 42P01 is Postgres' undefined_table.
 */
const isMissingTable = (error) => error?.code === 'PGRST205' || error?.code === '42P01';

let warnedMissingSubscriptions = false;
function warnMissingSubscriptions(context) {
  if (warnedMissingSubscriptions) return;
  warnedMissingSubscriptions = true;
  console.error(
    `${context}: the subscriptions tables are missing — apply backend/supabase/schema.sql. ` +
      'Every account is being treated as never-subscribed until then.',
  );
}

/** @returns {object|null} the user's plan row, or null if they never paid. Says nothing about whether the period is still live — the caller compares current_period_end. */
export async function getSubscription(userId) {
  const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
  if (isMissingTable(error)) {
    warnMissingSubscriptions('getSubscription');
    return null;
  }
  if (error) throw new Error(`getSubscription: ${error.message}`);
  return data;
}

/** Every subscription row, keyed by user_id — for the admin users list, which needs each user's plan alongside their profile. */
export async function getAllSubscriptions() {
  const { data, error } = await supabase.from('subscriptions').select('*');
  if (isMissingTable(error)) {
    warnMissingSubscriptions('getAllSubscriptions');
    return [];
  }
  if (error) throw new Error(`getAllSubscriptions: ${error.message}`);
  return data;
}

/** Starts or extends the user's plan. One row per user, so a renewal overwrites rather than stacking — the caller computes the new current_period_end. */
export async function putSubscription({ userId, plan, tier, currentPeriodEnd, grantedBy, note }) {
  must(
    await supabase.from('subscriptions').upsert(
      {
        user_id: userId,
        plan,
        tier,
        current_period_end: currentPeriodEnd,
        granted_by: grantedBy ?? null,
        note: note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    ),
    'putSubscription',
  );
}

/** Ends paid access immediately. The audit trail lives in subscription_grants, so dropping the row loses no history. */
export async function deleteSubscription(userId) {
  must(await supabase.from('subscriptions').delete().eq('user_id', userId), 'deleteSubscription');
}

/** Appends one admin action to the audit log — see the subscription_grants comment in supabase/schema.sql. */
export async function recordSubscriptionGrant({ userId, plan, periodEnd, amountEgp, reference, note, action, grantedBy }) {
  must(
    await supabase.from('subscription_grants').insert({
      user_id: userId,
      plan,
      period_end: periodEnd ?? null,
      amount_egp: amountEgp ?? null,
      reference: reference ?? null,
      note: note ?? null,
      action: action ?? 'grant',
      granted_by: grantedBy ?? null,
    }),
    'recordSubscriptionGrant',
  );
}

/** Appends one admin Credits change to the audit log — see the credits_grants comment in supabase/schema.sql. */
export async function recordCreditsGrant({ userId, deltas, reference, note, grantedBy }) {
  must(
    await supabase.from('credits_grants').insert({
      user_id: userId,
      deltas,
      reference: reference ?? null,
      note: note ?? null,
      granted_by: grantedBy ?? null,
    }),
    'recordCreditsGrant',
  );
}

/** This user's activation history, newest first — shown in the admin panel when reviewing a disputed or repeated payment. */
export async function listSubscriptionGrants(userId, { limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('subscription_grants')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listSubscriptionGrants: ${error.message}`);
  return data;
}

/** This user's Credits change history, newest first — same audit-check purpose as listSubscriptionGrants. */
export async function listCreditsGrants(userId, { limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('credits_grants')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listCreditsGrants: ${error.message}`);
  return data;
}

/** One user's support thread, oldest first — the whole conversation, which stays small enough not to need paging. */
export async function listSupportMessages(userId) {
  const { data, error } = await supabase
    .from('support_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listSupportMessages: ${error.message}`);
  return data;
}

export async function insertSupportMessage({ userId, sender, body, sentBy, imagePath }) {
  const { data, error } = await supabase
    .from('support_messages')
    .insert({ user_id: userId, sender, body, sent_by: sentBy ?? null, image_path: imagePath ?? null })
    .select('*')
    .single();
  if (error) throw new Error(`insertSupportMessage: ${error.message}`);
  return data;
}

/** Marks the other side's messages in this thread as seen. `sender` is whose messages to mark, i.e. the side that did NOT call this. */
export async function markSupportMessagesRead(userId, sender) {
  must(
    await supabase
      .from('support_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('sender', sender)
      .is('read_at', null),
    'markSupportMessagesRead',
  );
}

/**
 * Recent messages across every thread, newest first, for the admin inbox —
 * grouped into threads by the caller. Capped rather than paged: the inbox
 * shows active conversations, and an individual thread is read in full by
 * listSupportMessages.
 */
export async function listRecentSupportMessages({ limit = 500 } = {}) {
  const { data, error } = await supabase
    .from('support_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentSupportMessages: ${error.message}`);
  return data;
}

export const USER_ROLES = ['admin', 'marketer', 'user'];

/** The role a users row holds. Admin wins if both flags are somehow set. */
export const roleOf = (row) => (row?.is_admin ? 'admin' : row?.is_marketer ? 'marketer' : 'user');

/**
 * The one place a role is written: 'admin', 'marketer' or 'user' (a regular
 * account), stored as the two flags. Both are set in a single update, so a
 * user can never end up holding both.
 */
export async function setUserRole(id, role) {
  if (!USER_ROLES.includes(role)) throw new Error(`setUserRole: unknown role ${role}`);
  must(await supabase.from('users').update({ is_admin: role === 'admin', is_marketer: role === 'marketer' }).eq('id', id), 'setUserRole');
  forgetSessionUser(id);
}

export async function setUserAdmin(id, isAdmin) {
  await setUserRole(id, isAdmin ? 'admin' : 'user');
}

/** Granting replaces any other role; revoking only clears the marketer flag, so it can never demote an admin. */
export async function setUserMarketer(id, isMarketer) {
  if (isMarketer) return setUserRole(id, 'marketer');
  must(await supabase.from('users').update({ is_marketer: false }).eq('id', id), 'setUserMarketer');
  forgetSessionUser(id);
}

/**
 * Suspends or reinstates an account. Suspension blocks the app entirely —
 * ahead of trial/subscription state, even for staff — until lifted; the
 * message (shown with a WhatsApp button, same spot the paywall occupies) is
 * cleared on reinstatement so a later suspension never reuses a stale reason.
 */
export async function setUserSuspended(id, suspended, message = null) {
  must(
    await supabase.from('users').update({
      is_suspended: suspended,
      suspension_message: suspended ? (message ?? null) : null,
    }).eq('id', id),
    'setUserSuspended',
  );
  forgetSessionUser(id);
}

/**
 * Permanently removes a user. Their portfolio, reviews, subscription, grants
 * and support thread go with them via `on delete cascade`; the columns that
 * only record *who acted* (granted_by, sent_by, approved_by) don't cascade, so
 * they're cleared first or the delete would fail on a user who ever acted as
 * an admin. Returns false if no such user existed.
 */
export async function deleteUser(id) {
  for (const [table, column] of [
    ['subscriptions', 'granted_by'],
    ['subscription_grants', 'granted_by'],
    ['support_messages', 'sent_by'],
    ['blog_posts', 'approved_by'],
  ]) {
    must(await supabase.from(table).update({ [column]: null }).eq(column, id), `deleteUser(${table}.${column})`);
  }
  const data = must(await supabase.from('users').delete().eq('id', id).select('id'), 'deleteUser');
  forgetSessionUser(id);
  return data.length > 0;
}

/**
 * Every registered user, newest first — for the admin users list. Excludes
 * auth secrets (password hash/salt, tokens). Each row also carries `usage`,
 * the same shape getUserUsage returns, read in this one query so the list
 * needs no second per-account (or second whole-table) read. Paged like
 * getAllPortfolios — an unpaged select stops at PostgREST's 1000-row cap,
 * which the users table is already past. `id` breaks created_at ties so
 * pages can't overlap or skip.
 */
export async function getAllUsers() {
  const month = cairoToday().slice(0, 7);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('users')
      .select(`id, email, name, phone, is_admin, is_marketer, is_suspended, suspension_message, email_verified, google_id, created_at, last_login_at, last_seen_at, signup_ip, last_login_ip, ${USER_USAGE_COLUMNS}`)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`getAllUsers: ${error.message}`);
    rows.push(...data.map((row) => ({ ...row, usage: usageRecordFrom(row, month) })));
    if (data.length < 1000) return rows;
  }
}

let warnedMissingFollowUps = false;

/** Every user's follow-up checklist row — for the admin users list. Empty (with one warning) until the user_follow_ups table from supabase/schema.sql is applied. */
export async function getAllFollowUps() {
  const { data, error } = await supabase.from('user_follow_ups').select('user_id, whatsapp_at, email_at');
  if (isMissingTable(error)) {
    if (!warnedMissingFollowUps) {
      warnedMissingFollowUps = true;
      console.error('getAllFollowUps: the user_follow_ups table is missing — apply backend/supabase/schema.sql.');
    }
    return [];
  }
  if (error) throw new Error(`getAllFollowUps: ${error.message}`);
  return data;
}

export const FOLLOW_UP_CHANNELS = ['whatsapp', 'email'];

/**
 * Ticks (done) or clears one channel of a user's follow-up checklist, leaving
 * the other channel as it was. Returns the row after the change.
 */
export async function setUserFollowUp(userId, channel, done, updatedBy) {
  if (!FOLLOW_UP_CHANNELS.includes(channel)) throw new Error(`setUserFollowUp: unknown channel ${channel}`);
  const now = new Date().toISOString();
  const data = must(
    await supabase
      .from('user_follow_ups')
      .upsert(
        { user_id: userId, [`${channel}_at`]: done ? now : null, updated_by: updatedBy ?? null, updated_at: now },
        { onConflict: 'user_id' },
      )
      .select('user_id, whatsapp_at, email_at')
      .single(),
    'setUserFollowUp',
  );
  return data;
}

/**
 * Every live (non-deleted) portfolio's state, one row per Portfolio — for the
 * admin users list's per-Portfolio summary (#111) and the daily close. A User
 * can hold more than one row since #103 (up to 3 for الحريفة); `ordinal` is
 * along so callers that want a single row per User can pick the primary
 * (lowest `ordinal`) deterministically instead of an arbitrary one, and
 * `name`/`style` so each Portfolio can be labelled without a second query.
 * Paged, like listOpenRecommendationKeys: every User has a row now, and an
 * unpaged select stops at PostgREST's 1000-row cap — the daily close
 * (runDailyClose in server.js) would silently skip whoever fell past it.
 */
export async function getAllPortfolios() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('portfolios')
      .select('id, user_id, ordinal, name, style, state_json')
      .is('deleted_at', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`getAllPortfolios: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/** @returns {{tickers:string[],updatedAt:string,updatedBy:string|null}|null} an admin-uploaded ticker list for this index, or null if none was ever uploaded. */
export async function getIndexOverride(indexName) {
  const { data, error } = await platformDb.from('index_overrides').select('*').eq('index_name', indexName).maybeSingle();
  if (error) throw new Error(`getIndexOverride: ${error.message}`);
  if (!data) return null;
  return { tickers: data.tickers_json, updatedAt: data.updated_at, updatedBy: data.updated_by };
}

export async function setIndexOverride(indexName, tickers, updatedBy) {
  must(
    await platformDb.from('index_overrides').upsert(
      { index_name: indexName, tickers_json: tickers, updated_at: new Date().toISOString(), updated_by: updatedBy ?? null },
      { onConflict: 'index_name' },
    ),
    'setIndexOverride',
  );
}

export async function clearIndexOverride(indexName) {
  must(await platformDb.from('index_overrides').delete().eq('index_name', indexName), 'clearIndexOverride');
}

export async function getAllIndexOverrides() {
  const { data, error } = await platformDb.from('index_overrides').select('*');
  if (error) throw new Error(`getAllIndexOverrides: ${error.message}`);
  return Object.fromEntries(
    data.map((row) => [row.index_name, { tickers: row.tickers_json, updatedAt: row.updated_at, updatedBy: row.updated_by }]),
  );
}

/** @returns {{code:string,name:string}[]} every admin-added stock not in the generated universe — see config/universe.js's registerCustomStocks. */
export async function getAllCustomStocks() {
  const { data, error } = await platformDb.from('custom_stocks').select('code, name');
  if (error) throw new Error(`getAllCustomStocks: ${error.message}`);
  return data;
}

/** Upserts (never overwrites a name with a blank one) a batch of admin-uploaded stocks that weren't already known. */
export async function addCustomStocks(stocks, addedBy) {
  if (!stocks.length) return;
  must(
    await platformDb.from('custom_stocks').upsert(
      stocks.map(({ code, name }) => ({ code, name, added_at: new Date().toISOString(), added_by: addedBy ?? null })),
      { onConflict: 'code' },
    ),
    'addCustomStocks',
  );
}

/** @returns {object|null} the stored draft/post for that (day, batch slot), or null if never generated — used by getOrGenerateNextBlogArticle to avoid regenerating. */
export async function getBlogPostByBatch(postDate, batchIndex) {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('post_date', postDate).eq('batch_index', batchIndex).maybeSingle();
  if (error) throw new Error(`getBlogPostByBatch: ${error.message}`);
  return data;
}

/** @returns {object[]} every article already generated for that day, ordered by batch_index — used to resume a partially-completed daily batch instead of paying for already-stored articles again. */
export async function getBlogPostsForDate(postDate) {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('post_date', postDate).order('batch_index', { ascending: true });
  if (error) throw new Error(`getBlogPostsForDate: ${error.message}`);
  return data;
}

/**
 * The day's topic plan (one discoverTopics() call's worth of keyword/angle
 * pairs), so spreading the day's articles across the several cron runs
 * that follow doesn't re-run — and re-pay for — discovery on every run.
 * @returns {object|null} the stored row, or null if today's plan hasn't been generated yet.
 */
export async function getDailyBlogTopics(postDate) {
  const { data, error } = await supabase.from('blog_daily_topics').select('*').eq('post_date', postDate).maybeSingle();
  if (error) throw new Error(`getDailyBlogTopics: ${error.message}`);
  return data;
}

/**
 * Stores today's topic plan. Insert-if-absent (like putMarketReport) so two
 * cron runs racing to create the same day's plan can't both land one —
 * whichever writes first wins, and the loser's caller should re-read.
 * @returns {object|null} the inserted row, or null if a plan for this postDate already existed.
 */
export async function putDailyBlogTopics(postDate, topics, model) {
  const { data, error } = await supabase
    .from('blog_daily_topics')
    .upsert(
      { post_date: postDate, topics_json: topics, model: model ?? null, generated_at: new Date().toISOString() },
      { onConflict: 'post_date', ignoreDuplicates: true },
    )
    .select('*');
  if (error) throw new Error(`putDailyBlogTopics: ${error.message}`);
  return data[0] ?? null;
}

/**
 * Inserts a freshly generated draft. Insert-if-absent (like putMarketReport)
 * so two concurrent runs for the same (day, batch_index) can't both land a
 * row — whichever writes first wins, and the loser's caller should re-read
 * instead.
 * @returns {object|null} the inserted row, or null if a row for this (day, batch_index) already existed.
 */
export async function insertBlogPostDraft(row) {
  const { data, error } = await supabase
    .from('blog_posts')
    .upsert(
      {
        post_date: row.postDate,
        batch_index: row.batchIndex,
        slug: row.slug,
        primary_keyword: row.primaryKeyword,
        secondary_keywords: row.secondaryKeywords ?? [],
        title: row.title,
        meta_title: row.metaTitle ?? row.title,
        meta_description: row.metaDescription,
        dek: row.dek ?? null,
        content_json: row.content,
        tags: row.tags ?? [],
        sources_json: row.sources ?? null,
        image_json: row.image ?? null,
        image_url: row.imageUrl ?? null,
        image_thumb_url: row.imageThumbUrl ?? null,
        image_source_url: row.imageSourceUrl ?? null,
        image_credit_name: row.imageCreditName ?? null,
        image_credit_url: row.imageCreditUrl ?? null,
        generation_model: row.generationModel ?? null,
        generation_usage_json: row.generationUsage ?? null,
        review_model: row.reviewModel ?? null,
        review_json: row.review ?? null,
        // Published immediately by default — no admin click required. The
        // review model's verdict/notes are still stored either way, so a
        // "flag" is visible on the live post for an admin to unpublish
        // (POST /api/admin/blog-drafts/:id/unpublish) rather than a gate.
        status: 'published',
        generated_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
      },
      { onConflict: 'post_date,batch_index', ignoreDuplicates: true },
    )
    .select('*');
  if (error) throw new Error(`insertBlogPostDraft: ${error.message}`);
  return data[0] ?? null;
}

/**
 * Inserts an article written directly by an admin (as opposed to
 * insertBlogPostDraft above, which is only ever called by the auto-generation
 * pipeline and requires generation-specific fields like postDate/batchIndex
 * to line up with that day's cron batch). Manual posts still need *some*
 * (post_date, batch_index) to satisfy that unique constraint, so they get a
 * negative, per-second batch_index — auto-generation only ever uses small
 * positive indices (see ARTICLES_PER_DAY in blogGenerator.js), so the two
 * numbering schemes can never collide.
 * @throws an Error with a `.code` matching the underlying Postgres error
 *   code (e.g. '23505' for a duplicate slug) so callers can give a friendly
 *   message for that case.
 */
export async function insertManualBlogPost({
  title,
  slug,
  metaTitle,
  metaDescription,
  dek,
  content,
  tags,
  primaryKeyword,
  imageUrl,
  publish,
}) {
  const now = new Date();
  const status = publish ? 'published' : 'draft';
  const { data, error } = await supabase
    .from('blog_posts')
    .insert({
      post_date: now.toISOString().slice(0, 10),
      batch_index: -Math.floor(now.getTime() / 1000),
      slug,
      primary_keyword: primaryKeyword || title,
      secondary_keywords: [],
      title,
      meta_title: metaTitle,
      meta_description: metaDescription,
      dek: dek ?? null,
      content_json: content,
      tags: tags ?? [],
      image_url: imageUrl ?? null,
      image_thumb_url: imageUrl ?? null,
      status,
      generated_at: now.toISOString(),
      published_at: publish ? now.toISOString() : null,
    })
    .select('*')
    .single();
  if (error) {
    const wrapped = new Error(`insertManualBlogPost: ${error.message}`);
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}

export async function listBlogPosts({ status, limit = 50 } = {}) {
  let query = supabase.from('blog_posts').select('*').order('generated_at', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(`listBlogPosts: ${error.message}`);
  return data;
}

/** True row count for a status, independent of listBlogPosts' page size — so an admin count display stays right past the 50-row cap. */
export async function countBlogPosts(status) {
  let query = supabase.from('blog_posts').select('*', { count: 'exact', head: true });
  if (status) query = query.eq('status', status);
  const { count, error } = await query;
  if (error) throw new Error(`countBlogPosts: ${error.message}`);
  return count ?? 0;
}

/**
 * One page of the newest published posts, plus the total across every page —
 * for the public /blog list (paged), the landing strip and the header ticker
 * (both just the first page). `slug` is the tie-break so posts sharing a
 * published_at can't swap between pages and show up twice or not at all.
 */
export async function listPublishedBlogPosts({ limit = 20, offset = 0 } = {}) {
  const { data, error, count } = await supabase
    .from('blog_posts')
    .select('slug, title, dek, meta_description, tags, image_thumb_url, published_at', { count: 'exact' })
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .order('slug', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error?.code === 'PGRST103') {
    // The offset is past the last post (a stale or hand-typed ?page=). PostgREST
    // refuses the range outright, so an empty page still needs its total from
    // a separate count for the caller to know where the real last page is.
    const total = await countPublishedBlogPosts();
    return { posts: [], total };
  }
  if (error) throw new Error(`listPublishedBlogPosts: ${error.message}`);
  return { posts: data, total: count ?? data.length };
}

async function countPublishedBlogPosts() {
  const { count, error } = await supabase
    .from('blog_posts')
    .select('slug', { count: 'exact', head: true })
    .eq('status', 'published');
  if (error) throw new Error(`countPublishedBlogPosts: ${error.message}`);
  return count ?? 0;
}

/** Every published slug, for /sitemap.xml — unlike listPublishedBlogPosts above, no cap. */
export async function listAllPublishedBlogSlugs() {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('slug, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) throw new Error(`listAllPublishedBlogSlugs: ${error.message}`);
  return data;
}

export async function getPublishedBlogPostBySlug(slug) {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('slug', slug).eq('status', 'published').maybeSingle();
  if (error) throw new Error(`getPublishedBlogPostBySlug: ${error.message}`);
  return data;
}

export async function setBlogPostStatus(id, status, approvedBy) {
  const patch = { status };
  if (status === 'published') {
    patch.published_at = new Date().toISOString();
    patch.approved_at = new Date().toISOString();
    patch.approved_by = approvedBy ?? null;
  }
  const { data, error } = await supabase.from('blog_posts').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(`setBlogPostStatus: ${error.message}`);
  return data;
}

/** Edits editorial fields on an existing post (draft or already published) — used by the admin blog tab's edit form. */
export async function updateBlogPost(id, { title, dek, metaDescription, content, tags } = {}) {
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (dek !== undefined) patch.dek = dek;
  if (metaDescription !== undefined) patch.meta_description = metaDescription;
  if (content !== undefined) patch.content_json = content;
  if (tags !== undefined) patch.tags = tags;
  const { data, error } = await supabase.from('blog_posts').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(`updateBlogPost: ${error.message}`);
  return data;
}

export async function deleteBlogPost(id) {
  const { data, error } = await supabase.from('blog_posts').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw new Error(`deleteBlogPost: ${error.message}`);
  return data;
}

// ---- Feature announcements (see supabase/schema.sql) ----
// Per-tenant-database, like blog_posts — not centrally shared like
// index_overrides — so these use `supabase`, not `platformDb`.

export async function listAnnouncements() {
  const { data, error } = await supabase.from('feature_announcements').select('*').order('starts_at', { ascending: false });
  if (error) throw new Error(`listAnnouncements: ${error.message}`);
  return data;
}

export async function createAnnouncement({ title, body, imageUrls, videoUrl, ctaLabel, ctaUrl, audiences, startsAt, endsAt, createdBy }) {
  const { data, error } = await supabase
    .from('feature_announcements')
    .insert({
      title,
      body,
      image_urls: imageUrls ?? [],
      video_url: videoUrl ?? null,
      cta_label: ctaLabel ?? null,
      cta_url: ctaUrl ?? null,
      audiences: audiences ?? [],
      starts_at: startsAt,
      ends_at: endsAt,
      created_by: createdBy ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`createAnnouncement: ${error.message}`);
  return data;
}

export async function updateAnnouncement(id, { title, body, imageUrls, videoUrl, ctaLabel, ctaUrl, audiences, startsAt, endsAt }) {
  const { data, error } = await supabase
    .from('feature_announcements')
    .update({
      title,
      body,
      image_urls: imageUrls ?? [],
      video_url: videoUrl ?? null,
      cta_label: ctaLabel ?? null,
      cta_url: ctaUrl ?? null,
      audiences: audiences ?? [],
      starts_at: startsAt,
      ends_at: endsAt,
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`updateAnnouncement: ${error.message}`);
  return data;
}

export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('feature_announcements').delete().eq('id', id);
  if (error) throw new Error(`deleteAnnouncement: ${error.message}`);
}

/**
 * The one announcement this user should currently see, or null: among the
 * announcements whose window covers now and whose audience includes one of
 * the user's `segments` (see announcementAudience.js), the one with the latest
 * startsAt that this user hasn't dismissed. Two separate queries (candidates,
 * dismissed ids) rather than a join, since this table is small and a plain
 * `.not('id', 'in', ...)` filter would need the dismissed set client-side
 * anyway to also exclude it from an "active" window that already passed.
 */
let warnedMissingAnnouncementsTable = false;

export async function getActiveAnnouncementForUser(userId, segments = []) {
  const now = new Date().toISOString();
  const [{ data: candidates, error: candidatesError }, { data: dismissed, error: dismissedError }] = await Promise.all([
    supabase.from('feature_announcements').select('*').lte('starts_at', now).gte('ends_at', now).order('starts_at', { ascending: false }),
    supabase.from('user_announcement_dismissals').select('announcement_id').eq('user_id', userId),
  ]);
  if (isMissingTable(candidatesError) || isMissingTable(dismissedError)) {
    if (!warnedMissingAnnouncementsTable) {
      warnedMissingAnnouncementsTable = true;
      console.error('getActiveAnnouncementForUser: the feature_announcements/user_announcement_dismissals tables are missing — apply backend/supabase/schema.sql.');
    }
    return null;
  }
  if (candidatesError) throw new Error(`getActiveAnnouncementForUser: ${candidatesError.message}`);
  if (dismissedError) throw new Error(`getActiveAnnouncementForUser: ${dismissedError.message}`);
  const dismissedIds = new Set(dismissed.map((row) => row.announcement_id));
  return candidates.find((row) => !dismissedIds.has(row.id) && audienceMatches(row.audiences, segments)) ?? null;
}

/** Hides one announcement for one account, forever — idempotent by the upsert's onConflict. */
export async function dismissAnnouncement(userId, announcementId) {
  const { error } = await supabase
    .from('user_announcement_dismissals')
    .upsert(
      { user_id: userId, announcement_id: announcementId, dismissed_at: new Date().toISOString() },
      { onConflict: 'user_id,announcement_id' },
    );
  if (isMissingTable(error)) {
    if (!warnedMissingAnnouncementsTable) {
      warnedMissingAnnouncementsTable = true;
      console.error('dismissAnnouncement: the user_announcement_dismissals table is missing — apply backend/supabase/schema.sql.');
    }
    return;
  }
  if (error) throw new Error(`dismissAnnouncement: ${error.message}`);
}

// ---- Recommendation track record (see the recommendations section of supabase/schema.sql) ----

/** Logs issued calls. A call already logged for that User, stock and action today is skipped, not an error. */
export async function insertRecommendations(rows) {
  if (!rows.length) return;
  const { error } = await supabase
    .from('recommendations')
    .upsert(rows, { onConflict: 'user_id,portfolio_id,ticker,action,issued_on', ignoreDuplicates: true });
  if (error) throw new Error(`insertRecommendations: ${error.message}`);
}

/** The stock and action of every call still open in a Portfolio — what a repeat review must not log a second copy of. */
export async function listOpenRecommendationKeys(portfolioId) {
  if (!portfolioId) return [];
  const keys = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('recommendations')
      .select('ticker, action')
      .eq('portfolio_id', portfolioId)
      .eq('status', 'open')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`listOpenRecommendationKeys: ${error.message}`);
    keys.push(...data.map((r) => `${r.ticker}:${r.action}`));
    if (data.length < 1000) return keys;
  }
}

/** The ticker and issue date of every call still being followed (open, or its horizon not over) — what the daily price recording needs to cover. */
export async function listOpenRecommendationTickers() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('recommendations')
      .select('ticker, issued_on')
      .or('status.eq.open,stock_move_final.eq.false')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`listOpenRecommendationTickers: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function upsertRecommendationPrices(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('recommendation_prices')
      .upsert(rows.slice(i, i + 500), { onConflict: 'ticker,session_date' });
    if (error) throw new Error(`upsertRecommendationPrices: ${error.message}`);
  }
}

/**
 * Recommendations for the track-record page, newest first. `userId` narrows
 * to one User's calls; `from`/`to` are inclusive Cairo issue dates.
 * `excludeTestRows` leaves out what the test suite logged (source 'test'):
 * it writes to the same database, and the table refuses deletes.
 */
export async function listRecommendations({ userId = null, from = null, to = null, limit = 5000, excludeTestRows = false } = {}) {
  const columns = 'id, user_id, ticker, action, ref_price, target_price, stop_price, horizon_days, egx30_at_issue, model_version, issued_at, issued_on, source, style, status, closed_at, exit_price, return_pct, excess_return_pct, sessions_elapsed, mark_price, mark_return_pct, mark_excess_return_pct, evaluated_at, benchmark, indices_at_issue, benchmark_excess_pct, index_excess, mark_benchmark_excess_pct, mark_index_excess, stock_move_price, stock_move_pct, stock_move_sessions, stock_move_final';
  // scoring_version arrived later than the rest; a project that hasn't applied
  // schema.sql yet doesn't have it, and the page must keep working there.
  for (const select of [`${columns}, scoring_version`, columns]) {
    const rows = [];
    let missingColumn = false;
    for (let offset = 0; offset < limit; offset += 1000) {
      let query = supabase.from('recommendations').select(select);
      if (userId) query = query.eq('user_id', userId);
      if (from) query = query.gte('issued_on', from);
      if (to) query = query.lte('issued_on', to);
      if (excludeTestRows) query = query.neq('source', 'test');
      const { data, error } = await query
        .order('issued_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, Math.min(offset + 999, limit - 1));
      if (error) {
        if (select !== columns && /scoring_version/.test(error.message)) { missingColumn = true; break; }
        throw new Error(`listRecommendations: ${error.message}`);
      }
      rows.push(...data);
      if (data.length < 1000) break;
    }
    if (!missingColumn) return rows;
  }
}

export { supabase };
