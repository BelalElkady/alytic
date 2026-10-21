/**
 * Position sizing and risk arithmetic — plus computeStop()/computeTrailingStop(),
 * kept here for their config constants and unit tests but NO LONGER called for
 * the authoritative stop-loss level: by product decision, that is now
 * AI-determined (see src/agent/stopPlanner.js), driven by the same guiding
 * idea these functions encode — a stop belongs where the trade thesis is
 * *wrong*, not at a round percentage — but decided by the model rather than
 * this formula. positionSize() below still takes whatever stop it's given
 * and sizes the position so a smaller position, never a tighter stop, is the
 * answer when risk runs high.
 */

import RULES from '../config/rules.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));

/**
 * Where to place the initial stop for a long entry.
 * @param {object} snapshot - output of buildSnapshot
 * @param {number} [entry] - defaults to the last close
 */
export function computeStop(snapshot, entry = null, rules = RULES) {
  const price = entry ?? snapshot.price.close;
  // Stops honor the close, so the noise they must clear is the close-to-close
  // move. High/low ATR is only a fallback for snapshots that lack it.
  const atr = snapshot.volatility.closeAtr14 ?? snapshot.volatility.atr14;
  const cfg = rules.stop;

  // 1. Structural: under the nearest support that has actually been defended —
  // as long as it is close enough to be where this trade is proven wrong. A
  // support 20% down is a different trade's invalidation; using it would just
  // pin the stop to the risk cap.
  const nearest = snapshot.levels.supports.find((s) => s.strength >= 45 && s.price < price);
  const nearestStop = nearest ? nearest.price * (1 - cfg.structureBufferPct / 100) : null;
  const tooFar = nearestStop != null && atr && price - nearestStop > cfg.noiseMultiple * atr;
  const support = tooFar ? null : nearest;
  const structural = support ? nearestStop : null;

  // 2. Volatility: far enough out that ordinary noise doesn't reach it.
  const volatility = atr ? price - cfg.noiseMultiple * atr : null;

  let stop = structural ?? volatility ?? price * (1 - cfg.maxStopPct / 100);
  let basis = structural ? 'structure' : volatility ? 'volatility' : 'fallback';

  // A structural stop sitting inside the noise band is not survivable — push it
  // out to the volatility floor.
  if (atr && stop > price - cfg.minNoiseMultiple * atr) {
    stop = price - cfg.minNoiseMultiple * atr;
    basis = 'volatility_floor';
  }

  let riskPct = ((price - stop) / price) * 100;
  let capped = false;

  if (riskPct > cfg.maxStopPct) {
    // The noise alone is wider than the book tolerates. Keep the stop where risk
    // is tolerable and flag it — the caller should shrink the position rather
    // than pretend.
    stop = price * (1 - cfg.maxStopPct / 100);
    riskPct = cfg.maxStopPct;
    capped = true;
    basis = 'risk_cap';
  }
  if (riskPct < cfg.minStopPct) {
    stop = price * (1 - cfg.minStopPct / 100);
    riskPct = cfg.minStopPct;
    basis = 'min_stop';
  }

  return {
    stop: r2(stop),
    riskPct: r2(riskPct),
    basis,
    capped,
    supportDefended: support ? { price: support.price, strength: support.strength } : null,
    note:
      basis === 'structure' ? `تحت دعم ${r2(support.price)} بهامش ${cfg.structureBufferPct}%`
      : basis === 'volatility' ? `${tooFar ? `أقرب دعم (${r2(nearest.price)}) بعيد أوي — ` : ''}${cfg.noiseMultiple}× متوسط حركة الإغلاق اليومية (${r2(atr)})`
      : basis === 'volatility_floor' ? `الدعم قريب جدًا — الوقف اتوسّع لـ ${cfg.minNoiseMultiple}× متوسط حركة الإغلاق عشان التذبذب العادي ما يضربوش`
      : basis === 'risk_cap' ? `السهم متذبذب جدًا — الوقف عند الحد الأقصى للمخاطرة ${cfg.maxStopPct}% وقلّل حجم المركز`
      : basis === 'min_stop' ? `الوقف الطبيعي قريب أوي — اتثبت عند الحد الأدنى ${cfg.minStopPct}%`
      : 'وقف افتراضي',
  };
}

