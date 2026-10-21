/**
 * The resolution rules for one recommendation — pure, no I/O, so the Edge
 * Function (index.ts, Deno) and the backend's unit tests (Node) run the same
 * code.
 *
 * A call is walked session by session, starting with the first session after
 * the day it was issued, and scored the way the app tells a User to manage it
 * (R1 and R3 in src/agent/prompts/system.js), per its Investing style
 * (STYLE_RULES):
 *   - stop breached by CLOSES (close ≤ stop for a buy; two closes in a row
 *     for the long style, one otherwise) → hit_stop, filled at the next
 *     session's open. An intraday dip that recovers by the close is not a
 *     loss. Until that next session is recorded the call stays open. A
 *     session that closes under the stop never also banks the target: daily
 *     bars can't say which came first, and the record should never flatter
 *     itself.
 *   - target touched (high ≥ target) on a buy → the style's share is sold
 *     there (half, a third or a quarter) and the stop on the rest is raised
 *     to 4, 8 or 12% under that price. The rest then runs to that stop or to
 *     the horizon, and the call closes as hit_target with the two parts'
 *     blended return (target_sessions: the session the target printed). The
 *     new, higher target the app would set after is not followed, and
 *     neither is the trailing stop or the fundamental-hold exception.
 *   - target touched on a sell/reduce (low ≤ target) → hit_target, in full.
 *   - neither, and the session count reaches horizon_days → expired, at that
 *     session's close.
 * A session that opens beyond the target fills at the open, not at the target.
 *
 * A split, bonus issue or reverse split moves a stock's price in one session
 * without any money moving, and the call's prices (reference, target, stop)
 * are still on the old basis. A session whose close is more than a fifth away
 * from the one before it (the call's reference price, for the first session)
 * is beyond what EGX's daily limit allows a real move to be, so the call's
 * prices are rebased to the new basis from that session on — see basisFactors
 * — and the corporate action never reads as a stop-out or a crash. The call is
 * then measured from that session's close: the move across the action itself
 * is left out, not guessed.
 *
 * A hold carries no target: it tells an existing holder to keep the
 * position, not to enter one, so it is judged at the horizon against its
 * benchmark (isWin in src/recommendations.js). From scoring_version 4 it
 * carries the position's own stop, the "close under X = full exit" the app
 * gives with it, and closes there as hit_stop the way a buy does — the record
 * then books what a holder following the advice lost, not the whole fall to
 * the horizon. Holds logged before version 4 may still carry levels from an
 * older rule; they are ignored here.
 *
 * Sell and reduce are scored as short calls: their return is the fall in
 * price. They may carry a fall target (a support below the price) and are
 * won the moment a session's low reaches it, but never a stop. Excess return is measured over the same span, in the same
 * direction, against each of the four indices (index_excess, keyed by
 * index), against the call's own benchmark chosen at issue — EGX30, EGX70 or
 * EGX100 by the stock's membership (benchmark_excess_pct) — and, as its own
 * column, against EGX30 (excess_return_pct). An index is left out, or the
 * column null, when either end of it is missing.
 */

const LONG_ACTIONS = new Set(['buy', 'hold']);
/** The scoring_version from which a hold is closed by its stop (see the header). */
export const HOLD_STOP_SCORING = 4;
const INDICES = ['EGX30', 'EGX70', 'EGX33', 'EGX100'];

export const directionOf = (action) => (LONG_ACTIONS.has(action) ? 1 : -1);

/**
 * How the app manages a bought Position, per Investing style: the closes in a
 * row under the stop that make it an exit (stop.confirmCloses), the share sold
 * when the target prints (takeProfit.atTargetFraction) and how far under that
 * price the stop on the rest goes (takeProfit.raiseStopAfterTargetPct).
 * Copied from src/config (rules.js + styles.js), not imported: the Edge
 * Function only ships this folder. A unit test keeps the two in step.
 */
