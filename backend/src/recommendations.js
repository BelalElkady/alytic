/**
 * The recommendation track record: logging every call the app hands a User,
 * recording the session bars the daily evaluation needs, and summarizing the
 * result for the track-record page.
 *
 * The table, its append-only guard and the resolution rules are described in
 * the recommendations section of supabase/schema.sql and in
 * supabase/functions/evaluate-recommendations/evaluate.js. This module never
 * resolves a call itself — the Edge Function does, once a day.
 */

import { insertRecommendations, listOpenRecommendationKeys, listOpenRecommendationTickers, upsertRecommendationPrices, listRecommendations } from './db.js';
import { fetchDailyAuto, fetchEgx30Spot } from './data/yahoo.js';
import { fetchDailyTV, fetchLatestQuotes } from './data/tv-history.js';
import { cairoToday, expectedLastSession } from './data/cache.js';
import { lookup, toYahoo, sectorLabel } from './config/universe.js';
import { effectiveIndices } from './config/indices.js';

/**
 * The model's verdict vocabulary (ACTIONS in agent/schemas.js, plus the cash
 * review's picks) folded into the four calls the record scores. `avoid`,
 * `wait`, `buy_on_pullback` and `skip` are left out on purpose: each says
 * "don't act now", so there is no position whose outcome could be measured.
 */
export const TRACKED_ACTIONS = {
  buy: 'buy',
  accumulate: 'buy',
  hold: 'hold',
  reduce: 'reduce',
  take_profit: 'reduce',
  exit: 'sell',
};

/**
 * Sessions a call is judged over when the engine gave its target no horizon
 * (a stock in a range) — and always for a hold, which has no levels.
 */
const DEFAULT_HORIZON_SESSIONS = { trader: 10, medium: 20, long: 60 };
/**
 * Sell and reduce are judged over a shorter span than a hold: the engine's
 * levels for them are a long holder's, not a short call's, and a fall that
 * hasn't come within a couple of weeks isn't the call the user was given. Left
 * at the hold horizons, a long-style exit took three months to be judged.
 */
const EXIT_HORIZON_SESSIONS = { trader: 10, medium: 10, long: 20 };
/** A support must sit at least this far under the price to be a fall target worth hitting; nearer ones are noise. */
export const MIN_FALL_TARGET_PCT = 3;

/**
 * The nearest support at least MIN_FALL_TARGET_PCT under the price — where a
 * sell or reduce call is right if the stock gets there. Null when no support
 * is that far down, or the stock has no mapped supports.
 * @param {Array<{price:number}>|undefined} supports - a snapshot's levels.supports
 */
export function fallTargetFrom(supports, ref) {
  const limit = ref * (1 - MIN_FALL_TARGET_PCT / 100);
  const below = (supports ?? []).map((l) => positive(l?.price)).filter((p) => p != null && p <= limit);
  return below.length ? Math.max(...below) : null;
}
const MAX_HORIZON_SESSIONS = 500;

// buy/hold are long calls, sell/reduce short ones — the same split the
// evaluator uses (directionOf in supabase/functions/evaluate-recommendations/
// evaluate.js; that file isn't shipped with the backend, so it isn't imported).
const directionOf = (action) => (action === 'buy' || action === 'hold' ? 1 : -1);

/**
 * The benchmark indices, by the name the record stores them under, and the
 * TradingView symbol their live level and daily bars come from (the same
 * symbols as INDEX_SYMBOLS in api/server.js). EGX70 and EGX100 are the
 * equal-weighted variants, the only ones TradingView carries.
 */
export const INDEX_FEEDS = { EGX30: 'EGX30', EGX70: 'EGX70EWI', EGX33: 'SHARIAH', EGX100: 'EGX100EWI' };

/**
 * A call's own benchmark: the size index its stock belongs to. EGX100 is
 * EGX30 + EGX70, so a stock in neither has no index of its own and is
 * measured against the broadest one; the equal-weighted EGX100 isn't
 * dominated by a handful of large caps the way EGX30 is.
 */
