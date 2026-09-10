/**
 * The analyst agent.
 *
 * Takes the deterministic analysis from `src/analyze.js` and produces judgment:
 * which conflicting signal wins, whether a setup is worth taking today, and the
 * exact order to place — written in Egyptian Arabic.
 *
 * The model receives a compact *brief*, not the raw analysis object. Feeding it
 * the full JSON would cost several thousand tokens per stock and bury the
 * decision-relevant facts among indicator plumbing. The brief is also the
 * audit trail: whatever the analyst says, it was working from exactly this.
 */

import { MODEL, requestStructured } from './client.js';
import { PortfolioReviewSchema } from './schemas.js';
import { analystSystemPrompt } from './prompts/system.js';
import { crossCheckIndicators } from './crosscheck.js';
import RULES from '../config/rules.js';

/**
 * Client-side tool: an independent recomputation of RSI/MACD/Bollinger from a
 * second data source (yfinance) and a second implementation (pandas), run via
 * `scripts/cross_check_indicators.py`. It exists to catch "the engine's own
 * number is stale or wrong" — never to hand the model an alternate number to
 * prefer. A real discrepancy belongs in `conflictNoted` or `riskFlags`; it
 * must never change a stop, target or quantity, which stay the engine's alone.
 */
const crossCheckTool = {
  name: 'cross_check_indicators',
  description:
    'يجيب RSI(14) وMACD(12,26,9) وبولينجر(20,2) لسهم واحد من مصدر بيانات ومكتبة حسابية مختلفين تمامًا عن محرك التطبيق ' +
    '(yfinance + pandas بدل بيانات ياهو ومحرك التطبيق الداخلي). استخدمها بس لو في شك حقيقي إن رقم في البريف غريب أو ' +
    'قديم أو بيتناقض بشكل غير منطقي — مش كتأكيد روتيني لكل سهم. النتيجة معلومة للمقارنة بس؛ الوقف والهدف والكمية ' +
    'المحسوبين في البريف هما اللي يتحكموا في القرار دايمًا، حتى لو اختلفوا عن رقم الأداة دي.',
  input_schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'كود السهم في البورصة المصرية، زي COMI' },
    },
    required: ['code'],
  },
  handler: async ({ code }) => crossCheckIndicators(code),
};

const n = (x, unit = '') => (x == null ? 'غير متاح' : `${x}${unit}`);

