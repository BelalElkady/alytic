/**
 * Pre-warms ai_stop_plans (see stopPlanner.js) for the whole tracked universe
 * before the trading day's typical usage — otherwise the first scan of the
 * day pays the AI-call latency for every (code, style) it happens to be the
 * first to touch.
 *
 * Separate module from stopPlanner.js on purpose: this file imports
 * analyzeMany() from ../analyze.js, which itself imports stopPlanner.js —
 * importing analyzeMany() from inside stopPlanner.js would make that a
 * circular import. Calling analyzeMany() (rather than a narrower
 * stop-only path) is deliberate too: it's the same, already-tested engine
 * call every other scan uses, and a cron run pays the extra technical-only
 * compute gladly in exchange for not maintaining a second code path.
 *
 * Driven by startStopPlanScheduler() in src/api/server.js, the same
 * always-on-process approach as startDailyCloseScheduler — unlike that job,
 * this one needs no exact-time trigger and no GitHub Actions backup: it's
 * naturally idempotent/resumable (see the coverage check below), so a
 * restart or a slow tick just picks up wherever today's coverage left off on
 * the next one. POST /api/cron/stop-plan-generate still exists for manual
 * triggering (ops/debugging), same secret-gated pattern as
 * /api/cron/blog-generate.
 */

import { analyzeMany } from '../analyze.js';
import { ALL_CODES } from '../config/universe.js';
import { STYLE_KEYS, rulesForStyle } from '../config/styles.js';
import { cairoToday, isTradingDay } from '../data/cache.js';
import { getStopPlanCoverage } from '../db.js';
import RULES from '../config/rules.js';

/**
 * Generates up to `batchSize` of today's still-missing (code, style)
 * entry-plan stops. Cheap, safe to call repeatedly: once every pair for
 * today is covered, this is a fast no-op (one coverage query, no AI calls).
 *
 * Skipped on a non-trading day by default — the "day" every stock's engine
 * output actually carries as its asOf is the last real trading session, so
 * warming against today's calendar date on a Friday/Saturday would check
 * coverage for a report_date nothing is ever stored under, uselessly
 * re-scanning the whole universe on every tick. `force: true` overrides this
 * for manual backfill/testing.
 */
export async function warmNextStopPlans({ batchSize = 20, force = false } = {}) {
  const reportDate = cairoToday();
  if (!force && !isTradingDay(reportDate)) return { reportDate, skipped: 'not_a_trading_day' };

  const covered = await getStopPlanCoverage(reportDate);
  const coveredSet = new Set(covered.map((r) => `${r.code}:${r.style}`));
  const totalNeeded = ALL_CODES.length * STYLE_KEYS.length;

  const missingByStyle = new Map();
  let missingCount = 0;
  outer: for (const style of STYLE_KEYS) {
    for (const code of ALL_CODES) {
      if (coveredSet.has(`${code}:${style}`)) continue;
      if (!missingByStyle.has(style)) missingByStyle.set(style, []);
      missingByStyle.get(style).push(code);
      missingCount++;
      if (missingCount >= batchSize) break outer;
    }
  }

  if (!missingCount) return { reportDate, generated: 0, remaining: 0, totalNeeded };

  let generated = 0;
  for (const [style, codes] of missingByStyle) {
    const rules = rulesForStyle(RULES, style);
    // No positions/userId: this only needs the shared entry-plan stop, never
    // a per-user trailing stop.
    const { results } = await analyzeMany(codes, { capital: 1_000_000, concurrency: 3, rules, style });
    generated += results.length;
  }

  return { reportDate, generated, remaining: totalNeeded - coveredSet.size - generated, totalNeeded };
}
