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
  if (p.triggers?.exitOnStop || p.triggers?.takePartial || p.triggers?.atTarget) return true;
  if (p.stopBreached) return true;
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
  // When the existing stop is already above "X% under price", the ratchet keeps
  // it — say so instead of attributing that level to the percentage.
  const stopNote = (level, pct) =>
    level === rb.stop.level ? `stop stays at ${level} (already above ${pct}% under ${price})` : `stop to ${level} (${pct}% under ${price})`;
  const out = ['  **Rule book (this style, evaluated — quote these numbers, never derive others):**'];

  out.push(
    `  R1 Stop on ${rb.stop.honorOn}: level ${rb.stop.level}, price ${price} is ${rb.stop.distancePct}% above it → ${mark(rb.stop.fired)}` +
      (rb.stop.fired ? ` | order: sell all ${rb.stop.sellQty} shares at market next open` : ''),
  );
  out.push(
    `  R2 Trailing stop ${rb.trailing.trailPct}% (activates at +${rb.trailing.activateAtProfitPct}%, never moves down): ` +
      (rb.trailing.active
        ? `ACTIVE, peak ${rb.trailing.peak}${rb.trailing.moved ? `, moved today from ${rb.trailing.from} to ${rb.stop.level}` : ''}`
        : `inactive — profit ${ps.unrealizedPct}% is below +${rb.trailing.activateAtProfitPct}%`),
  );
  out.push(
    `  R3 Target (${tg.horizon}-term) ${tg.level ?? 'n/a'} → ${mark(tg.fired)}` +
      (tg.level != null
        ? ` | if fired: sell ${tg.fractionPct}% = ${tg.qty} of ${ps.shares} shares, keep ${tg.remainingShares}, ${stopNote(tg.raisedStop, tg.raiseStopPct)}`
        : ''),
  );
  out.push(
    `  R4 Partial profit at +${pp.thresholdPct}%: profit ${ps.unrealizedPct}% → ` +
      (pp.alreadyTaken ? 'already taken on this position — does not fire again' : mark(pp.fired)) +
      ` | if fired: sell ${pp.fractionPct}% = ${pp.qty} of ${ps.shares} shares, limit ${pp.limitPrice} (+${pp.limitAbovePricePct}% above ${price}), ` +
      `≈ ${pp.proceedsEgp} EGP, keep ${pp.remainingShares} shares, trailing ${stopNote(pp.remainingStop, rb.trailing.trailPct)}`,
  );
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

  lines.push(`### ${a.code} — ${a.name} (${a.sectorAr ?? '?'})`);
  lines.push(
    `Price ${s.price.close} EGP (${s.price.changePct >= 0 ? '+' : ''}${s.price.changePct}% today) | ` +
      `from 52w high ${s.price.pctFrom52wHigh}% | return 3m ${n(s.returns.m3, '%')} · 1y ${n(s.returns.y1, '%')}`,
  );
  lines.push(
    `Trend: ${s.trend.label} (${s.trend.score}/100) | ${s.strength.trendQuality} (ADX ${n(s.strength.adx)}) | ` +
      `MAs: 20=${n(s.movingAverages.sma20)} 50=${n(s.movingAverages.sma50)} 200=${n(s.movingAverages.sma200)}`,
  );
  lines.push(
    `Momentum: RSI ${n(s.momentum.rsi14)} (${s.momentum.rsiState}) | MACD ${s.momentum.macdCross ?? 'n/a'} | ` +
      `Divergence: ${s.momentum.divergence.type === 'none' ? 'none' : s.momentum.divergence.detail}`,
  );
  lines.push(
    `Volume: ${s.volume.relativeVolume}× average | OBV ${s.volume.obvTrend} | ` +
      `avg turnover ${Math.round((s.volume.avgTurnoverEgp ?? 0) / 1e6)}M EGP/day` +
      (a.liquidity.ok ? '' : ` ⚠️ ${a.liquidity.note}`),
  );
  lines.push(
    `Volatility: ATR ${s.volatility.atr14} (${s.volatility.atrPct}% daily)` +
      (s.volatility.squeeze ? ' | Bollinger squeeze — a strong move is likely coming' : ''),
  );

  const sup = s.levels.supports.slice(0, 3).map((l) => `${l.price} (strength ${l.strength}, ${l.distancePct}%)`).join(' · ');
  const res = s.levels.resistances.slice(0, 3).map((l) => `${l.price} (strength ${l.strength}, +${l.distancePct}%)`).join(' · ');
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
  lines.push(`**Computed plan:**`);
  lines.push(`  Entry: ${p.entryNote}`);
  lines.push(`  Stop: ${p.stop.stop} EGP (risk ${p.stop.riskPct}%) — ${p.stop.note}`);
  if (p.targets.mid) {
    lines.push(
      `  Mid-term target: ${p.targets.mid.price} EGP (+${p.targets.mid.upsidePct}%) — ${p.targets.mid.basis} | ` +
        `Timing: ${p.targets.mid.horizon.ar} | reward/risk ${p.targets.mid.riskReward}` +
        `${p.targets.mid.meetsMinRR === false ? ' ⚠️ below minimum' : ''}`,
    );
  } else {
    lines.push('  Mid-term target: no clear target within the mid-term horizon');
  }
  if (p.targets.long?.price) {
    lines.push(
      `  Long-term target: ${p.targets.long.price} EGP (+${p.targets.long.upsidePct}%) — ${p.targets.long.basis} | Timing: ${p.targets.long.horizon.ar}`,
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
      `effective (binding) stop ${ps.stop}${ps.trailing.active ? ' (trailing active)' : ''}`);
    if (ps.trailing.moved) lines.push(`  ⬆️ Trailing stop moved from ${ps.trailing.from} to ${ps.stop} (peak ${ps.trailing.peak})`);
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
    const facts = [
      f.peRatio != null && `P/E ${f.peRatio}`,
      f.epsEgp != null && `EPS ${f.epsEgp} EGP`,
      f.priceToBook != null && `P/B ${f.priceToBook}`,
      f.dividendYieldPct != null && `dividend yield ${f.dividendYieldPct}%`,
      f.returnOnEquityPct != null && `ROE ${f.returnOnEquityPct}%`,
      f.debtToEquity != null && `debt/equity ${f.debtToEquity}`,
      f.marketCapEgp != null && `market cap ${Math.round(f.marketCapEgp / 1e9)}B EGP`,
    ].filter(Boolean);

    if (facts.length) {
      lines.push(`**Fundamentals** (${f.industry ?? '—'}, ${f.asOf}): ${facts.join(' | ')}`);
      if (f.valuation) lines.push(`  ${f.valuation}`);
    }
    // Coverage is partial on EGX small caps. Say so, so the model reads a gap
    // as a gap rather than as a weak balance sheet.
    const missing = ['peRatio', 'epsEgp', 'returnOnEquityPct'].filter((k) => f[k] == null);
    if (missing.length) lines.push('  Note: some fundamentals are unavailable for this stock — absence is not a negative signal.');
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
 * rather than derives them. Shared by the full and single-stock reviews.
 */
function portfolioContext(analyses, ctx, rules) {
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
- Brokerage commission: ${rules.commissionPct}% per trade

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
  const aiVerdicts = (data.verdicts ?? []).map((v) => ({ ...v, reviewDepth: v.reviewDepth ?? 'full' }));
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
 * @param {string} [opts.userId='local']
 * @param {boolean} [opts.force] - regenerate even if a matching review is stored
 * @returns {Promise<{review: object, source: 'cached'|'ai'}>}
 */
export async function getOrGenerateReview(portfolio, analyses, ctx = {}, opts = {}) {
  const { userId = 'local', force = false, model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE } = opts;
  const asOf = analyses[0]?.asOf ?? new Date().toISOString().slice(0, 10);
  const hash = portfolioHash(portfolio);

  if (!force) {
    const cached = await getPortfolioReview(userId, asOf, style);
    if (cached && cached.portfolioHash === hash) {
      const { portfolioHash: _hash, ...review } = cached;
      return { review, source: 'cached' };
    }
  }

  const review = await reviewPortfolio(analyses, ctx, { model, rules, style });
  await putPortfolioReview(userId, asOf, style, hash, review, review._meta.model, review._meta.usage);
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
  const { text: contextText } = portfolioContext(analyses, ctx, rules);

  const userMessage = `# Single-stock review — ${code}, close of ${target.asOf ?? 'today'}

This request covers ONE holding only: return a single verdict for ${code}. Instructions about marketRead, cashAdvice, topPriority, portfolioAssessment, portfolioRisks or verdicts for other stocks do not apply here. The portfolio sections below are context for portfolioView, positionSizing and betterAlternative only.

${contextText}

## ${code} — full brief
${briefFor(target)}

---
Give me the verdict for ${code}. Remember: these numbers are final — judge them, do not recompute them.`;

  const { data, raw } = await requestStructuredOR({
    model,
    schema: StockVerdictSchema,
    schemaName: 'stock_verdict',
    maxTokens: 3000,
    system: analystSystemPrompt(rules, style),
    messages: [{ role: 'user', content: userMessage }],
    webSearch: { engine: 'auto', max_results: 4, max_uses: rules.webSearch?.perStock ?? 1 },
    clientTools: [crossCheckTool],
    maxTurns: 3,
    feature: 'stock_review',
  });

  return { ...data, code, reviewDepth: 'full', _meta: { model: raw.model, asOf: target.asOf ?? null, usage: raw.usage } };
}

/**
 * Cache-or-generate for reviewStock, same contract as getOrGenerateReview.
 * Stored in portfolio_reviews under a `style:CODE` style key (the column is
 * free text), and hashed on this position plus cash only, so a trade in a
 * different stock doesn't throw away this one's verdict.
 */
export async function getOrGenerateStockReview(portfolio, analyses, code, ctx = {}, opts = {}) {
  const { userId = 'local', force = false, model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE } = opts;
  const asOf = analyses.find((a) => a.code === code)?.asOf ?? new Date().toISOString().slice(0, 10);
  const cacheStyle = `${style}:${code}`;
  const hash = portfolioHash({ positions: { [code]: portfolio.positions[code] }, watchlist: {}, cash: portfolio.cash });

  if (!force) {
    const cached = await getPortfolioReview(userId, asOf, cacheStyle);
    if (cached && cached.portfolioHash === hash) {
      const { portfolioHash: _hash, ...verdict } = cached;
      return { verdict, source: 'cached' };
    }
  }

  const verdict = await reviewStock(analyses, code, ctx, { model, rules, style });
  await putPortfolioReview(userId, asOf, cacheStyle, hash, verdict, verdict._meta.model, verdict._meta.usage);
  return { verdict, source: 'ai' };
}
