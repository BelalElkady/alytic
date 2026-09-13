/**
 * The single AI client this app uses, talking to OpenRouter's
 * OpenAI-compatible endpoint. Every analysis feature — portfolio review,
 * the daily market report, fundamentals — goes through requestStructuredOR()
 * here. (Screenshot import is the one exception: it needs vision and is
 * pinned to its own model directly in server.js, independent of the knob
 * below.)
 *
 * This app used to route every model through OpenRouter's *Anthropic*-
 * compatible endpoint (`@anthropic-ai/sdk` pointed at `openrouter.ai/api`),
 * which worked for Claude but silently mistranslated Claude-only parameters
 * for other models — verified empirically: `thinking: {type:'adaptive'}`
 * caused a Qwen model to burn its entire token budget on unrequested
 * reasoning and return nothing, and `output_config.format` was not actually
 * enforced (a schema requiring an enum got a free-text value back). Both
 * failures disappeared once addressed on OpenRouter's native protocol
 * instead — this file. That Anthropic-SDK path (client.js) has since been
 * removed entirely; nothing in this app depends on it anymore.
 *
 * THE MODEL IS A RUNTIME CHOICE, NOT SOMETHING TUNED INTO THIS FILE. Set
 * ALYTIC_MODEL in .env to point every analysis feature at whatever
 * OpenRouter model you want — see MODEL below. Because any model can be
 * configured here, not just the one this file was originally tuned against,
 * every OpenRouter-specific parameter below is applied defensively: if a
 * model rejects it, the failure is caught by message content and the call is
 * retried without that parameter, rather than the whole feature breaking for
 * anyone who picks a model with different capabilities. Three such
 * fallbacks, in the order they were actually found:
 *  - `reasoning: {enabled:false}` bounds most models' reasoning (and stops a
 *    reasoning-only model from silently burning its whole budget with no
 *    output) — but a few "-thinking" variants reject it outright with
 *    "reasoning is mandatory for this endpoint and cannot be disabled";
 *    caught, and the call retried without the reasoning param.
 *  - Tool calling (`tools`, including the `openrouter:web_search` server
 *    tool) isn't supported by every model; caught, and the call retried with
 *    research skipped rather than the whole request failing.
 *  - `response_format: json_schema` isn't actually enforced — or accepted at
 *    all — by every model/provider pairing OpenRouter can route to; caught,
 *    and the call retried with the schema embedded as a text instruction,
 *    the reply parsed and validated by hand instead (the old Anthropic path
 *    used this same two-tier strategy, for the same reason).
 * One more thing verified empirically, not assumed: declaring tools
 * alongside `response_format: json_schema` in the *same* call broke
 * structured output on at least one model — it abandoned the schema and
 * echoed the input back as free text. So every request still runs in two
 * phases regardless of which model is configured: research/tool turns first
 * with no schema constraint, then one tool-free call that only has to format
 * already-completed reasoning into JSON — a much easier ask.
 */

import OpenAI from 'openai';
import '../loadEnv.js';
import { logAiSpend } from '../db.js';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

/** The one model knob for every analysis feature. Set ALYTIC_MODEL in .env
 * to any OpenRouter model id to change what every feature runs on. */
export const MODEL = process.env.ALYTIC_MODEL ?? 'qwen/qwen3.5-9b';

/** Optional free-tier model tried before MODEL on every call. Set
 * ALYTIC_MODEL_FREE to an OpenRouter `:free` slug to use it; leave unset and
 * nothing changes — MODEL is used directly, same as before this existed.
 * Falls through to MODEL only for failures that mean "this tier is
 * unavailable right now" (saturated free capacity, a rate limit that
 * survived callWithRetry's own retries) — see `fallbackToNextModel` in
 * callWithRetry. Anything else (bad request, invalid schema, auth) fails the
 * same way it always did, since a different model would fail it too. */
export const FREE_MODEL = process.env.ALYTIC_MODEL_FREE || null;

/** What requestStructuredOR's callers should default `model` to. A caller
 * that passes its own explicit model bypasses this — and the fallback —
 * entirely. */