/** Render one analysis as a compact, decision-focused brief. */
export function briefFor(a) {
  const s = a.snapshot;
  const t = a.technical;
  const p = a.plan;
  const lines = [];

  lines.push(`### ${a.code} — ${a.name} (${a.sectorAr ?? '؟'})`);
  lines.push(
    `السعر ${s.price.close} ج (${s.price.changePct >= 0 ? '+' : ''}${s.price.changePct}% اليوم) | ` +
      `من قمة 52 أسبوع ${s.price.pctFrom52wHigh}% | عائد 3 شهور ${n(s.returns.m3, '%')} · سنة ${n(s.returns.y1, '%')}`,
  );
  lines.push(
    `الاتجاه: ${s.trend.label} (${s.trend.score}/100) | ${s.strength.trendQuality} (ADX ${n(s.strength.adx)}) | ` +
      `المتوسطات: 20=${n(s.movingAverages.sma20)} 50=${n(s.movingAverages.sma50)} 200=${n(s.movingAverages.sma200)}`,
  );
  lines.push(
    `الزخم: RSI ${n(s.momentum.rsi14)} (${s.momentum.rsiState}) | MACD ${s.momentum.macdCross ?? 'غير متاح'} | ` +
      `دايفرجنس: ${s.momentum.divergence.type === 'none' ? 'مفيش' : s.momentum.divergence.detail}`,
  );
  lines.push(
    `الحجم: ${s.volume.relativeVolume}× المتوسط | OBV ${s.volume.obvTrend} | ` +
      `متوسط التداول ${Math.round((s.volume.avgTurnoverEgp ?? 0) / 1e6)} مليون ج/يوم` +
      (a.liquidity.ok ? '' : ` ⚠️ ${a.liquidity.note}`),
  );
  lines.push(
    `التقلب: ATR ${s.volatility.atr14} (${s.volatility.atrPct}% يوميًا)` +
      (s.volatility.squeeze ? ' | انضغاط بولينجر — حركة قوية قادمة' : ''),
  );

  const sup = s.levels.supports.slice(0, 3).map((l) => `${l.price} (قوة ${l.strength}، ${l.distancePct}%)`).join(' · ');
  const res = s.levels.resistances.slice(0, 3).map((l) => `${l.price} (قوة ${l.strength}، +${l.distancePct}%)`).join(' · ');
  lines.push(`الدعوم: ${sup || 'مفيش واضح'}`);
  lines.push(`المقاومات: ${res || 'مفيش فوق السعر — مساحة مفتوحة'}`);

  if (s.breakout) {
    const when =
      s.breakout.barsAgo === 0 ? 'النهاردة'
      : s.breakout.barsAgo === 1 ? 'إمبارح'
      : `من ${s.breakout.barsAgo} جلسات`;
    lines.push(
      `اختراق ${s.breakout.direction === 'up' ? 'صاعد' : 'هابط'} لمستوى ${s.breakout.level} ${when}، ` +
        `${s.breakout.volumeConfirmed ? 'بحجم مؤكد' : 'من غير حجم مؤكد'}`,
    );
  }

  lines.push(`**التقييم الفني الآلي: ${t.score}/100 → ${t.signal.ar}**`);
  if (t.reasons.bullish.length) lines.push(`  مؤيد: ${t.reasons.bullish.join(' · ')}`);
  if (t.reasons.bearish.length) lines.push(`  معارض: ${t.reasons.bearish.join(' · ')}`);
  if (t.reasons.neutral.length) lines.push(`  ملاحظات: ${t.reasons.neutral.join(' · ')}`);

  // Entry / risk plan
  lines.push(`**الخطة المحسوبة:**`);
  lines.push(`  الدخول: ${p.entryNote}`);
  lines.push(`  الوقف: ${p.stop.stop} ج (مخاطرة ${p.stop.riskPct}%) — ${p.stop.note}`);
  if (p.targets.mid) {
    lines.push(
      `  الهدف المتوسط: ${p.targets.mid.price} ج (+${p.targets.mid.upsidePct}%) — ${p.targets.mid.basis} | ` +
        `التوقيت: ${p.targets.mid.horizon.ar} | عائد/مخاطرة ${p.targets.mid.riskReward}` +
        `${p.targets.mid.meetsMinRR === false ? ' ⚠️ أقل من الحد الأدنى' : ''}`,
    );
  } else {
    lines.push('  الهدف المتوسط: مفيش هدف واضح داخل الأفق المتوسط');
  }
  if (p.targets.long?.price) {
    lines.push(
      `  الهدف البعيد: ${p.targets.long.price} ج (+${p.targets.long.upsidePct}%) — ${p.targets.long.basis} | التوقيت: ${p.targets.long.horizon.ar}`,
    );
  } else {
    lines.push(`  الهدف البعيد: ${p.targets.long?.note ?? 'غير متاح'}`);
  }
  lines.push(
    `  لو اشتريت بسعر السوق النهاردة: وقف ${p.buyingNow.stop}، عائد/مخاطرة ${n(p.buyingNow.riskReward)} ` +
      `→ ${p.buyingNow.worthIt ? 'مقبول' : 'مش مقبول'}`,
  );
  if (p.sizing) {
    lines.push(
      `  الحجم المسموح: ${p.sizing.shares} سهم (${p.sizing.positionPctOfCapital}% من رأس المال، مخاطرة ${p.sizing.riskPctOfCapital}%) — محدود بـ: ${p.sizing.bindingConstraint}`,
    );
  }

  // Open position state, when there is one
  if (a.position) {
    const ps = a.position;
    lines.push(`**المركز المفتوح:** ${ps.shares} سهم بمتوسط ${ps.avgCost} | ` +
      `${ps.unrealizedPct >= 0 ? 'ربح' : 'خسارة'} ${ps.unrealizedPct}% (${ps.unrealizedEgp} ج) | ` +
      `الوقف الفعلي (الملزم) ${ps.stop}${ps.trailing.active ? ' (متحرك مفعّل)' : ''}`);
    if (ps.trailing.moved) lines.push(`  ⬆️ الوقف المتحرك اتحرك من ${ps.trailing.from} لـ ${ps.stop} (القمة ${ps.trailing.peak})`);
    // Informational only — the mechanical triggers below act on ps.stop, never
    // on this. It exists so a "hold for the long term" verdict can point to a
    // real invalidation level instead of an open-ended "hold and see".
    if (ps.longTermStop?.stop) {
      lines.push(`  الوقف البعيد (استرشادي، للمدى الطويل فقط): ${ps.longTermStop.stop} — ${ps.longTermStop.note}`);
    }
    const fired = Object.entries(ps.triggers).filter(([, v]) => v).map(([k]) => k);
    lines.push(`  المشغّلات الميكانيكية: ${fired.length ? fired.join(', ') : 'مفيش — المركز داخل نطاقه'}`);
  }

  if (a.fundamentals) {
    const f = a.fundamentals;
    const facts = [
      f.peRatio != null && `مكرر ربحية ${f.peRatio}`,
      f.epsEgp != null && `ربحية السهم ${f.epsEgp} ج`,
      f.priceToBook != null && `السعر/القيمة الدفترية ${f.priceToBook}`,
      f.dividendYieldPct != null && `توزيعات ${f.dividendYieldPct}%`,
      f.returnOnEquityPct != null && `عائد على حقوق الملكية ${f.returnOnEquityPct}%`,
      f.debtToEquity != null && `مديونية/ملكية ${f.debtToEquity}`,
      f.marketCapEgp != null && `قيمة سوقية ${Math.round(f.marketCapEgp / 1e9)} مليار ج`,
    ].filter(Boolean);

    if (facts.length) {
      lines.push(`**الأساسيات** (${f.industry ?? '—'}، ${f.asOf}): ${facts.join(' | ')}`);
      if (f.valuation) lines.push(`  ${f.valuation}`);
    }
    // Coverage is partial on EGX small caps. Say so, so the model reads a gap
    // as a gap rather than as a weak balance sheet.
    const missing = ['peRatio', 'epsEgp', 'returnOnEquityPct'].filter((k) => f[k] == null);
    if (missing.length) lines.push('  ملاحظة: بعض البيانات الأساسية مش متاحة للسهم ده — الغياب مش إشارة سلبية.');
  } else {
    lines.push('**الأساسيات:** مش متاحة لهذا السهم — احكم على الفني بس.');
  }

  if (a.shariah && a.shariah !== 'compliant') {
    lines.push(`  ملاحظة: التوافق مع الشريعة — ${a.shariah === 'non_compliant' ? 'غير متوافق' : 'محتاج مراجعة'}`);
  }

  return lines.join('\n');
}

