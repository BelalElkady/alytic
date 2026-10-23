/**
 * The analyst agent.
 *
 * Takes the deterministic analysis from `src/analyze.js` and produces judgment:
 * which conflicting signal wins, whether a setup is worth taking today, and the
 * exact order to place — written in Egyptian Arabic.
 *
 * The model receives a compact *brief*, not the raw analysis object. Feeding it
 * the full JSON would cost several thousand tokens per stock and bury the
 * decision-relevant facts among indicator plumbing. The brief is also the
 * audit trail: whatever the analyst says, it was working from exactly this.
 */

import { MODEL_CHAIN, requestStructuredOR } from './clientOpenRouter.js';
import { PortfolioReviewSchema, StockVerdictSchema } from './schemas.js';
import { analystSystemPrompt } from './prompts/system.js';
import { crossCheckIndicators } from './crosscheck.js';
import { attachRuleChecks } from './ruleCheck.js';
import RULES from '../config/rules.js';
import { portfolioStructure, portfolioClassificationSummary } from '../scoring/portfolio.js';
import { DEFAULT_STYLE } from '../config/styles.js';
import { portfolioHash } from '../portfolio.js';
import { getPortfolioReview, putPortfolioReview } from '../db.js';

/**
 * Client-side tool: an independent recomputation of RSI/MACD/Bollinger from a
 * second data source (yfinance) and a second implementation (pandas), run via
 * `scripts/cross_check_indicators.py`. It exists to catch "the engine's own
 * number is stale or wrong" — never to hand the model an alternate number to
 * prefer. A real discrepancy belongs in `conflictNoted` or `riskFlags`; it
 * must never change a stop, target or quantity, which stay the engine's alone.
 */
export const crossCheckTool = {
  name: 'cross_check_indicators',
  description:
    'Returns RSI(14), MACD(12,26,9) and Bollinger(20,2) for one ticker from a data source and calculation library completely ' +
    "separate from the app's engine (yfinance + pandas instead of the app's Yahoo data and internal engine). Use it only when " +
    'you genuinely doubt a number in the brief is right or stale, or it looks internally inconsistent — not as a routine check ' +
    'on every stock. The result is comparison information only; the stop, target and quantity computed in the brief always ' +
    'govern the decision, even if they differ from this tool.',
  input_schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'EGX ticker code, e.g. COMI' },
    },
    required: ['code'],
  },
  handler: async ({ code }) => crossCheckIndicators(code),
};

const n = (x, unit = '') => (x == null ? 'n/a' : `${x}${unit}`);

/** A holding within this much of its stop is close enough to warrant a look. */
const NEAR_STOP_PCT = 5;

/**
 * Does this holding actually have a decision in it today?
 *
 * True when a mechanical trigger has fired, the stop is close, the trailing
 * stop just moved, or the share count is a screenshot estimate the user still
 * needs to confirm. Everything else is a position sitting inside its range,
 * where the honest verdict is "no change" — and paying a model to reach that
 * conclusion, with research attached, is the bulk of what a review costs on a
 * large book.
 */
function needsDecision(analysis) {
  const p = analysis.position;
  if (!p) return false;
  // Only triggers that demand an action count. `canAverageDown` is deliberately
  // excluded: it is a standing permission ("the rules would allow adding"),
  // true on every quiet day a position sits at a small loss inside an uptrend,
  // so treating it as news sends most of the book to the model for nothing.
  if (p.triggers?.exitOnStop || p.triggers?.takePartial || p.triggers?.atTarget || p.triggers?.trimOnWeakness) return true;
  if (p.stopBreached || p.stopWarning) return true;
  if ((p.distanceToStopPct ?? 99) <= NEAR_STOP_PCT) return true;
  if (p.trailing?.moved) return true;
  if (p.sharesEstimated) return true;
  return false;
}

/**
 * The verdict a quiet holding gets without involving the model. Deliberately
 * plain: it states the position is inside its range and names the stop that
 * would change that, using only numbers the engine already computed.
 */
function quietVerdict(analysis, weight = null) {
  const p = analysis.position;
  const plPct = p.unrealizedPct;
  return {
    code: analysis.code,
    action: 'hold',
    conviction: 'متوسطة',
    headline: 'مفيش جديد — المركز داخل نطاقه',
    reasoning:
      `${plPct >= 0 ? 'مربح' : 'خاسر'} ${Math.abs(plPct)}% ومحصلش أي مشغّل ميكانيكي: ` +
      `لا الوقف ${p.stop} اتكسر، ولا الهدف اتحقق، ولا السعر قرب من الوقف. ` +
      'المراجعة التفصيلية اتوفرت للأسهم اللي فيها قرار فعلي النهاردة.',
    // Same shape as a researched verdict so consumers never branch on depth.
    stockView: `التقييم الفني الآلي ${analysis.technical?.score ?? '—'}/100 (${analysis.technical?.signal?.ar ?? '—'}) — من غير مراجعة تفصيلية النهاردة.`,
    portfolioView: weight
      ? `وزنه ${weight.pctOfCapital}% من رأس المال في قطاع ${weight.sector}؛ ما اتغيرش وما استدعاش إعادة نظر.`
      : 'وزنه في المحفظة ما اتغيرش النهاردة.',
    positionSizing: {
      currentPct: weight?.pctOfCapital ?? null,
      recommendedPct: 'زي ما هو',
      rationale: 'مفيش مشغّل يستدعي تغيير الحجم.',
    },
    betterAlternative: null,
    conflictNoted: null,
    orderInstruction: null,
    invalidation: `إغلاق تحت ${p.stop} يبقى خروج كامل.`,
    timingNote: 'مفيش إجراء مطلوب دلوقتي.',
    riskFlags: [],
    externalContext: [],
    scenarios: null,
    reentryPlan: null,
    reviewDepth: 'quiet',
  };
}

