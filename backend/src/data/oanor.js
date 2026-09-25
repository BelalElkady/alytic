/**
 * oanor — a paid, keyed feed of EGX quotes that is closer to live than the
 * TradingView scrape (tv-history.js), which runs about 15 minutes behind
 * during the session (see issue #44). Only live-quotes.js calls this, for
 * subscribers; see docs/adr/0001-live-prices-for-subscribers-via-oanor.md.
 *
 * The HTTP call itself is not written yet: oanor's endpoint, auth header and
 * response shape have to be read from its docs, which weren't reachable when
 * this was built. Until then fetchOanorQuotes throws, OANOR_CLIENT_READY is
 * false, and live-quotes.js keeps everyone on TradingView even with
 * OANOR_ENABLED=1. Filling in the request is the only step left: the
 * pool, fallback, breaker and quota rollback around it are done and tested.
 */

/** Flip to true once fetchOanorQuotes makes the real request. */
export const OANOR_CLIENT_READY = false;

/** oanor takes at most this many tickers in one call. */
export const OANOR_MAX_CODES_PER_CALL = 20;

/**
 * Why an oanor call failed, which decides what live-quotes.js does next:
 * - 'quota': the billing period's call quota is used up, or the plan itself
 *   isn't active (402, see #42). Retrying won't help until the quota resets,
 *   so subscribers roll back to TradingView until then.
 * - 'transient': a per-minute rate limit (429), a 5xx, a timeout or a network
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

/**
 * Maps an HTTP answer from oanor to an OanorError kind. 402 is always
 * 'quota'. Whether oanor signals an exhausted quota with its own status or
 * body, rather than 402, must be checked against its docs: such an answer
 * must return 'quota' here, never be mistaken for a per-minute 429.
 */
export function classifyOanorStatus(status) {
  if (status === 402) return 'quota';
  return 'transient';
}

/**
 * Latest quotes for up to OANOR_MAX_CODES_PER_CALL EGX codes, as
 * Map<code, { price, change, changePct }>. oanor has no per-quote timestamp,
 * so none is returned. A code oanor doesn't answer for is simply missing from
 * the map. Throws OanorError on any failed call.
 */
export async function fetchOanorQuotes(codes, { apiKey, timeoutMs = 4000 } = {}) {
  throw new OanorError('oanor client not implemented yet (see src/data/oanor.js)', { kind: 'transient' });
}
