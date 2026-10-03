/**
 * AI-determined stop-loss placement — by product decision, replaces the
 * deterministic computeStop()/computeTrailingStop() in scoring/risk.js as the
 * authoritative source for every stop shown or enforced anywhere in the app.
 * Those two functions are kept for their config constants only (see the
 * clamp below); they are no longer called for the number itself.
 *
 * Two independent caches, matching who the number can be shared with:
 *  - getOrGenerateStopPlan(): the entry-plan stop for a fresh buy today —
 *    pure technical data, no portfolio context, so it's shared by every user
 *    for the same (stock, style, trading day). See ai_stop_plans in
 *    supabase/schema.sql, same sharing rationale as market_reports.
 *  - getOrGenerateTrailingStop(): one open position's own stop — needs that
 *    position's average cost and prior stop, so it can't be shared across
 *    users. Cached per (user, stock, style, trading day, position state) in
 *    portfolio_reviews under a `stop:STYLE:CODE` key, the same trick the
 *    (now-removed) per-stock recommendation cache used.
 *
 * Both clamp the model's number before it can reach position sizing or the
 * mechanical exit trigger: the entry-plan stop must land strictly between 0
 * and the entry price; the trailing stop additionally can never move below
 * where it last sat (ratchet-only), matching computeTrailingStop()'s own
 * invariant. Neither clamp reintroduces the mechanical formula's actual
 * *level* — only a sanity rail on the shape of the answer.
 */

import { MODEL_CHAIN, requestStructuredOR } from './clientOpenRouter.js';
import { StopPlanSchema, TrailingStopSchema } from './schemas.js';
import { stopPlanSystemPrompt, trailingStopSystemPrompt } from './prompts/system.js';
import { getStopPlan, putStopPlan, getPortfolioReview, putPortfolioReview } from '../db.js';
import { portfolioHash } from '../portfolio.js';
import { currentTenant } from '../tenancy/context.js';
import RULES from '../config/rules.js';
import { DEFAULT_STYLE } from '../config/styles.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));

function briefSnapshot(code, name, snapshot) {
  const s = snapshot;
  // Measured from the price the brief states — the engine's own distancePct is
  // off the daily close, which a live-priced snapshot has moved away from.
  const away = (level) => {
    const pct = +(((level - s.price.close) / s.price.close) * 100).toFixed(2);
    return `${pct >= 0 ? '+' : ''}${pct}`;
  };
  const sup = (s.levels.supports ?? []).slice(0, 3).map((l) => `${l.price} (strength ${l.strength}, ${away(l.price)}%)`).join(' · ');
  const res = (s.levels.resistances ?? []).slice(0, 3).map((l) => `${l.price} (strength ${l.strength}, ${away(l.price)}%)`).join(' · ');
  return `${code} — ${name}
Price ${s.price.close} EGP | Trend: ${s.trend.label} (${s.trend.score}/100), ADX ${s.strength?.adx ?? 'n/a'}
ATR14 ${s.volatility.atr14} (${s.volatility.atrPct}% daily)
Support: ${sup || 'none clear'}
Resistance: ${res || 'none above price'}`;
}

/**
 * Keeps a stop strictly inside (0, ceiling) — the one shape guarantee every
 * caller needs regardless of how the level itself was chosen. Logged when it
 * actually rewrites the model's number: a silent correction here would hide a
 * model that's regularly returning nonsense stops behind output that still
 * looks fine. `ctx` is free text identifying the call site for that log line.
 */
function clampPositiveBelow(value, ceiling, ctx) {
  if (!Number.isFinite(value) || value <= 0) {
    const fallback = r2(ceiling * 0.05);
    console.warn(`[ai] stop clamp fired (${ctx}): model returned ${value}, ceiling ${ceiling} — falling back to ${fallback}`);
    return fallback;
  }
  if (value >= ceiling) {
    const capped = r2(ceiling * 0.995);
    console.warn(`[ai] stop clamp fired (${ctx}): model returned ${value} >= ceiling ${ceiling} — capped to ${capped}`);
    return capped;
  }
  return r2(value);
}

// Stored plans are write-once (putStopPlan inserts only if absent), so a hit
// never changes and can be remembered here: without this, every market scan
// paid one or two Supabase round trips per stock (~12s for the universe)
// just to re-read numbers it already had. Only hits are kept — a miss is
// about to be generated and stored.
const stopPlanMemo = new Map();
const STOP_PLAN_MEMO_LIMIT = 5000;