/**
 * The active style's rules evaluated for one held position (analyze.js
 * buildRuleBook), in the same order the system prompt applies them. Every
 * quantity and price the verdict may quote for this position is on these lines.
 */
function ruleBookLines(ps, price) {
  const rb = ps.ruleBook;
  const mark = (on) => (on ? 'FIRED' : 'not fired');
  const pp = rb.partialProfit;
  const tg = rb.target;
  const ad = rb.averagingDown;
  // When a suggested level is already at or below the current stop, the
  // ratchet-only guarantee keeps the current one — say so instead of
  // attributing that level to a formula.
  const stopNote = (level) =>
    level <= rb.stop.level ? `stop stays at ${rb.stop.level}` : `stop to ${level} (${n(+(((price - level) / price) * 100).toFixed(2))}% under ${price})`;
  const out = ['  **Rule book (this style, evaluated — quote these numbers, never derive others):**'];

  out.push(
    `  R1 Stop on ${rb.stop.honorOn}: level ${rb.stop.level}, price ${price} is ${rb.stop.distancePct}% above it → ${mark(rb.stop.fired)}` +
      (rb.stop.fired ? ` | order: sell all ${rb.stop.sellQty} shares at market next open` : ''),
  );
  if (rb.stop.warning) {
    out.push(
      `  R1 confirmation — this style needs ${rb.stop.warning.needed} closes in a row under the stop before it is an exit; ` +
        `only ${rb.stop.warning.closesUnder} so far. R1 is NOT fired: the verdict is hold, and the next session's close decides. ` +
        `Do not recommend selling on this one close; say what the next close must do (back above ${rb.stop.level} keeps the position, another under it exits).`,
    );
  }
  const fh = rb.stop.fundamentalHold;
  if (fh?.eligible) {
    out.push(
      `  R1 fundamental-hold options — AVAILABLE (investment score ${fh.investmentScore}, long-term trend intact). Two ways to use it, both under "When the stop breaks on a strong business":`,
    );
    if (fh.holdThrough) {
      out.push(
        `    (a) HOLD THROUGH — keep all shares; the long-term stop ${fh.holdThrough.stop} (${fh.holdThrough.riskPct}% under ${price}) binds instead of ${rb.stop.level}; ` +
          `${fh.holdThrough.sessionsUnder} close(s) under the tactical stop so far, ${fh.holdThrough.sessionsLeft} more allowed (limit ${fh.holdThrough.maxSessionsUnder}) before the full exit stands.`,
      );
    }
    out.push(
      `    ${fh.holdThrough ? '(b)' : '(a)'} KEEP A CORE — sell ${fh.sellQty} shares at market next open, keep ${fh.keepQty} (${fh.keepPct}%) under the long-term stop ${fh.coreStop} ` +
        `(${fh.coreStopRiskPct}% under ${price}, a close below it exits the core).`,
    );
  } else if (fh) {
    out.push(`  R1 fundamental-hold options — NOT available: ${fh.blockers.join('; ')}. The full exit stands.`);
  }
  out.push(
    `  R2 Stop-loss (AI-determined per style, ratchets up only — never moves down): current level ${rb.stop.level}` +
      (rb.trailing.moved ? `, raised today from ${rb.trailing.from} to ${rb.stop.level}` : ' (unchanged today)') +
      (rb.trailing.raisedLive ? ' — re-set upward against the live price during this session' : '') +
      (rb.trailing.peak != null ? ` | peak since entry ${rb.trailing.peak}` : ''),
  );
  out.push(
    `  R3 Target (${tg.horizon}-term) ${tg.level ?? 'n/a'} → ${mark(tg.fired)}` +
      (tg.level != null
        ? ` | if fired: sell ${tg.fractionPct}% = ${tg.qty} of ${ps.shares} shares, keep ${tg.remainingShares}, ${stopNote(tg.raisedStop)}`
        : '') +
      // Once the price passes a target a new one is set for what is kept.
      (tg.next != null ? ` | new target for the remainder: ${tg.next}` : ''),
  );
  out.push(
    `  R4 Partial profit at +${pp.thresholdPct}%: profit ${ps.unrealizedPct}% → ` +
      (pp.alreadyTaken ? 'already taken on this position — does not fire again' : mark(pp.fired)) +
      ` | if fired: sell ${pp.fractionPct}% = ${pp.qty} of ${ps.shares} shares, limit ${pp.limitPrice} (+${pp.limitAbovePricePct}% above ${price}), ` +
      `≈ ${pp.proceedsEgp} EGP, keep ${pp.remainingShares} shares, trailing ${stopNote(pp.remainingStop)}`,
  );
  const rw = rb.relativeWeakness;
  if (rw) {
    out.push(
      `  R7 Lagging the market (${rw.lookbackSessions} sessions vs ${rw.benchmark ?? 'its index'}, at least ${rw.minLagPts} pts behind AND close under the ${rw.maPeriod}-day average): ` +
        (!rw.available
          ? `not evaluated (${rw.reason}) → not fired`
          : `stock ${rw.stockPct}% vs index ${rw.indexPct}% = ${rw.lagPts} pts, close ${rw.close} vs ${rw.maPeriod}-day average ${rw.ma} → ` +
            (rw.alreadyTrimmed ? 'position already trimmed — does not fire again' : mark(rw.fired)) +
            ` | if fired: sell ${rw.fractionPct}% = ${rw.qty} of ${ps.shares} shares at market next open, keep ${rw.remainingShares} under the current stop ${rb.stop.level}`),
    );
  }
  out.push(
    `  R5 Averaging down (leaders only: loss, trend score > ${ad.trendScoreMin}, above SMA200, max ${ad.maxAdds} add): ` +
      `trend score ${ad.trendScore}, vs SMA200 ${ad.priceVsSma200Pct ?? 'n/a'}% → ${ad.allowed ? mark(ad.fired) : 'disabled'}`,
  );
  out.push(
    `  R6 Entry/size limits: min reward/risk ${rb.entry.minRiskReward} (from here: ${ps.riskRewardFromHere ?? 'n/a'}) · ` +
      `risk per trade ${rb.entry.riskPerTradePct}% · max position ${rb.entry.maxPositionPct}%`,
  );
  return out.join('\n');
}

