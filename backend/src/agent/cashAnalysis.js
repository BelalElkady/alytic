/**
 * The AI layer on "تحليل الكاش".
 *
 * /api/scan?focus=cash builds the cash plan deterministically — which stocks,
 * share counts, limit prices, stops, the reserve. This module asks the model
 * to judge that plan for one user before it is shown as a recommendation:
 * deploy now, in tranches, or hold cash, and a call on each stock of the
 * engine's shortlist (its picks plus the next-ranked alternates). The engine
 * then rebuilds the plan from those calls — a stock the model says to wait on
 * or skip is dropped and its cash re-split across the ones it approved. The
 * model never touches a number; every amount still comes from the engine.
 *
 * Deliberately cheap: no web search and no tool loop. The day's shared market
 * report (marketAnalysis.js), when it has already been generated, is handed
 * over as the researched context instead — read from storage only, never
 * generated from here, so a cash review can't trigger the expensive research
 * pass on someone's behalf.
 */

import { MODEL_CHAIN, requestStructuredOR } from './clientOpenRouter.js';
import { CashPlanReviewSchema } from './schemas.js';
import { cashReviewSystemPrompt } from './prompts/system.js';
import { briefFor, portfolioContext } from './analyst.js';
import RULES from '../config/rules.js';
import { behaviorProfile, behaviorLines } from '../scoring/behavior.js';
import { DEFAULT_STYLE } from '../config/styles.js';
import { portfolioHash } from '../portfolio.js';
import { getMarketReport, getPortfolioReview, putPortfolioReview } from '../db.js';

const egp = (x) => Math.round(x ?? 0).toLocaleString('en-US');

// A cheap, non-blocking hallucination guard: the system prompt tells the
// model to "quote only numbers given to you," but that's an instruction, not
// an enforcement — this actually checks it. Bare 1-2 digit integers are
// skipped since those are usually a legitimate count the model derives by
// reading the context (e.g. "3 مراكز قريبة من وقفها"), not an invented price,
// amount or percentage.
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

function extractFinancialNumbers(text) {
  if (!text) return [];
  const out = [];
  let m;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(text))) {
    const raw = m[0];
    if (!/[.,]/.test(raw) && raw.length <= 2) continue;
    const value = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

// Tolerant of the model rounding to fewer decimals or dropping a thousands
// separator — this isn't meant to catch every stylistic reformat, only a
// number that isn't grounded in what the model was actually given.
const numbersMatch = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.01);

function findUnverifiedNumbers(text, allowed) {
  const found = extractFinancialNumbers(text);
  return found.filter((n) => !allowed.some((a) => numbersMatch(n, a)));
}

/**
 * Flags numbers in the model's free-text fields that don't match any number
 * it was actually given in `userMessage` — logged for now, not blocking:
 * false positives are possible (a legitimately derived figure, e.g. summing
 * two given amounts), so this is a signal to watch, not a hard gate on a
 * feature that's meant to stay cheap and fast.
 */
function flagUnverifiedNumbers(userMessage, data, reviewedPicks) {
  const allowed = extractFinancialNumbers(userMessage);
  const fields = [
    ['headline', data.headline],
    ['marketRead', data.marketRead],
    ['portfolioRead', data.portfolioRead],
    ['behaviorRead', data.behaviorRead],
    ['deploymentPlan', data.deploymentPlan],
    ['reserveAdvice', data.reserveAdvice],
    ['topPriority', data.topPriority],
    ...(data.risks ?? []).map((r, i) => [`risks[${i}]`, r]),
    ...reviewedPicks.flatMap((p) => [
      [`picks.${p.code}.comment`, p.comment],
      [`picks.${p.code}.portfolioFit`, p.portfolioFit],
      [`picks.${p.code}.watchFor`, p.watchFor],
    ]),
  ];
  const flags = fields
    .map(([field, text]) => ({ field, numbers: findUnverifiedNumbers(text, allowed) }))
    .filter((f) => f.numbers.length > 0);
  if (flags.length) {
    console.warn(
      `[ai] cash_plan_review: numbers not found in the given context — ${flags
        .map((f) => `${f.field}: ${f.numbers.join(', ')}`)
        .join(' | ')}`,
    );
  }
  return flags;
}

