/**
 * Investor flows — one closed EGX session's net buying or selling by
 * Egyptians, Arabs and foreigners, and by individuals and institutions.
 *
 * None of the app's feeds carries this, and EGX's own site refuses requests
 * from our servers, so the figures come from an AI web search of the day's
 * market-wrap news, run after the close (see researchInvestorFlows below).
 * A model reading news can misread a sign or swap a group, so nothing is
 * stored unless it passes validateFlows: every buy is someone's sell, so the
 * nets must balance. A day that fails any check is simply not stored, and the
 * panel is then absent from the page rather than showing a stale or doubtful
 * session — see currentSession for which session the page is allowed to show.
 *
 * The rules here are pure (no database, no clock reads beyond the moment
 * passed in) so they can be tested without either.
 */

import { z } from 'zod';

import { cairoDateOf, isTradingDay, previousTradingDay } from './data/cache.js';

/** Cairo wall-clock time at which a session's figures count as closed. */
const CLOSE_MINUTES = 14 * 60 + 30;
/** First attempt, and the end of the retry window (hourly slots 0-5, the last starting 20:30). */
const FIRST_FETCH_MINUTES = 15 * 60 + 30;
const FETCH_WINDOW_END_MINUTES = 21 * 60 + 30;
/** How far a set of nets may be from balancing, as a share of the largest one — article rounding. */
const TOLERANCE = 0.02;
/**
 * The largest nationality net must be at least this many EGP. A balance check
 * can't tell all-zeros, or figures left in millions, from the real thing —
 * a day's biggest net on the EGX is tens of millions of EGP.
 */
const MIN_LARGEST_NET_EGP = 1e6;

const cairoMinutes = (moment) => {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(moment).split(':').map(Number);
  return hour * 60 + minute;
};

/**
 * The session the page may show: today once its close has passed on a trading
 * day, otherwise the most recent trading day before today.
 * @returns {string} YYYY-MM-DD
 */
export function currentSession(moment = new Date()) {
  const today = cairoDateOf(moment);
  if (isTradingDay(today) && cairoMinutes(moment) >= CLOSE_MINUTES) return today;
  return previousTradingDay(today);
}

/**
 * Whether now falls in a fetch slot: hourly from 15:30 to 20:30 Cairo on a
 * trading day. The slot number (0-5) lets a scheduler run once per slot.
 * @returns {{date: string, slot: number}|null}
 */
export function fetchSlot(moment = new Date()) {
  const today = cairoDateOf(moment);
  const minutes = cairoMinutes(moment);
  if (!isTradingDay(today) || minutes < FIRST_FETCH_MINUTES || minutes >= FETCH_WINDOW_END_MINUTES) return null;
  return { date: today, slot: Math.floor((minutes - FIRST_FETCH_MINUTES) / 60) };
}

const GroupSchema = z.object({
  nationality: z.enum(['egyptian', 'arab', 'foreign', 'all']),
  type: z.enum(['individual', 'institution', 'all']),
  netEgp: z.number().describe('Net buying minus selling for the group, in full EGP. Negative = net selling.'),
  sharePct: z.number().nullable().describe("The group's share of the session's trading value, in percent, if stated"),
  buyEgp: z.number().nullable().describe('Gross buy value in full EGP, only if stated'),
  sellEgp: z.number().nullable().describe('Gross sell value in full EGP, only if stated'),
});

export const InvestorFlowsSchema = z.object({
  found: z.boolean().describe('true only if a source states the figures for the requested session'),
  sessionDate: z.string().nullable().describe('YYYY-MM-DD of the session the source reports'),
  sourceUrl: z.string().nullable(),
  groups: z
    .array(GroupSchema)
    .describe("Any subset the source states. 'all' on one axis is that axis's total: egyptian+all is all Egyptians, all+institution is all institutions."),
});

const find = (groups, nationality, type) => groups.find((g) => g.nationality === nationality && g.type === type);

/** True when the values cancel out to within TOLERANCE of the largest one. */
const balances = (values) => {
  const largest = Math.max(...values.map(Math.abs));
  return Math.abs(values.reduce((sum, v) => sum + v, 0)) <= TOLERANCE * largest;
};

/** True when `total` equals the sum of `parts` to within TOLERANCE of the largest of them. */
const agrees = (total, parts) => {
  const largest = Math.max(Math.abs(total), ...parts.map(Math.abs));
  return Math.abs(total - parts.reduce((sum, v) => sum + v, 0)) <= TOLERANCE * largest;
};

const NATIONALITIES = ['egyptian', 'arab', 'foreign'];
const TYPES = ['individual', 'institution'];

/**
 * Check a researched result before it is stored.
 * @param {object} result - what InvestorFlowsSchema parses
 * @param {{date: string}} opts - the session the job asked about
 * @returns {{ok: true, groups: object[], sourceUrl: string} | {ok: false, reason: string}}
 */
