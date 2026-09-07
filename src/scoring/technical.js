/**
 * Composite technical score, 0-100.
 *
 * This is the deterministic verdict — the same bars always produce the same
 * number, and every point is attributable to a named component with a written
 * reason. The AI layer sits *on top* of this and may argue with it, but it can
 * never silently replace it, which is what keeps recommendations auditable.
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r1 = (x) => (x == null ? null : +x.toFixed(1));

/** Map a value from one range onto 0..1, clamped. */
const norm = (x, lo, hi) => clamp((x - lo) / (hi - lo), 0, 1);

export function scoreTechnical(snapshot) {
  const reasons = { bullish: [], bearish: [], neutral: [] };
  const components = {};

  // ---- Trend, 30 pts -------------------------------------------------------
  {
    const t = snapshot.trend.score; // -100..100
    let pts = norm(t, -100, 100) * 30;
    const ma = snapshot.movingAverages;

    if (ma.goldenCross === true) {
      pts += 2;
      reasons.bullish.push('متوسط 50 فوق متوسط 200 (تقاطع ذهبي)');
    } else if (ma.goldenCross === false) {
      pts -= 2;
      reasons.bearish.push('متوسط 50 تحت متوسط 200 (تقاطع الموت)');
    }

    if (ma.priceVsSma200Pct != null) {
      if (ma.priceVsSma200Pct > 0) reasons.bullish.push(`السعر فوق متوسط 200 بـ ${ma.priceVsSma200Pct}%`);
      else reasons.bearish.push(`السعر تحت متوسط 200 بـ ${Math.abs(ma.priceVsSma200Pct)}%`);
    }

    components.trend = { points: r1(clamp(pts, 0, 30)), max: 30, label: snapshot.trend.label };
  }

  // ---- Momentum, 25 pts ----------------------------------------------------
  {
    const m = snapshot.momentum;
    let pts = 0;

    // RSI scores best in the 55-70 "strong but not exhausted" band. Above 75 the
    // score comes back down: overbought is a warning, not a buy signal.
    if (m.rsi14 != null) {
      const rsiPts =
        m.rsi14 >= 75 ? 6
        : m.rsi14 >= 55 ? 10
        : m.rsi14 >= 45 ? 6
        : m.rsi14 >= 30 ? 3
        : 4; // deeply oversold can be a reversal setup
      pts += rsiPts;
      if (m.rsi14 >= 70) reasons.bearish.push(`RSI ${m.rsi14} — تشبع شرائي، خطر تصحيح`);
      else if (m.rsi14 >= 55) reasons.bullish.push(`RSI ${m.rsi14} — زخم إيجابي صحي`);
      else if (m.rsi14 <= 30) reasons.neutral.push(`RSI ${m.rsi14} — تشبع بيعي، ممكن ارتداد`);
    }

    if (m.macdCross === 'bullish_cross') {
      pts += 9;
      reasons.bullish.push('تقاطع MACD إيجابي جديد');
    } else if (m.macdCross === 'bullish') {
      pts += 6;
      reasons.bullish.push('MACD فوق خط الإشارة');
    } else if (m.macdCross === 'bearish_cross') {
      pts += 1;
      reasons.bearish.push('تقاطع MACD سلبي جديد');
    } else if (m.macdCross === 'bearish') {
      pts += 2;
      reasons.bearish.push('MACD تحت خط الإشارة');
    }

    if (m.divergence?.type === 'bullish') {
      pts += 6;
      reasons.bullish.push(`دايفرجنس إيجابي: ${m.divergence.detail}`);
    } else if (m.divergence?.type === 'bearish') {
      pts -= 4;
      reasons.bearish.push(`دايفرجنس سلبي: ${m.divergence.detail}`);
    }

    components.momentum = { points: r1(clamp(pts, 0, 25)), max: 25, rsi: m.rsi14, macd: m.macdCross };
  }

  // ---- Participation / volume, 15 pts -------------------------------------
  {
    const v = snapshot.volume;
    let pts = 7; // neutral baseline

    if (v.obvTrend === 'تجميع') {
      pts += 5;
      reasons.bullish.push('حجم التداول بيأكد الصعود (تجميع)');
    } else if (v.obvTrend === 'تصريف') {
      pts -= 5;
      reasons.bearish.push('حجم التداول بيشير لتصريف');
    }

    if (v.relativeVolume != null) {
      if (v.relativeVolume >= 1.5) {
        pts += 3;
        reasons.bullish.push(`حجم اليوم ${v.relativeVolume}× المتوسط — اهتمام حقيقي`);
      } else if (v.relativeVolume < 0.5) {
        pts -= 2;
        reasons.neutral.push('حجم تداول ضعيف — الحركة مش مدعومة');
      }
    }

    if (snapshot.breakout?.direction === 'up') {
      if (snapshot.breakout.volumeConfirmed) {
        pts += 3;
        reasons.bullish.push(`اختراق ${snapshot.breakout.level} بحجم مؤكد`);
      } else {
        reasons.neutral.push(`اختراق ${snapshot.breakout.level} بدون حجم مؤكد — حذر`);
      }
    } else if (snapshot.breakout?.direction === 'down') {
      pts -= 4;
      reasons.bearish.push(`كسر لمستوى ${snapshot.breakout.level}`);
    }

    components.participation = { points: r1(clamp(pts, 0, 15)), max: 15, obv: v.obvTrend };
  }

  // ---- Location / structure, 20 pts ---------------------------------------
  {
    let pts = 0;
    const nearestRes = snapshot.levels.resistances[0];
    const nearestSup = snapshot.levels.supports[0];

    // Reward being close to support and far from resistance — that is where the
    // risk/reward of an entry is best.
    if (nearestSup) pts += norm(-nearestSup.distancePct, 0, 12) * 4;
    if (nearestRes) {
      pts += norm(nearestRes.distancePct, 0, 15) * 10;
      if (nearestRes.distancePct < 2 && nearestRes.strength >= 60) {
        reasons.bearish.push(`مقاومة قوية قريبة عند ${nearestRes.price} (${nearestRes.distancePct}%)`);
      }
    } else {
      pts += 10; // clear air above
      reasons.bullish.push('لا توجد مقاومة واضحة فوق السعر الحالي');
    }

    const fromHigh = snapshot.price.pctFrom52wHigh;
    if (fromHigh != null) {
      // Near the highs is strength, but the very top of the range leaves no room.
      pts += fromHigh > -3 ? 4 : fromHigh > -15 ? 6 : fromHigh > -35 ? 3 : 1;
      if (fromHigh > -3) reasons.neutral.push('السهم عند قمته السنوية — الدخول بأمر محدد على تصحيح، مش مطاردة');
    }

    components.location = { points: r1(clamp(pts, 0, 20)), max: 20 };
  }

  // ---- Volatility & liquidity, 10 pts -------------------------------------
  {
    let pts = 10;
    const vol = snapshot.volatility;
    const turnover = snapshot.volume.avgTurnoverEgp ?? 0;

    if (vol.atrPct != null && vol.atrPct > 4) {
      pts -= 4;
      reasons.bearish.push(`تقلب عالي (ATR ${vol.atrPct}% يوميًا) — قلّل حجم المركز`);
    }
    if (turnover < 2_000_000) {
      pts -= 5;
      reasons.bearish.push(`سيولة ضعيفة (${Math.round(turnover / 1000)} ألف ج يوميًا) — صعب الخروج`);
    }
    if (vol.squeeze) {
      reasons.neutral.push('انضغاط بولينجر — حركة قوية قادمة، الاتجاه لسه مش محدد');
    }

    components.risk = { points: r1(clamp(pts, 0, 10)), max: 10, atrPct: vol.atrPct };
  }

  const total = Object.values(components).reduce((a, c) => a + c.points, 0);
  const score = Math.round(clamp(total, 0, 100));

  const signal =
    score >= 72 ? { action: 'buy', ar: 'شراء', strength: 'قوي' }
    : score >= 58 ? { action: 'accumulate', ar: 'تجميع تدريجي', strength: 'متوسط' }
    : score >= 42 ? { action: 'hold', ar: 'احتفاظ', strength: 'محايد' }
    : score >= 28 ? { action: 'reduce', ar: 'تخفيف', strength: 'ضعيف' }
    : { action: 'avoid', ar: 'تجنب / خروج', strength: 'ضعيف جدًا' };

  return { score, signal, components, reasons };
}