function planLine(row, investableCash) {
  const bp = row.buyPlan;
  const share = investableCash > 0 ? ((bp.cost / investableCash) * 100).toFixed(1) : '0';
  const target = row.midTarget?.price
    ? `mid target ${row.midTarget.price} (+${row.midTarget.upsidePct}%, ${row.midTarget.horizon?.ar ?? 'n/a'})`
    : 'no mid target';
  return (
    `- ${row.code} (${row.sector ?? '?'}): buy ${bp.shares} shares at limit ${bp.entry} = ${egp(bp.cost)} EGP (${share}% of investable cash)` +
    ` | stop ${bp.stop} (risk ${row.riskPct}%, max loss ${egp(bp.risk)} EGP) | ${target}` +
    ` | reward/risk if bought now ${row.riskRewardNow ?? 'n/a'} | entry status ${row.entryStatus ?? 'n/a'} — ${row.entryNote ?? ''}`
  );
}

/** A shortlisted stock the engine didn't fund: it has no order yet, only the levels one would be built on. */
function alternateLine(row) {
  const target = row.midTarget?.price
    ? `mid target ${row.midTarget.price} (+${row.midTarget.upsidePct}%, ${row.midTarget.horizon?.ar ?? 'n/a'})`
    : 'no mid target';
  return (
    `- ${row.code} (${row.sector ?? '?'}): limit entry ${row.suggestedEntry} | stop ${row.stop} (risk ${row.riskPct}%) | ${target}` +
    ` | reward/risk if bought now ${row.riskRewardNow ?? 'n/a'} | entry status ${row.entryStatus ?? 'n/a'} — ${row.entryNote ?? ''}`
  );
}

function daysSince(date, asOf) {
  const ms = new Date(asOf ?? Date.now()).getTime() - new Date(date).getTime();
  return date && Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
}

/** One held position, with what the rules say about it today — the "does this need handling first" facts. */
function holdingLine(a, stored, asOf) {
  const ps = a.position;
  const fired = Object.entries(ps.triggers ?? {}).filter(([, on]) => on).map(([k]) => k);
  const held = daysSince(stored?.openedAt, asOf);
  return (
    `- ${a.code} (${a.sectorAr ?? '?'}): ${ps.shares} shares at avg ${ps.avgCost}, price ${a.snapshot.price.close}` +
    ` | ${ps.unrealizedPct >= 0 ? 'profit' : 'loss'} ${ps.unrealizedPct}% (${egp(ps.unrealizedEgp)} EGP)` +
    `${held != null ? ` | held ${held} days` : ''}` +
    ` | stop ${ps.stop} (${ps.distanceToStopPct}% away${ps.stopBreached ? ', BREACHED' : ''})` +
    ` | engine score ${a.technical.score}/100 (${a.technical.signal?.ar ?? '—'})` +
    ` | position card says: ${ps.recommendation?.label ?? 'n/a'}` +
    ` | triggers fired: ${fired.length ? fired.join(', ') : 'none'}`
  );
}

function marketReportSection(report, codes) {
  if (!report) return '## Today\'s market report\nNot generated yet today — judge on the briefs alone.';
  const covered = (report.topOpportunities ?? []).filter((op) => codes.includes(op.code));
  const lines = [
    `## Today's market report (researched, ${report.asOf})`,
    `### Overview\n${report.marketOverview}`,
    `### Market-wide risks\n${(report.risksToWatch ?? []).map((r) => `- ${r}`).join('\n') || 'none noted'}`,
    `### Report's top priority\n${report.topPriority ?? 'n/a'}`,
  ];
  if (report.cashDeploymentGuide) {
    lines.push(
      `### Report's generic cash guide (for an empty book — context, not an instruction)\n` +
        `${report.cashDeploymentGuide.philosophy} | suggested reserve ${report.cashDeploymentGuide.reserveCashPct}%`,
    );
  }
  lines.push(
    covered.length
      ? `### Plan picks the report researched\n${covered
          .map((op) => `- ${op.code} (${op.action}, ${op.conviction}): ${op.headline} | catalysts: ${(op.catalysts ?? []).join(' · ') || 'none'} | risks: ${(op.risks ?? []).join(' · ') || 'none'}`)
          .join('\n')}`
      : '### Plan picks the report researched\nNone of the plan\'s picks are among the report\'s researched opportunities.',
  );
  return lines.join('\n\n');
}

/**
 * @param {object} scan - the /api/scan payload (focus=cash), see runScan in server.js
 * @param {object[]} analyses - the full analyses that payload was built from
 * @param {object} [opts]
 * @param {object|null} [opts.marketReport] - today's stored market report, if any
 */