/**
 * Render one analysis as a compact, decision-focused brief.
 *
 * The scaffolding — labels, connectors, fallback words — is English. Values
 * that come straight from the deterministic engine (trend label, signal text,
 * target basis/horizon, entry/stop notes, sector name) stay in whatever
 * language the engine produced them in, currently Arabic, because those exact
 * strings are also what the UI renders — translating them here would be a UI
 * change, not a prompt change. The result reads as English scaffolding around
 * Arabic engine phrases; that split is deliberate.
 */
export function briefFor(a) {
  const s = a.snapshot;
  const t = a.technical;
  const p = a.plan;
  const lines = [];

  // An open position's snapshot carries the LIVE quote as price.close, with the
  // last completed close kept in dailyClose (analyze.js). Every level-to-price
  // distance below is measured from that price here — the engine's own
  // distancePct/upsidePct fields were computed off the daily close and would
  // disagree with the price the verdict is about. Plain arithmetic on engine
  // numbers, so the model still never derives one itself.
  const price = s.price.close;
  const isLive = s.price.dailyClose != null;
  const away = (level) => +(((level - price) / price) * 100).toFixed(2);
  const signed = (x) => `${x >= 0 ? '+' : ''}${x}`;

  lines.push(`### ${a.code} — ${a.name} (${a.sectorAr ?? '?'})`);
  lines.push(`Price data: daily bars through ${a.asOf ?? s.meta?.asOf ?? 'n/a'}${isLive ? ', plus a live quote' : ''}`);
  if (a.halted) {
    lines.push(
      `TRADING HALTED: no trade since ${a.halted.since} — the stock is suspended or not trading. No order can be filled until it reopens: ` +
        'the verdict is hold (for a holding) or wait (otherwise), with no order instruction, and says the stock is suspended.',
    );
  }
  if (a.corporateAction) {
    const ca = a.corporateAction;
    lines.push(
      `CORPORATE ACTION: the share basis changed after ${ca.lastBefore} (${ca.kind ?? 'bonus shares / split / merger'}, ` +
        `${ca.factor.toFixed(4)} shares per old share${ca.status === 'suspected' ? ', ratio not yet confirmed' : ''})` +
        `${ca.summary ? ` — ${ca.summary}` : ''}. Every price, level and the position below is already on the new basis. ` +
        'The price drop by that ratio is NOT a market move and NOT a stop break — never recommend selling or exiting because of it.',
    );
  }
  lines.push(
    `Price ${price} EGP${isLive ? ` — LIVE now (last completed close ${s.price.dailyClose})` : ''} (${signed(s.price.changePct)}% today) | ` +
      `from 52w high ${s.price.high52w ? away(s.price.high52w) : s.price.pctFrom52wHigh}% · 52w low ${n(s.price.low52w)} | ` +
      `returns 1w ${n(s.returns.w1, '%')} · 1m ${n(s.returns.m1, '%')} · 3m ${n(s.returns.m3, '%')} · 6m ${n(s.returns.m6, '%')} · 1y ${n(s.returns.y1, '%')} | ` +
      `max drawdown 1y ${n(s.returns.maxDrawdown, '%')}`,
  );
  lines.push(
    `Trend: ${s.trend.label} (${s.trend.score}/100) | ${s.strength.trendQuality} (ADX ${n(s.strength.adx)}) | ` +
      `+DI ${n(s.strength.plusDI)} / −DI ${n(s.strength.minusDI)}`,
  );
  // Price-vs-average distances are the engine's, so the model never has to
  // compare a raw average to the price itself.
  const ma = s.movingAverages;
  lines.push(
    `MAs: 20=${n(ma.sma20)} (${n(ma.priceVsSma20Pct, '%')}) · 50=${n(ma.sma50)} (${n(ma.priceVsSma50Pct, '%')}) · ` +
      `200=${n(ma.sma200)} (${n(ma.priceVsSma200Pct, '%')}) — price vs each, off the last close` +
      (ma.goldenCross == null ? '' : ` | 50 ${ma.goldenCross ? 'above' : 'below'} 200`),
  );
  lines.push(
    `Momentum: RSI ${n(s.momentum.rsi14)} (${s.momentum.rsiState}) | MACD ${s.momentum.macdCross ?? 'n/a'}, histogram ${n(s.momentum.macdHistogram)} | ` +
      `ROC 20 ${n(s.momentum.roc20, '%')} | Stoch ${n(s.momentum.stochK)}/${n(s.momentum.stochD)} | ` +
      `Divergence: ${s.momentum.divergence.type === 'none' ? 'none' : s.momentum.divergence.detail}`,
  );
  lines.push(
    `Volume: ${s.volume.relativeVolume}× average | OBV ${s.volume.obvTrend} | ` +
      `avg turnover ${Math.round((s.volume.avgTurnoverEgp ?? 0) / 1e6)}M EGP/day` +
      (a.liquidity.ok ? '' : ` ⚠️ ${a.liquidity.note}`),
  );
  lines.push(
    `Volatility: ATR ${s.volatility.atr14} (${s.volatility.atrPct}% daily) · annualized ${n(s.volatility.annualizedVolPct, '%')}` +
      (s.volatility.squeeze ? ' | Bollinger squeeze — a strong move is likely coming' : ''),
  );

  const sup = s.levels.supports.slice(0, 3).map((l) => `${l.price} (strength ${l.strength}, ${signed(away(l.price))}%)`).join(' · ');
  const res = s.levels.resistances.slice(0, 3).map((l) => `${l.price} (strength ${l.strength}, ${signed(away(l.price))}%)`).join(' · ');
  lines.push(`Support: ${sup || 'none clear'}`);
  lines.push(`Resistance: ${res || 'none above price — open space'}`);

  if (s.breakout) {
    const when =
      s.breakout.barsAgo === 0 ? 'today'
      : s.breakout.barsAgo === 1 ? 'yesterday'
      : `${s.breakout.barsAgo} sessions ago`;
    lines.push(
      `${s.breakout.direction === 'up' ? 'Upward' : 'Downward'} breakout of level ${s.breakout.level} ${when}, ` +
        `${s.breakout.volumeConfirmed ? 'volume-confirmed' : 'without volume confirmation'}`,
    );
  }

  lines.push(`**Engine technical score: ${t.score}/100 → ${t.signal.ar}**`);
  if (t.reasons.bullish.length) lines.push(`  Bullish: ${t.reasons.bullish.join(' · ')}`);
  if (t.reasons.bearish.length) lines.push(`  Bearish: ${t.reasons.bearish.join(' · ')}`);
  if (t.reasons.neutral.length) lines.push(`  Notes: ${t.reasons.neutral.join(' · ')}`);

  // Entry / risk plan
  lines.push(
    a.position
      ? `**Computed plan** (a fresh entry, sized off the last completed close ${s.price.dailyClose ?? price} — for the held position use the Open position block below):`
      : `**Computed plan:**`,
  );
  lines.push(`  Entry: ${p.entryNote}`);
  lines.push(`  Stop: ${p.stop.stop} EGP (risk ${p.stop.riskPct}%) — ${p.stop.basis}`);
  if (p.targets.mid) {
    lines.push(
      `  Mid-term target: ${p.targets.mid.price} EGP (${signed(away(p.targets.mid.price))}% from price${price >= p.targets.mid.price ? ' — ALREADY REACHED' : ''}${p.targets.mid.previous ? ` — NEW target, set because price passed the earlier ${p.targets.mid.previous.price}` : ''}) — ${p.targets.mid.basis} | ` +
        `Timing: ${p.targets.mid.horizon.ar} | reward/risk ${p.targets.mid.riskReward}` +
        `${p.targets.mid.meetsMinRR === false ? ' ⚠️ below minimum' : ''}`,
    );
  } else {
    lines.push('  Mid-term target: no clear target within the mid-term horizon');
  }
  if (p.targets.long?.price) {
    lines.push(
      `  Long-term target: ${p.targets.long.price} EGP (${signed(away(p.targets.long.price))}% from price${price >= p.targets.long.price ? ' — ALREADY REACHED' : ''}${p.targets.long.previous ? ` — NEW target, set because price passed the earlier ${p.targets.long.previous.price}` : ''}) — ${p.targets.long.basis} | Timing: ${p.targets.long.horizon.ar}`,
    );
  } else {
    lines.push(`  Long-term target: ${p.targets.long?.note ?? 'n/a'}`);
  }
  lines.push(
    `  If bought at market today: stop ${p.buyingNow.stop}, reward/risk ${n(p.buyingNow.riskReward)} ` +
      `→ ${p.buyingNow.worthIt ? 'acceptable' : 'not acceptable'}`,
  );
  if (p.sizing) {
    lines.push(
      `  Allowed size: ${p.sizing.shares} shares (${p.sizing.positionPctOfCapital}% of capital, risk ${p.sizing.riskPctOfCapital}%) — bound by: ${p.sizing.bindingConstraint}`,
    );
  }

  // Open position state, when there is one
  if (a.position) {
    const ps = a.position;
    lines.push(`**Open position:** ${ps.shares} shares at avg ${ps.avgCost} | ` +
      `${ps.unrealizedPct >= 0 ? 'profit' : 'loss'} ${ps.unrealizedPct}% (${ps.unrealizedEgp} EGP) | ` +
      `effective (binding) stop ${ps.stop}`);
    // The three numbers the card the user is looking at shows, restated at the
    // price this brief is about, so the verdict speaks about the same picture.
    lines.push(
      `  Where price stands now (${ps.pricedAt === 'live' ? 'live quote' : 'last close'}): price ${price} | ` +
        `stop ${ps.stop} (${ps.distanceToStopPct}% below price${ps.distanceToStopPct < 0 ? ' — PRICE IS UNDER THE STOP right now' : ''}) | ` +
        (ps.targetLevel != null
          ? `target ${ps.targetLevel} (${ps.distanceToTargetPct >= 0 ? `${ps.distanceToTargetPct}% above price` : `price is ${Math.abs(ps.distanceToTargetPct)}% PAST it`}` +
            `${ps.reachedTarget?.next != null ? `; this is the NEW target — price already passed the earlier ${ps.reachedTarget.price}` : ''})`
          : 'no target'),
    );
    if (ps.trailing.moved) lines.push(`  ⬆️ Stop raised today from ${ps.trailing.from} to ${ps.stop} (peak ${ps.trailing.peak})`);
    // Informational only — the mechanical triggers below act on ps.stop, never
    // on this. It exists so a "hold for the long term" verdict can point to a
    // real invalidation level instead of an open-ended "hold and see".
    if (ps.longTermStop?.stop) {
      lines.push(`  Long-term stop (advisory, long horizon only): ${ps.longTermStop.stop} — ${ps.longTermStop.note}`);
    }
    const fired = Object.entries(ps.triggers).filter(([, v]) => v).map(([k]) => k);
    lines.push(`  Mechanical triggers: ${fired.length ? fired.join(', ') : 'none — position within its range'}`);
    if (ps.ruleBook) lines.push(ruleBookLines(ps, s.price.close));
  }

  if (a.fundamentals) {
    const f = a.fundamentals;
    const pctl = f.percentiles ?? {};
    // "rank" = where the raw number sits (0-100, higher = larger number), across
    // every EGX listing and within the company's peer group, with the peers'
    // median — so the model compares without computing anything.
    const rank = (key) => {
      const bits = [];
      if (pctl[key] != null) bits.push(`EGX rank ${Math.round(pctl[key])}`);
      const peer = f.peers?.[key];
      if (peer) {
        bits.push(
          `${peer.group} "${peer.name}" (${peer.count} cos) median ${peer.median}` +
            (peer.percentile != null ? `, rank ${Math.round(peer.percentile)}` : ''),
        );
      }
      return bits.length ? ` [${bits.join(' · ')}]` : '';
    };
    const bn = (x) => `${(x / 1e9).toFixed(1)}B EGP`;
    const group = (label, items) => {
      const facts = items.filter(Boolean);
      if (facts.length) lines.push(`  ${label}: ${facts.join(' | ')}`);
      return facts.length;
    };

    lines.push(
      `**Fundamentals** (${f.industry ?? '—'}; TradingView screener pulled ${f.asOf} — TTM and latest-quarter figures, not audited-report dates):`,
    );
    const shown =
      group('Valuation', [
        f.peRatio != null && `P/E ${f.peRatio}${rank('peRatio')}`,
        f.priceToBook != null && `P/B ${f.priceToBook}${rank('priceToBook')}`,
        f.priceToSales != null && `P/S ${f.priceToSales}`,
        f.evToEbitda != null && `EV/EBITDA ${f.evToEbitda}${rank('evToEbitda')}`,
        f.dividendYieldPct != null && `dividend yield ${f.dividendYieldPct}%${rank('dividendYieldPct')}`,
        f.freeCashFlowYieldPct != null && `FCF yield ${f.freeCashFlowYieldPct}%`,
        f.marketCapEgp != null && `market cap ${Math.round(f.marketCapEgp / 1e9)}B EGP`,
      ]) +
      group('Growth (YoY, TTM, nominal EGP)', [
        f.revenueGrowthPct != null && `revenue ${f.revenueGrowthPct}%${rank('revenueGrowthPct')}`,
        f.netIncomeGrowthPct != null && `net income ${f.netIncomeGrowthPct}%`,
        f.epsGrowthPct != null && `EPS ${f.epsGrowthPct}%`,
        f.epsEgp != null && `EPS ${f.epsEgp} EGP`,
      ]) +
      group('Profitability', [
        f.grossMarginPct != null && `gross margin ${f.grossMarginPct}%`,
        f.operatingMarginPct != null && `operating margin ${f.operatingMarginPct}%`,
        f.netMarginPct != null && `net margin ${f.netMarginPct}%${rank('netMarginPct')}`,
        f.returnOnEquityPct != null && `ROE ${f.returnOnEquityPct}%${rank('returnOnEquityPct')}`,
        f.returnOnAssetsPct != null && `ROA ${f.returnOnAssetsPct}%`,
      ]) +
      group('Balance sheet & cash', [
        f.debtToEquity != null && `debt/equity ${f.debtToEquity}${rank('debtToEquity')}`,
        f.netDebtEgp != null && (f.netDebtEgp < 0 ? `net cash ${bn(-f.netDebtEgp)}` : `net debt ${bn(f.netDebtEgp)}`),
        f.currentRatio != null && `current ratio ${f.currentRatio}${rank('currentRatio')}`,
        f.freeCashFlowEgp != null && `free cash flow ${bn(f.freeCashFlowEgp)} TTM`,
      ]);
    if (f.valuation) lines.push(`  Engine read: ${f.valuation}`);
    // Coverage is partial on EGX small caps. Say so, so the model reads a gap
    // as a gap rather than as a weak balance sheet.
    const missing = [
      f.revenueGrowthPct == null && f.netIncomeGrowthPct == null && 'growth',
      f.netMarginPct == null && f.returnOnEquityPct == null && 'profitability',
      f.debtToEquity == null && f.netDebtEgp == null && 'leverage',
      f.freeCashFlowEgp == null && 'cash flow',
    ].filter(Boolean);
    if (!shown) lines.push('  (no fundamental figures published for this stock)');
    if (missing.length) lines.push(`  Missing: ${missing.join(', ')} — absence is a gap in the read, not a negative signal.`);
  } else {
    lines.push('**Fundamentals:** unavailable for this stock — judge on technicals only.');
  }

  // Engine-computed, not model-authored (scoring/classification.js) — quote
  // these as given; see "Investment vs. speculative character" in the system
  // prompt for how to use them. Never recompute or override the type.
  if (a.classification?.investmentScore != null) {
    const c = a.classification;
    lines.push(
      `**Classification:** ${c.type} — investment ${c.investmentScore}/100, speculation ${c.speculationScore}/100 (confidence ${c.confidence}%)`,
    );
    if (c.reasons.investment.length) lines.push(`  Investment case: ${c.reasons.investment.join(' · ')}`);
    if (c.reasons.speculation.length) lines.push(`  Speculative character: ${c.reasons.speculation.join(' · ')}`);
    if (c.reasons.risks.length) lines.push(`  Classification risks: ${c.reasons.risks.join(' · ')}`);
  }

  if (a.shariah && a.shariah !== 'compliant') {
    lines.push(`  Note: Shariah compliance — ${a.shariah === 'non_compliant' ? 'non-compliant' : 'needs review'}`);
  }

  return lines.join('\n');
}

