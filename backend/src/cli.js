#!/usr/bin/env node
/**
 * Alytic CLI.
 *
 *   node src/cli.js scan                    مسح السوق كله وترتيب الفرص
 *   node src/cli.js analyze COMI            تحليل كامل لسهم واحد
 *   node src/cli.js review                  مراجعة المحفظة بالذكاء الاصطناعي
 *   node src/cli.js sync                    تحديث كاش الأسعار
 *   node src/cli.js fundamentals COMI       جمع بيانات الشركة الأساسية
 *   node src/cli.js buy COMI 100 142.50     تسجيل صفقة شراء
 *   node src/cli.js sell COMI 50 148.00     تسجيل صفقة بيع
 *   node src/cli.js cash 250000             تحديث الكاش المتاح
 *
 * The technical half runs with no API key. Only `review` and `fundamentals`
 * need one — everything else is arithmetic.
 */

import 'dotenv/config';
import { analyzeTicker, analyzeMany } from './analyze.js';
import { ALL_CODES, lookup } from './config/universe.js';
import { loadPortfolio, savePortfolio, recordTrade, trackedCodes } from './portfolio.js';
import { aiAvailable } from './agent/clientOpenRouter.js';
import RULES from './config/rules.js';
import { DEFAULT_STYLE, STYLE_KEYS, rulesForStyle, styleProfile } from './config/styles.js';

const [, , command, ...args] = process.argv;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);

function scoreColor(score) {
  if (score >= 72) return c.green(lpad(score, 3));
  if (score >= 42) return c.yellow(lpad(score, 3));
  return c.red(lpad(score, 3));
}

async function cmdScan() {
  const onlyActionable = args.includes('--actionable');
  process.stderr.write(c.dim('بيحلل السوق...\n'));
  const { results, errors } = await analyzeMany(ALL_CODES, { capital: 1_000_000, concurrency: 5 });

  let shown = results;
  if (onlyActionable) {
    shown = results.filter((r) => r.plan.actionable && r.plan.buyingNow.worthIt && r.technical.score >= 58);
  }

  console.log(
    '\n' + c.bold(pad('كود', 6) + lpad('تقييم', 6) + '  ' + pad('القرار', 16) + lpad('السعر', 9) +
      lpad('الوقف', 9) + lpad('هدف متوسط', 11) + lpad('صعود', 8) + lpad('ع/م', 6) + '  ' + pad('الدخول', 16) + 'التوقيت'),
  );
  console.log(c.dim('─'.repeat(110)));

  for (const r of shown) {
    const m = r.plan.targets.mid;
    console.log(
      pad(r.code, 6) + scoreColor(r.technical.score) + '  ' +
        pad(r.technical.signal.ar, 16) +
        lpad(r.snapshot.price.close, 9) +
        lpad(r.plan.stop.stop, 9) +
        lpad(m?.price ?? '—', 11) +
        lpad(m ? `+${m.upsidePct}%` : '—', 8) +
        lpad(r.plan.buyingNow.riskReward ?? '—', 6) + '  ' +
        pad({ buy_now: 'دلوقتي', limit_pullback: 'أمر محدد', too_extended: 'ممتد — استنى', wait: 'استنى' }[r.plan.entryStatus], 16) +
        (m?.horizon.ar ?? ''),
    );
  }

  console.log(c.dim(`\n${shown.length} سهم${onlyActionable ? ' قابل للتنفيذ' : ''} من ${results.length} تم تحليلهم`));
  if (errors.length) {
    console.log(c.dim(`\nمستبعدين (${errors.length}):`));
    for (const e of errors) console.log(c.dim(`  ${pad(e.code, 6)} ${e.error}`));
  }
}

