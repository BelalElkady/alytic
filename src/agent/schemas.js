/**
 * Zod schemas for the agents' structured outputs.
 *
 * These are contracts, not suggestions — `output_config.format` constrains the
 * model to them, so the UI can render results without defensive parsing. Note
 * what is deliberately absent: no schema lets the model return an indicator
 * value, a stop, or a target price it invented. Prices it may quote are the
 * ones handed to it; its own fields are judgement, confidence and prose.
 */

import { z } from 'zod';

export const ACTIONS = [
  'buy',          // شراء / بناء مركز
  'accumulate',   // تجميع تدريجي على تصحيح
  'hold',         // احتفاظ بدون تعديل
  'reduce',       // تخفيف جزئي
  'take_profit',  // جني أرباح عند الهدف
  'exit',         // خروج كامل
  'avoid',        // ما تدخلش أصلًا
  'wait',         // مهتم، بس السعر مش مناسب دلوقتي
];

export const CONVICTION = ['عالية', 'متوسطة', 'منخفضة'];

/** One stock's verdict. */
export const StockVerdictSchema = z.object({
  code: z.string().describe('كود السهم في البورصة المصرية'),
  action: z.enum(ACTIONS).describe('القرار النهائي'),
  conviction: z.enum(CONVICTION).describe('درجة الثقة في القرار'),

  headline: z.string().describe('جملة واحدة قصيرة بالعامية المصرية تلخص القرار'),
  reasoning: z.string().describe(
    'شرح 2-4 جمل بالعامية المصرية. لازم يذكر أقوى إشارة مؤيدة وأقوى إشارة معارضة بالأرقام المعطاة لك.',
  ),

  conflictNoted: z
    .string()
    .nullable()
    .describe('لو المؤشرات بتتناقض مع بعض، اشرح التناقض هنا. لو متفقة، رجّع null.'),

  orderInstruction: z
    .string()
    .nullable()
    .describe(
      'الأمر بالظبط لو فيه إجراء: النوع (محدد/سوق)، السعر، والعدد لو متاح. لو مفيش إجراء النهاردة رجّع null.',
    ),

  invalidation: z
    .string()
    .describe('إيه اللي يخلي القرار ده غلط — المستوى أو الحدث اللي لو حصل تخرج.'),

  timingNote: z
    .string()
    .describe('التوقيت المتوقع للحركة بالعامية، مبني على التقدير الزمني المعطى لك.'),

  riskFlags: z
    .array(z.string())
    .describe('مخاطر محددة: سيولة، تقلب، تركز قطاعي، قرب من مقاومة. فاضية لو مفيش.'),
});

/** The whole portfolio review. */
export const PortfolioReviewSchema = z.object({
  marketRead: z.string().describe('2-3 جمل عن حالة السوق المصري النهاردة بناءً على الأسهم المعروضة عليك'),

  verdicts: z.array(StockVerdictSchema).describe('قرار لكل سهم في المحفظة وقائمة المراقبة'),

  cashAdvice: z.string().describe('توصية الكاش المتاح في 2-3 جمل: يفضل نقدي ولا يتوزع وعلى إيه'),

  topPriority: z.string().describe('أهم إجراء واحد لبكرة، جملة واحدة'),

  portfolioRisks: z.array(z.string()).describe('مخاطر على مستوى المحفظة كلها: تركز، ارتباط، تقلب'),
});

/** Fundamentals gathered from the web for one company. */
export const FundamentalsSchema = z.object({
  code: z.string(),
  asOf: z.string().describe('تاريخ آخر بيانات متاحة، YYYY-MM-DD أو وصف مثل "الربع الثاني 2026"'),

  peRatio: z.number().nullable().describe('مكرر الربحية، null لو مش متاح'),
  epsEgp: z.number().nullable().describe('ربحية السهم بالجنيه'),
  bookValueEgp: z.number().nullable(),
  dividendYieldPct: z.number().nullable(),
  marketCapEgp: z.number().nullable(),
  revenueGrowthPct: z.number().nullable().describe('نمو الإيرادات سنويًا %'),
  profitGrowthPct: z.number().nullable().describe('نمو صافي الربح سنويًا %'),
  debtToEquity: z.number().nullable(),

  businessSummary: z.string().describe('جملتين عن نشاط الشركة ومصدر أرباحها بالعامية المصرية'),
  fundamentalStrength: z.enum(['قوية', 'متوسطة', 'ضعيفة']),
  keyPositives: z.array(z.string()),
  keyRisks: z.array(z.string()),
  recentNews: z.array(
    z.object({
      date: z.string(),
      headline: z.string(),
      impact: z.enum(['إيجابي', 'سلبي', 'محايد']),
    }),
  ),

  sources: z.array(z.string()).describe('روابط المصادر اللي البيانات دي جت منها'),
  confidence: z
    .enum(['عالية', 'متوسطة', 'منخفضة'])
    .describe('ثقتك في البيانات دي. لو ما لقيتش مصادر موثوقة قول منخفضة.'),
});