export function validateFlows(result, { date }) {
  const fail = (reason) => ({ ok: false, reason });
  if (!result?.found) return fail('not_found');
  if (!result.sourceUrl) return fail('no_source');
  try {
    const { protocol } = new URL(result.sourceUrl);
    if (protocol !== 'http:' && protocol !== 'https:') return fail('bad_source_url');
  } catch {
    return fail('bad_source_url');
  }
  if (result.sessionDate !== date) return fail('wrong_date');

  const groups = result.groups ?? [];
  const keys = groups.map((g) => `${g.nationality}/${g.type}`);
  if (new Set(keys).size !== keys.length) return fail('duplicate_group');

  const nationalityTotals = NATIONALITIES.map((n) => find(groups, n, 'all'));
  if (nationalityTotals.some((g) => !g)) return fail('missing_nationality');
  const typeTotals = TYPES.map((t) => find(groups, 'all', t));
  const cells = NATIONALITIES.flatMap((n) => TYPES.map((t) => find(groups, n, t)));

  if (Math.max(...nationalityTotals.map((g) => Math.abs(g.netEgp))) < MIN_LARGEST_NET_EGP) return fail('implausible_scale');
  if (!balances(nationalityTotals.map((g) => g.netEgp))) return fail('nets_do_not_balance');
  if (typeTotals.every(Boolean) && !balances(typeTotals.map((g) => g.netEgp))) return fail('nets_do_not_balance');
  if (cells.every(Boolean) && !balances(cells.map((g) => g.netEgp))) return fail('nets_do_not_balance');

  for (const total of nationalityTotals) {
    const parts = TYPES.map((t) => find(groups, total.nationality, t));
    if (parts.every(Boolean) && !agrees(total.netEgp, parts.map((g) => g.netEgp))) return fail('total_mismatch');
  }
  for (const total of typeTotals) {
    if (!total) continue;
    const parts = NATIONALITIES.map((n) => find(groups, n, total.type));
    if (parts.every(Boolean) && !agrees(total.netEgp, parts.map((g) => g.netEgp))) return fail('total_mismatch');
  }

  return { ok: true, groups: groups.map(cleanExtras), sourceUrl: result.sourceUrl };
}

/**
 * The share and gross buy/sell figures are shown beside a net, but nothing
 * else checks them, so they only survive if they are consistent with it:
 * a share must be 0-100, and gross buy and sell must both be present and
 * satisfy net = buy - sell (to the usual tolerance). Otherwise they are
 * dropped and the group keeps its (checked) net alone.
 */
function cleanExtras(group) {
  const out = { ...group };
  if (out.sharePct !== null && !(out.sharePct >= 0 && out.sharePct <= 100)) out.sharePct = null;
  const { buyEgp, sellEgp } = out;
  const grossOk = buyEgp !== null && sellEgp !== null && agrees(out.netEgp, [buyEgp - sellEgp]);
  if (!grossOk) {
    out.buyEgp = null;
    out.sellEgp = null;
  }
  return out;
}

/**
 * Ask the web who bought and sold in one EGX session. Returns the parsed
 * answer, or null when research isn't available or fails.
 * @param {string} date - YYYY-MM-DD of the session
 * @param {{request?: Function}} opts - requestStructuredOR, injected
 */
export async function researchInvestorFlows(date, { request } = {}) {
  if (!request) return null;
  const prompt = `Find the investor-type trading breakdown for the Egyptian Exchange (EGX) session of ${date}.

Report each group's NET buying or selling for that exact session, in full EGP (convert millions and billions): net selling is a negative number. The market-wrap news states it in phrases like "صافي شراء / صافي بيع" and "تعاملات المصريين والعرب والأجانب" and "الأفراد والمؤسسات". Report:
- the three nationality totals: Egyptians (egyptian), Arabs (arab), foreigners (foreign) — use type 'all';
- the two type totals: individuals (individual), institutions (institution) — use nationality 'all';
- the six nationality × type cells, only if the source states them.
Also report each group's share of the session's trading value (%) and its gross buy and sell values, but only when the source states them.

Good sources: egx.com.eg, mubasher.info, argaam.com, enterprise.press, Al Mal, broker market wraps (Thndr, EFG Hermes, HC). The figures must be for ${date} itself, not the day before or after. If you can't find them for that exact date, return found=false; never guess or estimate a number.`;
  try {
    const { data } = await request({
      schema: InvestorFlowsSchema,
      schemaName: 'investor_flows',
      maxTokens: 2000,
      system: 'You research investor-type trading figures for the Egyptian Exchange for a market tracker. Only report numbers a source states. Answer in the required format.',
      messages: [{ role: 'user', content: prompt }],
      webSearch: { engine: 'auto', max_results: 5, max_uses: 4 },
      feature: 'investor_flows',
    });
    return data;
  } catch (err) {
    console.warn(`[investor-flows] research for ${date} failed:`, err.message);
    return null;
  }
}

/**
 * Research one session and store it if it passes the checks.
 * @param {object} opts
 * @param {string} opts.date - YYYY-MM-DD
 * @param {Function} opts.request - requestStructuredOR
 * @param {{get: Function, save: Function}} opts.store - getInvestorFlows / saveInvestorFlows
 * @param {boolean} [opts.force] - research again even if a row exists, replacing it
 * @returns {Promise<{status: 'saved'|'exists'|'not_found'|'rejected'|'error', reason?: string}>}
 */
export async function fetchAndSaveInvestorFlows({ date, request, store, force = false }) {
  if (!force && (await store.get(date))) return { status: 'exists' };

  const researched = await researchInvestorFlows(date, { request });
  if (!researched) return { status: 'error' };

  const checked = validateFlows(researched, { date });
  if (!checked.ok) {
    if (checked.reason === 'not_found') return { status: 'not_found' };
    console.warn(`[investor-flows] rejected for ${date}: ${checked.reason}`);
    return { status: 'rejected', reason: checked.reason };
  }

  await store.save({ sessionDate: date, groups: checked.groups, sourceUrl: checked.sourceUrl });
  return { status: 'saved' };
}
