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

import { getClient, MODEL, callWithRetry } from './client.js';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PortfolioReviewSchema } from './schemas.js';
import { analystSystemPrompt } from './prompts/system.js';
import RULES from '../config/rules.js';

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
      `الوقف الفعلي ${ps.stop}${ps.trailing.active ? ' (متحرك مفعّل)' : ''}`);
    if (ps.trailing.moved) lines.push(`  ⬆️ الوقف المتحرك اتحرك من ${ps.trailing.from} لـ ${ps.stop} (القمة ${ps.trailing.peak})`);
    const fired = Object.entries(ps.triggers).filter(([, v]) => v).map(([k]) => k);
    lines.push(`  المشغّلات الميكانيكية: ${fired.length ? fired.join(', ') : 'مفيش — المركز داخل نطاقه'}`);
  }

  if (a.fundamentals) {
    const f = a.fundamentals;
    lines.push(
      `**الأساسيات (${f.asOf}، ثقة ${f.confidence}):** مكرر ربحية ${n(f.peRatio)} | ربحية السهم ${n(f.epsEgp)} ج | ` +
        `توزيعات ${n(f.dividendYieldPct, '%')} | نمو أرباح ${n(f.profitGrowthPct, '%')} | التقييم: ${f.fundamentalStrength}`,
    );
    lines.push(`  ${f.businessSummary}`);
    if (f.keyRisks?.length) lines.push(`  مخاطر: ${f.keyRisks.join(' · ')}`);
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
  const client = getClient();

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

  const response = await callWithRetry(() =>
    client.messages.parse({
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      // The system prompt is identical on every run, so caching it makes each
      // subsequent review meaningfully cheaper.
      system: [{ type: 'text', text: analystSystemPrompt(rules), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
      output_config: { format: zodOutputFormat(PortfolioReviewSchema) },
    }),
  );

  if (response.stop_reason === 'refusal') {
    throw new Error(`النموذج رفض الطلب: ${response.stop_details?.explanation ?? 'بدون تفاصيل'}`);
  }
  if (!response.parsed_output) {
    throw new Error('النموذج رجّع رد مش مطابق للصيغة المطلوبة');
  }

  return {
    ...response.parsed_output,
    _meta: {
      model: response.model,
      asOf: analyses[0]?.asOf ?? null,
      usage: response.usage,
      stocksReviewed: analyses.length,
    },
  };
}