export async function reviewCashPlan(scan, analyses, {
  model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE, styleAuto = false, marketReport = null, portfolio = {}, capital = 0,
} = {}) {
  const plan = scan.cashPlan;
  const byCode = new Map(analyses.map((a) => [a.code, a]));
  // The shortlist, in the engine's order: the picks it funded, then the
  // alternates that take over the cash of any pick turned down here.
  const rowByCode = new Map(scan.results.map((row) => [row.code, row]));
  const shortlist = (plan.shortlistCodes ?? plan.selectedCodes ?? []).map((code) => rowByCode.get(code)).filter(Boolean);
  const picks = shortlist.filter((row) => row.cashPlanSelected && row.buyPlan?.shares > 0);
  const alternates = shortlist.filter((row) => !picks.includes(row));
  const pickCodes = shortlist.map((row) => row.code);
  const held = analyses.filter((a) => a.position);
  const { text: walletText } = portfolioContext(analyses, { cash: scan.cash, capital }, rules);
  const behavior = behaviorProfile(portfolio, { capital, today: scan.asOf ?? undefined });
  const investedTotal = picks.reduce((sum, row) => sum + row.buyPlan.cost, 0);
  // The investor chose to spread the cash only across what they already hold
  // (see CASH_POOLS in server.js): every pick is an add to an open position.
  const heldOnly = scan.pool === 'held';

  const userMessage = `# Cash deployment review — close of ${scan.asOf ?? 'today'}
${heldOnly ? `
**The investor chose to put this cash only into stocks they already hold.** Every pick and alternate below is an ADD to an open position, never a new name — judge each as averaging up/down into that holding, weighing its current P&L, its stop and how big it already is. Don't suggest new stocks instead.
` : ''}
## Cash
- Cash available: ${egp(scan.cash)} EGP
- Reserve kept aside by the rules: ${egp(plan.reserveCash)} EGP (min ${rules.sizing.minCashBufferPct}%)
- Investable cash: ${egp(plan.investableCash)} EGP
- The plan below spends ${egp(investedTotal)} EGP, leaving ${egp(plan.unallocatedCash)} EGP of investable cash unallocated
- Limits: max single position ${rules.sizing.maxPositionPct}% · max sector ${rules.sizing.maxSectorPct}% · risk per trade ${rules.sizing.riskPerTradePct}%

${walletText}

## Each holding today (${held.length}) — any rule firing here comes before new buys
${held.map((a) => holdingLine(a, portfolio.positions?.[a.code], scan.asOf)).join('\n') || 'None — the book is all cash.'}

## The investor's trading behavior (computed from their own trade log — judge it, do not recompute it)
${behaviorLines(behavior, { style, styleAuto })}

${marketReportSection(marketReport, pickCodes)}

## The engine's draft cash plan (${picks.length} funded picks, strongest first)
${picks.map((row) => planLine(row, plan.investableCash)).join('\n') || 'The engine found no pick worth funding today.'}

## Alternates (${alternates.length}, ranked next — funded only in place of a pick you turn down)
${alternates.map(alternateLine).join('\n') || 'None.'}

## What happens with your calls
The investor sees the plan only after your review. Every stock you mark wait or skip is left out, and the engine re-splits the investable cash across the stocks you marked buy_now or buy_on_pullback, strongest first, up to ${plan.maxRecommendations ?? picks.length} stocks. So the share counts and order costs above are a draft and will change: never quote a share count, an order's cost or its share of the cash. Prices, stops and targets stay as given.

## Full briefs (picks, then alternates)
${shortlist.map((row) => (byCode.has(row.code) ? briefFor(byCode.get(row.code)) : `### ${row.code}\nBrief unavailable.`)).join('\n\n') || 'None.'}

---
Give me the stance, your read of this portfolio and of this investor's behavior, how to deploy, a call on each of the ${shortlist.length} stocks above (picks, then alternates) in that order, what to do with the reserve and unallocated cash, the risks, and the top priority for next session.
Remember: every number is the engine's — judge it, do not recompute it.`;

  const { data, raw } = await requestStructuredOR({
    model,
    schema: CashPlanReviewSchema,
    schemaName: 'cash_plan_review',
    // Arabic prose runs ~2 characters per token; a comment per pick plus the
    // plan-level fields needs real room even for a nine-stock shortlist.
    maxTokens: Math.min(8000, 2500 + shortlist.length * 500),
    system: cashReviewSystemPrompt(rules, style),
    messages: [{ role: 'user', content: userMessage }],
    feature: 'cash_review',
  });

  // The boundary holds on the way out too: a code the model adds that isn't
  // on the shortlist is dropped rather than shown with no numbers behind it.
  const allowed = new Set(pickCodes);
  const seen = new Set();
  const reviewedPicks = (data.picks ?? []).filter((p) => allowed.has(p.code) && !seen.has(p.code) && seen.add(p.code));
  const unverifiedNumbers = flagUnverifiedNumbers(userMessage, data, reviewedPicks);

  return {
    ...data,
    picks: reviewedPicks,
    _meta: {
      model: raw.model,
      asOf: scan.asOf ?? null,
      usage: raw.usage,
      picksReviewed: pickCodes.length,
      marketReportAsOf: marketReport?.asOf ?? null,
      behavior,
      ...(unverifiedNumbers.length ? { unverifiedNumbers } : {}),
    },
  };
}

