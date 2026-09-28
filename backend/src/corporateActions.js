/**
 * Corporate actions on held stocks: bonus shares, splits, reverse splits and
 * share-swap mergers that change how many shares a User holds without any
 * money moving.
 *
 * The price feeds (Yahoo, TradingView with `adjustment: splits`) rewrite a
 * stock's whole history onto the new share basis the day such an event lands,
 * but a Position's share count and average cost are the User's own numbers
 * and nothing rewrote them. POUL's 2026-09 merger showed the result: the
 * broker handed out ~2.69 shares per share held, the price fell from ~102 to
 * ~38, and the book kept 385 shares at a 102 average — a phantom 63% loss,
 * a stop far above the price and a Recommendation built on it.
 *
 * Detection needs no outside source. Every daily close stores each holding's
 * raw price in the portfolio log, so comparing those saved prices with the
 * feed's (adjusted) close for the same sessions gives the adjustment factor
 * directly: before the event they differ by the factor, after it they agree.
 * A live quote far from the last saved close (EGX's daily limits make a 30%
 * overnight move impossible without one) is the same-day signal, before the
 * feed has caught up.
 *
 * The factor read off prices is only as exact as the prices, and the share
 * count has to be exact, so a web search then looks for the announced ratio
 * (EGX disclosures, Mubasher, the broker's notice). The announced ratio is
 * used only when it agrees with the prices; a rights issue — which moves the
 * price but hands out nothing — is never applied.
 *
 * What was changed is kept in `portfolio.corporateActions`, with the holding
 * before and after, so the card can say what happened and offer an undo.
 */

import { z } from 'zod';

/** Smallest factor treated as an event — a 5% bonus (1 per 20) and up. */
const MIN_FACTOR_MOVE = 0.04;
/** How closely saved prices on the same side of an event must agree. */
const SAME_SIDE_TOLERANCE = 0.02;
/** An announced ratio must land this close to the one the prices imply. */
const RESEARCH_TOLERANCE = 0.03;
/**
 * ...or this close to a same-day gap, whose factor also carries the day's own
 * move (EGX's limit is ±10–20%). Still far apart enough to tell 2.69 from 3.69.
 */
const GAP_RESEARCH_TOLERANCE = 0.15;
/** An overnight move this large can't be the market on EGX. */
const GAP_MOVE = 0.3;
/** How far back an unadjusted jump in a feed's own bars is looked for. */
const RECENT_GAP_SESSIONS = 5;
/** Saved prices read from each side of an event. */
const MAX_PRE_ANCHORS = 5;
/** Records kept on the portfolio. */
const MAX_RECORDS = 50;
/** A stock-level event older than this isn't applied to a holding with no saved closes. */
const STORED_EVENT_DAYS = 30;
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** Kinds that hand out (or consolidate) shares, so the holding follows. */
const SHARE_KINDS = new Set(['bonus', 'split', 'reverse_split', 'merger']);

export const CORPORATE_ACTION_KIND_LABEL = {
  bonus: 'أسهم مجانية',
  split: 'تجزئة',
  reverse_split: 'تجميع أسهم',
  merger: 'اندماج',
  rights: 'اكتتاب (حقوق أولوية)',
  other: 'إجراء على السهم',
  none: 'إجراء على السهم',
};

const logDistance = (a, b) => Math.abs(Math.log(a / b));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * The raw prices this app itself saved for `code`, oldest first — one per
 * real daily close. Backfilled entries are left out: they were built from the
 * feed's adjusted closes, so they'd agree with it whatever happened.
 */
