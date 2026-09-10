/**
 * Investor-style rule overlays — trader (مضارب), medium (متوسط المدى), long
 * (طويل المدى). The same three styles and the same numbers as the frontend's
 * `invest-style.ts`, which re-derives a *held position's* recommendation
 * instantly and client-side from data already on the page. This file exists
 * because the cash-allocation plan can't be re-derived that way: which
 * stocks qualify, how many shares to size, and whether a setup even clears
 * the risk/reward bar all come out of the same deterministic engine that
 * scoring/risk.js and scoring/targets.js already parameterise by `rules` —
 * so a style becomes "which rules", computed once here, same as everywhere
 * else in this codebase.
 *
 * Keep the numbers below in sync with frontend/src/lib/invest-style.ts by
 * hand — there is no shared package between the two runtimes to enforce it.
 * "medium" is deliberately identical to the base RULES in rules.js; this file
 * only ever *overrides* fields, so drift in one place shows up as a diff
 * against the other rather than a silent behavioural mismatch.
 */

export const STYLE_KEYS = ['trader', 'medium', 'long'];

export const DEFAULT_STYLE = 'medium';

/**
 * The qualitative half of a style, for the analyst's system prompt. The
 * numeric overrides below already reach the prompt on their own — it is built
 * from `rules` — but numbers alone don't tell the model *who it is advising*,
 * and that changes which target governs a verdict and what to do with cash.
 * A speculator sitting on cash is waiting for a fast setup; a long-term
 * investor sitting on cash is waiting for a better price on a business.
 */
const PROFILES = {
  trader: {
    label: 'مضارب',
    horizon: 'a speculator holding for days, occasionally a couple of weeks',
    guidance: [
      'The mid-term target governs every verdict. Treat the long-horizon target as background only — this holder will be out long before it matters.',
      'Prefer setups with a near, identifiable catalyst or an active breakout over slow structural theses. A stock that needs four months to work is a poor fit however good it looks.',
      'Take profit earlier and more completely than a long-horizon holder would, and cut a failing position without waiting for the thesis to fully break.',
      'On cash: deploy only into setups that can move now. Holding cash for days waiting for a clean entry is a normal, correct answer — say so plainly rather than forcing a trade.',
    ],
  },
  medium: {
    label: 'متوسط المدى',
    horizon: 'a medium-term investor holding for weeks to months',
    guidance: [
      'The mid-term target governs the verdict; the long-horizon target frames whether the position is worth keeping past it.',
      'Balance entry quality against patience: a good business at a poor entry is still a wait, but a sound setup does not need an immediate catalyst to be worth taking.',
      'On cash: deploy into setups whose thesis can play out over weeks to months, keeping the reserve intact and sector risk spread.',
    ],
  },
  long: {
    label: 'طويل المدى',
    horizon: 'a long-term investor holding for many months, sometimes over a year',
    guidance: [
      'The long-horizon target and the durability of the trend govern the verdict. Do not recommend exiting a sound long-term holding over short-term noise or an overbought oscillator.',
      'Weigh fundamentals, liquidity and trend regime more heavily than near-term momentum. A stock below its 200-day average is a real problem here; a stock 3% under near-term resistance is not.',
      'Tolerate ordinary drawdowns inside an intact uptrend. Reserve exit for a breached stop or a genuinely broken thesis, not a soft week.',
      'On cash: prefer fewer, higher-conviction deployments in businesses worth owning through a cycle, and be more willing to sit on cash rather than accept a mediocre entry.',
    ],
  },
};

/** Prompt-facing description of a style, defaulting to the medium profile. */
export function styleProfile(styleKey) {
  return PROFILES[styleKey] ?? PROFILES[DEFAULT_STYLE];
}

const OVERRIDES = {
  trader: {
    trailing: { trailPct: 4, activateAtProfitPct: 4 },
    takeProfit: { partialAtProfitPct: 6, partialFraction: 0.5, limitAbovePricePct: 1, atTargetFraction: 0.5, raiseStopAfterTargetPct: 4 },
    entry: { minRiskReward: 1.5 },
    sizing: { riskPerTradePct: 1, maxPositionPct: 10 },
  },
  medium: {
    trailing: { trailPct: 8, activateAtProfitPct: 12 },
    takeProfit: { partialAtProfitPct: 15, partialFraction: 0.3, limitAbovePricePct: 2, atTargetFraction: 1 / 3, raiseStopAfterTargetPct: 8 },
    entry: { minRiskReward: 1.8 },
    sizing: { riskPerTradePct: 1.5, maxPositionPct: 15 },
  },
  long: {
    trailing: { trailPct: 12, activateAtProfitPct: 20 },
    takeProfit: { partialAtProfitPct: 25, partialFraction: 0.25, limitAbovePricePct: 2, atTargetFraction: 0.25, raiseStopAfterTargetPct: 12 },
    entry: { minRiskReward: 2.2 },
    sizing: { riskPerTradePct: 2, maxPositionPct: 20 },
  },
};

/**
 * `base` with one style's overrides layered on top — only the fields above
 * change; liquidity, stop, commission, averaging-down and everything else
 * stay exactly as `base` defined them.
 */
export function rulesForStyle(base, styleKey) {
  const overrides = OVERRIDES[styleKey];
  if (!overrides) return base;
  return {
    ...base,
    trailing: { ...base.trailing, ...overrides.trailing },
    takeProfit: { ...base.takeProfit, ...overrides.takeProfit },
    entry: { ...base.entry, ...overrides.entry },
    sizing: { ...base.sizing, ...overrides.sizing },
  };
}