async function cmdAnalyze(code) {
  if (!code) throw new Error('اكتب كود السهم: node src/cli.js analyze COMI');
  const portfolio = await loadPortfolio();
  const position = portfolio.positions[code.toUpperCase()] ?? null;
  const capital = Object.values(portfolio.positions).reduce((a, p) => a + p.shares * p.avgCost, 0) + portfolio.cash;

  const a = await analyzeTicker(code, { position, capital: capital || 1_000_000 });

  if (!a.usable) {
    console.log(c.red(`\n${a.code}: ${a.error}`));
    return;
  }

  const s = a.snapshot;
  const p = a.plan;
  console.log(`\n${c.bold(`${a.code} — ${a.name}`)} ${c.dim(`(${a.sectorAr})`)}  ${c.dim(a.asOf)}`);
  console.log(c.dim('─'.repeat(70)));
  console.log(`السعر        ${c.bold(s.price.close)} ج   ${s.price.changePct >= 0 ? c.green(`+${s.price.changePct}%`) : c.red(`${s.price.changePct}%`)}   من قمة السنة ${s.price.pctFrom52wHigh}%`);
  console.log(`الاتجاه      ${s.trend.label} (${s.trend.score}) · ${s.strength.trendQuality}`);
  console.log(`الزخم        RSI ${s.momentum.rsi14} (${s.momentum.rsiState}) · MACD ${s.momentum.macdCross}`);
  console.log(`الحجم        ${s.volume.relativeVolume}× المتوسط · OBV ${s.volume.obvTrend}`);
  console.log(`التقييم      ${scoreColor(a.technical.score)}/100 → ${c.bold(a.technical.signal.ar)}`);

  console.log(`\n${c.bold('الخطة')}`);
  console.log(`  الدخول     ${p.entryNote}`);
  console.log(`  الوقف      ${c.red(p.stop.stop)} ج (مخاطرة ${p.stop.riskPct}%) — ${p.stop.note}`);
  if (p.targets.mid) {
    console.log(`  هدف متوسط  ${c.green(p.targets.mid.price)} ج (+${p.targets.mid.upsidePct}%) — ${p.targets.mid.basis}`);
    console.log(`             التوقيت: ${p.targets.mid.horizon.ar} · عائد/مخاطرة ${p.targets.mid.riskReward}`);
  }
  if (p.targets.long?.price) {
    console.log(`  هدف بعيد   ${c.green(p.targets.long.price)} ج (+${p.targets.long.upsidePct}%) — ${p.targets.long.basis}`);
    console.log(`             التوقيت: ${p.targets.long.horizon.ar}`);
  } else if (p.targets.long?.note) {
    console.log(`  هدف بعيد   ${c.dim(p.targets.long.note)}`);
  }

  console.log(`\n${c.bold('الدعوم')}      ${s.levels.supports.slice(0, 3).map((l) => `${l.price} (${l.distancePct}%)`).join('  ') || '—'}`);
  console.log(`${c.bold('المقاومات')}   ${s.levels.resistances.slice(0, 3).map((l) => `${l.price} (+${l.distancePct}%)`).join('  ') || 'مساحة مفتوحة'}`);

  if (a.technical.reasons.bullish.length) {
    console.log(`\n${c.green('مؤيد:')}`);
    for (const r of a.technical.reasons.bullish) console.log(`  + ${r}`);
  }
  if (a.technical.reasons.bearish.length) {
    console.log(`${c.red('معارض:')}`);
    for (const r of a.technical.reasons.bearish) console.log(`  − ${r}`);
  }
  if (a.technical.reasons.neutral.length) {
    console.log(c.dim('ملاحظات:'));
    for (const r of a.technical.reasons.neutral) console.log(c.dim(`  · ${r}`));
  }

  if (a.position) {
    const ps = a.position;
    console.log(`\n${c.bold('مركزك')}`);
    console.log(`  ${ps.shares} سهم بمتوسط ${ps.avgCost} — ${ps.unrealizedPct >= 0 ? c.green(`+${ps.unrealizedPct}%`) : c.red(`${ps.unrealizedPct}%`)} (${ps.unrealizedEgp} ج)`);
    console.log(`  الوقف الفعلي ${ps.stop}${ps.trailing.active ? c.cyan(' — متحرك مفعّل') : ''}`);
    const fired = Object.entries(ps.triggers).filter(([, v]) => v).map(([k]) => k);
    if (fired.length) console.log(`  ${c.yellow('مشغّلات:')} ${fired.join(', ')}`);
  }
  console.log();
}