export const MODEL_CHAIN = FREE_MODEL ? [FREE_MODEL, MODEL] : MODEL;

let client = null;

export function getOpenRouterClient() {
  if (client) return client;
  if (!OPENROUTER_KEY) {
    throw new Error('مفيش مفتاح API. حط OPENROUTER_API_KEY في ملف .env.');
  }
  client = new OpenAI({
    apiKey: OPENROUTER_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'Alytic',
    },
  });
  return client;
}

/** Is the AI layer usable at all? Lets callers degrade gracefully. */
export function aiAvailable() {
  return Boolean(OPENROUTER_KEY);
}

/**
 * Wrap an API call with typed error handling and one retry on rate limits or
 * connection blips. Errors are surfaced in Arabic because they reach the UI.
 */
export async function callWithRetry(fn, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof OpenAI.RateLimitError && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (err instanceof OpenAI.APIConnectionError && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      // 5xx from OpenRouter itself or from a server-side tool it invokes
      // (verified empirically: the web_search plugin returns a bare 502
      // "Server tool request failed" on a transient upstream hiccup, not
      // wrapped in RateLimitError/APIConnectionError) — worth one retry
      // rather than failing the whole generation outright.
      if (typeof err?.status === 'number' && err.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      break;
    }
  }

  if (lastErr instanceof OpenAI.AuthenticationError) throw new Error('مفتاح API غير صالح');
  if (lastErr instanceof OpenAI.RateLimitError) {
    // Survived callWithRetry's own backoff and is still rate-limited — a free
    // tier's shared quota is the common real-world cause, so this is worth
    // trying the next model in the chain over, not just failing outright.
    const err = new Error('تجاوزت حد الطلبات — جرّب بعد شوية');
    err.fallbackToNextModel = true;
    throw err;
  }
  // Billing failure from OpenRouter: either the balance is gone, or a previous
  // request is still in flight holding a reservation. Both need a human or a
  // wait — checked by message content, not just `.status`, since a live
  // failure once arrived with `.status` undefined on a differently-shaped
  // error that didn't set it.
  const billingFailure =
    lastErr?.status === 402 || /billing_error|payment_required|exceed your available credits/i.test(lastErr?.message ?? '');
  if (billingFailure) throw new Error('الرصيد مش كفاية على OpenRouter — اشحن رصيد أو استنى الطلبات الجارية تخلص');
  // A `:free` model variant (e.g. the screenshot-import vision model) can get
  // saturated and start rejecting requests with a 404 that names the paid
  // slug instead — not a real "not found", just today's free capacity being
  // gone. Surface a plain retry-later message instead of leaking OpenRouter's
  // internal slug-swap suggestion straight to the user.
  const modelUnavailableFree = lastErr?.status === 404 && /unavailable for free/i.test(lastErr?.message ?? '');
  if (modelUnavailableFree) {
    const err = new Error('الخدمة المجانية مش متاحة دلوقتي بسبب الضغط عليها — جرّب تاني بعد شوية.');
    err.fallbackToNextModel = true;
    throw err;
  }
  if (lastErr instanceof OpenAI.BadRequestError) throw new Error(`طلب غير صالح: ${lastErr.message}`);
  if (lastErr instanceof OpenAI.APIError) throw new Error(`خطأ في الـ API (${lastErr.status}): ${lastErr.message}`);
  throw lastErr;
}

/** Anthropic-shaped tool ({name, description, input_schema, handler}) ->
 * OpenAI function-tool shape. Lets crossCheckTool in analyst.js stay defined
 * once and feed this client. */
function toFunctionTool(tool) {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  };
}

/** Pull the JSON object out of a reply that may carry fences or stray prose
 * — only needed once structured decode has been given up on for this model. */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('مفيش JSON في الرد');
  return body.slice(start, end + 1);
}

