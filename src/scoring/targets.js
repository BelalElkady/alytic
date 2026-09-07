/**
 * Target derivation and time-to-target estimation.
 *
 * Targets are anchored to observable structure, in priority order:
 *   1. a real resistance cluster the stock has to clear anyway;
 *   2. a measured move — the height of the base it just broke out of;
 *   3. a volatility projection, used only when structure gives nothing.
 *
 * The time estimate uses Kaufman's Efficiency Ratio rather than raw ATR. A
 * stock with ATR of 2 EGP does not travel 2 EGP of *net* distance per session —
 * it churns. ER measures how much of the daily range converts into directional
 * progress, so `ATR × ER` is a far better estimate of daily advance, and it
 * naturally reports a long horizon for choppy names and a short one for trenders.
 */

import RULES from '../config/rules.js';
import { riskReward } from './risk.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));

/**
 * Kaufman Efficiency Ratio over `period` sessions: net directional movement
 * divided by total path length. 1.0 = a straight line, ~0 = pure chop.
 */
export function efficiencyRatio(closes, period = 50) {
  if (closes.length < period + 1) return null;
  const win = closes.slice(-(period + 1));
  const net = Math.abs(win[win.length - 1] - win[0]);
  let path = 0;
  for (let i = 1; i < win.length; i++) path += Math.abs(win[i] - win[i - 1]);
  return path === 0 ? 0 : net / path;
}

/**
 * Sessions needed to travel `distance` EGP, given the stock's realised daily
 * net progress. Returns null when the stock is going nowhere (ER too low to
 * project honestly) — an unknown ETA is more useful than a fabricated one.
 *
 * `atr × ER` alone extrapolates a hot streak indefinitely: a stock that has been
 * running 1.6% a day is projected to keep doing that for months, which produced
 * absurd ETAs (+88% in six weeks) in testing. The governor caps sustained daily
 * progress at 1% of price — fast over a week, but not compounding forever.
 */
export function estimateSessions(distance, atr, er, price = null) {
  if (!atr || !er || er < 0.08 || distance <= 0) return null;
  let dailyProgress = atr * er;
  if (price) dailyProgress = Math.min(dailyProgress, price * 0.01);
  const sessions = Math.ceil(distance / dailyProgress);
  return sessions > 0 && sessions < 1000 ? sessions : null;
}

/** Arabic count phrasing — singular / dual / plural, which Arabic distinguishes. */
function arabicCount(n, [singular, dual, plural]) {
  if (n === 1) return singular;
  if (n === 2) return dual;
  if (n <= 10) return `${n} ${plural}`;
  return `${n} ${singular}`;
}

/** Human phrasing for a session count, in Egyptian Arabic. */
export function describeHorizon(sessions, rules = RULES) {
  if (sessions == null) return { ar: 'غير محدد — السهم في نطاق عرضي', sessions: null };
  const { sessionsPerWeek, sessionsPerMonth } = rules.horizon;

  if (sessions <= sessionsPerWeek) return { ar: `خلال أسبوع (${sessions} جلسات)`, sessions };
  if (sessions <= sessionsPerMonth) {
    return { ar: `حوالي ${arabicCount(Math.round(sessions / sessionsPerWeek), ['أسبوع', 'أسبوعين', 'أسابيع'])}`, sessions };
  }
  const months = sessions / sessionsPerMonth;
  if (months < 1.75) return { ar: 'شهر إلى شهر ونص', sessions };
  if (months < 12) return { ar: `حوالي ${arabicCount(Math.round(months), ['شهر', 'شهرين', 'أشهر'])}`, sessions };
  return { ar: 'أكثر من سنة', sessions };
}

/**
 * Measured move: if the stock broke out of a base, project the base's height
 * upward from the breakout level. Classic, and it respects real structure.
 */
function measuredMove(snapshot, bars) {
  const bo = snapshot.breakout;
  if (!bo || bo.direction !== 'up' || bo.barsAgo > 20) return null;

  // Height of the range over the 60 sessions preceding the breakout.
  const end = bars.length - 1 - bo.barsAgo;
  const start = Math.max(0, end - 60);
  const window = bars.slice(start, end + 1);
  if (window.length < 20) return null;

  const hi = Math.max(...window.map((b) => b.h));
  const lo = Math.min(...window.map((b) => b.l));
  const height = hi - lo;
  if (!(height > 0)) return null;

  return { price: r2(bo.level + height), method: 'measured_move', basis: `ارتفاع النطاق ${r2(height)} مسقط من الاختراق ${bo.level}` };
}

/**
 * Fibonacci 1.618 extension of the dominant swing — the standard long-horizon
 * projection once a stock is in a confirmed trend.
 */