export function benchmarkFor(code, membership) {
  const c = String(code).toUpperCase();
  if (membership?.EGX30?.includes(c)) return 'EGX30';
  if (membership?.EGX70?.includes(c)) return 'EGX70';
  return 'EGX100';
}

const round = (x, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;
const positive = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);

/** The price levels a call on one analyzed stock (an analyzeTicker result) is judged by. */
export function levelsFromAnalysis(a, style) {
  const planTarget = style === 'long' && a.plan?.targets?.long?.price ? a.plan.targets.long : a.plan?.targets?.mid;
  return {
    refPrice: a.snapshot?.price?.close,
    // An open position's own levels win: they are what the verdict was about.
    target: a.position?.targetLevel ?? planTarget?.price ?? null,
    stop: a.position?.stop ?? a.plan?.stop?.stop ?? null,
    horizonSessions: planTarget?.horizon?.sessions ?? null,
    // For a sell or reduce: the support the fall would have to reach.
    fallTarget: fallTargetFrom(a.snapshot?.levels?.supports, a.snapshot?.price?.close),
  };
}

/** Levels from a market-report opportunity (topOpportunities in agent/marketAnalysis.js). */
export function levelsFromOpportunity(op, style) {
  const target = style === 'long' && op.longTarget?.price ? op.longTarget : op.midTarget;
  return { refPrice: op.price, target: target?.price ?? null, stop: op.stop, horizonSessions: target?.horizon?.sessions ?? null };
}

/** Levels from a /api/scan row (the cash plan's picks). */
export function levelsFromScanRow(row) {
  return { refPrice: row.price, target: row.midTarget?.price ?? null, stop: row.stop, horizonSessions: row.midTarget?.horizon?.sessions ?? null };
}

/**
 * One row for the recommendations table, or null when the call isn't one the
 * record scores or has no usable reference price. Levels on the wrong side of
 * the price (a target already passed) are dropped rather than logged: they
 * would resolve on the first session and say nothing about the call.
 */
export function recommendationRow({ userId, portfolioId, code, action, levels, style, source, model, indices = {}, benchmark = null }) {
  const tracked = TRACKED_ACTIONS[action];
  const ref = positive(levels?.refPrice);
  if (!tracked || !ref || !code) return null;

  // Only a buy is a call to enter at a price, so only a buy carries a target
  // and stop. A hold tells someone who already owns the stock to keep it —
  // its stop is the position's own, often a few percent away, and scoring it
  // as a fresh entry would stop it out on ordinary noise. It is judged at the
  // horizon against its benchmark instead (see isWin).
  //
  // A sell or reduce is right if the stock falls, so it may carry the support
  // it would have to reach as its target (a win the moment it is touched,
  // like a buy's) — but no stop: there is no position to protect.
  const levelled = tracked === 'buy';
  const exiting = tracked === 'sell' || tracked === 'reduce';
  const target = levelled ? positive(levels.target) : exiting ? positive(levels.fallTarget) : null;
  const stop = levelled ? positive(levels.stop) : null;
  const horizons = exiting ? EXIT_HORIZON_SESSIONS : DEFAULT_HORIZON_SESSIONS;
  const fallback = horizons[style] ?? horizons.medium;
  const sessions = levelled && positive(levels.horizonSessions) ? Math.round(levels.horizonSessions) : fallback;
  const indexLevels = Object.fromEntries(
    Object.keys(INDEX_FEEDS).filter((name) => positive(indices[name])).map((name) => [name, positive(indices[name])]),
  );

  return {
    user_id: userId ?? null,
    portfolio_id: portfolioId ?? null,
    ticker: String(code).toUpperCase(),
    action: tracked,
    ref_price: round(ref),
    // Levels on the wrong side of the price are dropped: above it for a buy's
    // target, below it for a sell's.
    target_price: target && (exiting ? target < ref : target > ref) ? round(target) : null,
    stop_price: stop && stop < ref ? round(stop) : null,
    horizon_days: Math.min(MAX_HORIZON_SESSIONS, Math.max(1, sessions)),
    egx30_at_issue: indexLevels.EGX30 ?? null,
    benchmark: benchmark ?? benchmarkFor(code, null),
    indices_at_issue: Object.keys(indexLevels).length ? indexLevels : null,
    model_version: model || 'engine',
    // The guard trigger stamps both of these itself; sending them keeps the
    // upsert's conflict target complete.
    issued_on: cairoToday(),
    source,
    style: style ?? null,
  };
}

