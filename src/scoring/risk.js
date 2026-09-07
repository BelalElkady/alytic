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
