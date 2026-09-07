/**
 * OpenRouter/Anthropic client setup shared by every agent in this directory.
 *
 * The browser build this project replaced called `api.anthropic.com` directly
 * from the page — no key, no `anthropic-version`, blocked by CORS, and had it
 * worked it would have shipped the API key to every visitor. All model calls
 * now happen here, server-side, with the key read from the environment.
 */

import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const DIRECT_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const USING_OPENROUTER = Boolean(OPENROUTER_KEY);

/** Default model. Override per call, or globally via ALYTIC_MODEL. */
// claude-sonnet-4 is a generation behind AND is one of the few models
// OpenRouter lists without structured-output support, so it cannot satisfy the
// review schema at all. Default to the current generation.
export const MODEL = process.env.ALYTIC_MODEL ?? (USING_OPENROUTER ? 'anthropic/claude-sonnet-5' : 'claude-sonnet-5');

/** Cheaper model for high-volume, low-judgment passes (bulk screening). */
export const FAST_MODEL = process.env.ALYTIC_FAST_MODEL ?? (USING_OPENROUTER ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5');

let client = null;

export function getClient() {
  if (client) return client;
  if (!OPENROUTER_KEY && !DIRECT_ANTHROPIC_KEY) {
    throw new Error(
      'مفيش مفتاح API. حط OPENROUTER_API_KEY في ملف .env — التحليل الفني بيشتغل من غيره، بس التوصيات الذكية لأ.',
    );
  }
  client = new Anthropic({
    apiKey: OPENROUTER_KEY ?? DIRECT_ANTHROPIC_KEY,
    ...(USING_OPENROUTER ? {
      baseURL: 'https://openrouter.ai/api',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
        'X-Title': process.env.OPENROUTER_APP_NAME ?? 'Alytic',
      },
    } : {}),
  });
  return client;
}

/** Is the AI layer usable at all? Lets callers degrade gracefully. */
export function aiAvailable() {
  return Boolean(OPENROUTER_KEY || DIRECT_ANTHROPIC_KEY);
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

/**
 * Ask for a structured response, whichever provider is behind the client.
 *
 * `client.messages.parse()` + `output_config.format` is an Anthropic-API
 * feature. Routed through OpenRouter it is silently ignored: the model answers
 * in prose and the SDK throws `Unexpected token '#'` when it tries to parse a
 * markdown heading as JSON. That took the whole review path down.
 *
 * So on OpenRouter we ask for JSON in the prompt, extract it, and validate it
 * against the same zod schema — the guarantee is weaker than a constrained
 * decode, so a failed parse is fed back once for the model to correct. On the
 * direct Anthropic API the native path is used, because a schema enforced by
 * the decoder cannot drift.
 */
export async function requestStructured({
  model = MODEL, system, messages, schema, schemaName = 'response', maxTokens = 16000, thinking = { type: 'adaptive' },
}) {
  const client = getClient();

  if (!USING_OPENROUTER) {
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
    const response = await callWithRetry(() =>
      client.messages.parse({
        model, max_tokens: maxTokens, thinking, system, messages,
        output_config: { format: zodOutputFormat(schema) },
      }),
    );
    if (response.stop_reason === 'refusal') {
      throw new Error(`النموذج رفض الطلب: ${response.stop_details?.explanation ?? 'بدون تفاصيل'}`);
    }
    if (!response.parsed_output) throw new Error('النموذج رجّع رد مش مطابق للصيغة المطلوبة');
    return { data: response.parsed_output, raw: response };
  }

  // --- Prompt-and-parse fallback -------------------------------------------
  // Use zod's own v4 converter, NOT the `zod-to-json-schema` package: that
  // package targets zod v3 and, against a v4 schema, silently returns a 147-byte
  // stub instead of failing. The model then had no field list to follow and
  // invented `riskFlagsOverall` in place of `portfolioRisks` — a wrong schema in
  // the prompt is worse than none, because nothing looks broken.
  const { z } = await import('zod');
  const jsonSchema = z.toJSONSchema(schema, { io: 'output' });

  const jsonInstruction = `

# OUTPUT FORMAT — ABSOLUTE REQUIREMENT
Reply with a single JSON object and nothing else. No prose before it, no explanation after it, no markdown code fences, no headings.
It must validate against this JSON Schema:

${JSON.stringify(jsonSchema, null, 1)}

The first character of your reply must be "{" and the last must be "}".`;

  const systemWithFormat = Array.isArray(system)
    ? [...system, { type: 'text', text: jsonInstruction }]
    : `${system}${jsonInstruction}`;

  const convo = [...messages];
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await callWithRetry(() =>
      client.messages.create({ model, max_tokens: maxTokens, system: systemWithFormat, messages: convo }),
    );

    const text = (response.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    try {
      const data = schema.parse(JSON.parse(extractJson(text)));
      return { data, raw: response };
    } catch (err) {
      lastError = err;
      // Hand the failure back so the next attempt can correct itself.
      convo.push({ role: 'assistant', content: text.slice(0, 4000) });
      convo.push({
        role: 'user',
        content: `الرد ده مش JSON صالح حسب الصيغة المطلوبة. الخطأ: ${String(err.message).slice(0, 600)}\n\nرجّع JSON صحيح بس، من غير أي نص تاني.`,
      });
    }
  }

  throw new Error(`النموذج ما رجّعش JSON صالح بعد 3 محاولات: ${String(lastError?.message ?? '').slice(0, 200)}`);
}

/** Pull the JSON object out of a reply that may carry fences or stray prose. */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('مفيش JSON في الرد');
  return body.slice(start, end + 1);
}

export { Anthropic, USING_OPENROUTER };
