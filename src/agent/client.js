/**
 * Anthropic client setup shared by every agent in this directory.
 *
 * The browser build this project replaced called `api.anthropic.com` directly
 * from the page — no key, no `anthropic-version`, blocked by CORS, and had it
 * worked it would have shipped the API key to every visitor. All model calls
 * now happen here, server-side, with the key read from the environment.
 */

import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

/** Default model. Override per call, or globally via ALYTIC_MODEL. */
export const MODEL = process.env.ALYTIC_MODEL ?? 'claude-opus-5';

/** Cheaper model for high-volume, low-judgment passes (bulk screening). */
export const FAST_MODEL = process.env.ALYTIC_FAST_MODEL ?? 'claude-sonnet-5';

let client = null;

export function getClient() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error(
      'مفيش مفتاح API. حط ANTHROPIC_API_KEY في ملف .env — التحليل الفني بيشتغل من غيره، بس التوصيات الذكية لأ.',
    );
  }
  client = new Anthropic();
  return client;
}

/** Is the AI layer usable at all? Lets callers degrade gracefully. */
export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Wrap an API call with typed error handling and one retry on rate limits.
 * Errors are surfaced in Arabic because they reach the UI.
 */
export async function callWithRetry(fn, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof Anthropic.RateLimitError && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (err instanceof Anthropic.APIConnectionError && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    }
  }

  if (lastErr instanceof Anthropic.AuthenticationError) throw new Error('مفتاح API غير صالح');
  if (lastErr instanceof Anthropic.RateLimitError) throw new Error('تجاوزت حد الطلبات — جرّب بعد شوية');
  if (lastErr instanceof Anthropic.BadRequestError) throw new Error(`طلب غير صالح: ${lastErr.message}`);
  if (lastErr instanceof Anthropic.APIError) throw new Error(`خطأ في الـ API (${lastErr.status}): ${lastErr.message}`);
  throw lastErr;
}

export { Anthropic };
