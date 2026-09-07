/**
 * Analysis orchestrator — the deterministic half of the system.
 *
 * `analyzeTicker` produces a complete, reproducible verdict with no AI involved:
 * indicators, structure, stop, both targets and a composite score. The agent
 * layer in `src/agent/` consumes this output; it never recomputes any of it.
 * That separation means you can run the whole analyzer with no API key and
 * still get every number — the model only adds narrative and judgment.
 */

import { fetchDailyAuto } from './data/yahoo.js';
import { getBars } from './data/cache.js';
import { checkQuality } from './data/quality.js';
import { fetchFundamentals } from './data/tradingview.js';
import { lookup, toYahoo, sectorLabel } from './config/universe.js';
import { buildSnapshot } from './ta/snapshot.js';
import { scoreTechnical } from './scoring/technical.js';
import { computeStop, computeTrailingStop, positionSize, liquidityCheck, riskReward } from './scoring/risk.js';
import { buildTargets } from './scoring/targets.js';
import RULES from './config/rules.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));

/**
 * Full analysis for one ticker.
 *
 * @param {string} code - EGX ticker, e.g. 'COMI'
 * @param {object} [opts]
 * @param {object} [opts.position] - an open position: { shares, avgCost, stop }
 * @param {number} [opts.capital]  - total book value, for position sizing
 */
export async function analyzeTicker(code, opts = {}) {
  const { range = '2y', force = false, position = null, capital = null, rules = RULES } = opts;

  const meta = lookup(code) ?? { code, ar: code, sector: null, shariah: 'review' };
  // Accept either a pre-fetched Map (batch path) or fetch for this one ticker.
  const fundamentals =
    opts.fundamentals instanceof Map
      ? opts.fundamentals.get(code.toUpperCase()) ?? null
      : opts.withFundamentals === false
        ? null
        : (await fetchFundamentals([code])).get(code.toUpperCase()) ?? null;
  // The fetcher picks its own source (Yahoo, else TradingView); the cache keys
  // on the ticker either way, so nothing downstream needs to know which won.
  const data = await getBars(
    code,
    toYahoo(code),
    (yahooSymbol, o) => fetchDailyAuto(code, { ...o, yahooSymbol, source: meta.source }),
    { range, force },
  );
  const bars = data.bars;

  // Refuse to analyze data we don't trust. Returning a scored verdict on a
  // frozen or delisted series is worse than returning nothing.
  const quality = checkQuality(bars, { code });
  if (!quality.ok) {
    return {
      code: meta.code ?? code,
      name: meta.ar ?? code,
      asOf: bars[bars.length - 1]?.date ?? null,
      usable: false,
      quality,
      error: quality.issues.find((i) => i.level === 'fatal')?.message ?? 'بيانات غير صالحة',
    };
  }

  const snapshot = buildSnapshot(bars, meta);
  const technical = scoreTechnical(snapshot);
  const liquidity = liquidityCheck(snapshot, rules);

  // Entry planning. Rule: never buy at market into a high — the suggested entry
  // is a limit order at the nearest defended support, unless price is already
  // sitting on it.
  //
  // But a limit 25% under the market is not a plan, it is a refusal wearing a
  // number. When the nearest real support is that far below, the honest output
  // is "wait", flagged as such, so the reward ratio isn't quoted off a fill that
  // will never happen.
  const price = snapshot.price.close;
  const nearestSupport = snapshot.levels.supports.find((s) => s.strength >= 45);
  const supportGapPct = nearestSupport ? Math.abs(nearestSupport.distancePct) : null;

  let entryStatus, suggestedEntry, entryNote;
  if (!nearestSupport) {
    entryStatus = 'wait';
    suggestedEntry = r2(price);
    entryNote = 'لا يوجد دعم واضح تحت السعر — استنى ما يتكوّن دعم قبل الدخول';
  } else if (supportGapPct <= rules.entry.maxChasePctAboveSupport) {
    entryStatus = 'buy_now';
    suggestedEntry = r2(price);
    entryNote = `السعر على الدعم (${nearestSupport.price}) — ممكن الدخول دلوقتي بأمر سوق أو محدد`;
  } else if (supportGapPct <= rules.entry.maxPullbackWaitPct) {
    entryStatus = 'limit_pullback';
    suggestedEntry = r2(nearestSupport.price * 1.005);
    entryNote = `حط أمر محدد عند ${r2(nearestSupport.price * 1.005)} (دعم ${nearestSupport.price}, على بعد ${supportGapPct}%) — مش مطاردة بسعر السوق`;
  } else {
    entryStatus = 'too_extended';
    suggestedEntry = r2(nearestSupport.price * 1.005);
    entryNote = `السهم بعيد ${supportGapPct}% عن أقرب دعم حقيقي (${nearestSupport.price}) — ممتد أوي، استنى تصحيح. أي أمر عند ${r2(nearestSupport.price * 1.005)} غالبًا مش هيتنفذ قريب.`;
  }

  const stopPlan = computeStop(snapshot, suggestedEntry, rules);
  const targets = buildTargets(snapshot, bars, { entry: suggestedEntry, stop: stopPlan.stop }, rules);

  // What the trade looks like if you ignored the advice and bought at market —
  // this is the ratio to judge "should I buy today" by.
  const stopNow = computeStop(snapshot, price, rules);
  const buyingNow = {
    entry: r2(price),
    stop: stopNow.stop,
    riskPct: stopNow.riskPct,
    riskReward: targets.mid?.price ? riskReward(price, stopNow.stop, targets.mid.price) : null,
  };
  buyingNow.worthIt = buyingNow.riskReward != null && buyingNow.riskReward >= rules.entry.minRiskReward;

  const sizing =
    capital && stopPlan.stop
      ? positionSize(
          {
            capital,
            entry: suggestedEntry,
            stop: stopPlan.stop,
            avgTurnoverEgp: snapshot.volume.avgTurnoverEgp,
            sectorExposureEgp: opts.sectorExposureEgp ?? 0,
          },
          rules,
        )
      : null;

  // If a position is already open, the live stop and P&L matter more than the
  // hypothetical entry plan.
  let positionState = null;
  if (position?.shares > 0 && position.avgCost > 0) {
    const runningHigh = Math.max(...bars.slice(-120).map((b) => b.h));
    const trailing = computeTrailingStop(
      { avgCost: position.avgCost, currentPrice: price, runningHigh, existingStop: position.stop ?? stopPlan.stop },
      rules,
    );
    const effectiveStop = trailing.stop ?? position.stop ?? stopPlan.stop;
    const plPct = ((price - position.avgCost) / position.avgCost) * 100;

    positionState = {
      shares: position.shares,
      avgCost: r2(position.avgCost),
      marketValue: r2(position.shares * price),
      unrealizedPct: r2(plPct),
      unrealizedEgp: r2(position.shares * (price - position.avgCost)),
      stop: effectiveStop,
      trailing,
      stopBreached: price < effectiveStop,
      distanceToStopPct: r2(((price - effectiveStop) / price) * 100),
      distanceToTargetPct: targets.mid?.price ? r2(((targets.mid.price - price) / price) * 100) : null,
      riskRewardFromHere: targets.mid?.price ? riskReward(price, effectiveStop, targets.mid.price) : null,
      // The rule set, applied. These are the mechanical triggers the AI must respect.
      triggers: {
        exitOnStop: price < effectiveStop,
        takePartial: plPct >= rules.takeProfit.partialAtProfitPct && !trailing.active,
        atTarget: targets.mid?.price != null && price >= targets.mid.price,
        canAverageDown:
          rules.averagingDown.allowed &&
          plPct < 0 &&
          snapshot.trend.score > rules.averagingDown.onlyIfTrendScoreAbove &&
          (!rules.averagingDown.onlyIfAboveSma200 || (snapshot.movingAverages.priceVsSma200Pct ?? -1) > 0),
      },
    };
  }

  return {
    code: meta.code ?? code,
    name: meta.ar ?? code,
    nameEn: meta.en ?? null,
    sector: meta.sector,
    sectorAr: meta.sector ? sectorLabel(meta.sector) : null,
    shariah: meta.shariah,
    asOf: snapshot.meta.asOf,
    fromCache: data.fromCache,
    usable: true,
    quality,
    // Free fundamentals from the screener. Frequently null on small caps —
    // absence is normal and must not be read as a negative signal.
    fundamentals: fundamentals ?? null,

    snapshot,
    technical,
    liquidity,

    plan: {
      suggestedEntry,
      entryStatus,
      entryNote,
      supportGapPct,
      actionable: entryStatus === 'buy_now' || entryStatus === 'limit_pullback',
      buyingNow,
      stop: stopPlan,
      targets,
      sizing,
    },

    position: positionState,
  };
}