async function readStopPlan(code, style, asOf) {
  const key = `${code}|${style}|${asOf}`;
  const memoed = stopPlanMemo.get(key);
  if (memoed) return memoed;
  const stored = await getStopPlan(code, style, asOf);
  if (stored) {
    if (stopPlanMemo.size >= STOP_PLAN_MEMO_LIMIT) stopPlanMemo.clear();
    stopPlanMemo.set(key, stored);
  }
  return stored;
}

/**
 * The entry-plan stop for a fresh buy today, shared across every user for
 * this (code, style, trading day) — see the module comment.
 * @param {string} entry - the entry price a fresh buy would use (suggestedEntry or current price)
 * @returns {Promise<{stop: number, basis: string}>}
 */
export async function getOrGenerateStopPlan(code, name, snapshot, entry, style = DEFAULT_STYLE, rules = RULES) {
  const asOf = snapshot.meta.asOf;
  const cached = await readStopPlan(code, style, asOf);
  if (cached) return cached;

  const userMessage = `${briefSnapshot(code, name, snapshot)}
A fresh buy today would enter at ${entry} EGP. Where should the stop-loss sit?`;

  const { data, raw } = await requestStructuredOR({
    model: MODEL_CHAIN,
    schema: StopPlanSchema,
    schemaName: 'stop_plan',
    maxTokens: 300,
    system: stopPlanSystemPrompt(rules, style),
    messages: [{ role: 'user', content: userMessage }],
    feature: 'stop_plan',
  });

  const stop = clampPositiveBelow(data.stop, entry, `stop_plan ${code}/${style}`);
  await putStopPlan(code, style, asOf, stop, data.basis, raw.model, raw.usage);
  // Re-read so a concurrent request that won the insert race is what this
  // call (and everyone after it) actually sees, same pattern as market_reports.
  return (await readStopPlan(code, style, asOf)) ?? { stop, basis: data.basis };
}

/**
 * One open position's own stop, personalized to its average cost, prior stop
 * and current profit — see the module comment.
 * @param {{avgCost: number, shares: number, existingStop: number|null}} position
 * @returns {Promise<{stop: number, rationale: string, moved: boolean}>}
 */
export async function getOrGenerateTrailingStop(portfolioId, code, name, snapshot, position, style = DEFAULT_STYLE, rules = RULES) {
  const asOf = snapshot.meta.asOf;
  const cacheStyle = `stop:${style}:${code}`;
  // Only this one position's numbers matter for the hash — a trade in a
  // different stock, or a watchlist edit, must not bust this cache.
  const hash = portfolioHash({
    positions: { [code]: { shares: position.shares, avgCost: position.avgCost, stop: position.existingStop ?? null } },
    watchlist: {},
    cash: 0,
  });

  const cached = await getPortfolioReview(portfolioId, asOf, cacheStyle);
  if (cached && cached.portfolioHash === hash) {
    return { stop: cached.stop, rationale: cached.rationale, moved: cached.moved };
  }

  const price = snapshot.price.close;
  const plPct = ((price - position.avgCost) / position.avgCost) * 100;
  const userMessage = `${briefSnapshot(code, name, snapshot)}
Position: bought at ${r2(position.avgCost)} EGP, now ${r2(plPct)}% ${plPct >= 0 ? 'profit' : 'loss'}. Current stop: ${position.existingStop != null ? `${position.existingStop} EGP` : 'none set yet'}.
Where should the stop sit now?`;

  const { data, raw } = await requestStructuredOR({
    model: MODEL_CHAIN,
    schema: TrailingStopSchema,
    schemaName: 'trailing_stop',
    maxTokens: 300,
    system: trailingStopSystemPrompt(rules, style),
    messages: [{ role: 'user', content: userMessage }],
    feature: 'trailing_stop',
  });

  let stop = clampPositiveBelow(data.stop, price, `trailing_stop ${code}/${style}`);
  // Ratchet-only safety rail, confirmed with the user: an AI-suggested level
  // below the existing stop is ignored, the existing stop is kept.
  if (position.existingStop != null) stop = Math.max(stop, position.existingStop);
  const moved = position.existingStop != null && stop > position.existingStop + 0.001;

  await putPortfolioReview(portfolioId, asOf, cacheStyle, hash, { stop, rationale: data.rationale, moved }, raw.model, raw.usage);
  return { stop, rationale: data.rationale, moved };
}