/**
 * Trailing stop for an open position. Ratchets up only, and stays dormant until
 * the position has earned enough cushion to justify it.
 */
export function computeTrailingStop({ avgCost, currentPrice, runningHigh, existingStop }, rules = RULES) {
  const cfg = rules.trailing;
  const profitPct = ((currentPrice - avgCost) / avgCost) * 100;

  if (!cfg.enabled || profitPct < cfg.activateAtProfitPct) {
    return { stop: r2(existingStop), active: false, profitPct: r2(profitPct), moved: false };
  }

  const peak = Math.max(runningHigh ?? currentPrice, currentPrice);
  const trailed = peak * (1 - cfg.trailPct / 100);
  const next = cfg.ratchetOnly ? Math.max(trailed, existingStop ?? 0) : trailed;

  return {
    stop: r2(next),
    active: true,
    profitPct: r2(profitPct),
    moved: existingStop != null && next > existingStop + 0.001,
    from: r2(existingStop),
    peak: r2(peak),
  };
}

/**
 * The long-term investment stop — deliberately wider than the tactical stop
 * from computeStop()/computeTrailingStop(). Those protect a swing: tight,
 * structure- or ATR-based, meant to cut a failed setup quickly. This one marks
 * where the LONG-TERM thesis itself breaks, not where an ordinary pullback
 * does — so it has to sit on a level a normal correction won't reach.
 *
 * It reuses the exact criterion longTermTarget() already applies to decide
 * whether a long-horizon target exists at all: a close below the 200-day
 * average. That is deliberate — the stop and the long-term target now share
 * one invalidation condition instead of two unrelated ones, so "the long-term
 * story is broken" means the same thing on both sides of the trade.
 */
export function computeLongTermStop(snapshot, tacticalStop = null, rules = RULES) {
  const sma200 = snapshot.movingAverages.sma200;
  const price = snapshot.price.close;

  if (!sma200) {
    return { stop: null, basis: null, riskPct: null, note: 'تاريخ الأسعار أقصر من 200 جلسة — مفيش متوسط طويل يتحسب عليه وقف بعيد' };
  }
  if (sma200 >= price) {
    return { stop: null, basis: null, riskPct: null, note: 'السعر تحت متوسط 200 يوم بالفعل — مفيش اتجاه صاعد بعيد يستحق وقف منفصل' };
  }

  // Never tighter than the tactical stop — a "give it more room" stop that
  // triggers before the everyday one would defeat its own purpose.
  const stop = tacticalStop != null ? Math.min(sma200, tacticalStop) : sma200;
  const usedTactical = tacticalStop != null && stop === tacticalStop && tacticalStop > sma200 - 0.005;

  return {
    stop: r2(stop),
    basis: 'sma200',
    riskPct: r2(((price - stop) / price) * 100),
    note: usedTactical
      ? `متوسط 200 يوم (${r2(sma200)}) أضيق من الوقف التكتيكي — اتثبت عند الوقف التكتيكي بدل ما يبقى أضيق منه`
      : `إغلاق تحت متوسط 200 يوم (${r2(sma200)}) — نفس المستوى اللي بيلغي الهدف البعيد`,
  };
}

/**
 * Position size from risk budget, then clipped by concentration and liquidity.
 * Returns whole shares — EGX trades in whole lots. `positionExposureEgp` is
 * what is already held of this same stock, for sizing an add to it: the
 * single-position cap then only has the headroom left above that.
 */