function fibExtension(bars) {
  const window = bars.slice(-252);
  if (window.length < 60) return null;
  const lo = Math.min(...window.map((b) => b.l));
  const loIdx = window.findIndex((b) => b.l === lo);
  const after = window.slice(loIdx);
  if (after.length < 20) return null;
  const hi = Math.max(...after.map((b) => b.h));
  if (!(hi > lo)) return null;

  return { price: r2(lo + (hi - lo) * 1.618), method: 'fib_extension', basis: `امتداد 1.618 لموجة ${r2(lo)} → ${r2(hi)}` };
}

/**
 * Mid-horizon target (weeks to a few months) plus its ETA.
 */
export function midTermTarget(snapshot, bars, { entry = null, stop = null } = {}, rules = RULES) {
  // Structure is anchored to the MARKET price, never to a planned entry. When
  // the suggested entry is a pullback well below market, anchoring here made the
  // ceiling slide down with it and selected a "target" underneath the current
  // price — ZMID at 9.80 was handed a 9.47 target labelled +28% upside. The
  // entry only ever enters the reward arithmetic, never the level selection.
  const price = snapshot.price.close;
  const atr = snapshot.volatility.atr14;
  const closes = bars.map((b) => b.c);
  const er = efficiencyRatio(closes, 50);

  // A mid-term target has to be reachable in a mid-term horizon. Levels beyond
  // this ceiling are real, but they belong to the long-term projection.
  const ceiling = price * (1 + rules.horizon.midMaxUpsidePct / 100);
  const candidates = [];

  // 1. Structural resistance far enough away to be worth trading toward.
  for (const res of snapshot.levels.resistances) {
    if (res.price > ceiling) break; // sorted ascending — everything past here is too far
    if (res.strength >= 50 && atr && res.price - price >= 1.5 * atr) {
      candidates.push({
        price: res.price,
        method: 'resistance',
        basis: `مقاومة قوية (${res.touches} لمسات، قوة ${res.strength})`,
        priority: 1,
      });
      break;
    }
  }

  // 2. Measured move from a recent breakout.
  const mm = measuredMove(snapshot, bars);
  if (mm && mm.price <= ceiling) candidates.push({ ...mm, priority: 2 });

  // 3. The 52-week high, when it is overhead and reachable.
  const high52 = snapshot.price.high52w;
  if (high52 > price * 1.02 && high52 <= ceiling) {
    candidates.push({ price: high52, method: 'high_52w', basis: 'أعلى سعر في 52 أسبوع', priority: 3 });
  }

  // 4. Volatility projection — last resort when structure is silent or all of it
  //    sits beyond the mid-term ceiling (a stock in blue sky after a big run).
  if (atr) {
    candidates.push({
      price: r2(Math.min(price + atr * 6, ceiling)),
      method: 'atr_projection',
      basis: 'إسقاط تقلب (6× ATR) — لا توجد مقاومة قريبة داخل الأفق المتوسط',
      priority: 4,
    });
  }

  // A target at or below the market is not a target.
  const viable = candidates.filter((c) => c.price > price * 1.005);
  if (!viable.length) return null;
  viable.sort((a, b) => a.priority - b.priority);
  const chosen = viable[0];

  const sessions = estimateSessions(chosen.price - price, atr, er, price);
  const plannedEntry = entry ?? price;
  const rr = stop != null ? riskReward(plannedEntry, stop, chosen.price) : null;

  return {
    price: chosen.price,
    upsidePct: r2(((chosen.price - price) / price) * 100),
    upsideFromEntryPct: r2(((chosen.price - plannedEntry) / plannedEntry) * 100),
    method: chosen.method,
    basis: chosen.basis,
    riskReward: rr,
    meetsMinRR: rr == null ? null : rr >= rules.entry.minRiskReward,
    horizon: describeHorizon(sessions, rules),
    alternatives: viable.slice(1, 3).map((c) => ({ price: c.price, method: c.method })),
  };
}

/**
 * Long-horizon target (6-18 months). Blends a Fibonacci extension with a decayed
 * trend extrapolation, and refuses to project at all for a stock in a downtrend —
 * extrapolating a falling stock upward is how people hold bags.
 */