/**
 * The cash plan as it stands after the review: the engine's plan rebuilt from
 * the model's call on each shortlisted stock. Only the rows the review could
 * have changed are sent — the draft's picks, the final picks and everything
 * judged — for the dialog to lay over the scan it already has. Null when the
 * scan can't be re-planned.
 */
function reviewedPlan(draft, replan, review) {
  if (!replan) return null;
  const final = replan(new Map((review.picks ?? []).map((pick) => [pick.code, pick.action])));
  const touched = new Set([
    ...(draft.cashPlan?.selectedCodes ?? []),
    ...(draft.cashPlan?.shortlistCodes ?? []),
    ...(final.cashPlan?.selectedCodes ?? []),
    ...(final.cashPlan?.shortlistCodes ?? []),
  ]);
  return {
    cashPlan: final.cashPlan,
    rows: final.results
      .filter((row) => touched.has(row.code))
      .map(({ code, buyPlan, cashPlanSelected, cashPlanNote }) => ({ code, buyPlan, cashPlanSelected, cashPlanNote })),
  };
}

/**
 * Cache-or-generate, same contract as analyst.js's getOrGenerateReview, plus
 * `plan` — the reviewed cash plan (see reviewedPlan), rebuilt on every call
 * rather than stored, so it always matches the scan it lays over.
 * Stored in portfolio_reviews under a `cash:<style>:<index>` style key (plus
 * `:held` for a plan limited to the holdings) and
 * hashed on positions, cash, the trade log's length and where the style came
 * from, so reopening the dialog on an unchanged book the same day is free,
 * while a trade or a cash edit asks again.
 *
 * @param {object} portfolio
 * @param {() => Promise<{payload: object, results: object[], capital: number, replan?: Function}>} runScan - the
 *   cash scan, run once per call: its asOf keys the lookup and its replan
 *   builds the reviewed plan, on a cache hit as well as a miss.
 */
export async function getOrGenerateCashReview(portfolio, {
  portfolioId, style = DEFAULT_STYLE, styleAuto = false, index = 'ALL', pool = 'new', rules = RULES, model = MODEL_CHAIN, force = false, runScan,
}) {
  // portfolio_reviews.portfolio_id is a bigint column — a caller that forgot
  // to pass this (the old opts.userId default was the string 'local', valid
  // back when this was keyed by userId) must fail loudly here, not with an
  // opaque "invalid input syntax for type bigint" from inside getPortfolioReview.
  if (portfolioId == null) throw new Error('getOrGenerateCashReview: opts.portfolioId is required');
  const { payload, results, capital, replan } = await runScan();
  const asOf = payload.asOf ?? new Date().toISOString().slice(0, 10);
  // A plan limited to the holdings is a different plan; the `new` one keeps
  // its original key so reviews cached before the choice existed still match.
  const cacheStyle = pool === 'held' ? `cash:${style}:${index}:held` : `cash:${style}:${index}`;
  // The behavior half of the review changes with every logged trade, not
  // only with positions and cash, so the trade count is part of the key too.
  // `v3`: bumped when the prompt's inputs change, so a review cached under the
  // old prompt isn't served for the rest of the day.
  const hash = `v3:${portfolioHash({ positions: portfolio.positions, watchlist: {}, cash: portfolio.cash })}:${(portfolio.trades ?? []).length}:${styleAuto ? 'auto' : 'manual'}`;

  if (!force) {
    const cached = await getPortfolioReview(portfolioId, asOf, cacheStyle);
    if (cached && cached.portfolioHash === hash) {
      const { portfolioHash: _hash, ...review } = cached;
      return { review, source: 'cached', plan: reviewedPlan(payload, replan, review) };
    }
  }

  // Read-only: never generate the (researched, shared) report from here.
  const marketReport = await getMarketReport(asOf, style).catch(() => null);
  const review = await reviewCashPlan(payload, results, { model, rules, style, styleAuto, marketReport, portfolio, capital });
  await putPortfolioReview(portfolioId, asOf, cacheStyle, hash, review, review._meta.model, review._meta.usage);
  return { review, source: 'ai', plan: reviewedPlan(payload, replan, review) };
}