let indicesMemo = { at: 0, value: null };

/**
 * The four indices' levels right now, from TradingView's live index quotes
 * ({ EGX30, EGX70, EGX33, EGX100 }; one it didn't return is left out). EGX30
 * falls back to Yahoo's spot, the one other feed that has it.
 */
async function indexLevelsNow() {
  if (Date.now() - indicesMemo.at < 5 * 60_000 && indicesMemo.value) return indicesMemo.value;
  const quotes = await fetchLatestQuotes(Object.values(INDEX_FEEDS)).catch(() => new Map());
  const value = {};
  for (const [name, symbol] of Object.entries(INDEX_FEEDS)) {
    const level = positive(quotes.get(symbol)?.price);
    if (level) value[name] = level;
  }
  if (!value.EGX30) {
    const spot = positive((await fetchEgx30Spot())?.value);
    if (spot) value.EGX30 = spot;
  }
  if (Object.keys(value).length) indicesMemo = { at: Date.now(), value };
  return value;
}

let membershipMemo = { at: 0, value: null };

/** Index membership with admin overrides applied, re-read at most every ten minutes. */
async function indexMembership() {
  if (Date.now() - membershipMemo.at < 10 * 60_000 && membershipMemo.value) return membershipMemo.value;
  const value = await effectiveIndices();
  membershipMemo = { at: Date.now(), value };
  return value;
}

/**
 * Drops the calls a User already has open for the same stock and action: a
 * repeat review of an unresolved call is the same call, and logging it again
 * each day would count one outcome several times (the daily key only stops a
 * second copy on the same day).
 */
export function withoutOpenDuplicates(rows, openKeys) {
  const open = new Set(openKeys);
  return rows.filter((r) => !open.has(`${r.ticker}:${r.action}`));
}

/**
 * Logs the calls a User was just handed. `items` is [{ code, action, levels }].
 * Best-effort: a logging failure is reported and swallowed, never allowed to
 * fail the review it describes — callers don't await it.
 */
export async function logRecommendations(userId, portfolioId, items, { source, style, model }) {
  try {
    if (!items.some((item) => TRACKED_ACTIONS[item.action])) return;
    // recommendations.portfolio_id is nullable only so a deleted Portfolio's
    // calls survive it; a new call always belongs to one. Without this, a
    // caller that forgot portfolioId would log unowned rows that also slip
    // past the per-Portfolio dedupe.
    if (!portfolioId) throw new Error('portfolioId is required');
    const [indices, membership] = await Promise.all([indexLevelsNow(), indexMembership()]);
    const rows = items
      .map((item) => recommendationRow({
        userId, portfolioId, code: item.code, action: item.action, levels: item.levels, style, source, model,
        indices, benchmark: benchmarkFor(item.code, membership),
      }))
      .filter(Boolean);
    // Two verdicts on the same stock in one review would collide on the daily key inside one statement.
    const unique = [...new Map(rows.map((r) => [`${r.ticker}:${r.action}`, r])).values()];
    await insertRecommendations(withoutOpenDuplicates(unique, await listOpenRecommendationKeys(portfolioId)));
  } catch (err) {
    console.warn(`[recommendations] logging ${source} for ${userId} failed:`, err.message);
  }
}

/**
 * Records session bars for every stock with a call still being followed —
 * open, or its horizon not over (and the four benchmark indices), from the
 * first session after its earliest such call, so the evaluator has what
 * it needs. Stops at the last session whose close should be published (see
 * expectedLastSession): a bar still forming would resolve calls on prices the
 * session never closed at. Runs in the current tenant's database.
 */