/**
 * The book-level facts every review needs — cash, capital, weights, sectors,
 * health score, classification mix — computed here so the analyst judges them
 * rather than derives them. Shared by the full and single-stock reviews and
 * the cash review (cashAnalysis.js).
 */
export function portfolioContext(analyses, ctx, rules) {
  const held = analyses.filter((a) => a.position);
  const totalPositionValue = held.reduce((sum, a) => sum + (a.position?.marketValue ?? 0), 0);
  const cash = ctx.cash ?? 0;
  const capital = ctx.capital ?? totalPositionValue + cash;

  const structure = portfolioStructure(analyses, { cash, capital }, rules);
  const classificationSummary = portfolioClassificationSummary(analyses);
  const sectorLines = structure.sectors
    .map((s) => `  ${s.sector}: ${Math.round(s.value).toLocaleString('en-US')} EGP (${s.pctOfCapital}%)`)
    .join('\n');
  const weightLines = structure.weights
    .map((w) => `  ${w.code}: ${w.pctOfCapital}% of capital (${Math.round(w.value).toLocaleString('en-US')} EGP) · ${w.sector}`)
    .join('\n');

  const text = `## Financial position
- Positions value: ${Math.round(totalPositionValue).toLocaleString('en-US')} EGP
- Cash available: ${Math.round(cash).toLocaleString('en-US')} EGP (${((cash / capital) * 100).toFixed(1)}% of capital)
- Total capital: ${Math.round(capital).toLocaleString('en-US')} EGP

## Portfolio structure (computed — judge it, do not recompute it)
- Portfolio health score: ${structure.health.score}/100${structure.health.reasons.length ? ` — deductions: ${structure.health.reasons.join('; ')}` : ' — no structural violations'}
- Holdings: ${structure.holdings} | largest position: ${structure.largestPct}% | top 3: ${structure.top3Pct}% | top 5: ${structure.top5Pct}%
- Limits: max single position ${rules.sizing.maxPositionPct}% · max sector ${rules.sizing.maxSectorPct}% · min cash reserve ${rules.sizing.minCashBufferPct}%

### Weight of each position
${weightLines || '  No open positions'}

### Sector distribution
${sectorLines || '  No open positions'}

### Investment vs. speculative composition (computed — see each stock's own Classification line for detail)
${
  classificationSummary.holdings
    ? `  ${Object.entries(classificationSummary.pctByType).map(([type, pct]) => `${type} ${pct}%`).join(' · ')} | ` +
      `avg investment score ${classificationSummary.avgInvestmentScore ?? 'n/a'} · avg speculation score ${classificationSummary.avgSpeculationScore ?? 'n/a'} | ` +
      `speculative exposure (SPECULATIVE+HYBRID) ${classificationSummary.speculativeExposurePct}% of capital, largest single one ${classificationSummary.largestSpeculativePositionPct}%`
    : '  No open positions'
}`;

  return { text, structure, classificationSummary };
}

