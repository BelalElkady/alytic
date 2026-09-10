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
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getClient, MODEL, callWithRetry } from './client.js';
import { FundamentalsSchema } from './schemas.js';
import { fundamentalsSystemPrompt } from './prompts/system.js';
import { lookup } from '../config/universe.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'data', 'fundamentals');
const MAX_AGE_DAYS = 45;
const OUTPUT_FORMAT = zodOutputFormat(FundamentalsSchema);

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
  const client = getClient();

  const prompt = `ابحث عن البيانات الأساسية لشركة "${meta?.en ?? upper}" (${meta?.ar ?? ''}) المقيدة في البورصة المصرية تحت كود ${upper}.

دوّر على:
- آخر نتائج مالية معلنة (إيرادات، صافي ربح، ربحية السهم)
- مكرر الربحية الحالي والقيمة الدفترية
- التوزيعات النقدية وعائدها
- نمو الإيرادات والأرباح مقارنة بالفترة المماثلة
- نسبة الديون لحقوق الملكية
- أي أخبار مهمة آخر 3 شهور (صفقات، توسعات، تغييرات إدارة، أرباح مفاجئة)

مصادر كويسة: الموقع الرسمي للبورصة المصرية (egx.com.eg)، مباشر (mubasher.info)، أرقام (argaam.com)، الموقع الرسمي للشركة، وتقارير الوسطاء.

رجّع النتيجة بالصيغة المطلوبة. لو ما لقيتش رقم موثوق، رجّع null بدل ما تخمّن.`;

  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }];
  const messages = [{ role: 'user', content: prompt }];

  let final = null;
  // Server-side search can exhaust its per-turn iteration budget and return
  // `pause_turn`; the turn is resumed by echoing the assistant content back.
  for (let turn = 0; turn < 6; turn++) {
    const res = await callWithRetry(() =>
      client.messages.create({
        model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: fundamentalsSystemPrompt(), cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
        output_config: { format: OUTPUT_FORMAT },
      }),
    );

    if (res.stop_reason === 'refusal') {
      throw new Error(`النموذج رفض البحث: ${res.stop_details?.explanation ?? ''}`);
    }
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content });
      continue;
    }
    final = res;
    break;
  }

  if (!final) return null;

  const text = final.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  let parsed;
  try {
    parsed = FundamentalsSchema.parse(JSON.parse(text));
  } catch (err) {
    // A malformed answer is not worth caching or trusting.
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