export const STYLE_RULES = {
  trader: { confirmCloses: 1, atTargetFraction: 0.5, raiseStopAfterTargetPct: 4 },
  medium: { confirmCloses: 1, atTargetFraction: 1 / 3, raiseStopAfterTargetPct: 8 },
  long: { confirmCloses: 2, atTargetFraction: 0.25, raiseStopAfterTargetPct: 12 },
};
// A call logged without a style gets the default one (DEFAULT_STYLE in src/config/styles.js).
const styleRules = (style) => STYLE_RULES[style] ?? STYLE_RULES.medium;

const round = (x, digits) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

const num = (x) => (x == null || x === '' ? null : Number(x));

/** A one-session move beyond this, either way, is a corporate action, not a price move. */
const BASIS_BREAK_LOW = 0.8;
const BASIS_BREAK_HIGH = 1.25;

/**
 * How much to scale the call's own prices (reference, target, stop) by when
 * judging each session, so they stay on the basis that session trades on:
 * factors[i] applies to bars[i]. 1 until a session breaks from the one before
 * it (the reference price before the first); from then on it carries that
 * session's raw close ratio.
 *
 * The ratio is deliberately NOT snapped to a "nice" split ratio. The break
 * session's own move, and any session the feed skipped or left on the old
 * basis, is mixed into it and cannot be separated from the action by the
 * bars alone: POUL's 3-for-1 split read as 0.254 here, because the feed's
 * bar for the ex-date was stale and two limit-down sessions were folded into
 * the next one, and snapping that to 1/4 would have invented a 25% error.
 * Taking the ratio as it is measures the call from the break session's close
 * on — the move across the action itself is left out, not guessed.
 *
 * @param {number} ref - the call's reference price
 * @param {Array<{close:number}>} bars - sessions after the call, oldest first
 * @returns {number[]} one factor per bar
 */