export function savedPrices(portfolio, code) {
  return Object.entries(portfolio.log ?? {})
    .filter(([, entry]) => !entry?.reconstructed && entry?.prices?.[code] > 0)
    .map(([date, entry]) => ({ date, price: entry.prices[code] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The most recent share-basis change the feed's bars show against the prices
 * the app saved, or null. Walking back from the newest saved close: closes
 * that match the feed are after the event (or there was none); the first run
 * of closes that sit a steady factor above or below it is from before it.
 *
 * @param {{date:string, price:number}[]} anchors - savedPrices(), oldest first
 * @param {{date:string, c:number}[]} bars - the feed's daily bars
 * @returns {null | {factor:number, lastBefore:string, firstAfter:string|null, anchors:number, spread:number, strong:boolean, source:'prices'}}
 *   factor is shares after per share before (2.69 for POUL); lastBefore is
 *   the last saved close still on the old basis, firstAfter the first on the
 *   new one (null when none is saved yet).
 */
export function findAdjustment(anchors, bars) {
  const closeOn = new Map((bars ?? []).map((b) => [b.date, b.c]));
  const pairs = (anchors ?? [])
    .filter((a) => closeOn.get(a.date) > 0)
    .map((a) => ({ date: a.date, ratio: a.price / closeOn.get(a.date) }));

  let i = pairs.length - 1;
  while (i >= 0 && logDistance(pairs[i].ratio, 1) <= MIN_FACTOR_MOVE) i--;
  if (i < 0) return null;
  const firstAfter = i < pairs.length - 1 ? pairs[i + 1].date : null;

  const before = [pairs[i]];
  let j = i - 1;
  for (; j >= 0 && before.length < MAX_PRE_ANCHORS; j--) {
    if (logDistance(pairs[j].ratio, pairs[i].ratio) > SAME_SIDE_TOLERANCE) break;
    before.push(pairs[j]);
  }
  // An adjustment rewrites the whole history, so the closes older than the
  // run disagree with the feed too. Older ones that still agree mean the
  // feed never caught up with the newer closes — a stale bar still on the
  // old basis after the event (POUL on 2026-09-27: a 9.71 close against a
  // bar still at 38.9 read as a 0.249 "event") — not an event of its own.
  if (j >= 0 && before.length < MAX_PRE_ANCHORS && logDistance(pairs[j].ratio, 1) <= MIN_FACTOR_MOVE) return null;
  const factor = median(before.map((p) => p.ratio));
  const spread = Math.max(...before.map((p) => logDistance(p.ratio, factor)));
  return {
    factor,
    lastBefore: pairs[i].date,
    firstAfter,
    anchors: before.length,
    spread,
    // Three closes agreeing within 1% can't be a mistimed snapshot or two.
    strong: before.length >= 3 && spread <= 0.01,
    source: 'prices',
  };
}

/**
 * The same-day signal: a live quote this far from the last saved close. Only
 * a candidate — a halted stock reopening can gap too — so it is never
 * applied without an announced ratio behind it.
 */
export function findGap(anchors, livePrice, today) {
  const last = anchors?.at(-1);
  if (!last || !(livePrice > 0) || last.date >= today) return null;
  if (logDistance(last.price / livePrice, 1) < Math.log(1 + GAP_MOVE)) return null;
  return { factor: last.price / livePrice, lastBefore: last.date, firstAfter: today, anchors: 1, spread: 0, strong: false, source: 'gap' };
}

/**
 * The day a holding's shares and average cost were last set — by a trade, an
 * import, a hand fix. Positions saved before `sharesSetAt` existed fall back
 * to the later of when they were opened (an import resets that) and their
 * last trade.
 */
export function basisDate(portfolio, code) {
  const pos = portfolio.positions?.[code];
  if (!pos) return null;
  if (pos.sharesSetAt) return { date: pos.sharesSetAt, known: true };
  const lastTrade = (portfolio.trades ?? [])
    .filter((t) => t.code === code && (t.side === 'buy' || t.side === 'sell'))
    .map((t) => String(t.date).slice(0, 10))
    .sort()
    .at(-1);
  const opened = pos.openedAt ? String(pos.openedAt).slice(0, 10) : null;
  return { date: [opened, lastTrade].filter(Boolean).sort().at(-1) ?? null, known: false };
}

/**
 * Whether a holding still carries the old basis. A holding whose numbers were
 * set after the event already has the new ones (a screenshot re-imported from
 * the broker, say). In between — or for a position too old to know — the
 * average cost decides: the new basis is the one it sits closer to the price on.
 */
export function holdsOldBasis(pos, basis, candidate, price) {
  if (!pos || !(pos.shares > 0)) return false;
  if (basis?.date && candidate.firstAfter && basis.date >= candidate.firstAfter) return false;
  if (basis?.known && basis.date && basis.date <= candidate.lastBefore) return true;
  if (!(price > 0) || !(pos.avgCost > 0)) return false;
  return logDistance(pos.avgCost / candidate.factor, price) < logDistance(pos.avgCost, price);
}

/** The holding on the new basis: more shares, same money in. */
export function adjustHolding(pos, factor) {
  const shares = Math.max(1, Math.round(pos.shares * factor));
  const scale = (level) => (level > 0 ? +(level / factor).toFixed(2) : level ?? null);
  return {
    ...pos,
    shares,
    avgCost: +((pos.shares * pos.avgCost) / shares).toFixed(4),
    stop: scale(pos.stop),
    target: scale(pos.target),
  };
}

/**
 * Whether a stop or target is still on the old basis: on the new one it sits
 * closer to the price once divided by the factor than as it is. A 35.48 stop
 * against a 14.2 price after a 2.69 bonus: 13.2 is the real level, not a
 * breached stop.
 */
export function onOldScale(level, factor, price) {
  if (!(level > 0) || !(price > 0) || !(factor > 0)) return false;
  return logDistance(level / factor, price) < logDistance(level, price);
}

/** Only the stop and target moved to the new basis: the share count already was. */
export function adjustLevels(pos, factor) {
  const scale = (level) => (level > 0 ? +(level / factor).toFixed(2) : level ?? null);
  return { ...pos, stop: scale(pos.stop), target: scale(pos.target) };
}

/** Whether a holding's stored stop/target need moving to the new basis. */
function levelsOnOldScale(pos, factor, price) {
  if (pos.stop > 0) return onOldScale(pos.stop, factor, price);
  return pos.target > 0 && onOldScale(pos.target, factor, price);
}

// ---- The stock's own prices -------------------------------------------------

/**
 * A stock's live quote this far from its last cached close is the event
 * itself, seen before the feed adjusts — as is the same jump between two
 * recent bars of a feed that doesn't adjust at all. Returns a suspected event
 * (its factor still carries the day's own move until research pins it down)
 * or null.
 */
export function gapEvent(code, bars, livePrice, today) {
  const isGap = (before, after) => before > 0 && after > 0 && logDistance(before / after, 1) >= Math.log(1 + GAP_MOVE);
  const event = (bar, after) => ({ code, lastBefore: bar.date, rawBefore: bar.c, factor: bar.c / after, status: 'suspected', source: 'gap' });
  const last = bars?.at(-1);
  if (!last) return null;
  if (last.date < today && isGap(last.c, livePrice)) return event(last, livePrice);
  // A feed that never adjusts keeps the jump in its history.
  for (let i = bars.length - 1; i >= Math.max(1, bars.length - RECENT_GAP_SESSIONS); i--) {
    if (isGap(bars[i - 1].c, bars[i].c)) return event(bars[i - 1], bars[i].c);
  }
  return null;
}

/**
 * The bars on the event's new basis. A feed that already adjusted them is
 * left as it is; one still showing the raw close on the last old-basis
 * session has everything up to it divided by the factor (volume multiplied).
 * @returns {{bars: object[], rescaled: boolean}}
 */
export function onNewBasis(bars, event) {
  if (!event || !bars?.length) return { bars, rescaled: false };
  const pivot = bars.find((b) => b.date === event.lastBefore);
  if (!pivot || logDistance(pivot.c, event.rawBefore) > 0.02) return { bars, rescaled: false };
  const k = event.factor;
  const scaled = bars.map((b) =>
    b.date > event.lastBefore ? b : { ...b, o: b.o / k, h: b.h / k, l: b.l / k, c: b.c / k, v: Math.round((b.v ?? 0) * k) },
  );
  return { bars: scaled, rescaled: true };
}

const levelsOf = (pos) => ({ shares: pos.shares, avgCost: pos.avgCost, stop: pos.stop ?? null, target: pos.target ?? null });

export const CorporateActionResearchSchema = z.object({
  found: z.boolean().describe('true only if a source was found for a corporate action in the window'),
  kind: z.enum(['bonus', 'split', 'reverse_split', 'merger', 'rights', 'other', 'none']),
  sharesAfterPerShare: z
    .number()
    .nullable()
    .describe('Shares a holder of ONE share owns right after the event, the original share included: a 1-for-4 bonus is 1.25, a 2-for-1 split is 2, a 1-for-10 reverse split is 0.1. null if not stated.'),
  effectiveDate: z.string().nullable().describe('YYYY-MM-DD the shares were credited / the price adjusted, if stated'),
  summaryAr: z.string().describe('One short Egyptian-Arabic sentence: what happened and the ratio'),
  sourceUrl: z.string().nullable(),
});

/**
 * Ask the web what happened, with the window the prices point at. Returns the
 * parsed answer or null when research isn't available or fails.
 */
export async function researchCorporateAction(code, candidate, { name = null, request } = {}) {
  if (!request) return null;
  const window = candidate.firstAfter
    ? `between ${candidate.lastBefore} and ${candidate.firstAfter}`
    : `on or after ${candidate.lastBefore}`;
  const prompt = `The Egyptian Exchange stock ${code}${name ? ` (${name})` : ''} changed its share basis ${window}: its price history was adjusted by a factor of about ${candidate.factor.toFixed(3)} (price before ÷ price after).

Find the corporate action behind it — bonus/free shares (أسهم مجانية / توزيع أسهم منحة), a stock split (تجزئة), a reverse split (تجميع), a merger share swap (اندماج / معامل مبادلة), or a rights issue (زيادة رأس مال نقدية / حق اكتتاب) — and its exact announced ratio.

Good sources: egx.com.eg disclosures, mubasher.info, argaam.com, enterprise.press, the company's site, broker notices (Thndr, EFG Hermes).

Report sharesAfterPerShare as the shares a holder of ONE share owns right after the event, counting the original share. Brokers often phrase a bonus as "X free shares for every 1 share" — read carefully whether X includes the original share, and report the total either way. If you can't find the exact ratio, return found=false; never guess a number.`;
  try {
    const { data } = await request({
      schema: CorporateActionResearchSchema,
      schemaName: 'corporate_action',
      maxTokens: 1500,
      system: 'You research corporate actions on Egyptian Exchange stocks for a portfolio tracker. Only report what a source states. Answer in the required format.',
      messages: [{ role: 'user', content: prompt }],
      webSearch: { engine: 'auto', max_results: 5, max_uses: 4 },
      feature: 'corporate_action',
    });
    return data;
  } catch (err) {
    console.warn(`[corporate-actions] research for ${code} failed:`, err.message);
    return null;
  }
}

/**
 * The announced factor, when research found one the prices agree with. A
 * "X free shares per share" read the other way round is off by exactly one,
 * so X+1 is tried too.
 */
export function confirmedFactor(research, candidate) {
  if (!research?.found || !SHARE_KINDS.has(research.kind)) return null;
  const stated = research.sharesAfterPerShare;
  if (!(stated > 0)) return null;
  const tolerance = candidate.source === 'gap' ? GAP_RESEARCH_TOLERANCE : RESEARCH_TOLERANCE;
  const options = [stated, stated + 1].filter((f) => logDistance(f, candidate.factor) <= tolerance);
  if (!options.length) return null;
  return options.sort((a, b) => logDistance(a, candidate.factor) - logDistance(b, candidate.factor))[0];
}

/** What to do with a candidate once research (if any) is in. */
export function decide(candidate, research) {
  const confirmed = confirmedFactor(research, candidate);
  if (confirmed) return { status: 'applied', factor: confirmed, confirmedBy: 'research' };
  // A rights issue moves the price but hands out nothing: the new shares are
  // bought, and get recorded as a buy.
  if (research?.kind === 'rights') return { status: 'pending', factor: candidate.factor, confirmedBy: null };
  if (candidate.source === 'prices' && candidate.strong) return { status: 'applied', factor: candidate.factor, confirmedBy: 'prices' };
  return { status: 'pending', factor: candidate.factor, confirmedBy: null };
}

const recordFor = (portfolio, code, lastBefore) =>
  (portfolio.corporateActions ?? []).find((r) => r.code === code && r.lastBefore === lastBefore) ?? null;

/**
 * Settled once applied, undone or dismissed. A pending one — the day-one gap
 * with no ratio found yet — is looked at again, so it can still go through
 * once the feed adjusts or the announcement turns up.
 */
const alreadySeen = (portfolio, code, lastBefore) => {
  const record = recordFor(portfolio, code, lastBefore);
  return Boolean(record) && (record.status !== 'pending' || Boolean(record.dismissedAt));
};

/**
 * Find every held stock whose share basis changed under it. Slow parts
 * (bars, live quotes, web research) run here, outside the portfolio lock;
 * applyCorporateActions() then re-checks against the portfolio as it is.
 *
 * @param {object} portfolio
 * @param {object} deps
 * @param {(code:string) => Promise<object[]|null>} deps.barsFor - cached daily bars
 * @param {(code:string) => Promise<object[]|null>} [deps.freshBarsFor] - bars re-fetched from the feed
 * @param {Map<string, number>} [deps.livePrices]
 * @param {(code:string, candidate:object) => Promise<object|null>} [deps.research]
 * @param {string} deps.today - Cairo YYYY-MM-DD
 * @returns {Promise<object[]>} proposals
 */
export async function detectCorporateActions(portfolio, { barsFor, freshBarsFor = null, livePrices = new Map(), research = null, eventFor = null, today }) {
  const proposals = [];
  for (const [code, pos] of Object.entries(portfolio.positions ?? {})) {
    try {
      const anchors = savedPrices(portfolio, code);
      const live = livePrices.get(code) ?? null;
      // No saved closes of its own (a fresh import, say): the stock-level
      // record the analysis keeps (data/corporateEvents.js) stands in.
      if (!anchors.length) {
        const event = eventFor ? await eventFor(code) : null;
        if (!event || alreadySeen(portfolio, code, event.lastBefore) || daysBetween(event.lastBefore, today) > STORED_EVENT_DAYS) continue;
        anchors.push({ date: event.lastBefore, price: event.rawBefore, stored: event });
      }

      const stored = anchors[0]?.stored;
      let candidate = stored
        ? { factor: stored.factor, lastBefore: stored.lastBefore, firstAfter: null, anchors: 0, spread: 0, strong: stored.status === 'confirmed', source: stored.status === 'confirmed' ? 'prices' : 'gap' }
        : findAdjustment(anchors, await barsFor(code));
      const gap = stored ? null : findGap(anchors, live, today);
      // The feed may not have adjusted yet on the day itself — or the cache
      // predates the event. Ask it again before settling for the gap alone.
      if (gap && (!candidate || alreadySeen(portfolio, code, candidate.lastBefore)) && freshBarsFor) {
        candidate = findAdjustment(anchors, await freshBarsFor(code).catch(() => null)) ?? candidate;
      }
      if ((!candidate || alreadySeen(portfolio, code, candidate.lastBefore)) && gap) candidate = gap;
      if (!candidate || alreadySeen(portfolio, code, candidate.lastBefore)) continue;

      const price = live ?? (await barsFor(code))?.at(-1)?.c ?? null;
      const rawBefore = anchors.find((a) => a.date === candidate.lastBefore)?.price ?? null;
      if (!holdsOldBasis(pos, basisDate(portfolio, code), candidate, price)) {
        // The shares are already right (a fresh broker screenshot, a hand
        // fix) but a stop or target set before the event isn't: moved alone,
        // so it doesn't read as a breach.
        if (!levelsOnOldScale(pos, candidate.factor, price)) continue;
        const found = research ? await research(code, candidate) : null;
        const announced = confirmedFactor(found, candidate);
        // Nothing asks the User first here, so the ratio has to be one the
        // holding path would apply on its own too.
        if (!announced && !(candidate.source === 'prices' && candidate.strong)) continue;
        const factor = announced ?? candidate.factor;
        proposals.push({
          code,
          lastBefore: candidate.lastBefore,
          firstAfter: candidate.firstAfter,
          rawBefore,
          source: candidate.source,
          priceFactor: +candidate.factor.toFixed(6),
          factor: +factor.toFixed(9),
          status: 'applied',
          levelsOnly: true,
          confirmedBy: announced ? 'research' : 'prices',
          kind: found?.found ? found.kind : null,
          summary: found?.found ? found.summaryAr : null,
          sourceUrl: found?.found ? found.sourceUrl : null,
          effectiveDate: found?.found ? found.effectiveDate : null,
          before: levelsOf(pos),
        });
        continue;
      }

      const found = research ? await research(code, candidate) : null;
      const { status, factor, confirmedBy } = decide(candidate, found);
      proposals.push({
        code,
        lastBefore: candidate.lastBefore,
        firstAfter: candidate.firstAfter,
        rawBefore,
        source: candidate.source,
        priceFactor: +candidate.factor.toFixed(6),
        factor: +factor.toFixed(9),
        status,
        confirmedBy,
        kind: found?.found ? found.kind : null,
        summary: found?.found ? found.summaryAr : null,
        sourceUrl: found?.found ? found.sourceUrl : null,
        effectiveDate: found?.found ? found.effectiveDate : null,
        before: levelsOf(pos),
      });
    } catch (err) {
      console.warn(`[corporate-actions] ${code} skipped:`, err.message);
    }
  }
  return proposals;
}

/**
 * Apply proposals to the portfolio as it stands under the lock. A proposal
 * whose holding changed since it was made, or that was already recorded, is
 * dropped — the next run looks again. No cash flow is recorded: the same
 * money sits in more shares.
 */
export function applyCorporateActions(portfolio, proposals, now = new Date()) {
  let positions = portfolio.positions;
  let records = portfolio.corporateActions ?? [];
  let changed = false;
  for (const proposal of proposals) {
    const pos = positions[proposal.code];
    if (!pos || alreadySeen(portfolio, proposal.code, proposal.lastBefore)) continue;
    if (pos.shares !== proposal.before.shares || pos.avgCost !== proposal.before.avgCost) continue;
    const pending = recordFor(portfolio, proposal.code, proposal.lastBefore);
    // Still pending, nothing new to say: leave the record (and its date) be.
    if (pending && proposal.status === 'pending') continue;
    const record = { ...proposal, at: now.toISOString() };
    if (proposal.status === 'applied') {
      const next = proposal.levelsOnly ? adjustLevels(pos, proposal.factor) : adjustHolding(pos, proposal.factor);
      positions = { ...positions, [proposal.code]: next };
      record.after = levelsOf(next);
    }
    records = [...records.filter((r) => r !== pending), record];
    changed = true;
  }
  if (!changed) return portfolio;
  return { ...portfolio, positions, corporateActions: records.slice(-MAX_RECORDS) };
}

/**
 * The User's answer to a record on the card: `undo` an applied one, `apply` a
 * pending one, or `dismiss` either (it stops showing). Undo and apply only go
 * through while the holding is still exactly what the record left it as.
 */
export function resolveCorporateAction(portfolio, { code, lastBefore, action }, now = new Date()) {
  const records = portfolio.corporateActions ?? [];
  const index = records.findIndex((r) => r.code === code && r.lastBefore === lastBefore);
  if (index < 0) throw new Error('الإجراء ده مش موجود — حدّث الصفحة وجرب تاني.');
  const record = records[index];
  const pos = portfolio.positions?.[code];
  const same = (levels) => pos && levels && pos.shares === levels.shares && pos.avgCost === levels.avgCost;

  let positions = portfolio.positions;
  let next;
  if (action === 'dismiss') {
    next = { ...record, dismissedAt: now.toISOString() };
  } else if (action === 'undo') {
    if (record.status !== 'applied') throw new Error('الإجراء ده متطبقش أصلاً.');
    if (!same(record.after)) throw new Error(`عدد أسهم ${code} اتغير بعد التعديل — صحّحه من «إدخال يدوي».`);
    positions = { ...positions, [code]: { ...pos, ...record.before } };
    next = { ...record, status: 'undone', resolvedAt: now.toISOString() };
  } else if (action === 'apply') {
    if (record.status !== 'pending' && record.status !== 'undone') throw new Error('الإجراء ده متطبق بالفعل.');
    if (!same(record.before)) throw new Error(`عدد أسهم ${code} اتغير من وقتها — صحّحه من «إدخال يدوي».`);
    const adjusted = record.levelsOnly ? adjustLevels(pos, record.factor) : adjustHolding(pos, record.factor);
    positions = { ...positions, [code]: adjusted };
    next = { ...record, status: 'applied', after: levelsOf(adjusted), resolvedAt: now.toISOString() };
  } else {
    throw new Error('الإجراء لازم يكون undo أو apply أو dismiss');
  }
  const corporateActions = [...records];
  corporateActions[index] = next;
  return { ...portfolio, positions, corporateActions };
}
