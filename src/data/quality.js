/**
 * Data-quality gate.
 *
 * Discovered the hard way: Yahoo served ORAS.CA as 489 identical bars at 71.05
 * — ATR zero, every return zero — because the listing was suspended and the
 * feed forward-fills. The engine scored it 44/100 and issued a stop and a
 * position size for a stock that had not traded. Silent bad data is worse than
 * a missing symbol, so every series is checked before it reaches an indicator.
 */

import { cairoToday, isTradingDay } from './cache.js';

export const SEVERITY = { OK: 'ok', WARN: 'warn', FATAL: 'fatal' };

/** Trading days (Sun-Thu) between two ISO dates. */
function tradingDaysBetween(fromIso, toIso) {
  let count = 0;
  const cur = new Date(`${fromIso}T12:00:00Z`);
  const end = new Date(`${toIso}T12:00:00Z`);
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (isTradingDay(cur.toISOString().slice(0, 10))) count++;
  }
  return count;
}

export function checkQuality(bars, { code = '?', maxStaleSessions = 5 } = {}) {
  const issues = [];
  let severity = SEVERITY.OK;

  const fail = (msg) => {
    issues.push({ level: SEVERITY.FATAL, message: msg });
    severity = SEVERITY.FATAL;
  };
  const warn = (msg) => {
    issues.push({ level: SEVERITY.WARN, message: msg });
    if (severity === SEVERITY.OK) severity = SEVERITY.WARN;
  };

  if (!bars?.length) {
    fail('لا توجد بيانات أسعار');
    return { ok: false, severity, issues, code };
  }

  if (bars.length < 60) {
    fail(`تاريخ قصير جدًا (${bars.length} جلسة) — محتاج 60 على الأقل للتحليل الفني`);
  }

  // --- Staleness ---
  const lastDate = bars[bars.length - 1].date;
  const stale = tradingDaysBetween(lastDate, cairoToday());
  if (stale > maxStaleSessions) {
    fail(`آخر بيانات من ${lastDate} — متأخرة ${stale} جلسة، السهم غالبًا موقوف أو مشطوب`);
  } else if (stale > 1) {
    warn(`آخر بيانات من ${lastDate} (${stale} جلسات متأخرة)`);
  }

  // --- Flatlining: the ORAS failure mode ---
  const recent = bars.slice(-60);
  const unchanged = recent.filter((b, i) => i > 0 && b.c === recent[i - 1].c).length;
  const flatShare = unchanged / (recent.length - 1);

  if (flatShare > 0.9) {
    fail(`السعر ثابت في ${Math.round(flatShare * 100)}% من آخر 60 جلسة — البيانات مجمدة، مش تداول حقيقي`);
  } else if (flatShare > 0.5) {
    warn(`السعر ثابت في ${Math.round(flatShare * 100)}% من الجلسات — سيولة ضعيفة جدًا`);
  }

  const distinctCloses = new Set(recent.map((b) => b.c)).size;
  if (distinctCloses <= 2) {
    fail(`آخر 60 جلسة فيها ${distinctCloses} سعر مختلف فقط — بيانات غير صالحة`);
  }

  // --- Dead volume ---
  const zeroVol = recent.filter((b) => !b.v).length;
  if (zeroVol / recent.length > 0.5) {
    warn(`نصف الجلسات تقريبًا بدون حجم تداول مسجّل`);
  }

  // --- Absurd values ---
  if (bars.some((b) => b.c <= 0 || b.h < b.l)) {
    fail('البيانات فيها أسعار غير منطقية (صفر/سالب أو أعلى أقل من أدنى)');
  }

  // --- Unadjusted split artefacts: a >45% single-session gap with no volume spike ---
  for (let i = Math.max(1, bars.length - 250); i < bars.length; i++) {
    const jump = (bars[i].c - bars[i - 1].c) / bars[i - 1].c;
    if (Math.abs(jump) > 0.45) {
      warn(`قفزة ${Math.round(jump * 100)}% يوم ${bars[i].date} — يحتمل تجزئة أسهم غير معدّلة`);
      break;
    }
  }

  return { ok: severity !== SEVERITY.FATAL, severity, issues, code, lastDate, barsCount: bars.length };
}