/**
 * Full portfolio review.
 *
 * @param {object[]} analyses - results from analyzeTicker (positions + watchlist)
 * @param {object} ctx - { cash, capital, positions: Map<code, {shares, avgCost}> }
 * @param {object} [opts]
 * @param {string} [opts.style] - investor style (trader | medium | long); sets
 *   both the horizon the analyst reasons in and the rule numbers it quotes.
 *   Pass `rules` already adjusted for it — see config/styles.js.
 */
export async function reviewPortfolio(analyses, ctx = {}, { model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE } = {}) {
  const held = analyses.filter((a) => a.position);
  const watch = analyses.filter((a) => !a.position);

  // Every holding gets a real, model-written verdict — the review is limited
  // to one confirmed use per day in the UI, so a canned "no change" for quiet
  // holdings saved little and read as no recommendation at all. Triage now
  // only orders the brief, so research goes to the names with a live rule first.
  const heldNeedingDecision = held.filter(needsDecision);
  const quietHeld = held.filter((a) => !needsDecision(a));
  // A watchlist name is only worth a verdict if it is actually buyable now, or
  // the engine flags it as worth waiting for at a specific level.
  const watchWorthReviewing = watch.filter((a) => a.plan?.actionable || a.plan?.buyingNow?.worthIt);
  const quietWatch = watch.filter((a) => !watchWorthReviewing.includes(a));
  const reviewed = [...heldNeedingDecision, ...quietHeld, ...watchWorthReviewing];

  const { text: contextText, structure, classificationSummary } = portfolioContext(analyses, ctx, rules);

  const userMessage = `# Portfolio review — close of ${analyses[0]?.asOf ?? 'today'}

${contextText}

## Holdings with a rule firing or close to the stop (${heldNeedingDecision.length} of ${held.length}) — research these first
${heldNeedingDecision.map(briefFor).join('\n\n') || 'No position has a trigger or is near its stop today.'}

## Holdings with no rule firing (${quietHeld.length} of ${held.length}) — still a real verdict each
${quietHeld.map(briefFor).join('\n\n') || 'None.'}

## Watchlist — actionable opportunities (${watchWorthReviewing.length} of ${watch.length})
${watchWorthReviewing.map(briefFor).join('\n\n') || 'No actionable setup on the watchlist.'}
${quietWatch.length ? `\nExcluded from the watchlist for now (not actionable, no verdict): ${quietWatch.map((a) => a.code).join(', ')}` : ''}

---
Give me a decision for every stock in the three sections above, a cash recommendation, and the top priority for tomorrow.
Remember: these numbers are final — judge them, do not recompute them.`;

  // The prompt requires research before any money-moving verdict, so the search
  // allowance scales with how many names are under review rather than being a
  // flat number that a large book would exhaust on its first few stocks.
  // Counted against the names actually being reviewed, not the whole book —
  // the quiet ones are never researched, so budgeting for them would just
  // hand the model an allowance to spend on stocks it was told to skip.
  const perStock = rules.webSearch?.perStock ?? 2;
  const searchBudget = Math.min(
    rules.webSearch?.maxUsesPerReview ?? 30,
    Math.max(perStock, reviewed.length * perStock),
  );
  // One cross-check tool round trip per reviewed stock, plus room for the
  // model's own research turns and a final no-tool turn — a fixed budget was
  // exhausted by portfolios with several actionable names in one review,
  // throwing a generic "too many tool calls" error before any verdict came
  // back. Capped so a single stuck stock can't spin forever.
  const maxTurns = Math.min(20, reviewed.length + 4);

  const { data, raw } = await requestStructuredOR({
    model,
    schema: PortfolioReviewSchema,
    schemaName: 'portfolio_review',
    // Per phase, not shared (research phase, then formatting phase — see
    // clientOpenRouter.js). Scales with verdict count: each detailed Arabic
    // verdict is ~900 tokens, and a flat 4000 truncated the JSON on larger books.
    maxTokens: Math.min(16000, 2000 + reviewed.length * 900),
    system: analystSystemPrompt(rules, style),
    messages: [{ role: 'user', content: userMessage }],
    // Model-decided, not always-on: the system prompt governs when a search
    // is warranted, same as before. Resolves server-side within one turn.
    webSearch: { engine: 'auto', max_results: 4, max_uses: searchBudget },
    clientTools: [crossCheckTool],
    maxTurns,
    feature: 'portfolio_review',
  });

  // Every holding was sent to the model; quietVerdict only covers one it
  // skipped, so no card is left without a verdict. reviewDepth tells them apart.
  const aiVerdicts = attachRuleChecks(
    (data.verdicts ?? []).map((v) => ({ ...v, reviewDepth: v.reviewDepth ?? 'full' })),
    held,
    'portfolio_review',
  );
  const aiCodes = new Set(aiVerdicts.map((v) => v.code));
  const weightOf = new Map(structure.weights.map((w) => [w.code, w]));
  const localVerdicts = quietHeld
    .filter((a) => !aiCodes.has(a.code))
    .map((a) => quietVerdict(a, weightOf.get(a.code) ?? null));

  return {
    ...data,
    verdicts: [...aiVerdicts, ...localVerdicts],
    // Engine-computed, not model-authored: the concentration figures and the
    // health score the analyst was asked to interpret rather than invent.
    portfolioHealth: structure.health,
    portfolioClassification: classificationSummary,
    portfolioStructure: {
      holdings: structure.holdings,
      largestPct: structure.largestPct,
      top3Pct: structure.top3Pct,
      top5Pct: structure.top5Pct,
      cashPct: structure.cashPct,
      sectors: structure.sectors,
      weights: structure.weights,
    },
    _meta: {
      model: raw.model,
      asOf: analyses[0]?.asOf ?? null,
      usage: raw.usage,
      stocksReviewed: analyses.length,
      // What the spend actually covered, versus what was answered for free.
      stocksSentToModel: reviewed.length,
      stocksAnsweredLocally: localVerdicts.length,
      searchBudget,
    },
  };
}

