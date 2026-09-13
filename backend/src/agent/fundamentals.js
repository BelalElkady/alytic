/**
 * Fundamentals agent.
 *
 * Yahoo has no fundamentals for EGX — `quoteSummary` returns "No fundamentals
 * data found for symbol: COMI.CA" for every Cairo listing, verified against the
 * live endpoint. So this agent gathers them from the open web instead, using
 * the server-side web search tool, and writes them to a shared cache in
 * Supabase (fundamentals_cache) — not local disk, so the research survives a
 * redeploy and is shared across every app instance rather than re-paid for
 * per machine.
 *
 * EGX companies report quarterly, so a cached entry is good for ~45 days;
 * re-running this daily would burn tokens for data that has not changed.
 */

import { MODEL_CHAIN, requestStructuredOR } from './clientOpenRouter.js';
import { FundamentalsSchema } from './schemas.js';
import { fundamentalsSystemPrompt } from './prompts/system.js';
import { lookup } from '../config/universe.js';
import { getFundamentalsCache, putFundamentalsCache } from '../db.js';

const MAX_AGE_DAYS = 45;

async function readCached(code) {
  const raw = await getFundamentalsCache(code);
  if (!raw) return null;
  const ageDays = (Date.now() - new Date(raw._fetchedAt).getTime()) / 86_400_000;
  return ageDays <= MAX_AGE_DAYS ? { ...raw, _ageDays: Math.round(ageDays) } : null;
}

async function writeCached(code, data) {
  await putFundamentalsCache(code, data);
}

/**
 * Gather fundamentals for one ticker.
 * @returns {Promise<object|null>} null when nothing trustworthy was found.
 */
export async function getFundamentals(code, { force = false, model = MODEL_CHAIN } = {}) {
  const upper = code.toUpperCase();
  if (!force) {
    const cached = await readCached(upper);
    if (cached) return { ...cached, _fromCache: true };
  }

  const meta = lookup(upper);

  const prompt = `Research the fundamentals of "${meta?.en ?? upper}" (${meta?.ar ?? ''}), listed on the Egyptian Stock Exchange under ticker ${upper}.

Look for:
- Latest disclosed financial results (revenue, net profit, earnings per share)
- Current P/E ratio, P/B ratio, and book value
- Cash dividends and their yield
- Dividend history: the most recent cash or stock/bonus distributions, each with its ex-dividend date, payment date (if disclosed), and amount per share — go back up to 3 years if available. Return an empty list if this company has never distributed a dividend; do not guess a date or amount you didn't actually find.
- Revenue and profit growth versus the same period last year
- Debt-to-equity ratio, current ratio, and net debt/EBITDA
- Return on equity (ROE) and return on assets (ROA)
- EV/EBITDA and free cash flow yield, if derivable from disclosed figures
- Any material news in the last 3 months (deals, expansions, management changes, earnings surprises)

Good sources: the official EGX website (egx.com.eg), Mubasher (mubasher.info), Argaam (argaam.com), the company's official website, and broker reports.

Return the result in the required format. If you cannot find a reliable number, return null rather than guessing.`;

  let parsed;
  try {
    const { data } = await requestStructuredOR({
      model,
      schema: FundamentalsSchema,
      schemaName: 'fundamentals',
      maxTokens: 4000,
      system: fundamentalsSystemPrompt(),
      messages: [{ role: 'user', content: prompt }],
      webSearch: { engine: 'auto', max_results: 4, max_uses: 8 },
      feature: 'fundamentals',
    });
    parsed = data;
  } catch {
    // A malformed or unfindable answer is not worth caching or trusting.
    return null;
  }

  if (parsed.confidence === 'منخفضة' && !parsed.sources?.length) return null;

  await writeCached(upper, parsed);
  return { ...parsed, _fromCache: false };
}

/** Fetch fundamentals for several tickers, sequentially (web search is slow and rate-limited). */
export async function getFundamentalsMany(codes, opts = {}) {
  const out = new Map();
  for (const code of codes) {
    try {
      const f = await getFundamentals(code, opts);
      if (f) out.set(code.toUpperCase(), f);
    } catch {
      // A failed lookup must never sink the whole run.
    }
  }
  return out;
}
