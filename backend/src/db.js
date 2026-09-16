import { supabase } from './supabaseClient.js';

function must(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

export async function getUserByEmail(email) {
  const { data, error } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (error) throw new Error(`getUserByEmail: ${error.message}`);
  return data;
}

export async function getUserById(id) {
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getUserById: ${error.message}`);
  return data;
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
    name: user.name,
    phone: user.phone ?? null,
    password_salt: user.passwordSalt,
    password_hash: user.passwordHash,
    google_id: user.googleId ?? null,
    email_verified: Boolean(user.emailVerified),
    verification_token: user.verificationToken ?? null,
    verification_token_expires: user.verificationTokenExpires ?? null,
    is_admin: Boolean(user.isAdmin),
    created_at: user.createdAt,
  };
  must(await supabase.from('users').insert(row), 'createUser');
}

export async function touchUserLogin(id, timestamp) {
  must(await supabase.from('users').update({ last_login_at: timestamp }).eq('id', id), 'touchUserLogin');
}

export async function setVerificationToken(id, token, expiresAt) {
  must(
    await supabase.from('users').update({ verification_token: token, verification_token_expires: expiresAt }).eq('id', id),
    'setVerificationToken',
  );
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
}

/** Also clears the reset token so a used (or abandoned) link can't be replayed. */
export async function setUserPassword(id, { salt, hash }) {
  must(
    await supabase.from('users')
      .update({ password_salt: salt, password_hash: hash, reset_token: null, reset_token_expires: null })
      .eq('id', id),
    'setUserPassword',
  );
}

export async function markEmailVerified(id) {
  must(
    await supabase.from('users')
      .update({ email_verified: true, verification_token: null, verification_token_expires: null })
      .eq('id', id),
    'markEmailVerified',
  );
}

/** Attaches a Google account to an existing email/password user (same email on both). Google already confirmed the address. */
export async function linkGoogleAccount(id, googleId) {
  must(
    await supabase.from('users').update({ google_id: googleId, email_verified: true }).eq('id', id),
    'linkGoogleAccount',
  );
}

/** Google sign-in never collects a phone number, so an account created that way needs this filled in afterward. */
export async function setUserPhone(id, phone) {
  must(await supabase.from('users').update({ phone }).eq('id', id), 'setUserPhone');
}

export async function getPortfolio(userId) {
  const { data, error } = await supabase.from('portfolios').select('state_json').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`getPortfolio: ${error.message}`);
  return data?.state_json ?? null;
}

export async function putPortfolio(userId, state) {
  const now = new Date().toISOString();
  const stateJson = { ...state, updatedAt: now };

  const updated = must(
    await supabase.from('portfolios').update({ state_json: stateJson, updated_at: now }).eq('user_id', userId).select('user_id'),
    'putPortfolio(update)',
  );
  if (updated.length) return;

  must(
    await supabase.from('portfolios').insert({ user_id: userId, state_json: stateJson, created_at: now, updated_at: now }),
    'putPortfolio(insert)',
  );
}

/** @returns {object|null} the stored report for that day/style, or null if never generated. */
export async function getMarketReport(reportDate, style) {
  const { data, error } = await supabase
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
  const { data, error } = await supabase
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

/**
 * Records one AI call's cost, tagged by which feature made it — see ai_spend
 * in schema.sql. Called fire-and-forget from clientOpenRouter.js; errors are
 * the caller's problem to log, never this function's to throw, since a spend
 * row is telemetry, not something any feature should fail over.
 */
export async function logAiSpend(feature, model, usage) {
  const { error } = await supabase.from('ai_spend').insert({ feature, model: model ?? null, usage_json: usage ?? null });
  if (error) throw new Error(`logAiSpend: ${error.message}`);
}

/** @returns {object|null} cached fundamentals for one ticker, or null if never fetched. */
export async function getFundamentalsCache(code) {
  const { data, error } = await supabase.from('fundamentals_cache').select('*').eq('code', code).maybeSingle();
  if (error) throw new Error(`getFundamentalsCache: ${error.message}`);
  if (!data) return null;
  return { ...data.data_json, _fetchedAt: data.fetched_at };
}

/** Overwrites the cached fundamentals for one ticker. */
export async function putFundamentalsCache(code, data) {
  const { error } = await supabase
    .from('fundamentals_cache')
    .upsert({ code, data_json: data, fetched_at: new Date().toISOString() }, { onConflict: 'code' });
  if (error) throw new Error(`putFundamentalsCache: ${error.message}`);
}

/**
 * @returns {object|null} the stored review for that user/day/style, or null
 *   if none is stored, or if one is stored but for a different portfolio
 *   (the caller must compare portfolioHash itself — this just returns
 *   whatever row exists so the caller can decide).
 */
export async function getPortfolioReview(userId, reportDate, style) {
  const { data, error } = await supabase
    .from('portfolio_reviews')
    .select('*')
    .eq('user_id', userId)
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
 * Stores today's review for this user/style, replacing whatever was there —
 * unlike putMarketReport this is a per-user row, so there is no cross-request
 * race to protect against with insert-if-absent; the latest generation for a
 * changed portfolio should simply win.
 */
export async function putPortfolioReview(userId, reportDate, style, portfolioHash, review, model, usage) {
  const { error } = await supabase.from('portfolio_reviews').upsert(
    {
      user_id: userId,
      report_date: reportDate,
      style,
      portfolio_hash: portfolioHash,
      review_json: review,
      model: model ?? null,
      usage_json: usage ?? null,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,report_date,style' },
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

export async function setUserAdmin(id, isAdmin) {
  must(await supabase.from('users').update({ is_admin: Boolean(isAdmin) }).eq('id', id), 'setUserAdmin');
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
  return data.length > 0;
}

/** Every registered user, newest first — for the admin users list. Excludes auth secrets (password hash/salt, tokens). */
export async function getAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, phone, is_admin, email_verified, google_id, created_at, last_login_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getAllUsers: ${error.message}`);
  return data;
}