// Matched against error messages (already possibly Arabic-wrapped by
// callWithRetry, which always keeps the original text as a substring) to
// decide whether a failure is "this model doesn't support X" rather than
// something genuinely fatal that should propagate immediately.
const REASONING_MANDATORY_RE = /reasoning.*(mandatory|cannot be disabled|is required)/i;
const TOOLS_UNSUPPORTED_RE = /tool.*(not support|unsupported)|function.calling.*not support|no endpoints found/i;
const STRUCTURED_UNSUPPORTED_RE = /response_format|json_schema|structured.output/i;

/**
 * Phase A: runs research/tool turns to completion with no schema constraint.
 * `openrouter:web_search` (when `webSearch` is passed) resolves server-side
 * within a single turn, same as a server tool — no client loop needed for
 * it. Client-defined `clientTools` do need the loop: the model emits
 * `tool_calls`, we execute the matching handler, and feed a `role: 'tool'`
 * message back per call.
 *
 * Adapts to whatever model is configured: if it rejects `reasoning:
 * {enabled:false}` or tool calling outright, the offending parameter is
 * dropped and the same turn retried — see the file header.
 */
async function runToolPhase(client, { model, system, messages, clientTools, maxTokens, webSearch }, { maxTurns = 6 } = {}) {
  const toolHandlers = Object.fromEntries(clientTools.map((t) => [t.name, t.handler]));
  const baseTools = [
    ...(webSearch ? [{ type: 'openrouter:web_search', parameters: webSearch }] : []),
    ...clientTools.map(toFunctionTool),
  ];
  let convo = [{ role: 'system', content: system }, ...messages];
  let toolsEnabled = baseTools.length > 0;
  let reasoningOff = true;

  for (let turn = 0; turn < maxTurns; ) {
    const tools = toolsEnabled ? baseTools : [];
    let res;
    try {
      res = await callWithRetry(() =>
        client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          ...(reasoningOff ? { reasoning: { enabled: false } } : {}),
          ...(tools.length ? { tools } : {}),
          messages: convo,
        }),
      );
    } catch (err) {
      const msg = err?.message ?? '';
      if (reasoningOff && REASONING_MANDATORY_RE.test(msg)) {
        reasoningOff = false;
        continue;
      }
      if (toolsEnabled && TOOLS_UNSUPPORTED_RE.test(msg)) {
        toolsEnabled = false;
        continue;
      }
      throw err;
    }
    const message = res.choices?.[0]?.message;
    if (!message) throw new Error('مفيش رد من النموذج');

    if (res.choices[0].finish_reason === 'tool_calls' && message.tool_calls?.length) {
      convo = [...convo, message];
      const toolResults = await Promise.all(
        message.tool_calls.map(async (call) => {
          const handler = toolHandlers[call.function?.name];
          let content;
          if (!handler) {
            content = JSON.stringify({ error: `unknown tool: ${call.function?.name}` });
          } else {
            try {
              const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
              content = JSON.stringify(await handler(args));
            } catch (err) {
              content = JSON.stringify({ error: String(err?.message ?? err) });
            }
          }
          return { role: 'tool', tool_call_id: call.id, content };
        }),
      );
      convo = [...convo, ...toolResults];
      turn++;
      continue;
    }
    return { finalMessage: message, convo: [...convo, message], reasoningOff };
  }
  throw new Error('استدعاءات أدوات متكررة من غير حل — قلّل عدد الأدوات المتاحة');
}

/**
 * Ask for a structured response, optionally with tools (including
 * OpenRouter's server-side web search) available during the research phase.
 * Works with whatever model ALYTIC_MODEL is set to — see the file header for
 * how capability differences between models are handled.
 *
 * `clientTools` are locally-executed tools: each is `{ name, description,
 * input_schema, handler }`, where `handler` is called with the model's input
 * and its return value goes back as the tool result.
 */