export async function recordRecommendationPrices() {
  const open = await listOpenRecommendationTickers();
  if (!open.length) return { tickers: 0, bars: 0 };

  const since = new Map();
  for (const { ticker, issued_on: day } of open) {
    if (!since.has(ticker) || day < since.get(ticker)) since.set(ticker, day);
  }
  const earliest = [...since.values()].sort()[0];
  const through = expectedLastSession();

  const rows = [];
  const failed = [];
  const add = (ticker, bars, after) => {
    for (const b of bars) {
      if (b.date <= after || b.date > through) continue;
      rows.push({ ticker, session_date: b.date, open: b.o ?? null, high: b.h, low: b.l, close: b.c, updated_at: new Date().toISOString() });
    }
  };

  for (const [ticker, after] of since) {
    try {
      const data = await fetchDailyAuto(ticker, { range: '2y', yahooSymbol: toYahoo(ticker), source: lookup(ticker)?.source });
      add(ticker, data.bars, after);
    } catch (err) {
      failed.push(ticker);
      console.warn(`[recommendations] bars for ${ticker} failed:`, err.message);
    }
  }
  for (const [name, symbol] of Object.entries(INDEX_FEEDS)) {
    try {
      add(name, (await fetchDailyTV(symbol, { bars: 600 })).bars, earliest);
    } catch (err) {
      failed.push(name);
      console.warn(`[recommendations] ${name} bars failed:`, err.message);
    }
  }

  await upsertRecommendationPrices(rows);
  return { tickers: since.size, bars: rows.length, failed };
}

// ---- The track-record page --------------------------------------------------