export function basisFactors(ref, bars) {
  const factors = [];
  let factor = 1;
  let prev = ref;
  for (const bar of bars) {
    const close = num(bar.close);
    if (prev > 0 && close > 0) {
      // Consecutive closes share a basis, so their ratio is the session's own
      // move; only the first session compares against the call's reference price.
      const ratio = close / prev;
      if (ratio < BASIS_BREAK_LOW || ratio > BASIS_BREAK_HIGH) factor *= ratio;
    }
    factors.push(factor);
    if (close > 0) prev = close;
  }
  return factors;
}

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
  const factor = basisFactors(num(rec.ref_price), bars)[sessions - 1];
  return {
    stock_move_price: round(close, 4),
    stock_move_pct: round((close / (num(rec.ref_price) * factor) - 1) * 100, 2),
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
  const baseTarget = levelled ? num(rec.target_price) : null;
  const horizon = Number(rec.horizon_days);
  const style = styleRules(rec.style);
  // A buy is managed like the Position it opens: part sold at the target, the
  // rest kept under a raised stop. Sell and reduce exit in full at theirs.
  const scalesOut = rec.action === 'buy';
  // The call's prices on the basis each session trades on (see basisFactors).
  const factors = basisFactors(ref, bars);
  // The stop on the call's own basis; raised once the target banks part.
  const holdStop = rec.action === 'hold' && Number(rec.scoring_version) >= HOLD_STOP_SCORING;
  let baseStop = levelled || holdStop ? num(rec.stop_price) : null;
  let closesUnder = 0;
  // The part sold at the target: its fraction, return, excess and session count.
  let banked = null;

  const returnAt = (price, factor) => round(dir * (price / (ref * factor) - 1) * 100, 2);
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

  // The whole call's return and excess when the rest is at `price` on `date`:
  // the part banked at the target and the rest, each weighted by its size.
  const blended = (price, factor, date) => {
    const ret = returnAt(price, factor);
    const excess = excessAt(ret, date);
    if (!banked) return { ret, excess };
    const f = banked.fraction;
    const mix = (a, b) => (a == null || b == null ? null : round(f * a + (1 - f) * b, 2));
    const byIndex = {};
    for (const index of INDICES) {
      const x = mix(banked.excess.byIndex?.[index], excess.byIndex?.[index]);
      if (x != null) byIndex[index] = x;
    }
    return {
      ret: mix(banked.ret, ret),
      excess: {
        egx30: mix(banked.excess.egx30, excess.egx30),
        benchmark: mix(banked.excess.benchmark, excess.benchmark),
        byIndex: Object.keys(byIndex).length ? byIndex : null,
      },
    };
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const open = num(bar.open);
    const high = num(bar.high);
    const low = num(bar.low);
    const close = num(bar.close);

    const target = baseTarget == null || banked ? null : baseTarget * factors[i];
    const stop = baseStop == null ? null : baseStop * factors[i];
    const closedPastStop = stop != null && (dir > 0 ? close <= stop : close >= stop);
    closesUnder = closedPastStop ? closesUnder + 1 : 0;
    const stopFired = closedPastStop && closesUnder >= style.confirmCloses;
    // A session that closes past the stop never banks the target: daily bars
    // can't say which came first, and the record should never flatter itself.
    const targetHit = !closedPastStop && target != null && (dir > 0 ? high >= target : low <= target);

    // The session the call closes on, and the price the rest leaves at.
    let status = null;
    let exit = null;
    let at = bar;
    let atFactor = factors[i];
    let sessions = i + 1;
    if (stopFired) {
      // Filled at the next session's open; not recorded yet → stay open.
      const next = bars[i + 1];
      if (!next) break;
      status = 'hit_stop';
      at = next;
      atFactor = factors[i + 1];
      sessions = i + 2;
      exit = num(next.open) ?? close;
    } else if (targetHit) {
      const fill = open == null ? target : dir > 0 ? Math.max(target, open) : Math.min(target, open);
      if (scalesOut) {
        // Sell the style's share here; the rest runs under a stop raised under the fill.
        const ret = returnAt(fill, factors[i]);
        banked = { fraction: style.atTargetFraction, ret, excess: excessAt(ret, bar.date), sessions };
        const raised = (fill * (1 - style.raiseStopAfterTargetPct / 100)) / factors[i];
        baseStop = baseStop == null ? raised : Math.max(baseStop, raised);
        closesUnder = 0;
        if (sessions >= horizon) {
          status = 'expired';
          exit = close;
        }
      } else {
        status = 'hit_target';
        exit = fill;
      }
    } else if (sessions >= horizon) {
      status = 'expired';
      exit = close;
    }

    if (status) {
      const { ret, excess } = blended(exit, atFactor, at.date);
      // The price the whole call left at on average, on the closing session's basis.
      const exitPrice = banked ? ref * atFactor * (1 + (dir * ret) / 100) : exit;
      return {
        // Reaching the target decides the label; whether it was a win is the blended return.
        status: banked ? 'hit_target' : status,
        closed_at: sessionCloseAt(at.date),
        exit_price: round(exitPrice, 4),
        return_pct: ret,
        excess_return_pct: excess.egx30,
        benchmark_excess_pct: excess.benchmark,
        index_excess: excess.byIndex,
        sessions_elapsed: sessions,
        target_sessions: banked ? banked.sessions : status === 'hit_target' ? sessions : null,
        mark_price: round(exitPrice, 4),
        mark_return_pct: ret,
        mark_excess_return_pct: excess.egx30,
        mark_benchmark_excess_pct: excess.benchmark,
        mark_index_excess: excess.byIndex,
      };
    }
  }

  const last = bars[bars.length - 1];
  const mark = blended(num(last.close), factors[factors.length - 1], last.date);
  return {
    status: 'open',
    sessions_elapsed: bars.length,
    target_sessions: banked ? banked.sessions : null,
    mark_price: round(num(last.close), 4),
    mark_return_pct: mark.ret,
    mark_excess_return_pct: mark.excess.egx30,
    mark_benchmark_excess_pct: mark.excess.benchmark,
    mark_index_excess: mark.excess.byIndex,
  };
}