/**
 * The entry point every caller should use instead of reviewPortfolio()
 * directly — both the HTTP endpoint and the CLI's `review` command go
 * through here. Unlike the daily market report this can't be shared across
 * users (it reflects one person's actual positions and cost basis), but a
 * repeated request from the *same* user, same day, same style, against an
 * *unchanged* portfolio — someone reloading a page, or testing — is served
 * from storage instead of paying for another model call. A real trade, a
 * watchlist edit, or a cash change naturally busts the cache on the next
 * request, since portfolioHash() changes with them.
 *
 * @param {object} portfolio - the loaded portfolio (for its hash + userId)
 * @param {object[]} analyses - same as reviewPortfolio's first argument
 * @param {object} ctx - same as reviewPortfolio's second argument
 * @param {object} [opts] - same as reviewPortfolio's third argument, plus:
 * @param {string} opts.portfolioId - required; the bigint Portfolio id to cache under
 * @param {boolean} [opts.force] - regenerate even if a matching review is stored
 * @returns {Promise<{review: object, source: 'cached'|'ai'}>}
 */
export async function getOrGenerateReview(portfolio, analyses, ctx = {}, opts = {}) {
  const { portfolioId, force = false, model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE } = opts;
  // portfolio_reviews.portfolio_id is a bigint column — a caller that forgot
  // to pass this (the old opts.userId default was the string 'local', valid
  // back when this was keyed by userId) must fail loudly here, not with an
  // opaque "invalid input syntax for type bigint" from inside getPortfolioReview.
  if (portfolioId == null) throw new Error('getOrGenerateReview: opts.portfolioId is required');
  const asOf = analyses[0]?.asOf ?? new Date().toISOString().slice(0, 10);
  const hash = portfolioHash(portfolio);

  if (!force) {
    const cached = await getPortfolioReview(portfolioId, asOf, style);
    if (cached && cached.portfolioHash === hash) {
      const { portfolioHash: _hash, ...review } = cached;
      return { review, source: 'cached' };
    }
  }

  const review = await reviewPortfolio(analyses, ctx, { model, rules, style });
  await putPortfolioReview(portfolioId, asOf, style, hash, review, review._meta.model, review._meta.usage);
  return { review, source: 'ai' };
}

