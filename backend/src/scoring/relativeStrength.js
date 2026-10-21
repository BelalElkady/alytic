/**
 * R7 — lagging the market. A held stock that has trailed its own index over
 * the last few sessions and closed under its short moving average gets part
 * of the position sold instead of a plain hold.
 *
 * Why: the other rules only act on the stop, the target or a profit
 * threshold, so a position sliding inside its range got "hold" every day
 * until the stop finally broke. In the track record that was the weakest
 * call the app made — trader-style holds trailed their index about four
 * times in five (Sep–Oct 2026), and reduce calls on the same stocks were
 * right almost every time.
 *
 * Judged on completed session closes only, like the stop, so an intraday dip
 * never fires it. Fires once per position: any partial sale already recorded
 * (partialTakenAt) means the position was trimmed, and the stop handles the rest.
 */

import { fetchDailyTV } from '../data/tv-history.js';
import { effectiveIndices } from '../config/indices.js';
import { INDEX_FEEDS, benchmarkFor } from '../recommendations.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));

/** The close of the last index session on or before `date` (bars oldest first). */
function closeOnOrBefore(bars, date) {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date <= date) return bars[i].c > 0 ? bars[i].c : null;
  }
  return null;
}

/**
 * R7 evaluated for one open position. Null when the style has the rule off.
 *
 * @param {object} p
 * @param {Array<{date:string,c:number}>} p.bars - the stock's completed sessions, oldest first
 * @param {{name:string, bars:Array<{date:string,c:number}>}|null} p.index - its benchmark index's daily bars
 * @param {number} p.shares
 * @param {boolean} p.partialTaken - a partial sale is already recorded on this position
 */
export function relativeWeakness({ bars, index, shares, partialTaken }, rules) {
  const cfg = rules.relativeWeakness;
  if (!cfg?.enabled) return null;
  const base = {
    lookbackSessions: cfg.lookbackSessions,
    maPeriod: cfg.maPeriod,
    minLagPts: cfg.minLagPts,
    fractionPct: r2(cfg.sellFraction * 100),
    benchmark: index?.name ?? null,
    alreadyTrimmed: partialTaken,
  };
  const need = Math.max(cfg.lookbackSessions, cfg.maPeriod) + 1;
  if (!(bars?.length >= need)) return { ...base, available: false, fired: false, reason: 'not enough sessions' };

  const last = bars[bars.length - 1];
  const from = bars[bars.length - 1 - cfg.lookbackSessions];
  const indexNow = index?.bars?.length ? closeOnOrBefore(index.bars, last.date) : null;
  const indexFrom = index?.bars?.length ? closeOnOrBefore(index.bars, from.date) : null;
  if (!indexNow || !indexFrom) return { ...base, available: false, fired: false, reason: 'no index history' };

  const stockPct = (last.c / from.c - 1) * 100;
  const indexPct = (indexNow / indexFrom - 1) * 100;
  const lagPts = stockPct - indexPct;
  const ma = bars.slice(-cfg.maPeriod).reduce((s, b) => s + b.c, 0) / cfg.maPeriod;
  const belowMa = last.c < ma;
  const qty = Math.round(shares * cfg.sellFraction);

  return {
    ...base,
    available: true,
    stockPct: r2(stockPct),
    indexPct: r2(indexPct),
    lagPts: r2(lagPts),
    ma: r2(ma),
    close: r2(last.c),
    belowMa,
    qty,
    remainingShares: shares - qty,
    fired: lagPts <= -cfg.minLagPts && belowMa && !partialTaken && qty >= 1 && qty < shares,
  };
}

const HISTORY_TTL_MS = 30 * 60_000;
const historyMemo = new Map();
let membershipMemo = { at: 0, value: null };

/**
 * The daily bars of the index a stock is measured against (EGX30, EGX70 or
 * EGX100 by membership — the same benchmark the track record scores it by),
 * cached for half an hour. Null when the feed fails: R7 then shows as
 * unavailable rather than failing the analysis.
 */
export async function benchmarkHistory(code) {
  try {
    if (Date.now() - membershipMemo.at > 10 * 60_000 || !membershipMemo.value) {
      membershipMemo = { at: Date.now(), value: await effectiveIndices() };
    }
    const name = benchmarkFor(code, membershipMemo.value);
    const hit = historyMemo.get(name);
    if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return { name, bars: hit.bars };
    const { bars } = await fetchDailyTV(INDEX_FEEDS[name], { bars: 60 });
    historyMemo.set(name, { at: Date.now(), bars });
    return { name, bars };
  } catch (err) {
    console.warn(`[relative-strength] index history for ${code} failed:`, err.message);
    return null;
  }
}
