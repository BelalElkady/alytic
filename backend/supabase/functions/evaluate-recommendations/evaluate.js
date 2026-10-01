/**
 * The resolution rules for one recommendation — pure, no I/O, so the Edge
 * Function (index.ts, Deno) and the backend's unit tests (Node) run the same
 * code.
 *
 * A call is walked session by session, starting with the first session after
 * the day it was issued:
 *   - stop breached by a CLOSE (close ≤ stop for a buy) → hit_stop, filled at
 *     the next session's open. That is the rule the product gives its users
 *     ("a close under the stop is a full exit, sell at the open"), so an
 *     intraday dip that recovers by the close is not a loss. Until that next
 *     session is recorded the call stays open. A session that closes under
 *     the stop and also touched the target counts as the stop: daily bars
 *     can't say which came first, and the record should never flatter itself.
 *   - target touched (high ≥ target, or low ≤ target for sell/reduce)
 *     → hit_target.
 *   - neither, and the session count reaches horizon_days → expired, at that
 *     session's close.
 * A session that opens beyond the target fills at the open, not at the target.
 *
 * A hold carries no stop or target: it tells an existing holder to keep the
 * position, not to enter one, so it is only ever judged at the horizon
 * against its benchmark (isWin in src/recommendations.js). Holds logged
 * before that rule may still carry levels; they are ignored here.
 *
 * Sell and reduce are scored as short calls: their return is the fall in
 * price. Excess return is measured over the same span, in the same
 * direction, against each of the four indices (index_excess, keyed by
 * index), against the call's own benchmark chosen at issue — EGX30, EGX70 or
 * EGX100 by the stock's membership (benchmark_excess_pct) — and, as its own
 * column, against EGX30 (excess_return_pct). An index is left out, or the
 * column null, when either end of it is missing.
 */

const LONG_ACTIONS = new Set(['buy', 'hold']);
const INDICES = ['EGX30', 'EGX70', 'EGX33', 'EGX100'];

export const directionOf = (action) => (LONG_ACTIONS.has(action) ? 1 : -1);

const round = (x, digits) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

const num = (x) => (x == null || x === '' ? null : Number(x));

/** An index's level when the call was issued. Calls logged before indices_at_issue existed only carry EGX30. */
function issueLevel(rec, index) {
  const level = num(rec.indices_at_issue?.[index]);
  if (level > 0) return level;
  return index === 'EGX30' ? num(rec.egx30_at_issue) : null;
}

/** An index's move from the call's issue level to `date`'s close, in percent — null when either side is missing. */
function indexMovePct(rec, indexCloses, index, date) {
  if (!index) return null;
  const from = issueLevel(rec, index);
  const to = indexCloses.get(index)?.get(date);
  if (!(from > 0) || !(to > 0)) return null;
  return (to / from - 1) * 100;
}

/**
 * What actually happened to the stock over the call's horizon, ignoring the
 * target and stop: its close at the horizon's last session (or at the latest
 * session while the horizon runs) against the reference price. Tracked on
 * after the call itself closes, and final once that last session is in.
 *
 * @param {object} rec - a recommendations row
 * @param {Array<{date:string, close:number}>} bars - the stock's sessions strictly after rec.issued_on, oldest first
 * @returns {object|null} the stock_move_* columns, or null with no session to judge by
 */
export function evaluateStockMove(rec, bars) {
  if (!bars.length) return null;
  const horizon = Number(rec.horizon_days);
  const sessions = Math.min(horizon, bars.length);
  const close = num(bars[sessions - 1].close);
  return {
    stock_move_price: round(close, 4),
    stock_move_pct: round((close / num(rec.ref_price) - 1) * 100, 2),
    stock_move_sessions: sessions,
    stock_move_final: bars.length >= horizon,
  };
}

/** The close of the session for `date`, as a timestamp — 14:30 Cairo is 12:30 UTC in winter (11:30 in summer); near enough for "closed on". */
export const sessionCloseAt = (date) => `${date}T12:30:00Z`;

/**
 * @param {object} rec - a recommendations row (numeric columns may arrive as strings)
 * @param {Array<{date:string, open:number|null, high:number, low:number, close:number}>} bars
 *   the stock's sessions strictly after rec.issued_on, oldest first
 * @param {Map<string, Map<string, number>>} indexCloses - per index ('EGX30', 'EGX70', 'EGX33', 'EGX100'), its close per session date
 * @returns {object|null} the columns to write, or null when there is no new session to judge by
 */
export function evaluateRecommendation(rec, bars, indexCloses) {
  if (!bars.length) return null;

  const dir = directionOf(rec.action);
  const ref = num(rec.ref_price);
  const levelled = rec.action !== 'hold';
  const target = levelled ? num(rec.target_price) : null;
  const stop = levelled ? num(rec.stop_price) : null;
  const horizon = Number(rec.horizon_days);

  const returnAt = (price) => round(dir * (price / ref - 1) * 100, 2);
  const excessOver = (index, ret, date) => {
    const move = indexMovePct(rec, indexCloses, index, date);
    return move == null ? null : round(ret - dir * move, 2);
  };
  const excessAt = (ret, date) => {
    const byIndex = {};
    for (const index of INDICES) {
      const excess = excessOver(index, ret, date);
      if (excess != null) byIndex[index] = excess;
    }
    return {
      egx30: byIndex.EGX30 ?? null,
      benchmark: rec.benchmark ? (byIndex[rec.benchmark] ?? null) : null,
      byIndex: Object.keys(byIndex).length ? byIndex : null,
    };
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const open = num(bar.open);
    const high = num(bar.high);
    const low = num(bar.low);
    const close = num(bar.close);

    const stopBreached = stop != null && (dir > 0 ? close <= stop : close >= stop);
    const targetHit = target != null && (dir > 0 ? high >= target : low <= target);

    // The session the call closes on, and the price it closes at.
    let status = null;
    let exit = null;
    let at = bar;
    let sessions = i + 1;
    if (stopBreached) {
      // Filled at the next session's open; not recorded yet → stay open.
      const next = bars[i + 1];
      if (!next) break;
      status = 'hit_stop';
      at = next;
      sessions = i + 2;
      exit = num(next.open) ?? close;
    } else if (targetHit) {
      status = 'hit_target';
      exit = open == null ? target : dir > 0 ? Math.max(target, open) : Math.min(target, open);
    } else if (sessions >= horizon) {
      status = 'expired';
      exit = close;
    }

    if (status) {
      const ret = returnAt(exit);
      const excess = excessAt(ret, at.date);
      return {
        status,
        closed_at: sessionCloseAt(at.date),
        exit_price: round(exit, 4),
        return_pct: ret,
        excess_return_pct: excess.egx30,
        benchmark_excess_pct: excess.benchmark,
        index_excess: excess.byIndex,
        sessions_elapsed: sessions,
        mark_price: round(exit, 4),
        mark_return_pct: ret,
        mark_excess_return_pct: excess.egx30,
        mark_benchmark_excess_pct: excess.benchmark,
        mark_index_excess: excess.byIndex,
      };
    }
  }

  const last = bars[bars.length - 1];
  const markRet = returnAt(num(last.close));
  const markExcess = excessAt(markRet, last.date);
  return {
    status: 'open',
    sessions_elapsed: bars.length,
    mark_price: round(num(last.close), 4),
    mark_return_pct: markRet,
    mark_excess_return_pct: markExcess.egx30,
    mark_benchmark_excess_pct: markExcess.benchmark,
    mark_index_excess: markExcess.byIndex,
  };
}
