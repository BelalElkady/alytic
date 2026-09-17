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
import RULES from '../config/rules.js';
import { DEFAULT_STYLE } from '../config/styles.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));

function briefSnapshot(code, name, snapshot) {
  const s = snapshot;
  const sup = (s.levels.supports ?? []).slice(0, 3).map((l) => `${l.price} (strength ${l.strength}, ${l.distancePct}%)`).join(' · ');
  const res = (s.levels.resistances ?? []).slice(0, 3).map((l) => `${l.price} (strength ${l.strength}, +${l.distancePct}%)`).join(' · ');
  return `${code} — ${name}
Price ${s.price.close} EGP | Trend: ${s.trend.label} (${s.trend.score}/100), ADX ${s.strength?.adx ?? 'n/a'}
ATR14 ${s.volatility.atr14} (${s.volatility.atrPct}% daily)
Support: ${sup || 'none clear'}
Resistance: ${res || 'none above price'}`;
}

/** Keeps a stop strictly inside (0, ceiling) — the one shape guarantee every caller needs regardless of how the level itself was chosen. */
function clampPositiveBelow(value, ceiling) {
  if (!Number.isFinite(value) || value <= 0) return r2(ceiling * 0.05);
  if (value >= ceiling) return r2(ceiling * 0.995);
  return r2(value);
}

/**
 * The entry-plan stop for a fresh buy today, shared across every user for
 * this (code, style, trading day) — see the module comment.
 * @param {string} entry - the entry price a fresh buy would use (suggestedEntry or current price)
 * @returns {Promise<{stop: number, basis: string}>}
 */
export async function getOrGenerateStopPlan(code, name, snapshot, entry, style = DEFAULT_STYLE, rules = RULES) {
  const asOf = snapshot.meta.asOf;
  const cached = await getStopPlan(code, style, asOf);
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

  const stop = clampPositiveBelow(data.stop, entry);
  await putStopPlan(code, style, asOf, stop, data.basis, raw.model, raw.usage);
  // Re-read so a concurrent request that won the insert race is what this
  // call (and everyone after it) actually sees, same pattern as market_reports.
  return (await getStopPlan(code, style, asOf)) ?? { stop, basis: data.basis };
}

/**
 * One open position's own stop, personalized to its average cost, prior stop
 * and current profit — see the module comment.
 * @param {{avgCost: number, shares: number, existingStop: number|null}} position
 * @returns {Promise<{stop: number, rationale: string, moved: boolean}>}
 */
export async function getOrGenerateTrailingStop(userId, code, name, snapshot, position, style = DEFAULT_STYLE, rules = RULES) {
  const asOf = snapshot.meta.asOf;
  const cacheStyle = `stop:${style}:${code}`;
  // Only this one position's numbers matter for the hash — a trade in a
  // different stock, or a watchlist edit, must not bust this cache.
  const hash = portfolioHash({
    positions: { [code]: { shares: position.shares, avgCost: position.avgCost, stop: position.existingStop ?? null } },
    watchlist: {},
    cash: 0,
  });

  const cached = await getPortfolioReview(userId, asOf, cacheStyle);
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

  let stop = clampPositiveBelow(data.stop, price);
  // Ratchet-only safety rail, confirmed with the user: an AI-suggested level
  // below the existing stop is ignored, the existing stop is kept.
  if (position.existingStop != null) stop = Math.max(stop, position.existingStop);
  const moved = position.existingStop != null && stop > position.existingStop + 0.001;

  await putPortfolioReview(userId, asOf, cacheStyle, hash, { stop, rationale: data.rationale, moved }, raw.model, raw.usage);
  return { stop, rationale: data.rationale, moved };
}