/**
 * Analyze many tickers, tolerating individual failures.
 *
 * Pass `positions` as a `{ CODE: {shares, avgCost, stop} }` map to attach each
 * ticker's own cost basis — a single `position` in `opts` would be applied to
 * every code, which silently produced portfolios where no holding had a P&L.
 */
export async function analyzeMany(codes, opts = {}) {
  const results = [];
  const errors = [];
  const concurrency = opts.concurrency ?? 3;
  const queue = [...codes];
  const positions = opts.positions ?? {};

  // One screener call covers every ticker, so fundamentals are fetched once
  // here rather than per-stock. Failure is non-fatal — coverage is partial even
  // when it succeeds, so callers already handle missing fundamentals.
  const fundamentals = opts.fundamentals ?? (opts.withFundamentals === false ? new Map() : await fetchFundamentals());

  async function worker() {
    while (queue.length) {
      const code = queue.shift();
      try {
        const r = await analyzeTicker(code, {
          ...opts,
          position: positions[code.toUpperCase()] ?? opts.position ?? null,
          fundamentals,
        });
        if (r.usable) results.push(r);
        else errors.push({ code, error: r.error, quality: r.quality });
      } catch (err) {
        errors.push({ code, error: err.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, codes.length) }, worker));
  results.sort((a, b) => b.technical.score - a.technical.score);
  return { results, errors };
}
