/**
 * oanor — a paid, keyed feed of EGX quotes that is closer to live than the
 * TradingView scrape (tv-history.js), which runs about 15 minutes behind
 * during the session (see issue #44). Only live-quotes.js calls this, for
 * subscribers; see docs/adr/0001-live-prices-for-subscribers-via-oanor.md.
 *
 * API: GET https://api.oanor.com/egx-api/v1/quote?codes=COMI,TMGH with the
 * key in the x-oanor-key header, up to 20 tickers per call. The answer is
 * { success, data: { quotes: [{ ticker, price, change, change_percent, … }] } }.
 * Plans (per month): Free 12,200 calls at 2 req/s, Basic 263,000 at 10 req/s,
 * Pro 1,420,000 at 20 req/s, Scale 7,520,000 at 50 req/s.
 */

export const OANOR_CLIENT_READY = true;

export const OANOR_QUOTE_URL = 'https://api.oanor.com/egx-api/v1/quote';

/** oanor takes at most this many tickers in one call. */
export const OANOR_MAX_CODES_PER_CALL = 20;

/**
 * Why an oanor call failed, which decides what live-quotes.js does next:
 * - 'quota': the billing period's call quota is used up, or the plan itself
 *   isn't active (402, see #42). Retrying won't help until the quota resets,
 *   so subscribers roll back to TradingView until then.
 * - 'transient': a per-second rate limit (429), a 5xx, a timeout or a network
 *   error. Worth trying again after a short pause.
 */
export class OanorError extends Error {
  constructor(message, { kind, status = null } = {}) {
    super(message);
    this.name = 'OanorError';
    this.kind = kind;
    this.status = status;
  }
}

/** Words in an oanor refusal that mean the allowance or plan, not a momentary limit. */
const QUOTA_WORDS = /quota|monthly|plan|subscription|upgrade/i;

/**
 * Maps a failed HTTP answer from oanor to an OanorError kind. 402 is always
 * 'quota' — #42 saw it for an inactive plan, and it's the usual answer to a
 * used-up allowance. A 429 is normally the per-second rate limit
 * ('transient'), unless its body talks about the monthly quota or the plan:
 * then waiting a minute won't help either, so it's 'quota' too.
 */
export function classifyOanorStatus(status, body = '') {
  if (status === 402) return 'quota';
  if (status === 429 && QUOTA_WORDS.test(String(body))) return 'quota';
  return 'transient';
}

/**
 * Latest quotes for up to OANOR_MAX_CODES_PER_CALL EGX codes, as
 * Map<code, { price, change, changePct }>. oanor has no per-quote timestamp,
 * so none is returned. A code oanor doesn't answer for is simply missing from
 * the map. Throws OanorError on any failed call.
 */
export async function fetchOanorQuotes(codes, { apiKey, timeoutMs = 4000, fetchImpl = fetch } = {}) {
  const wanted = [...new Set(codes.map((code) => String(code).toUpperCase()))].slice(0, OANOR_MAX_CODES_PER_CALL);
  if (!wanted.length) return new Map();
  if (!apiKey) throw new OanorError('OANOR_API_KEY is empty', { kind: 'quota' });

  const url = `${OANOR_QUOTE_URL}?codes=${encodeURIComponent(wanted.join(','))}`;
  // Covers reading the body too, not just the headers arriving.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let text;
  try {
    response = await fetchImpl(url, {
      headers: { 'x-oanor-key': apiKey, accept: 'application/json' },
      signal: controller.signal,
    });
    text = await response.text();
  } catch (err) {
    throw new OanorError(
      controller.signal.aborted ? `oanor timed out after ${timeoutMs}ms` : `oanor unreachable: ${err?.message ?? err}`,
      { kind: 'transient' },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new OanorError(`oanor answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`, {
      kind: classifyOanorStatus(response.status, text),
      status: response.status,
    });
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OanorError('oanor sent a response that is not JSON', { kind: 'transient', status: response.status });
  }
  if (body?.success === false) {
    const message = body?.message ?? body?.error ?? 'unknown error';
    // Classified by its wording too: a refusal can arrive with a 200 status.
    const kind = QUOTA_WORDS.test(String(message)) ? 'quota' : classifyOanorStatus(response.status, message);
    throw new OanorError(`oanor refused: ${message}`, { kind, status: response.status });
  }

  const quotes = new Map();
  for (const row of body?.data?.quotes ?? []) {
    const code = String(row?.ticker ?? '').toUpperCase();
    const price = Number(row?.price);
    if (!code || !wanted.includes(code) || !(price > 0)) continue;
    quotes.set(code, {
      price,
      change: Number.isFinite(Number(row.change)) ? Number(row.change) : null,
      changePct: Number.isFinite(Number(row.change_percent)) ? Number(row.change_percent) : null,
    });
  }
  return quotes;
}