async function requestStructuredORWithModel({
  model,
  system,
  messages,
  schema,
  schemaName,
  maxTokens,
  clientTools,
  webSearch,
}) {
  const client = getOpenRouterClient();

  const { convo, reasoningOff: reasoningOffFromTools } = await runToolPhase(client, { model, system, messages, clientTools, maxTokens, webSearch });

  const { z } = await import('zod');
  const jsonSchema = z.toJSONSchema(schema, { io: 'output' });

  let reasoningOff = reasoningOffFromTools;
  let structuredSupported = true;
  let formatConvo = [
    ...convo,
    {
      role: 'user',
      content:
        'Now output your final answer as a single JSON object matching the required schema exactly — no prose before or after it, no markdown fences.',
    },
  ];

  let lastError = null;
  for (let attempt = 0; attempt < 3; ) {
    let res;
    try {
      res = await callWithRetry(() =>
        client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          temperature: 0.2,
          ...(reasoningOff ? { reasoning: { enabled: false } } : {}),
          ...(structuredSupported
            ? { response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: jsonSchema } } }
            : {}),
          messages: formatConvo,
        }),
      );
    } catch (err) {
      const msg = err?.message ?? '';
      if (reasoningOff && REASONING_MANDATORY_RE.test(msg)) {
        reasoningOff = false;
        continue;
      }
      if (structuredSupported && STRUCTURED_UNSUPPORTED_RE.test(msg)) {
        structuredSupported = false;
        formatConvo = [
          ...formatConvo,
          {
            role: 'user',
            content: `Your reply must validate against this JSON Schema exactly. Reply with only the JSON object — no prose, no markdown fences, nothing else:\n${JSON.stringify(jsonSchema)}`,
          },
        ];
        continue;
      }
      throw err;
    }
    const text = res.choices?.[0]?.message?.content ?? '';
    try {
      const data = schema.parse(JSON.parse(structuredSupported ? text : extractJson(text)));
      return { data, raw: res };
    } catch (err) {
      lastError = err;
      attempt++;
      formatConvo = [
        ...formatConvo,
        { role: 'assistant', content: text.slice(0, 4000) },
        { role: 'user', content: `That was not valid per the schema: ${String(err.message).slice(0, 500)}. Return corrected JSON only.` },
      ];
    }
  }
  throw new Error(`النموذج ما رجّعش JSON صالح بعد 3 محاولات: ${String(lastError?.message ?? '').slice(0, 200)}`);
}

/**
 * Ask for a structured response — see requestStructuredORWithModel for the
 * actual request logic. This wrapper only adds one thing: `model` may be a
 * single id (as always) or a chain (as MODEL_CHAIN is, once ALYTIC_MODEL_FREE
 * is set), in which case each id is tried in order and a failure only moves
 * to the next one when it was tagged `fallbackToNextModel` — a saturated free
 * tier or a rate limit that survived retries, not a bad request or an
 * unrelated bug that the next model would hit too. Every other failure mode
 * (unsupported reasoning param, no tool support, no structured output) is
 * still handled per-model exactly as before, inside the call being retried.
 */
export async function requestStructuredOR({
  model = MODEL_CHAIN,
  system,
  messages,
  schema,
  schemaName = 'response',
  maxTokens = 4000,
  clientTools = [],
  webSearch = null,
  // Tags every call for ai_spend (see db.js's logAiSpend) — e.g.
  // 'portfolio_review', 'market_research', 'blog_article'. Optional: a call
  // site that doesn't pass one just isn't tracked, nothing else changes.
  feature = null,
}) {
  const chain = Array.isArray(model) ? model : [model];
  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    try {
      const result = await requestStructuredORWithModel({ model: chain[i], system, messages, schema, schemaName, maxTokens, clientTools, webSearch });
      // Fire-and-forget: logging spend must never add latency to, or ever be
      // able to fail, the actual call it's describing.
      if (feature) {
        logAiSpend(feature, result.raw?.model, result.raw?.usage).catch((err) => {
          console.error(`[ai-spend] failed to log ${feature}:`, err.message);
        });
      }
      return result;
    } catch (err) {
      const hasNext = i < chain.length - 1;
      if (hasNext && err.fallbackToNextModel) {
        console.warn(`[ai] ${chain[i]} unavailable (${err.message}) — falling back to ${chain[i + 1]}`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export { OpenAI };
