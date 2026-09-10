/**
 * Fundamentals agent.
 *
 * Yahoo has no fundamentals for EGX — `quoteSummary` returns "No fundamentals
 * data found for symbol: COMI.CA" for every Cairo listing, verified against the
 * live endpoint. So this agent gathers them from the open web instead, using
 * the server-side web search tool, and writes them to a local cache.
 *
 * EGX companies report quarterly, so a cached entry is good for ~45 days;
 * re-running this daily would burn tokens for data that has not changed.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, requestStructuredOR } from './clientOpenRouter.js';
import { FundamentalsSchema } from './schemas.js';
import { fundamentalsSystemPrompt } from './prompts/system.js';
import { lookup } from '../config/universe.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'data', 'fundamentals');
const MAX_AGE_DAYS = 45;

async function readCached(code) {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(DIR, `${code}.json`), 'utf8'));
    const ageDays = (Date.now() - new Date(raw._fetchedAt).getTime()) / 86_400_000;
    return ageDays <= MAX_AGE_DAYS ? { ...raw, _ageDays: Math.round(ageDays) } : null;
  } catch {
    return null;
  }
}

async function writeCached(code, data) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(
    path.join(DIR, `${code}.json`),
    JSON.stringify({ ...data, _fetchedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

/**
 * Gather fundamentals for one ticker.
 * @returns {Promise<object|null>} null when nothing trustworthy was found.
 */
export async function getFundamentals(code, { force = false, model = MODEL } = {}) {
  const upper = code.toUpperCase();
  if (!force) {
    const cached = await readCached(upper);
    if (cached) return { ...cached, _fromCache: true };
  }

  const meta = lookup(upper);

  const prompt = `Research the fundamentals of "${meta?.en ?? upper}" (${meta?.ar ?? ''}), listed on the Egyptian Stock Exchange under ticker ${upper}.

Look for:
- Latest disclosed financial results (revenue, net profit, earnings per share)
- Current P/E ratio and book value
- Cash dividends and their yield
- Revenue and profit growth versus the same period last year
- Debt-to-equity ratio
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