/**
 * One holding's verdict, asked on its own from the position card. Much less
 * output and one stock's worth of research, so it returns in well under a
 * minute. The system prompt is identical to the full review's (keeps any
 * provider prompt cache warm); the single-stock scope is set in the message.
 *
 * @param {object[]} analyses - every held position's analysis (for weights/sectors)
 * @param {string} code - the held position to review
 */
export async function reviewStock(analyses, code, ctx = {}, { model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE } = {}) {
  const target = analyses.find((a) => a.code === code && a.position);
  if (!target) throw new Error(`مفيش مركز مفتوح في ${code}`);
  if (target.halted) throw new Error(`${code} موقوف عن التداول من ${target.halted.since} — التوصية هتتاح أول ما التداول يرجع.`);
  const { text: contextText } = portfolioContext(analyses, ctx, rules);

  const pricedLive = target.position.pricedAt === 'live';
  const userMessage = `# Single-stock review — ${code}, ${pricedLive ? `priced at the live quote right now (last completed close ${target.asOf ?? 'n/a'})` : `close of ${target.asOf ?? 'today'}`}

This request covers ONE holding only: return a single verdict for ${code}. Instructions about marketRead, cashAdvice, topPriority, portfolioAssessment, portfolioRisks or verdicts for other stocks do not apply here. The portfolio sections below are context for portfolioView, positionSizing and betterAlternative only.

The reader sees this verdict on the stock's card as exactly two lines, so write it to the point. This overrides the length guidance in the system prompt:
- headline (line 1): the action and the one number that decides it, at most 8 words — e.g. "بيع جزئي — عدّى +15% ربح" or "احتفاظ — لسه بعيد عن الوقف والهدف".
- orderInstruction (line 2 when there is an action): the exact rule-book order in at most 15 words — e.g. "بيع 57 سهم بأمر محدد عند 91.95، والباقي وقفه 82.94". null for hold, wait or avoid.
- invalidation (line 2 for hold, wait or avoid): the one level to watch in at most 12 words — e.g. "خروج كامل لو قفل تحت 38.50".
- Every other field: one short sentence. At most 2 riskFlags and 2 externalContext entries. Never list the portfolio's weights or sectors back.

The cross_check_indicators tool is not available in this request — take the brief's indicator numbers as given.
Answer this message with terse working notes only (the action, the rule-book numbers that decide it, anything your research found — under 120 words); you will be asked to format them into the verdict right after, so do not write the verdict out in full here.

${contextText}

## ${code} — full brief
${briefFor(target)}

---
Give me the verdict for ${code}. Remember: these numbers are final — judge them, do not recompute them.`;

  const { data, raw } = await requestStructuredOR({
    model,
    schema: StockVerdictSchema,
    schemaName: 'stock_verdict',
    // Arabic prose runs ~2 characters per token, so a full verdict needs more
    // room than it looks; 3000 cut valid answers off mid-string.
    maxTokens: 5000,
    system: analystSystemPrompt(rules, style),
    messages: [{ role: 'user', content: userMessage }],
    webSearch: { engine: 'auto', max_results: 4, max_uses: rules.webSearch?.perStock ?? 1 },
    // No cross-check tool here: its Python/yfinance subprocess plus the extra
    // model turn it forces was the slowest part of a single-stock verdict, and
    // the engine's numbers govern the verdict either way. Web search resolves
    // server-side inside one turn, so no client tool loop is needed at all.
    clientTools: [],
    feature: 'stock_review',
  });

  const [verdict] = attachRuleChecks([{ ...data, code, reviewDepth: 'full' }], [target], 'stock_review');
  return { ...verdict, _meta: { model: raw.model, asOf: target.asOf ?? null, usage: raw.usage } };
}

/**
 * Generates a stock's AI recommendation — no caching, unlike
 * getOrGenerateReview. Every call is a fresh model call and is billed as one
 * recommendation-tier use by the caller (see leftFor('recommendations', ...)
 * in src/api/server.js): asking again for the same stock the same day is a
 * new use spending a new credit, not a free re-read of an earlier answer.
 *
 * @param {() => Promise<object[]>} opts.loadAnalyses - every held position's
 *   analysis, needed for portfolio-wide context (sector mix, weights).
 */
export async function getOrGenerateStockReview(code, ctx = {}, opts = {}) {
  const { model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE, loadAnalyses } = opts;
  const analyses = await loadAnalyses();
  const verdict = await reviewStock(analyses, code, ctx, { model, rules, style });
  return { verdict, source: 'ai' };
}