export function positionSize({ capital, entry, stop, avgTurnoverEgp, sectorExposureEgp = 0, positionExposureEgp = 0 }, rules = RULES) {
  const cfg = rules.sizing;
  const riskPerShare = entry - stop;
  if (!(riskPerShare > 0)) {
    return { shares: 0, reason: 'وقف غير صالح (أعلى من أو يساوي سعر الدخول)' };
  }

  const riskBudget = capital * (cfg.riskPerTradePct / 100);
  const byRisk = riskBudget / riskPerShare;
  const byConcentration = Math.max(0, capital * (cfg.maxPositionPct / 100) - positionExposureEgp) / entry;

  const byLiquidity =
    avgTurnoverEgp && rules.liquidity.maxPositionVsDailyTurnover
      ? (avgTurnoverEgp * rules.liquidity.maxPositionVsDailyTurnover) / entry
      : Infinity;

  const sectorHeadroom = capital * (cfg.maxSectorPct / 100) - sectorExposureEgp;
  const bySector = sectorHeadroom > 0 ? sectorHeadroom / entry : 0;

  const limits = [
    { n: byRisk, why: `ميزانية المخاطرة ${cfg.riskPerTradePct}% من رأس المال` },
    { n: byConcentration, why: `الحد الأقصى للمركز الواحد ${cfg.maxPositionPct}%` },
    { n: byLiquidity, why: `السيولة — ما يزيد عن ${rules.liquidity.maxPositionVsDailyTurnover * 100}% من التداول اليومي` },
    { n: bySector, why: `الحد الأقصى للقطاع ${cfg.maxSectorPct}%` },
  ];
  const binding = limits.reduce((a, b) => (b.n < a.n ? b : a));
  const shares = Math.max(0, Math.floor(binding.n));

  return {
    shares,
    costEgp: r2(shares * entry),
    riskEgp: r2(shares * riskPerShare),
    riskPctOfCapital: r2(((shares * riskPerShare) / capital) * 100),
    positionPctOfCapital: r2(((shares * entry) / capital) * 100),
    bindingConstraint: binding.why,
    reason: shares === 0 ? `لا يسمح بمركز: ${binding.why}` : null,
  };
}

/** Reward-to-risk for a target, expressed in R. */
export function riskReward(entry, stop, target) {
  const risk = entry - stop;
  if (!(risk > 0)) return null;
  return +(((target - entry) / risk)).toFixed(2);
}

/**
 * The standing recommendation for an open position, in Egyptian Arabic.
 *
 * This is the mechanical verdict the desk view shows on each card. It applies
 * the rule set in order of severity — a breached stop overrides everything,
 * because the one discipline that must never be negotiated is the stop. The AI
 * analyst may add colour on top of this, but it cannot contradict it.
 */
