/**
 * Analysis orchestrator — the deterministic half of the system, except for
 * the stop-loss.
 *
 * `analyzeTicker` produces a reproducible verdict for indicators, structure,
 * both targets and a composite score with no AI involved — the agent layer in
 * `src/agent/` consumes this output and never recomputes any of it. The one
 * deliberate exception, by product decision, is the stop-loss itself: it is
 * AI-determined (see `src/agent/stopPlanner.js`), cached per (stock, style,
 * trading day) for a fresh entry and per (user, stock, style, trading day,
 * position state) for an open position's trailing stop. This means
 * `analyzeTicker`/`analyzeMany` now require `OPENROUTER_API_KEY` to run at
 * all — the old "technical endpoints work with no key" guarantee no longer
 * holds, since every analysis needs a stop.
 */

import { fetchDailyAuto } from './data/yahoo.js';
import { getBars, cairoToday, tradingHalted } from './data/cache.js';
import { latestEventFor, recordEvent } from './data/corporateEvents.js';
import { gapEvent, onNewBasis, onOldScale } from './corporateActions.js';
import { checkQuality } from './data/quality.js';
import { fetchFundamentals } from './data/tradingview.js';
import { fetchLatestQuotes } from './data/tv-history.js';
import { lookup, toYahoo, sectorLabel } from './config/universe.js';
import { buildSnapshot } from './ta/snapshot.js';
import { scoreTechnical } from './scoring/technical.js';
import { computeLongTermStop, positionSize, liquidityCheck, riskReward, positionRecommendation, consecutiveClosesUnder } from './scoring/risk.js';
import { getOrGenerateStopPlan, getOrGenerateTrailingStop, getLiveTrailingStop } from './agent/stopPlanner.js';
import { buildTargets, targetEstimate } from './scoring/targets.js';
import { classifyStock } from './scoring/classification.js';
import RULES from './config/rules.js';
import { DEFAULT_STYLE } from './config/styles.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));

/**
 * R1's one exception (rules.stop.fundamentalHold): when the stop has fired on
 * a stock whose fundamentals are strong and whose long-term trend still holds,
 * sell part and keep a core under the wider long-term stop instead of selling
 * everything. Returns the exact order either way, or why it isn't available —
 * the analyst chooses whether to take it; it never works out the numbers.
 */
export function fundamentalHoldOption({ shares, price, stopFired, classification, longTermStop, liquidityOk, sessionsUnder = 0 }, rules) {
  const cfg = rules.stop.fundamentalHold;
  if (!stopFired) return null;
  const blockers = [];
  if (!cfg?.allowed) blockers.push('not allowed for this style');
  const inv = classification?.investmentScore;
  if (inv == null || !classification?.dataQuality?.hasFundamentals) blockers.push('no fundamentals to judge the business on');
  else if (inv < cfg.minInvestmentScore) blockers.push(`investment score ${inv} < ${cfg.minInvestmentScore}`);
  if (classification?.confidence != null && classification.confidence < cfg.minConfidence) {
    blockers.push(`classification confidence ${classification.confidence}% < ${cfg.minConfidence}%`);
  }
  if (!(longTermStop?.stop < price)) blockers.push('long-term trend broken (price under the 200-day average)');
  if (cfg?.holdThrough && cfg.maxSessionsUnder && sessionsUnder > cfg.maxSessionsUnder) {
    blockers.push(`already ${sessionsUnder} closes under the stop (more than the ${cfg.maxSessionsUnder} this style lets a dip run)`);
  }
  if (!liquidityOk) blockers.push('liquidity too thin to hold a core through more weakness');
  const keepQty = Math.floor(shares * (cfg?.keepFraction ?? 0));
  if (keepQty < 1 || keepQty >= shares) blockers.push('position too small to split');

  if (blockers.length) return { eligible: false, blockers };
  return {
    eligible: true,
    investmentScore: inv,
    sellQty: shares - keepQty,
    keepQty,
    keepPct: r2((keepQty / shares) * 100),
    coreStop: longTermStop.stop,
    coreStopRiskPct: r2(((price - longTermStop.stop) / price) * 100),
    // Keeping the whole position instead of a core: the long-term stop becomes
    // the one that binds, for as long as the dip stays inside the session limit.
    holdThrough: cfg.holdThrough
      ? { stop: longTermStop.stop, riskPct: r2(((price - longTermStop.stop) / price) * 100), sessionsUnder, sessionsLeft: Math.max(0, (cfg.maxSessionsUnder ?? 0) - sessionsUnder), maxSessionsUnder: cfg.maxSessionsUnder ?? null }
      : null,
  };
}