async function cmdReview(styleArg) {
  const style = STYLE_KEYS.includes(styleArg) ? styleArg : DEFAULT_STYLE;
  const rules = rulesForStyle(RULES, style);
  if (!aiAvailable()) {
    console.log(c.red('\nمحتاج OPENROUTER_API_KEY في ملف .env عشان المراجعة الذكية.'));
    console.log(c.dim('التحليل الفني شغال من غيره: node src/cli.js scan\n'));
    process.exit(1);
  }
  const { reviewPortfolio } = await import('./agent/analyst.js');

  const portfolio = await loadPortfolio();
  const codes = trackedCodes(portfolio);
  if (!codes.length) {
    console.log(c.yellow('\nالمحفظة وقائمة المراقبة فاضيين. سجّل صفقة الأول:'));
    console.log(c.dim('  node src/cli.js buy COMI 100 142.50\n'));
    return;
  }

  const capital = Object.values(portfolio.positions).reduce((a, p) => a + p.shares * p.avgCost, 0) + portfolio.cash;
  process.stderr.write(c.dim(`بيحلل ${codes.length} سهم...\n`));

  const { results, errors } = await analyzeMany(codes, {
    capital,
    positions: portfolio.positions,
    concurrency: 5,
    rules,
  });

  process.stderr.write(c.dim(`بيراجع مع المحلل (أسلوب: ${styleProfile(style).label})...\n`));
  const review = await reviewPortfolio(results, { cash: portfolio.cash, capital }, { rules, style });

  console.log(`\n${c.bold('قراءة السوق')}\n${review.marketRead}\n`);
  console.log(c.bold('القرارات'));
  console.log(c.dim('─'.repeat(70)));
  for (const v of review.verdicts) {
    const meta = lookup(v.code);
    console.log(`\n${c.bold(v.code)} ${c.dim(meta?.ar ?? '')} — ${c.cyan(v.action)} ${c.dim(`(ثقة ${v.conviction})`)}`);
    console.log(`  ${v.headline}`);
    console.log(c.dim(`  ${v.reasoning}`));
    if (v.conflictNoted) console.log(c.yellow(`  ⚖️  ${v.conflictNoted}`));
    if (v.orderInstruction) console.log(c.green(`  ▸ ${v.orderInstruction}`));
    console.log(c.dim(`  التوقيت: ${v.timingNote}`));
    console.log(c.dim(`  يبطل لو: ${v.invalidation}`));
    for (const f of v.riskFlags ?? []) console.log(c.red(`  ⚠ ${f}`));
  }

  console.log(`\n${c.bold('الكاش')}\n${review.cashAdvice}`);
  console.log(`\n${c.bold('أهم إجراء لبكرة')}\n${c.green(review.topPriority)}`);
  if (review.portfolioRisks?.length) {
    console.log(`\n${c.bold('مخاطر المحفظة')}`);
    for (const r of review.portfolioRisks) console.log(`  ⚠ ${r}`);
  }
  if (errors.length) console.log(c.dim(`\nمستبعدين: ${errors.map((e) => e.code).join(', ')}`));
  console.log(c.dim(`\n${review._meta.model} · ${review._meta.usage.input_tokens} إدخال / ${review._meta.usage.output_tokens} إخراج\n`));
}

async function cmdSync() {
  process.stderr.write(c.dim('بيحدّث الأسعار...\n'));
  const { results, errors } = await analyzeMany(ALL_CODES, { force: true, concurrency: 5 });
  console.log(c.green(`تم تحديث ${results.length} سهم`));
  if (errors.length) console.log(c.dim(`فشل: ${errors.map((e) => e.code).join(', ')}`));
}

