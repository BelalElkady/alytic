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
import { computeStop, computeTrailingStop, computeLongTermStop, positionSize, liquidityCheck, riskReward, positionRecommendation } from './scoring/risk.js';
import { buildTargets, targetEstimate } from './scoring/targets.js';
import { classifyStock } from './scoring/classification.js';
import RULES from './config/rules.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));

/**
 * The active style's rules (config/styles.js layered on config/rules.js),
 * each evaluated against one open position with the exact quantities and
 * prices its order would use. The analyst quotes these; it never derives them.
 */
function buildRuleBook({ snapshot, position, price, plPct, trailing, effectiveStop, governingTarget, partialTaken }, rules) {
  const { shares } = position;
  const tp = rules.takeProfit;
  const trailFromPrice = price * (1 - rules.trailing.trailPct / 100);

  const partialQty = Math.round(shares * tp.partialFraction);
  const targetQty = Math.floor(shares * tp.atTargetFraction);
  const trendScore = snapshot.trend.score;
  const priceVsSma200Pct = snapshot.movingAverages.priceVsSma200Pct;

  return {
    stop: {
      level: effectiveStop,
      distancePct: r2(((price - effectiveStop) / price) * 100),
      honorOn: rules.stop.honorOn,
      fired: price < effectiveStop,
      sellQty: shares,
    },
    trailing: {
      trailPct: rules.trailing.trailPct,
      activateAtProfitPct: rules.trailing.activateAtProfitPct,
      active: trailing.active,
      peak: trailing.peak ?? null,
      moved: trailing.moved,
      from: trailing.from ?? null,
    },
    partialProfit: {
      thresholdPct: tp.partialAtProfitPct,
      fractionPct: r2(tp.partialFraction * 100),
      limitAbovePricePct: tp.limitAbovePricePct,
      alreadyTaken: partialTaken,
      fired: plPct >= tp.partialAtProfitPct && !partialTaken && partialQty >= 1,
      qty: partialQty,
      limitPrice: r2(price * (1 + tp.limitAbovePricePct / 100)),
      proceedsEgp: r2(partialQty * price * (1 + tp.limitAbovePricePct / 100)),
      remainingShares: shares - partialQty,
      remainingStop: r2(Math.max(effectiveStop, trailFromPrice)),
    },
    target: {
      level: governingTarget?.price ?? null,
      horizon: rules.targets?.primary === 'long' && governingTarget?.price ? 'long' : 'mid',
      fired: governingTarget?.price != null && price >= governingTarget.price && targetQty >= 1,
      fractionPct: r2(tp.atTargetFraction * 100),
      qty: targetQty,
      remainingShares: shares - targetQty,
      raiseStopPct: tp.raiseStopAfterTargetPct,
      raisedStop: r2(Math.max(effectiveStop, price * (1 - tp.raiseStopAfterTargetPct / 100))),
    },
    averagingDown: {
      allowed: rules.averagingDown.allowed,
      trendScore,
      trendScoreMin: rules.averagingDown.onlyIfTrendScoreAbove,
      priceVsSma200Pct,
      maxAdds: rules.averagingDown.maxAddsPerPosition,
      fired:
        rules.averagingDown.allowed &&
        plPct < 0 &&
        trendScore > rules.averagingDown.onlyIfTrendScoreAbove &&
        (!rules.averagingDown.onlyIfAboveSma200 || (priceVsSma200Pct ?? -1) > 0),
    },
    entry: {
      minRiskReward: rules.entry.minRiskReward,
      riskPerTradePct: rules.sizing.riskPerTradePct,
      maxPositionPct: rules.sizing.maxPositionPct,
    },
  };
}

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
  //
  // Every hardcoded stock in config/universe.js was pre-verified (see its
  // header) to have a real, fetchable price series, so this call throwing was
  // previously unreachable in practice. Admin-added custom stocks (see
  // registerCustomStocks) carry no such guarantee — a made-up or delisted
  // ticker can fail on both Yahoo and TradingView. Treat that the same way as
  // a quality-gate rejection below rather than letting it become an uncaught
  // 500: no data is just a stronger version of bad data.
  let data;
  try {
    data = await getBars(
      code,
      toYahoo(code),
      (yahooSymbol, o) => fetchDailyAuto(code, { ...o, yahooSymbol, source: meta.source }),
      { range, force },
    );
  } catch (err) {
    return {
      code: meta.code ?? code,
      name: meta.ar ?? code,
      asOf: null,
      usable: false,
      error: `تعذر جلب بيانات السعر لهذا السهم: ${err.message}`,
    };
  }
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
    // A second, wider stop for the long-horizon thesis — see computeLongTermStop
    // for why it shares its invalidation level with the long-term target.
    const longTermStop = computeLongTermStop(snapshot, effectiveStop, rules);
    // Which computed target governs "reached target" for this position — mid
    // for every style except long (config/styles.js), which follows its own
    // stated guidance to judge by the long-horizon target instead. Falls back
    // to mid when the long target isn't projectable (downtrend, no data).
    const governingTarget = rules.targets?.primary === 'long' && targets.long?.price ? targets.long : targets.mid;
    // Every style activates its trail below its partial threshold, so gating
    // the partial on `!trailing.active` (as this used to) meant it never fired.
    const partialTaken = Boolean(position.partialTakenAt);
    const ruleBook = buildRuleBook({ snapshot, position, price, plPct, trailing, effectiveStop, governingTarget, partialTaken }, rules);

    positionState = {
      shares: position.shares,
      // True when the share count was never read off the screenshot but
      // back-solved from `marketValue ÷ a cached close`. That guess is only as
      // good as the price it divided by, so it must stay visibly marked all
      // the way to the UI rather than passing as a confirmed holding.
      sharesEstimated: position.derivedFromScreenshot === true,
      avgCost: r2(position.avgCost),
      purchaseValue: r2(position.shares * position.avgCost),
      marketValue: r2(position.shares * price),
      unrealizedPct: r2(plPct),
      unrealizedEgp: r2(position.shares * (price - position.avgCost)),
      stop: effectiveStop,
      trailing,
      // Wider stop for the long-term hold — null when there's no long-term
      // uptrend left to protect (see computeLongTermStop). Distinct from
      // `stop`: that one is what the mechanical rules actually enforce on a
      // session close; this one is informational context for the long
      // horizon, never the trigger the AI or the recommendation rules act on.
      longTermStop,
      stopBreached: price < effectiveStop,
      distanceToStopPct: r2(((price - effectiveStop) / price) * 100),
      distanceToTargetPct: governingTarget?.price ? r2(((governingTarget.price - price) / price) * 100) : null,
      riskRewardFromHere: governingTarget?.price ? riskReward(price, effectiveStop, governingTarget.price) : null,
      // The targets-table badge: a week range plus a momentum marker.
      estimate: targetEstimate({
        price,
        target: governingTarget?.price ?? null,
        dayChangePct: snapshot.price.changePct ?? 0,
        sector: meta.sector,
        sessions: governingTarget?.horizon?.sessions ?? null,
      }, rules),
      partialTaken,
      // What the desk view shows on this position's card.
      recommendation: positionRecommendation(
        { snapshot, position, trailing: { ...trailing, stop: effectiveStop }, midTarget: governingTarget?.price ?? null, partialTaken },
        rules,
      ),
      // The rule set, applied. These are the mechanical triggers the AI must respect.
      triggers: {
        exitOnStop: ruleBook.stop.fired,
        takePartial: ruleBook.partialProfit.fired,
        atTarget: ruleBook.target.fired,
        canAverageDown: ruleBook.averagingDown.fired,
      },
      // Each rule from the settings panel, evaluated with the exact order
      // numbers the analyst is allowed to quote — see briefFor in analyst.js.
      ruleBook,
    };
  }

  // Investment-vs-speculation classification (see scoring/classification.js)
  // — purely arithmetic over what was just computed above, same "the model
  // never calculates a number" boundary as everything else in this file.
  const classification = classifyStock({
    usable: true,
    sector: meta.sector,
    snapshot,
    technical,
    fundamentals: fundamentals ?? null,
    quality,
  });

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
    classification,

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
