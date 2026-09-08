/**
 * Stop placement, position sizing and risk arithmetic.
 *
 * The guiding idea: a stop belongs where the trade thesis is *wrong*, not at a
 * round percentage. So structure comes first — the stop sits under the support
 * the stock is actually defending — and volatility only sets the floor on how
 * tight that stop may be. When honest structure implies more risk than the book
 * allows, the answer is a smaller position, never a tighter stop.
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
  const atr = snapshot.volatility.atr14;
  const cfg = rules.stop;

  // 1. Structural: under the nearest support that has actually been defended.
  const support = snapshot.levels.supports.find((s) => s.strength >= 45 && s.price < price);
  const structural = support ? support.price * (1 - cfg.structureBufferPct / 100) : null;

  // 2. Volatility: far enough out that ordinary noise doesn't reach it.
  const volatility = atr ? price - cfg.atrMultiple * atr : null;

  let stop = structural ?? volatility ?? price * (1 - cfg.maxStopPct / 100);
  let basis = structural ? 'structure' : volatility ? 'volatility' : 'fallback';

  // A structural stop sitting inside the noise band is not survivable — push it
  // out to the volatility floor.
  if (atr && stop > price - cfg.minAtrMultiple * atr) {
    stop = price - cfg.minAtrMultiple * atr;
    basis = 'volatility_floor';
  }

  let riskPct = ((price - stop) / price) * 100;
  let capped = false;

  if (riskPct > cfg.maxStopPct) {
    // Honest structure is too far away. Keep the stop where risk is tolerable and
    // flag it — the caller should shrink the position rather than pretend.
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
      : basis === 'volatility' ? `${cfg.atrMultiple}× متوسط المدى الحقيقي (ATR ${atr})`
      : basis === 'volatility_floor' ? `الدعم قريب جدًا — الوقف اتوسّع لـ ${cfg.minAtrMultiple}× ATR عشان التذبذب العادي ما يضربوش`
      : basis === 'risk_cap' ? `الدعم بعيد — الوقف عند الحد الأقصى للمخاطرة ${cfg.maxStopPct}% وقلّل حجم المركز`
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
 * Returns whole shares — EGX trades in whole lots.
 */
export function positionSize({ capital, entry, stop, avgTurnoverEgp, sectorExposureEgp = 0 }, rules = RULES) {
  const cfg = rules.sizing;
  const riskPerShare = entry - stop;
  if (!(riskPerShare > 0)) {
    return { shares: 0, reason: 'وقف غير صالح (أعلى من أو يساوي سعر الدخول)' };
  }

  const riskBudget = capital * (cfg.riskPerTradePct / 100);
  const byRisk = riskBudget / riskPerShare;
  const byConcentration = (capital * (cfg.maxPositionPct / 100)) / entry;

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
export function positionRecommendation({ snapshot, position, trailing, midTarget }, rules = RULES) {
  const price = snapshot.price.close;
  const { avgCost, shares } = position;
  const stop = trailing.stop;
  const profitPct = ((price - avgCost) / avgCost) * 100;
  const toStopPct = ((price - stop) / price) * 100;

  // 1. Stop breached — nothing else matters.
  if (price < stop) {
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
      text: `وصل الهدف ${r2(midTarget)}. بيع ${qty} سهم وارفع الوقف للباقي لـ ${r2(price * (1 - rules.takeProfit.raiseStopAfterTargetPct / 100))}.`,
      order: { side: 'sell', qty, price: r2(price) },
    };
  }

  // 3. Enough profit to bank some, and the trail hasn't taken over yet.
  if (profitPct >= rules.takeProfit.partialAtProfitPct && !trailing.active) {
    const qty = Math.round(shares * rules.takeProfit.partialFraction);
    const limit = price * (1 + rules.takeProfit.limitAbovePricePct / 100);
    return {
      action: 'sell_part',
      label: 'بيع جزئي',
      text: `مربح ${r2(profitPct)}% — أمّن جزء. بيع ${qty} سهم بأمر محدد عند ${r2(limit)} (صلاحية أسبوع). الباقي بوقف متحرك.`,
      order: { side: 'sell', qty, price: r2(limit) },
    };
  }

  // 4. Close to the stop — a warning, not an action.
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
