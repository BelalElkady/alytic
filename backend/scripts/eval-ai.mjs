#!/usr/bin/env node
/**
 * Manual AI-output eval for the stop-loss layer (agent/stopPlanner.js).
 *
 *   node scripts/eval-ai.mjs
 *
 * NOT part of the test suite, NOT run in CI, and NOT something meant to be
 * run automatically on your behalf: every run fires real requests against
 * whatever ALYTIC_MODEL is configured and spends real OpenRouter credits
 * (a handful of ~300-token stop-plan calls — cents, not dollars, on the
 * default deepseek model, but not zero). Run it yourself after a model or
 * prompt change you want to sanity check, not as a habit.
 *
 * What it checks — the invariants analyze.js/stopPlanner.js are supposed to
 * hold regardless of which model answers:
 *  - a fresh-buy stop lands strictly between 0 and the entry price
 *  - an open position's trailing stop never moves below its existing stop
 *    (ratchet-only)
 *  - a stock tagged shariah non-compliant in the universe never comes back
 *    worth buying as a NEW position (deterministic, not AI-dependent, but
 *    cheap to assert alongside these — see rules.js `shariah`)
 *  - the same non-compliant stock, once already held, is NOT blocked — the
 *    gate stops new money in, it doesn't hide an existing position
 *
 * NOT covered yet: reviewCashPlan (agent/cashAnalysis.js). It needs a `scan`
 * payload shaped the way server.js's runScan() builds it (buyPlan, cashPlan,
 * per-row sizing, ...) — that function isn't exported and isn't small, and
 * faking the shape by hand risks silently drifting from the real one. Left
 * as a TODO: either export a slice of runScan's row-building for reuse here,
 * or drive it through the real HTTP endpoint against a throwaway account.
 *
 * Side effects: getOrGenerateStopPlan/getOrGenerateTrailingStop cache their
 * answers in the real, shared Supabase tables (ai_stop_plans /
 * portfolio_reviews — see stopPlanner.js's module comment). EVAL_CODES below
 * are real tickers so the shariah gate has real metadata to check, which
 * means a run can share a cache hit with real traffic on those codes today —
 * harmless (it's the same cache real users read), but a second run today
 * will mostly report cache hits rather than asking the model again.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Must be set before analyze.js (and, transitively, src/data/cache.js) is
// imported — cache.js reads ALYTIC_BARS_DIR at module-load time. A dynamic
// import() below guarantees that ordering; a static import would not.
process.env.ALYTIC_BARS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alytic-eval-'));

const { writeBars, isTradingDay, expectedLastSession } = await import('../src/data/cache.js');
const { analyzeTicker } = await import('../src/analyze.js');
const { primaryPortfolioIdFor } = await import('../src/db.js');

/** Tiny deterministic PRNG — reproducible fixtures, no external dependency. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** `count` EGX trading sessions ending at the most recent expected session. */
function tradingDates(count) {
  const dates = [];
  let cursor = new Date(`${expectedLastSession()}T12:00:00Z`);
  while (dates.length < count) {
    const iso = cursor.toISOString().slice(0, 10);
    if (isTradingDay(iso)) dates.unshift(iso);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

/** Synthetic uptrending OHLCV — same shape as the real bar cache, no network. */
function synthBars({ sessions = 260, start = 100, seed = 1 }) {
  const rand = prng(seed);
  const days = tradingDates(sessions);
  const bars = [];
  let close = start;
  for (const date of days) {
    const o = close;
    close = Math.max(0.5, close * (1 + 0.0008 + (rand() - 0.5) * 0.012));
    const h = Math.max(o, close) * (1 + rand() * 0.004);
    const l = Math.min(o, close) * (1 - rand() * 0.004);
    bars.push({ date, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +close.toFixed(2), v: Math.round(80_000 * (0.7 + rand() * 0.6)) });
  }
  return bars;
}

// COMI: shariah non_compliant (conventional bank) — the gate should fire.
// ABUK: shariah compliant — a normal candidate, gate should stay quiet.
// ORAS: shariah review (screening unknown) — recommendable by default.
const EVAL_CODES = ['COMI', 'ABUK', 'ORAS'];

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

for (const code of EVAL_CODES) {
  const bars = synthBars({ seed: code.charCodeAt(0) + code.charCodeAt(1) });
  await writeBars(code, { code, symbol: `EGX:${code}`, currency: 'EGP', bars });
}

console.log(`Evaluating ${EVAL_CODES.join(', ')} against the live model chain — this spends real credits.\n`);

for (const code of EVAL_CODES) {
  const a = await analyzeTicker(code, { withFundamentals: false, userId: 'local' });
  const { plan } = a;
  const isNonCompliant = a.shariah === 'non_compliant';

  check(`${code}: fresh-buy stop is between 0 and entry`, plan.stop.stop > 0 && plan.stop.stop < plan.suggestedEntry, `stop=${plan.stop.stop}, entry=${plan.suggestedEntry}`);
  check(`${code}: shariah gate matches universe tag`, plan.shariahExcluded === isNonCompliant, `shariah=${a.shariah}, shariahExcluded=${plan.shariahExcluded}`);
  if (isNonCompliant) {
    check(`${code}: non-compliant stock is not worth-buying`, plan.buyingNow.worthIt === false && plan.actionable === false);
  }
}

// Held-position case: an existing stop must never be lowered, and a
// non-compliant stock already held must NOT be excluded (only new buys are).
{
  const code = 'COMI';
  const existingStop = 30;
  const held = await analyzeTicker(code, {
    withFundamentals: false,
    // A held position's trailing stop is cached per Portfolio (bigint id), so
    // analyzeTicker needs the Portfolio's id — the same resolution cli.js uses.
    portfolioId: await primaryPortfolioIdFor('local'),
    capital: 1_000_000,
    position: { shares: 100, avgCost: existingStop * 1.2, stop: existingStop },
  });
  check(`${code} (held): shariah gate does not apply to an existing position`, held.plan.shariahExcluded === false);
  check(`${code} (held): trailing stop never drops below the existing stop`, held.position?.stop >= existingStop, `stop=${held.position?.stop}, existing=${existingStop}`);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