export function longTermTarget(snapshot, bars, rules = RULES, midPrice = null) {
  const price = snapshot.price.close;
  const atr = snapshot.volatility.atr14;
  const closes = bars.map((b) => b.c);
  const er = efficiencyRatio(closes, 100);

  if (snapshot.trend.score < 0) {
    return {
      price: null,
      note: 'السهم في اتجاه هابط — لا يوجد هدف بعيد حتى ينقلب الاتجاه (إغلاق فوق متوسط 50 و200)',
      horizon: describeHorizon(null, rules),
    };
  }

  const candidates = [];

  const fib = fibExtension(bars);
  if (fib && fib.price > price * 1.05) candidates.push(fib);

  // Trend extrapolation: annualise the 6-month return, then halve it — trends
  // decay, and projecting a full year of recent pace is how targets get silly.
  const m6 = snapshot.returns.m6;
  if (m6 != null && m6 > 0) {
    const projected = price * (1 + (m6 / 100) * 0.5 * 2); // 12 months at half the observed pace
    candidates.push({ price: r2(projected), method: 'trend_extrapolation', basis: `استمرار نصف وتيرة آخر 6 شهور (${m6}%) لمدة سنة` });
  }

  if (!candidates.length) {
    return { price: null, note: 'لا توجد بيانات كافية لهدف بعيد', horizon: describeHorizon(null, rules) };
  }

  // Long-horizon targets should under-promise, so prefer the most conservative
  // candidate — but a long target below the mid target is nonsense, so first
  // discard any candidate the mid target already exceeds. If every candidate
  // falls short, the mid level *is* the ceiling structure gives us, and the
  // honest answer is a modest extension of it rather than a fabricated number.
  const floor = midPrice ? midPrice * 1.05 : 0;
  const viable = candidates.filter((c) => c.price >= floor);

  let chosen;
  if (viable.length) {
    chosen = viable.reduce((a, b) => (b.price < a.price ? b : a));
  } else {
    const best = candidates.reduce((a, b) => (b.price > a.price ? b : a));
    chosen = {
      price: r2(Math.max(best.price, floor)),
      method: 'extended_from_mid',
      basis: `امتداد فوق الهدف المتوسط (${r2(midPrice)}) — المقاومات المعروفة كلها تحته`,
    };
  }

  const sessions = estimateSessions(chosen.price - price, atr, er, price);

  return {
    price: chosen.price,
    upsidePct: r2(((chosen.price - price) / price) * 100),
    method: chosen.method,
    basis: chosen.basis,
    horizon: describeHorizon(sessions, rules),
    alternatives: candidates.filter((c) => c !== chosen).map((c) => ({ price: c.price, method: c.method })),
    caveat: 'الهدف البعيد تقدير اتجاهي — أي كسر للوقف يلغيه.',
  };
}

/**
 * The targets-table estimate, in the original desk's vocabulary.
 *
 * The desk shows a RANGE badge ("2–4 أسابيع") plus a momentum marker, not a
 * single session count. The original derived weeks from a per-sector speed
 * table; this keeps that presentation but drives it from the measured
 * Efficiency-Ratio estimate, falling back to the sector heuristic only when the
 * stock is too choppy for ER to say anything honest. Same visual language,
 * better arithmetic underneath.
 */
const SECTOR_SPEED_PCT_PER_WEEK = {
  energy: 4.5, materials: 4, industrials: 3.5, consumer: 2.5, telecom: 2,
  holding: 1.8, financials: 1.8, banks: 2.5, realestate: 3, tech: 3,
  healthcare: 2.5, tourism: 3, transport: 3, education: 2.5,
};

export function targetEstimate({ price, target, dayChangePct = 0, sector, sessions = null }, rules = RULES) {
  if (!target || target <= price) {
    return { label: 'وصل الهدف 🎯', weeks: 0, note: 'جني أرباح', reached: true };
  }

  const distancePct = ((target - price) / price) * 100;

  let weeks;
  if (sessions != null) {
    weeks = Math.max(1, Math.round(sessions / rules.horizon.sessionsPerWeek));
  } else {
    // Fallback: sector speed, slowed or quickened by today's move.
    const speed = SECTOR_SPEED_PCT_PER_WEEK[sector] ?? 3;
    const momentum =
      dayChangePct > 3 ? 0.75 : dayChangePct > 1 ? 0.9 : dayChangePct < -2 ? 1.35 : dayChangePct < 0 ? 1.15 : 1;
    weeks = Math.max(1, Math.round((distancePct / speed) * momentum));
  }

  const label =
    distancePct <= 2 ? '1–3 جلسات'
    : weeks <= 2 ? '1–2 أسبوع'
    : weeks <= 4 ? '2–4 أسابيع'
    : weeks <= 6 ? '4–6 أسابيع'
    : weeks <= 10 ? '6–10 أسابيع'
    : weeks <= 16 ? '2–4 أشهر'
    : weeks <= 24 ? '4–6 أشهر'
    : '+6 أشهر';

  const note =
    dayChangePct > 3 ? '↑ زخم'
    : dayChangePct < -2 ? '↓ ضغط'
    : distancePct <= 5 ? 'قريب'
    : '';

  return { label, weeks, note, reached: false, distancePct: +distancePct.toFixed(1) };
}

/** Convenience: both targets plus the efficiency reading behind their ETAs. */
export function buildTargets(snapshot, bars, { entry = null, stop = null } = {}, rules = RULES) {
  const closes = bars.map((b) => b.c);
  const mid = midTermTarget(snapshot, bars, { entry, stop }, rules);
  return {
    efficiencyRatio: r2(efficiencyRatio(closes, 50)),
    mid,
    long: longTermTarget(snapshot, bars, rules, mid?.price ?? null),
  };
}