/**
 * Full portfolio review.
 *
 * @param {object[]} analyses - results from analyzeTicker (positions + watchlist)
 * @param {object} ctx - { cash, capital, positions: Map<code, {shares, avgCost}> }
 */
export async function reviewPortfolio(analyses, ctx = {}, { model = MODEL, rules = RULES } = {}) {
  const held = analyses.filter((a) => a.position);
  const watch = analyses.filter((a) => !a.position);

  const totalPositionValue = held.reduce((sum, a) => sum + (a.position?.marketValue ?? 0), 0);
  const cash = ctx.cash ?? 0;
  const capital = ctx.capital ?? totalPositionValue + cash;

  // Sector concentration is a portfolio-level fact the per-stock briefs cannot
  // show, so it is computed here and stated explicitly.
  const bySector = {};
  for (const a of held) {
    const key = a.sectorAr ?? 'غير مصنف';
    bySector[key] = (bySector[key] ?? 0) + (a.position?.marketValue ?? 0);
  }
  const sectorLines = Object.entries(bySector)
    .sort((a, b) => b[1] - a[1])
    .map(([sec, val]) => `  ${sec}: ${Math.round(val).toLocaleString('en-US')} ج (${((val / capital) * 100).toFixed(1)}%)`)
    .join('\n');

  const userMessage = `# مراجعة المحفظة — إغلاق ${analyses[0]?.asOf ?? 'اليوم'}

## الوضع المالي
- قيمة الأسهم: ${Math.round(totalPositionValue).toLocaleString('en-US')} ج
- الكاش المتاح: ${Math.round(cash).toLocaleString('en-US')} ج (${((cash / capital) * 100).toFixed(1)}% من رأس المال)
- إجمالي رأس المال: ${Math.round(capital).toLocaleString('en-US')} ج
- عمولة الوساطة: ${rules.commissionPct}% على كل صفقة

## التوزيع القطاعي الحالي
${sectorLines || '  لا توجد مراكز مفتوحة'}
(الحد الأقصى المسموح للقطاع الواحد: ${rules.sizing.maxSectorPct}%)

## المراكز المفتوحة (${held.length})
${held.map(briefFor).join('\n\n') || 'لا توجد مراكز مفتوحة.'}

## قائمة المراقبة (${watch.length})
${watch.map(briefFor).join('\n\n') || 'قائمة المراقبة فاضية.'}

---
اديني قرار لكل سهم فوق (المراكز وقائمة المراقبة)، وتوصية للكاش، وأهم إجراء لبكرة.
افتكر: الأرقام دي نهائية — احكم عليها، ما تحسبهاش من تاني.`;

  const { data, raw } = await requestStructured({
    model,
    schema: PortfolioReviewSchema,
    schemaName: 'portfolio_review',
    maxTokens: 16000,
    // The system prompt is identical on every run, so caching it makes each
    // subsequent review meaningfully cheaper.
    system: [{ type: 'text', text: analystSystemPrompt(rules), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
    // Server-side search — runs on Anthropic's infrastructure, no client-side
    // execution loop needed. The system prompt tells the model this is for
    // recent news/events that could change a verdict, never for recalculating
    // a number the brief already computed. Capped well under what a full
    // portfolio could otherwise burn through if it searched every holding.
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: rules.webSearch?.maxUsesPerReview ?? 6 }],
    clientTools: [crossCheckTool],
  });

  return {
    ...data,
    _meta: {
      model: raw.model,
      asOf: analyses[0]?.asOf ?? null,
      usage: raw.usage,
      stocksReviewed: analyses.length,
    },
  };
}