export function positionRecommendation({ snapshot, position, trailing, midTarget, nextTarget = null, partialTaken = false, stopBreached, stopWarning = null, weakness = null }, rules = RULES) {
  const price = snapshot.price.close;
  const { avgCost, shares } = position;
  const stop = trailing.stop;
  const profitPct = ((price - avgCost) / avgCost) * 100;
  const toStopPct = ((price - stop) / price) * 100;

  // 1. Stop breached — nothing else matters. The caller may say it is not
  // (stops are honored on a close, and `price` can be a live quote that dipped
  // under the stop mid-session); left undefined, the price alone decides.
  if (stopBreached ?? price < stop) {
    return {
      action: 'exit_stop',
      label: 'خروج — وقف',
      text: `أغلق تحت الوقف ${r2(stop)}. ما نجادلش الوقف — بيع كلي بسعر السوق عند الافتتاح.`,
      order: { side: 'sell', qty: shares, price: r2(price) },
    };
  }

  // 2. Mid target reached — take a third, trail the rest.
  if (midTarget && price >= midTarget) {
    const qty = Math.floor(shares * rules.takeProfit.atTargetFraction);
    return {
      action: 'take_target',
      label: 'جني أرباح',
      text: `وصل الهدف ${r2(midTarget)}. بيع ${qty} سهم وارفع الوقف للباقي لـ ${r2(price * (1 - rules.takeProfit.raiseStopAfterTargetPct / 100))}.` +
        (nextTarget != null ? ` الهدف الجديد للباقي: ${r2(nextTarget)}.` : ''),
      order: { side: 'sell', qty, price: r2(price) },
    };
  }

  // 3. Enough profit to bank some, once per position.
  if (profitPct >= rules.takeProfit.partialAtProfitPct && !partialTaken) {
    const qty = Math.round(shares * rules.takeProfit.partialFraction);
    const limit = price * (1 + rules.takeProfit.limitAbovePricePct / 100);
    return {
      action: 'sell_part',
      label: 'بيع جزئي',
      text: `مربح ${r2(profitPct)}% — أمّن جزء. بيع ${qty} سهم بأمر محدد عند ${r2(limit)} (صلاحية أسبوع). الباقي بوقف متحرك.`,
      order: { side: 'sell', qty, price: r2(limit) },
    };
  }

  // 3b. R7 — trailing its own index and under its short average: trim, once
  // per position (scoring/relativeStrength.js). Ahead of the near-stop hold
  // below: a weak stock close to its stop is the case to trim most.
  if (weakness?.fired) {
    return {
      action: 'trim_weak',
      label: 'تخفيف — أضعف من السوق',
      text:
        `آخر ${weakness.lookbackSessions} جلسات السهم ${r2(weakness.stockPct)}% و${weakness.benchmark} ${r2(weakness.indexPct)}% — ` +
        `متأخر عن مؤشره ${r2(Math.abs(weakness.lagPts))} نقطة وقفل تحت متوسط ${weakness.maPeriod} يوم (${r2(weakness.ma)}). ` +
        `بيع ${weakness.qty} سهم بسعر السوق مع الافتتاح، والباقي ${weakness.remainingShares} سهم بنفس الوقف ${r2(stop)}.`,
      order: { side: 'sell', qty: weakness.qty, price: r2(price) },
    };
  }

  // 4. Close to the stop — a warning, not an action.
  // A close under the stop that the style doesn't yet count as an exit: it
  // takes `stopWarning.needed` closes in a row, and this is the first.
  if (stopWarning) {
    const left = stopWarning.needed - stopWarning.closesUnder;
    return {
      action: 'hold',
      label: 'احتفاظ — الإغلاق الجاي بيحسم',
      text: `أول إغلاق تحت الوقف ${r2(stop)} — لسه مش خروج في الباقة دي. ${left === 1 ? 'إغلاق' : `${left} إغلاقات`} تاني تحت ${r2(stop)} يبقى خروج كامل، ولو رجع فوقه الوقف بيفضل شغال.`,
      order: null,
    };
  }
  if (toStopPct < 0) {
    // Under the stop right now but not on a close — not an exit yet.
    return {
      action: 'hold',
      label: 'احتفاظ',
      text: `السعر نازل تحت الوقف ${r2(stop)} دلوقتي، بس لسه ما اتأكدش بإغلاق. إغلاق تحت ${r2(stop)} يبقى خروج كامل.`,
      order: null,
    };
  }
  if (toStopPct <= 3) {
    return {
      action: 'hold',
      label: 'احتفاظ',
      text: `قريب من الوقف (${r2(toStopPct)}% بس). احتفظ، بس إغلاق تحت ${r2(stop)} يبقى خروج كامل.`,
      order: null,
    };
  }

  // 5. A leader that has pulled back — the only case where adding is allowed.
  if (
    profitPct < 0 &&
    rules.averagingDown.allowed &&
    snapshot.trend.score > rules.averagingDown.onlyIfTrendScoreAbove &&
    (snapshot.movingAverages.priceVsSma200Pct ?? -1) > 0
  ) {
    return {
      action: 'buy_more',
      label: 'زيادة شراء',
      text: `سهم قيادي نازل ${r2(Math.abs(profitPct))}% من غير سبب أساسي وفوق متوسط 200 — فرصة تحسين متوسط بأمر محدد عند الدعم.`,
      order: null,
    };
  }

  // 6. Nothing to do.
  const moved = trailing.moved ? ` الوقف المتحرك ارتفع لـ ${r2(stop)}.` : '';
  return {
    action: 'hold',
    label: 'احتفاظ',
    text: `${profitPct >= 0 ? 'مربح' : 'خاسر'} ${r2(Math.abs(profitPct))}% وداخل النطاق. الحركة هادية ومش محتاجة أي قرار.${moved}`,
    order: null,
  };
}

/** Does this name clear the liquidity gate at all? */
export function liquidityCheck(snapshot, rules = RULES) {
  const turnover = snapshot.volume.avgTurnoverEgp ?? 0;
  const ok = turnover >= rules.liquidity.minAvgTurnoverEgp;
  return {
    ok,
    avgTurnoverEgp: turnover,
    note: ok
      ? null
      : `سيولة ضعيفة — متوسط التداول ${Math.round(turnover / 1000)} ألف ج يوميًا، أقل من الحد ${rules.liquidity.minAvgTurnoverEgp / 1e6} مليون`,
  };
}

/**
 * How many of the latest closes, counting back from the most recent, are under
 * `stop` — the run a style's `stop.confirmCloses` is compared against. A close
 * back at or above the stop ends the run.
 */
export function consecutiveClosesUnder(closes, stop) {
  let count = 0;
  for (let i = closes.length - 1; i >= 0 && closes[i] < stop; i--) count++;
  return count;
}
