/**
 * Reusable 0-100 normalization primitives for the classification engine
 * (see scoring/classification.js).
 *
 * Every function here treats `null`/`undefined`/non-finite input as "unknown"
 * and returns `null` rather than 0 — a missing metric is not a bad metric,
 * and the caller (classification.js's weightedAverage) excludes a `null`
 * from its average instead of letting it drag the score down. This is the
 * single mechanism the whole engine uses for "handle missing data
 * gracefully": nothing downstream needs its own null-check once a value has
 * passed through one of these.
 */

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const isNum = (x) => x != null && Number.isFinite(x);

/** Linear 0-100, higher `value` is better. Clamped at the ends of [min, max]. */
export function normalizeHigher(value, min, max) {
  if (!isNum(value)) return null;
  if (max === min) return 50;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/** Linear 0-100, lower `value` is better (e.g. P/E, debt/equity). */
export function normalizeLower(value, min, max) {
  if (!isNum(value)) return null;
  if (max === min) return 50;
  return clamp(((max - value) / (max - min)) * 100, 0, 100);
}

/**
 * Target-range ("bell-shaped") normalization for a metric where *either*
 * extreme is bad — e.g. a current ratio too low (liquidity risk) or too high
 * (idle capital). Scores 100 exactly at `target`, decaying linearly to 0 at
 * `low` or `high`, and to 0 (not negative) beyond either bound.
 */
export function normalizeTarget(value, { low, target, high }) {
  if (!isNum(value)) return null;
  if (value <= low || value >= high) return 0;
  if (value === target) return 100;
  if (value < target) return clamp(((value - low) / (target - low)) * 100, 0, 100);
  return clamp(((high - value) / (high - target)) * 100, 0, 100);
}

/**
 * 0-100 percentile position of `value` within `sortedAsc` (ascending,
 * already filtered to finite numbers) — "what share of the universe is at or
 * below this value". Used where the app already has the whole EGX universe
 * in hand in one call (see data/tradingview.js's screener pull) and a
 * cross-sectional rank is more honest than an absolute threshold tuned by
 * hand. Returns null for an empty reference set, same "unknown" contract as
 * the functions above.
 */
export function percentileRank(value, sortedAsc) {
  if (!isNum(value) || !sortedAsc?.length) return null;
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return clamp((lo / sortedAsc.length) * 100, 0, 100);
}

/**
 * Weighted average of `{ value, weight }` entries, skipping any entry whose
 * value is null/non-finite or whose weight is <= 0 and renormalizing the
 * remaining weights to sum to 1 — the "a missing metric is excluded, not
 * scored as 0" rule applied generically, at both the metric level (combining
 * raw metrics into a bucket) and the bucket level (combining buckets into a
 * final score). Returns null only when nothing usable was supplied.
 */
export function weightedAverage(parts) {
  const usable = (parts ?? []).filter((p) => isNum(p?.value) && isNum(p?.weight) && p.weight > 0);
  const totalWeight = usable.reduce((sum, p) => sum + p.weight, 0);
  if (!totalWeight) return null;
  return usable.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight;
}