async function cmdFundamentals(code) {
  if (!code) throw new Error('اكتب كود السهم');
  if (!aiAvailable()) throw new Error('محتاج OPENROUTER_API_KEY');
  const { getFundamentals } = await import('./agent/fundamentals.js');
  process.stderr.write(c.dim('بيدوّر على البيانات الأساسية...\n'));
  const f = await getFundamentals(code, { force: args.includes('--force') });
  if (!f) return console.log(c.yellow('ما لقيتش بيانات أساسية موثوقة'));
  console.log(`\n${c.bold(`${f.code} — الأساسيات`)} ${c.dim(`(${f.asOf}, ثقة ${f.confidence}${f._fromCache ? ', من الكاش' : ''})`)}`);
  console.log(c.dim('─'.repeat(60)));
  console.log(`مكرر الربحية   ${f.peRatio ?? '—'}`);
  console.log(`ربحية السهم    ${f.epsEgp ?? '—'} ج`);
  console.log(`عائد التوزيعات ${f.dividendYieldPct ?? '—'}%`);
  console.log(`نمو الأرباح    ${f.profitGrowthPct ?? '—'}%`);
  console.log(`الديون/الملكية ${f.debtToEquity ?? '—'}`);
  console.log(`التقييم        ${c.bold(f.fundamentalStrength)}`);
  console.log(`\n${f.businessSummary}`);
  if (f.keyPositives?.length) { console.log(c.green('\nنقاط قوة:')); f.keyPositives.forEach((x) => console.log(`  + ${x}`)); }
  if (f.keyRisks?.length) { console.log(c.red('\nمخاطر:')); f.keyRisks.forEach((x) => console.log(`  − ${x}`)); }
  if (f.recentNews?.length) { console.log(c.bold('\nأخبار:')); f.recentNews.forEach((x) => console.log(`  ${x.date} [${x.impact}] ${x.headline}`)); }
  if (f.sources?.length) { console.log(c.dim('\nالمصادر:')); f.sources.forEach((x) => console.log(c.dim(`  ${x}`))); }
  console.log();
}

async function cmdTrade(side, [code, shares, price]) {
  if (!code || !shares || !price) throw new Error(`الصيغة: node src/cli.js ${side} COMI 100 142.50`);
  const portfolio = await loadPortfolio();
  const updated = await recordTrade(portfolio, { code, side, shares: +shares, price: +price });
  await savePortfolio(updated);
  const pos = updated.positions[code.toUpperCase()];
  console.log(c.green(`\nاتسجلت: ${side === 'buy' ? 'شراء' : 'بيع'} ${shares} سهم ${code.toUpperCase()} بسعر ${price}`));
  if (pos) console.log(`المركز دلوقتي: ${pos.shares} سهم بمتوسط ${pos.avgCost}`);
  else console.log('المركز اتقفل بالكامل');
  console.log(`الكاش: ${updated.cash.toLocaleString('en-US')} ج · أرباح محققة: ${updated.realizedPnl.toLocaleString('en-US')} ج\n`);
}

async function cmdCash(amount) {
  const portfolio = await loadPortfolio();
  if (amount == null) {
    console.log(`\nالكاش المتاح: ${portfolio.cash.toLocaleString('en-US')} ج\n`);
    return;
  }
  await savePortfolio({ ...portfolio, cash: +amount });
  console.log(c.green(`\nالكاش اتحدّث لـ ${(+amount).toLocaleString('en-US')} ج\n`));
}

const COMMANDS = {
  scan: cmdScan,
  analyze: () => cmdAnalyze(args[0]),
  review: () => cmdReview(args[0]),
  sync: cmdSync,
  fundamentals: () => cmdFundamentals(args[0]),
  buy: () => cmdTrade('buy', args),
  sell: () => cmdTrade('sell', args),
  cash: () => cmdCash(args[0]),
};

const run = COMMANDS[command];
if (!run) {
  console.log(`
${c.bold('Alytic')} — محلل البورصة المصرية

  ${c.cyan('scan')} [--actionable]     مسح السوق كله مرتب بالتقييم
  ${c.cyan('analyze')} <كود>           تحليل كامل لسهم
  ${c.cyan('review')} [أسلوب]          مراجعة المحفظة بالذكاء الاصطناعي (trader|medium|long)
  ${c.cyan('sync')}                    تحديث كاش الأسعار
  ${c.cyan('fundamentals')} <كود>      بيانات الشركة الأساسية من الإنترنت
  ${c.cyan('buy')} <كود> <عدد> <سعر>   تسجيل شراء
  ${c.cyan('sell')} <كود> <عدد> <سعر>  تسجيل بيع
  ${c.cyan('cash')} [مبلغ]             عرض أو تحديث الكاش
`);
  process.exit(command ? 1 : 0);
}

run().catch((err) => {
  console.error(c.red(`\nخطأ: ${err.message}\n`));
  process.exit(1);
});
