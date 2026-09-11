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

export async function setUserAdmin(id, isAdmin) {
  must(await supabase.from('users').update({ is_admin: Boolean(isAdmin) }).eq('id', id), 'setUserAdmin');
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

export { supabase };