// The live layer (getLiveTrailingStop) re-asks the model only when the price
// has climbed this far above the price the last stop was set at, and no more
// often than the interval. A stop that only ever moves up has nothing to
// reconsider on a fall, so falls never trigger a call.
const LIVE_STOP_MIN_RISE_PCT = 1.5;
const LIVE_STOP_MIN_INTERVAL_MS = 10 * 60 * 1000;
const liveStopInFlight = new Map();

/**
 * An open position's stop, re-set against the LIVE price during the session.
 *
 * getOrGenerateTrailingStop sets the stop once per completed session, off that
 * session's close. This sits on top of it: once the live price has climbed
 * meaningfully past where the current stop was last set, it asks the model
 * again with the live snapshot and lets the stop follow — never below `baseStop`
 * (the close-based stop) nor below the last live level, so the ratchet holds.
 * Stored beside the base stop under its own `stoplive:` key for the same
 * (user, style, stock, session), so it can never overwrite or move the base
 * stop — the one a "did it close under its stop" check is judged against.
 *
 * @param {object} liveSnapshot - the snapshot with price.close set to the live quote and price.dailyClose to the last close
 * @param {number} baseStop - the close-based stop from getOrGenerateTrailingStop
 * @returns {Promise<{stop: number, rationale: string}|null>} null while the live price hasn't earned a re-set
 */
export async function getLiveTrailingStop(portfolioId, code, name, liveSnapshot, position, baseStop, style = DEFAULT_STYLE, rules = RULES) {
  const asOf = liveSnapshot.meta.asOf;
  const cacheStyle = `stoplive:${style}:${code}`;
  const hash = portfolioHash({
    positions: { [code]: { shares: position.shares, avgCost: position.avgCost, stop: baseStop ?? null } },
    watchlist: {},
    cash: 0,
  });
  const price = liveSnapshot.price.close;

  const stored = await getPortfolioReview(portfolioId, asOf, cacheStyle);
  const cached = stored && stored.portfolioHash === hash ? stored : null;
  const reused = cached ? { stop: cached.stop, rationale: cached.rationale } : null;

  const referencePrice = cached?.pricedAt ?? liveSnapshot.price.dailyClose ?? price;
  const ageMs = cached ? Date.now() - Date.parse(cached._meta?.generatedAt) : Infinity;
  const earnedReset = price >= referencePrice * (1 + LIVE_STOP_MIN_RISE_PCT / 100);
  if (!earnedReset || ageMs < LIVE_STOP_MIN_INTERVAL_MS) return reused;

  // Tenant-prefixed: Portfolio ids are per-database (1, 2, 3...), so the same
  // id exists in every tenant and must not share another tenant's request.
  const key = `${currentTenant()?.id ?? ''}:${portfolioId}:${cacheStyle}:${asOf}`;
  if (liveStopInFlight.has(key)) return liveStopInFlight.get(key);

  const task = (async () => {
    const floor = Math.max(baseStop ?? 0, cached?.stop ?? 0);
    const plPct = ((price - position.avgCost) / position.avgCost) * 100;
    const userMessage = `${briefSnapshot(code, name, liveSnapshot)}
Position: bought at ${r2(position.avgCost)} EGP, now ${r2(plPct)}% ${plPct >= 0 ? 'profit' : 'loss'} at the LIVE price (last completed close ${liveSnapshot.price.dailyClose} EGP). Current stop: ${r2(floor)} EGP.
The price above is a live intraday quote, not a close, and the stop only ever moves up — so raise it only if the structure and the profit already earned justify it, not on an intraday spike alone. Where should the stop sit now?`;

    const { data, raw } = await requestStructuredOR({
      model: MODEL_CHAIN,
      schema: TrailingStopSchema,
      schemaName: 'trailing_stop',
      maxTokens: 300,
      system: trailingStopSystemPrompt(rules, style),
      messages: [{ role: 'user', content: userMessage }],
      feature: 'trailing_stop_live',
    });

    const stop = Math.max(clampPositiveBelow(data.stop, price, `trailing_stop_live ${code}/${style}`), floor);
    // Stored even when the model kept the stop where it was, so `pricedAt`
    // moves up and the same price doesn't re-ask.
    await putPortfolioReview(portfolioId, asOf, cacheStyle, hash, { stop, rationale: data.rationale, pricedAt: price }, raw.model, raw.usage);
    return { stop, rationale: data.rationale };
  })();
  liveStopInFlight.set(key, task);
  try {
    return await task;
  } finally {
    liveStopInFlight.delete(key);
  }
}