/** Horizon filter buckets, in sessions. */
export const HORIZON_BUCKETS = {
  short: [1, 10],
  medium: [11, 40],
  long: [41, MAX_HORIZON_SESSIONS],
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (x) => (x == null ? null : round(x, 2));
const n = (x) => (x == null ? null : Number(x));

/**
 * Whether a closed call worked. A buy that hit its target sold only part
 * there and kept the rest under a raised stop, so it wins if the two parts
 * together made money (a sell/reduce at its target always has); the stop is a
 * loss; a call that ran out its horizon wins if it made money — except a
 * hold, which is judged against its own benchmark index then ("keep it" was
 * right if it didn't lag that index), falling back to EGX30 for calls logged
 * before benchmarks existed, and to its own return when no index is known.
 */
export function isWin(row) {
  if (row.status === 'open') return null;
  if (row.status === 'hit_target') return n(row.return_pct) > 0;
  if (row.status === 'hit_stop') return false;
  if (row.action === 'hold') return n(row.benchmark_excess_pct ?? row.excess_return_pct ?? row.return_pct) >= 0;
  return n(row.return_pct) > 0;
}

/**
 * What "excess return" is measured against on the page: each call's own
 * benchmark index, or one index for every call. Maps to the index name the
 * record keys its figures by (null for a call's own benchmark).
 */
export const COMPARISONS = { own: null, egx30: 'EGX30', egx70: 'EGX70', egx33: 'EGX33', egx100: 'EGX100' };

/**
 * A row's excess return under one comparison: final once closed, marked
 * while open. Null when that index wasn't recorded. EGX30 falls back to its
 * own column, the only figure calls logged before index_excess existed have.
 */
function excessOf(row, vs) {
  const open = row.status === 'open';
  if (vs === 'own') return n(open ? row.mark_benchmark_excess_pct : row.benchmark_excess_pct);
  const index = COMPARISONS[vs];
  const figure = (open ? row.mark_index_excess : row.index_excess)?.[index];
  if (figure != null) return n(figure);
  return index === 'EGX30' ? n(open ? row.mark_excess_return_pct : row.excess_return_pct) : null;
}

/**
 * Cumulative performance of an equal-weight book that took every closed call
 * vs. the same money in the comparison index over the same spans: calls are
 * grouped by the session they closed on, each group's average return is
 * compounded in turn. The index line uses only calls that have that index
 * recorded (older calls carry EGX30 alone).
 */
function cumulativeSeries(closed, vs) {
  const byDay = new Map();
  for (const row of closed) {
    const day = String(row.closed_at).slice(0, 10);
    const bucket = byDay.get(day) ?? { strategy: [], index: [] };
    bucket.strategy.push(n(row.return_pct));
    // The index's move over this call's span, in the call's direction.
    const excess = excessOf(row, vs);
    if (excess != null) bucket.index.push(n(row.return_pct) - excess);
    byDay.set(day, bucket);
  }
  const days = [...byDay.keys()].sort();
  if (!days.length) return [];

  let strategy = 1;
  let index = 1;
  const start = closed.map((r) => String(r.issued_on)).sort()[0];
  const points = [{ date: start < days[0] ? start : days[0], strategy: 0, index: 0 }];
  for (const day of days) {
    const b = byDay.get(day);
    strategy *= 1 + mean(b.strategy) / 100;
    index *= 1 + (mean(b.index) ?? 0) / 100;
    points.push({ date: day, strategy: r2((strategy - 1) * 100), index: r2((index - 1) * 100) });
  }
  return points;
}

function summarize(rows, vs) {
  const closed = rows.filter((r) => r.status !== 'open');
  const returns = closed.map((r) => n(r.return_pct));
  const wins = returns.filter((x) => x > 0);
  const losses = returns.filter((x) => x < 0);
  const excess = closed.map((r) => excessOf(r, vs)).filter((x) => x != null);
  // The session the target printed, not the one the rest left on.
  const toTarget = closed.filter((r) => r.status === 'hit_target').map((r) => r.target_sessions ?? r.sessions_elapsed);
  const won = closed.filter(isWin).length;
  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  return {
    total: rows.length,
    open: rows.length - closed.length,
    closed: closed.length,
    wins: won,
    hitRate: closed.length ? r2((won / closed.length) * 100) : null,
    avgReturn: r2(mean(returns)),
    avgWin: r2(avgWin),
    avgLoss: r2(avgLoss),
    winLossRatio: avgWin != null && avgLoss ? r2(avgWin / Math.abs(avgLoss)) : null,
    avgExcess: r2(mean(excess)),
    // How many closed calls the excess figure covers: fewer than `closed`
    // when older calls predate the comparison index.
    excessCovered: excess.length,
    avgSessionsToTarget: toTarget.length ? r2(mean(toTarget)) : null,
  };
}

/**
 * Whether the stock actually went the way the call said, by its move over the
 * call's horizon (stock_move_pct), whatever the target or stop did: a buy is
 * right if the stock rose, a sell or reduce if it fell, a hold if it didn't
 * fall. Null until the evaluator has a session to judge by.
 */
export function wasRight(row) {
  if (row.stock_move_pct == null) return null;
  const move = n(row.stock_move_pct);
  if (row.action === 'buy') return move > 0;
  if (row.action === 'hold') return move >= 0;
  return move < 0;
}

function outcomes(rows) {
  const closed = rows.filter((r) => r.status !== 'open');
  const count = {
    hit_target: closed.filter((r) => r.status === 'hit_target').length,
    hit_stop: closed.filter((r) => r.status === 'hit_stop').length,
    expired_win: closed.filter((r) => r.status === 'expired' && n(r.return_pct) > 0).length,
    expired_loss: closed.filter((r) => r.status === 'expired' && n(r.return_pct) <= 0).length,
  };
  return Object.fromEntries(Object.entries(count).map(([k, v]) => [k, { count: v, pct: closed.length ? r2((v / closed.length) * 100) : 0 }]));
}

const ROWS_SHOWN = 300;

/**
 * The scoring rules a call was resolved under. 1 is the original rules (an
 * intraday touch of the stop closed a call, a hold carried a stop, and a split
 * could read as a crash); 2 needed a close under the stop and judged a hold
 * at its horizon; 3 is the current ones, which also follow the app's own
 * management of a buy (two closes under the stop for the long style, part
 * sold at the target — see evaluate.js). The page's figures cover calls
 * scored under the current rules only — older ones stay listed, tagged, but
 * never feed the headline. A project without the column is all current.
 */
export const CURRENT_SCORING = 3;
export const isLegacy = (row) => Number(row.scoring_version ?? CURRENT_SCORING) < CURRENT_SCORING;

/** Closed calls under the current rules before the headline figures are shown: fewer say nothing. */
export const MIN_CLOSED_FOR_HEADLINE = 30;

/**
 * Everything the track-record page draws, for one scope and set of filters.
 * `filters`: { scope: 'all'|'mine', vs (a COMPARISONS key), action, horizon (a HORIZON_BUCKETS key), from, to }.
 */
export async function trackRecord(userId, filters = {}) {
  const all = await listRecommendations({
    userId: filters.scope === 'mine' ? userId : null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    excludeTestRows: true,
  });
  return buildTrackRecord(all, userId, filters);
}

/** trackRecord's figures from the rows already read — no I/O, so it can be tested. */
export function buildTrackRecord(all, userId, filters = {}) {
  const vs = filters.vs in COMPARISONS ? filters.vs : 'own';

  const withMeta = all.map((row) => {
    const meta = lookup(row.ticker);
    return { ...row, sector: meta?.sector ?? null, name: meta?.ar ?? meta?.en ?? row.ticker };
  });

  const [lo, hi] = HORIZON_BUCKETS[filters.horizon] ?? [0, Infinity];
  const rows = withMeta.filter((r) =>
    (!filters.action || r.action === filters.action) &&
    r.horizon_days >= lo && r.horizon_days <= hi);
  // The figures use the current rules only; every row is still listed.
  const scored = rows.filter((r) => !isLegacy(r));
  const legacy = rows.filter(isLegacy);
  const summary = summarize(scored, vs);

  const byAction = ['buy', 'sell', 'reduce', 'hold'].map((action) => {
    const own = scored.filter((r) => r.action === action);
    const closed = own.filter((r) => r.status !== 'open');
    return { action, total: own.length, closed: closed.length, hitRate: closed.length ? r2((closed.filter(isWin).length / closed.length) * 100) : null };
  });

  return {
    vs,
    summary,
    // Too few resolved calls to say anything: the page shows the counts, not rates.
    scoring: {
      version: CURRENT_SCORING,
      minClosed: MIN_CLOSED_FOR_HEADLINE,
      tooEarly: summary.closed < MIN_CLOSED_FOR_HEADLINE,
      legacyTotal: legacy.length,
      legacyClosed: legacy.filter((r) => r.status !== 'open').length,
    },
    outcomes: outcomes(scored),
    byAction,
    series: cumulativeSeries(scored.filter((r) => r.status !== 'open'), vs),
    rows: rows.slice(0, ROWS_SHOWN).map((r) => ({
      id: r.id,
      ticker: r.ticker,
      name: r.name,
      sector: r.sector ? sectorLabel(r.sector) : null,
      action: r.action,
      issuedAt: r.issued_at,
      issuedOn: r.issued_on,
      refPrice: n(r.ref_price),
      targetPrice: n(r.target_price),
      stopPrice: n(r.stop_price),
      horizon: r.horizon_days,
      status: r.status,
      closedAt: r.closed_at,
      exitPrice: n(r.exit_price),
      // Closed: the final figures. Open: marked to the last evaluated close.
      returnPct: n(r.return_pct ?? r.mark_return_pct),
      // Excess return under the chosen comparison, plus every comparison for the CSV.
      excessPct: excessOf(r, vs),
      benchmark: r.benchmark ?? null,
      excessBy: Object.fromEntries(Object.keys(COMPARISONS).map((key) => [key, excessOf(r, key)])),
      sessions: r.sessions_elapsed,
      win: isWin(r),
      // What the stock actually did over the horizon, target and stop aside.
      stockMovePrice: n(r.stock_move_price),
      stockMovePct: n(r.stock_move_pct),
      stockMoveSessions: r.stock_move_sessions ?? 0,
      stockMoveFinal: Boolean(r.stock_move_final),
      right: wasRight(r),
      // Scored under the original rules: listed, but outside the figures above.
      legacy: isLegacy(r),
      mine: r.user_id === userId,
      model: r.model_version,
    })),
    rowsTruncated: rows.length > ROWS_SHOWN,
  };
}