/** Every stored portfolio's state, keyed by user_id — for the admin users list's investment-behavior summary. */
export async function getAllPortfolios() {
  const { data, error } = await supabase.from('portfolios').select('user_id, state_json');
  if (error) throw new Error(`getAllPortfolios: ${error.message}`);
  return data;
}

/** @returns {{tickers:string[],updatedAt:string,updatedBy:string|null}|null} an admin-uploaded ticker list for this index, or null if none was ever uploaded. */
export async function getIndexOverride(indexName) {
  const { data, error } = await supabase.from('index_overrides').select('*').eq('index_name', indexName).maybeSingle();
  if (error) throw new Error(`getIndexOverride: ${error.message}`);
  if (!data) return null;
  return { tickers: data.tickers_json, updatedAt: data.updated_at, updatedBy: data.updated_by };
}

export async function setIndexOverride(indexName, tickers, updatedBy) {
  must(
    await supabase.from('index_overrides').upsert(
      { index_name: indexName, tickers_json: tickers, updated_at: new Date().toISOString(), updated_by: updatedBy ?? null },
      { onConflict: 'index_name' },
    ),
    'setIndexOverride',
  );
}

export async function clearIndexOverride(indexName) {
  must(await supabase.from('index_overrides').delete().eq('index_name', indexName), 'clearIndexOverride');
}

export async function getAllIndexOverrides() {
  const { data, error } = await supabase.from('index_overrides').select('*');
  if (error) throw new Error(`getAllIndexOverrides: ${error.message}`);
  return Object.fromEntries(
    data.map((row) => [row.index_name, { tickers: row.tickers_json, updatedAt: row.updated_at, updatedBy: row.updated_by }]),
  );
}

/** @returns {{code:string,name:string}[]} every admin-added stock not in the generated universe — see config/universe.js's registerCustomStocks. */
export async function getAllCustomStocks() {
  const { data, error } = await supabase.from('custom_stocks').select('code, name');
  if (error) throw new Error(`getAllCustomStocks: ${error.message}`);
  return data;
}

/** Upserts (never overwrites a name with a blank one) a batch of admin-uploaded stocks that weren't already known. */
export async function addCustomStocks(stocks, addedBy) {
  if (!stocks.length) return;
  must(
    await supabase.from('custom_stocks').upsert(
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

/** Newest published posts first — for the public /blog list and the header ticker. */
export async function listPublishedBlogPosts({ limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('slug, title, dek, tags, image_thumb_url, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listPublishedBlogPosts: ${error.message}`);
  return data;
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

export { supabase };