/**
 * The active style's rules (config/styles.js layered on config/rules.js),
 * each evaluated against one open position with the exact quantities and
 * prices its order would use. The analyst quotes these; it never derives them.
 */
function buildRuleBook({ snapshot, position, price, plPct, trailing, effectiveStop, stopFired, stopWarning = null, governingTarget, nextTarget = null, partialTaken, classification = null, longTermStop = null, liquidityOk = true, sessionsUnder = 0 }, rules) {
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
      fired: stopFired,
      // The style's number of closes in a row under the stop that makes it an
      // exit, and — while the first close under it is still only a warning —
      // how far along that run is.
      confirmCloses: rules.stop.confirmCloses ?? 1,
      warning: stopWarning,
      sellQty: shares,
      fundamentalHold: fundamentalHoldOption({ shares, price, stopFired, classification, longTermStop, liquidityOk, sessionsUnder }, rules),
    },
    trailing: {
      // trailPct/activateAtProfitPct are no longer what sets the actual stop
      // (see agent/stopPlanner.js) — kept only as the informal reference this
      // style's raise-on-partial/raise-on-target suggestions below still use.
      trailPct: rules.trailing.trailPct,
      activateAtProfitPct: rules.trailing.activateAtProfitPct,
      peak: trailing.peak ?? null,
      moved: trailing.moved,
      raisedLive: trailing.raisedLive ?? false,
      from: trailing.from ?? null,
      rationale: trailing.rationale ?? null,
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
      // The new target set once the price passed `level`, so the order below can
      // name where the rest of the position is now aiming.
      next: nextTarget?.price ?? null,
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
 * @param {string} [opts.style] - the raw style key (see config/styles.js), needed
 *   alongside `rules` to key the AI stop cache — `rules` alone has already
 *   merged the style's numbers in and can't be turned back into its key.
 * @param {string} [opts.portfolioId] - required whenever `position` is set, to key
 *   that position's own AI trailing-stop cache.
 */
export async function analyzeTicker(code, opts = {}) {
  const { range = '2y', force = false, capital = null, rules = RULES, style = DEFAULT_STYLE, portfolioId = null } = opts;
  let position = opts.position ?? null;

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
  // A bonus issue, split or merger: the bars are put on the new share basis
  // (the feed may not have done it yet — on the day itself it usually
  // hasn't), so a price that fell by the ratio isn't read as a crash.
  const { bars, corporateAction } = await rebaseBars(code, data.bars, opts.live);
  // Suspended or otherwise not trading today (see tradingHalted): nothing can
  // be bought or sold, so no call on it is actionable until it reopens.
  const halted = tradingHalted(opts.live?.time);

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

  // Stop plans are cached per session, so on the event day the cached one can
  // still be on the old basis.
  const rebaseStop = (plan) =>
    corporateAction && onOldScale(plan.stop, corporateAction.factor, price)
      ? { ...plan, stop: r2(plan.stop / corporateAction.factor) }
      : plan;
  const stopPlanAi = rebaseStop(await getOrGenerateStopPlan(code, meta.ar ?? code, snapshot, suggestedEntry, style, rules));
  const stopPlan = { stop: stopPlanAi.stop, riskPct: r2(((suggestedEntry - stopPlanAi.stop) / suggestedEntry) * 100), basis: stopPlanAi.basis };
  const targets = buildTargets(snapshot, bars, { entry: suggestedEntry, stop: stopPlan.stop }, rules);

  // What the trade looks like if you ignored the advice and bought at market —
  // this is the ratio to judge "should I buy today" by. Priced at market
  // rather than the suggested entry, so it needs its own AI stop call.
  const stopNowAi =
    price === suggestedEntry ? stopPlanAi : rebaseStop(await getOrGenerateStopPlan(code, meta.ar ?? code, snapshot, price, style, rules));
  const stopNow = { stop: stopNowAi.stop, riskPct: r2(((price - stopNowAi.stop) / price) * 100) };
  const buyingNow = {
    entry: r2(price),
    stop: stopNow.stop,
    riskPct: stopNow.riskPct,
    riskReward: targets.mid?.price ? riskReward(price, stopNow.stop, targets.mid.price) : null,
  };
  buyingNow.worthIt = !halted && buyingNow.riskReward != null && buyingNow.riskReward >= rules.entry.minRiskReward;

  // Screening gate, not a technical one: a stock the universe tags
  // non-compliant is never offered as a fresh buy, independent of how good
  // the setup looks. Doesn't apply to a position already held — see rules.js.
  const shariahExcluded = !position && rules.shariah?.excludeNonCompliant && meta.shariah === 'non_compliant';
  if (shariahExcluded) buyingNow.worthIt = false;

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

  // Investment-vs-speculation classification (see scoring/classification.js)
  // — purely arithmetic over the snapshot and fundamentals above, same "the model
  // never calculates a number" boundary as everything else in this file.
  // Computed before the position block: a breached stop's fundamental-hold
  // option (buildRuleBook) depends on it.
  const classification = classifyStock({
    usable: true,
    sector: meta.sector,
    snapshot,
    technical,
    fundamentals: fundamentals ?? null,
    quality,
  });

  // If a position is already open, the live stop and P&L matter more than the
  // hypothetical entry plan.
  let positionState = null;
  // What the caller sees as this analysis's snapshot: the daily-close one,
  // unless an open position is being valued at a live quote (see below).
  let resultSnapshot = snapshot;
  // Likewise the targets: the close-based ones, unless the live price has
  // passed one and a new one had to be set (see below).
  let resultTargets = targets;
  // A stop or target the User set before the event is still on the old
  // basis until the portfolio catches up (see corporateActions.js); read it
  // on the new one so it isn't a false breach.
  if (corporateAction && position) {
    const k = corporateAction.factor;
    const scale = (level) => (onOldScale(level, k, opts.live?.price > 0 ? opts.live.price : price) ? r2(level / k) : level);
    position = { ...position, stop: position.stop != null ? scale(position.stop) : position.stop, target: position.target != null ? scale(position.target) : position.target };
    // The holding itself too, until the portfolio check writes it: the same
    // money in more shares, not a loss by the ratio.
    if (position.avgCost > 0 && position.shares > 0 && scale(position.avgCost) !== position.avgCost) {
      position = { ...position, shares: Math.round(position.shares * k), avgCost: (position.shares * position.avgCost) / Math.round(position.shares * k), sharesPendingCorporateAction: true };
    }
  }

  if (position?.shares > 0 && position.avgCost > 0) {
    // The cached bars stop at the last completed session, so on their own
    // they value a position at a price that can be days old — a recommendation
    // then talks about a stop or target the live price has long since left
    // behind. When the caller has a live quote, everything about the open
    // position (P&L, distances, rule triggers, and the snapshot the AI brief
    // quotes) is priced at it instead; entry planning above stays on the close.
    const closePrice = price;
    const livePrice = opts.live?.price > 0 ? opts.live.price : null;
    const posPrice = livePrice ?? closePrice;
    const posSnapshot = livePrice
      ? {
          ...snapshot,
          price: {
            ...snapshot.price,
            dailyClose: closePrice,
            close: livePrice,
            // Against the rebased close: the feed's own change is measured
            // across the jump on the event day.
            changePct: corporateAction?.rescaled
              ? r2(((livePrice - closePrice) / closePrice) * 100)
              : opts.live.changePct ?? snapshot.price.changePct,
            lastTradePrice: livePrice,
            lastTradeTime: opts.live.time ?? null,
          },
        }
      : snapshot;
    resultSnapshot = posSnapshot;
    const runningHigh = Math.max(...bars.slice(-120).map((b) => b.h));
    const existingStop = position.stop ?? stopPlan.stop;
    const trailingAi = await getOrGenerateTrailingStop(
      portfolioId,
      code,
      meta.ar ?? code,
      snapshot,
      { avgCost: position.avgCost, shares: position.shares, existingStop },
      style,
      rules,
    );
    // The stop set off the last completed close — the one in force when that
    // session ended, and so the one a "did it close under its stop" check is
    // judged against.
    const stopAtClose = trailingAi.stop ?? existingStop;
    // During the session the stop follows the live price up: once it has
    // climbed enough past where the stop was set, the stop is re-set against
    // it (ratchet-only — see getLiveTrailingStop). A failure there just leaves
    // the close-based stop in force.
    const liveStop = livePrice
      ? await getLiveTrailingStop(portfolioId, code, meta.ar ?? code, posSnapshot, { avgCost: position.avgCost, shares: position.shares }, stopAtClose, style, rules).catch((err) => {
          console.error(`[stop] live re-set failed for ${code}:`, err.message);
          return null;
        })
      : null;
    const effectiveStop = Math.max(stopAtClose, liveStop?.stop ?? 0);
    const raisedLive = effectiveStop > stopAtClose + 0.001;
    const trailing = {
      stop: effectiveStop,
      moved: trailingAi.moved || raisedLive,
      from: r2(existingStop),
      peak: r2(runningHigh),
      rationale: raisedLive ? liveStop.rationale : trailingAi.rationale,
      stopAtClose: r2(stopAtClose),
      raisedLive,
    };
    const plPct = ((posPrice - position.avgCost) / position.avgCost) * 100;
    // Stops are honored on a session close, not an intraday wick
    // (rules.stop.honorOn) — so a breach needs the last completed close under
    // the stop that was in force at that close AND the live price still under
    // the current one. A price that has since recovered above the stop re-arms
    // it; a live dip under it with the last close still above shows as a
    // negative distance but isn't an exit yet; and a stop raised today never
    // retroactively makes yesterday's close a breach.
    const brokenOnClose = closePrice < stopAtClose && posPrice < effectiveStop;
    // Some styles want more than one close under the stop before it is an exit
    // (rules.stop.confirmCloses — the long style asks for two): a stock that
    // gaps under it for a single session and is back above it the next day
    // shouldn't cost a long-term holder the position. Until the run is long
    // enough the breach is only a warning, and the next close decides.
    const confirmCloses = Math.max(1, rules.stop.confirmCloses ?? 1);
    const closesUnder = brokenOnClose ? consecutiveClosesUnder(bars.map((b) => b.c), stopAtClose) : 0;
    const stopFired = brokenOnClose && closesUnder >= confirmCloses;
    const stopWarning = brokenOnClose && !stopFired ? { closesUnder, needed: confirmCloses } : null;
    // A second, wider stop for the long-horizon thesis — see computeLongTermStop
    // for why it shares its invalidation level with the long-term target.
    const longTermStop = computeLongTermStop(posSnapshot, effectiveStop, rules);
    // Which computed target governs "reached target" for this position — mid
    // for every style except long (config/styles.js), which follows its own
    // stated guidance to judge by the long-horizon target instead. Falls back
    // to mid when the long target isn't projectable (downtrend, no data).
    const governingOf = (t) => (rules.targets?.primary === 'long' && t.long?.price ? t.long : t.mid);
    const passed = (t) => t?.price != null && posPrice >= t.price;

    // The targets above were derived off the last close, so a live price can
    // run past one — and a target already behind the price is not a target the
    // position can still aim at. When that happens, the passed horizon is
    // rebuilt against the live price (same structure-first rules as any other
    // target, so the next resistance up, else a measured move, else a
    // volatility projection) and the old level is kept as `previous`.
    let heldTargets = targets;
    if (livePrice && (passed(targets.mid) || passed(targets.long))) {
      const fresh = buildTargets(posSnapshot, bars, { entry: null, stop: effectiveStop }, rules);
      const retarget = (old, next) =>
        passed(old) && next?.price != null && next.price > posPrice
          ? { ...next, previous: { price: old.price, basis: old.basis ?? null } }
          : old;
      heldTargets = { ...targets, mid: retarget(targets.mid, fresh.mid), long: retarget(targets.long, fresh.long) };
    }
    resultTargets = heldTargets;
    const governingTarget = governingOf(heldTargets);
    // The target the price has just passed, if it is the one that governs — the
    // R3 "reached target → take profit" trigger keeps judging against it, so
    // setting a new target never silently drops the signal to bank some. When
    // no new target could be set, it is simply the governing target itself.
    const originalGoverning = governingOf(targets);
    const reachedTarget = passed(originalGoverning) ? originalGoverning : null;
    const nextTarget = reachedTarget && governingTarget !== reachedTarget ? governingTarget : null;
    const partialTaken = Boolean(position.partialTakenAt);
    const ruleBook = buildRuleBook(
      {
        snapshot: posSnapshot, position, price: posPrice, plPct, trailing, effectiveStop, stopFired, stopWarning,
        governingTarget: reachedTarget ?? governingTarget, nextTarget, partialTaken,
        classification, longTermStop, liquidityOk: liquidity.ok, sessionsUnder: closesUnder,
      },
      rules,
    );

    positionState = {
      shares: position.shares,
      // True when the share count was never read off the screenshot but
      // back-solved from `marketValue ÷ a cached close`. That guess is only as
      // good as the price it divided by, so it must stay visibly marked all
      // the way to the UI rather than passing as a confirmed holding.
      sharesEstimated: position.derivedFromScreenshot === true,
      avgCost: r2(position.avgCost),
      purchaseValue: r2(position.shares * position.avgCost),
      marketValue: r2(position.shares * posPrice),
      unrealizedPct: r2(plPct),
      unrealizedEgp: r2(position.shares * (posPrice - position.avgCost)),
      // What all of the above is priced at — the live quote when there was one,
      // else the last close — and that last completed close on its own. The UI
      // needs the close to re-derive stopBreached as the live price moves.
      pricedAt: livePrice ? 'live' : 'close',
      closePrice: r2(closePrice),
      stop: effectiveStop,
      // The stop in force at that close, before any raise during the session.
      stopAtClose: r2(stopAtClose),
      trailing,
      // Wider stop for the long-term hold — null when there's no long-term
      // uptrend left to protect (see computeLongTermStop). Distinct from
      // `stop`: that one is what the mechanical rules actually enforce on a
      // session close; this one is informational context for the long
      // horizon, never the trigger the AI or the recommendation rules act on.
      longTermStop,
      stopBreached: stopFired && !halted,
      // The first close(s) under the stop, short of the closes the style needs
      // to call it an exit — { closesUnder, needed } — or null.
      stopWarning: halted ? null : stopWarning,
      distanceToStopPct: r2(((posPrice - effectiveStop) / posPrice) * 100),
      // The level distanceToTargetPct is measured to — so the UI draws the
      // same target it quotes a distance to, whatever style it is showing.
      targetLevel: governingTarget?.price ?? null,
      // Set only while the live price is past the target the day's analysis
      // picked: that level, and (in targetLevel above) the new one that
      // replaced it. Null once the price is back under, or when nothing passed.
      reachedTarget: reachedTarget ? { price: reachedTarget.price, next: nextTarget?.price ?? null } : null,
      distanceToTargetPct: governingTarget?.price ? r2(((governingTarget.price - posPrice) / posPrice) * 100) : null,
      riskRewardFromHere: governingTarget?.price ? riskReward(posPrice, effectiveStop, governingTarget.price) : null,
      // The targets-table badge: a week range plus a momentum marker.
      estimate: targetEstimate({
        price: posPrice,
        target: governingTarget?.price ?? null,
        dayChangePct: posSnapshot.price.changePct ?? 0,
        sector: meta.sector,
        sessions: governingTarget?.horizon?.sessions ?? null,
      }, rules),
      partialTaken,
      halted,
      // What the desk view shows on this position's card. A stock that isn't
      // trading gets no order: none could be filled until it reopens.
      recommendation: halted ? haltedRecommendation(halted) : positionRecommendation(
        {
          snapshot: posSnapshot,
          position,
          trailing: { ...trailing, stop: effectiveStop },
          midTarget: (reachedTarget ?? governingTarget)?.price ?? null,
          nextTarget: nextTarget?.price ?? null,
          partialTaken,
          stopBreached: stopFired,
          stopWarning,
        },
        rules,
      ),
      // The rule set, applied. These are the mechanical triggers the AI must respect.
      triggers: {
        exitOnStop: !halted && ruleBook.stop.fired,
        takePartial: !halted && ruleBook.partialProfit.fired,
        atTarget: !halted && ruleBook.target.fired,
        canAverageDown: !halted && ruleBook.averagingDown.fired,
      },
      // Each rule from the settings panel, evaluated with the exact order
      // numbers the analyst is allowed to quote — see briefFor in analyst.js.
      ruleBook,
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

    snapshot: resultSnapshot,
    technical,
    liquidity,
    classification,

    plan: {
      suggestedEntry,
      entryStatus,
      entryNote,
      supportGapPct,
      actionable: !halted && !shariahExcluded && (entryStatus === 'buy_now' || entryStatus === 'limit_pullback'),
      shariahExcluded,
      buyingNow,
      stop: stopPlan,
      targets: resultTargets,
      sizing,
    },

    position: positionState,
    corporateAction,
    halted,
  };
}

/** The card's call for a held stock that isn't trading. */
export function haltedRecommendation(halted) {
  return {
    action: 'halted',
    label: 'موقوف عن التداول',
    text: `السهم مفيهوش تداول من ${halted.since} — غالبًا موقوف. مفيش أمر هيتنفذ دلوقتي، استنى لحد ما التداول يرجع وبعدين راجع التوصية.`,
    order: null,
  };
}

/** Sessions after an event during which the analysis still says it happened. */
const CORPORATE_ACTION_NOTICE_SESSIONS = 5;
/** How far a recorded factor may sit from today's gap before the gap wins (a limit day's own move is ±20%). */
const GAP_TOLERANCE = 0.25;

/**
 * The stock's bars on its current share basis, and the event that moved it
 * if it's recent. A live quote 30%+ off the last close is recorded as a
 * suspected event here; the portfolio check (api/server.js) confirms the
 * ratio with a search and upgrades it.
 */
async function rebaseBars(code, bars, live) {
  let event = await latestEventFor(code).catch(() => null);
  const gap = gapEvent(code.toUpperCase(), bars, live?.price, cairoToday());
  if (gap && gap.lastBefore !== event?.lastBefore) {
    event = await recordEvent(gap).catch(() => gap);
  } else if (gap && event && Math.abs(Math.log(gap.factor / event.factor)) > Math.log(1 + GAP_TOLERANCE)) {
    // The record for that session says something the bars and the live quote
    // flatly contradict (a factor read off a stale bar, the wrong way round):
    // go by what the prices show now.
    event = gap;
  }
  if (!event) return { bars, corporateAction: null };
  const { bars: rebased, rescaled } = onNewBasis(bars, event);
  const at = rebased.findIndex((b) => b.date === event.lastBefore);
  const recent = at >= 0 && rebased.length - 1 - at <= CORPORATE_ACTION_NOTICE_SESSIONS;
  if (!rescaled && !recent) return { bars: rebased, corporateAction: null };
  return {
    bars: rebased,
    corporateAction: {
      factor: event.factor,
      lastBefore: event.lastBefore,
      status: event.status,
      kind: event.kind ?? null,
      summary: event.summary ?? null,
      rescaled,
    },
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
  // Live quotes are fetched only for held codes — those are the only analyses
  // that value anything at the current price (see analyzeTicker) — in one
  // batch, alongside the fundamentals call. A failed or empty fetch just leaves
  // those positions priced at the last close, as before.
  const heldCodes = codes.filter((code) => positions[code.toUpperCase()] ?? opts.position);
  const [fundamentals, liveQuotes] = await Promise.all([
    opts.fundamentals ?? (opts.withFundamentals === false ? new Map() : fetchFundamentals()),
    opts.liveQuotes ?? (heldCodes.length ? fetchLatestQuotes(heldCodes).catch(() => new Map()) : new Map()),
  ]);

  async function worker() {
    while (queue.length) {
      const code = queue.shift();
      try {
        const r = await analyzeTicker(code, {
          ...opts,
          position: positions[code.toUpperCase()] ?? opts.position ?? null,
          fundamentals,
          live: liveQuotes.get(code.toUpperCase()) ?? null,
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
