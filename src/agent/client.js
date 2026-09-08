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
 * Runs one model turn to completion, transparently resuming through any
 * `pause_turn` breaks — the way a long server-tool session (several web
 * searches in one turn) hits its internal iteration budget and stops mid-way
 * without actually being done. Resuming just means echoing the paused
 * assistant content back and asking it to continue.
 *
 * Also drives any *client-side* tools (`toolHandlers`, name -> async(input)):
 * unlike server tools (web search), the API cannot execute these itself — it
 * stops with `stop_reason: 'tool_use'` and waits for a `tool_result` we
 * supply. A `tool_use` block for a name we have no handler for is left alone
 * and the response returned as-is, so an unrecognized tool call surfaces as
 * data rather than looping forever.
 */
async function runToCompletion(client, params, { maxResumes = 8, toolHandlers = {} } = {}) {
  const convo = [...params.messages];
  for (let i = 0; i < maxResumes; i++) {
    const response = await callWithRetry(() => client.messages.create({ ...params, messages: convo }));
    if (response.stop_reason === 'refusal') {
      throw new Error(`النموذج رفض الطلب: ${response.stop_details?.explanation ?? 'بدون تفاصيل'}`);
    }
    if (response.stop_reason === 'pause_turn') {
      convo.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (response.stop_reason === 'tool_use') {
      const toolUses = (response.content ?? []).filter((b) => b.type === 'tool_use');
      const knownUses = toolUses.filter((b) => typeof toolHandlers[b.name] === 'function');
      if (knownUses.length === 0) return response;

      convo.push({ role: 'assistant', content: response.content });
      const toolResults = await Promise.all(knownUses.map(async (tu) => {
        let content;
        try {
          content = JSON.stringify(await toolHandlers[tu.name](tu.input));
        } catch (err) {
          content = JSON.stringify({ error: String(err?.message ?? err) });
        }
        return { type: 'tool_result', tool_use_id: tu.id, content };
      }));
      convo.push({ role: 'user', content: toolResults });
      continue;
    }
    return response;
  }
  throw new Error('السيشن اتكرر كتير من غير ما يخلص (استدعاءات أدوات متكررة) — قلّل عدد الأدوات المتاحة');
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

/**
 * Ask for a structured response, optionally with server-side tools (e.g.
 * web search) available during the same turn.
 *
 * A schema-constrained decode (`output_config.format`) is tried first on
 * *every* provider — it is strictly stronger than asking nicely in a prompt,
 * since the decoder cannot emit invalid JSON. This used to be skipped
 * outright whenever routed through OpenRouter, on the assumption OpenRouter
 * never honors `output_config.format`. That was true only for
 * `claude-sonnet-4`, which OpenRouter itself lists without structured-output
 * support (`tools` only, no `response_format`) — verified against OpenRouter's
 * own `/models` listing. `claude-sonnet-5`, the current default, IS listed
 * with `response_format,structured_outputs,tools`, and live-tested: it honors
 * `output_config.format` through OpenRouter fine, including combined with the
 * `web_search_20260209` server tool and adaptive thinking in the same call.
 * So the real gate is "did it actually work for this model", checked by
 * trying, not guessed by provider — this generalises correctly if the model
 * is ever pointed at something that genuinely lacks structured-output
 * support, native or fallback.
 *
 * `clientTools` are locally-executed tools (as opposed to `tools`, which are
 * server-side tools like web search that the API runs itself): each is
 * `{ name, description, input_schema, handler }`, where `handler` is called
 * with the model's input and its return value goes back as the tool result.
 * They're merged into the same `tools` array the API sees; `handler` is
 * stripped before sending since the wire format has no such field.
 */
export async function requestStructured({
  model = MODEL, system, messages, schema, schemaName = 'response', maxTokens = 16000, thinking = { type: 'adaptive' }, tools = null, clientTools = [],
}) {
  const client = getClient();

  const toolHandlers = Object.fromEntries(clientTools.map((t) => [t.name, t.handler]));
  const allTools = [...(tools ?? []), ...clientTools.map(({ handler, ...def }) => def)];
  const toolsParam = allTools.length ? allTools : null;

  try {
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
    const response = await runToCompletion(client, {
      model, max_tokens: maxTokens, thinking, system, messages,
      output_config: { format: zodOutputFormat(schema) },
      ...(toolsParam ? { tools: toolsParam } : {}),
    }, { toolHandlers });
    const text = (response.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) throw new Error('مفيش رد نصي من النموذج');
    const data = schema.parse(JSON.parse(text));
    return { data, raw: response };
  } catch (nativeErr) {
    // A bad key or a rate limit will fail identically on the fallback attempt
    // too — surface it immediately instead of burning a second real call.
    if (/مفتاح API غير صالح|تجاوزت حد الطلبات/.test(nativeErr.message ?? '')) throw nativeErr;
    console.warn(`[requestStructured] schema-constrained decode failed (${nativeErr.message}); falling back to prompt-and-parse.`);
  }

  // --- Prompt-and-parse fallback -------------------------------------------
  // Only reached when the model/provider combination above didn't actually
  // honor output_config.format. Use zod's own v4 converter, NOT the
  // `zod-to-json-schema` package: that package targets zod v3 and, against a
  // v4 schema, silently returns a 147-byte stub instead of failing. The model
  // then had no field list to follow and invented `riskFlagsOverall` in place
  // of `portfolioRisks` — a wrong schema in the prompt is worse than none,
  // because nothing looks broken.
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

  let convo = [...messages];
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await runToCompletion(client, {
      model, max_tokens: maxTokens, system: systemWithFormat, messages: convo,
      ...(toolsParam ? { tools: toolsParam } : {}),
    }, { toolHandlers });

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
      convo = [
        ...convo,
        { role: 'assistant', content: text.slice(0, 4000) },
        { role: 'user', content: `الرد ده مش JSON صالح حسب الصيغة المطلوبة. الخطأ: ${String(err.message).slice(0, 600)}\n\nرجّع JSON صحيح بس، من غير أي نص تاني.` },
      ];
    }
  }

  throw new Error(`النموذج ما رجّعش JSON صالح بعد 3 محاولات: ${String(lastError?.message ?? '').slice(0, 200)}`);
}

export { Anthropic, USING_OPENROUTER };
