import { useEffect, useState, type ReactNode } from "react";

import { PriceHistoryChart } from "@/components/desk/price-history-chart";
import { EmptyState, ErrorState, LoadingBlock, Notice, Stat } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { fmt, int, pct, signed, tone } from "@/lib/format";
import { useActiveInvestStyle } from "@/lib/invest-style";
import { useDesk } from "@/lib/store";
import { mergedTarget } from "@/lib/targets";
import { cn } from "@/lib/utils";

/** Mirrors backend/src/config/classification.js's CLASSIFICATION_TYPES. */
type ClassificationType = "INVESTMENT" | "SPECULATIVE" | "HYBRID" | "NEUTRAL";

const CLASSIFICATION_LABEL: Record<ClassificationType, string> = {
  INVESTMENT: "استثماري",
  SPECULATIVE: "مضاربي",
  HYBRID: "هجين",
  NEUTRAL: "غير محدد",
};

const CLASSIFICATION_TONE_CLASS: Record<ClassificationType, string> = {
  INVESTMENT: "border-up/40 bg-up-soft text-up",
  HYBRID: "border-warn/40 bg-warn-soft text-foreground",
  SPECULATIVE: "border-down/40 bg-down-soft text-down",
  NEUTRAL: "border-border bg-surface text-muted-foreground",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the /api/analyze response shape
export type StockAnalysis = any;

/** Per-stock analysis, same /api/analyze/:code payload for the popup and the page. */
export function useStockAnalysis(code: string | null) {
  const { pf } = useDesk();
  const [data, setData] = useState<StockAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { style } = useActiveInvestStyle(pf?.trades);
  // The invest style can still change once the portfolio loads, so on a page
  // opened cold the request waits for it instead of being sent twice.
  const ready = Boolean(pf);

  useEffect(() => {
    if (!code || !ready) return;
    let cancelled = false;
    setData(null);
    setError(null);
    // Same style the rest of the desk (scan rows, alerts, cards) uses — a
    // mismatch here used to show a different stop/targets for the same
    // position depending which screen you looked at it from.
    api(`/api/analyze/${code}?style=${style}`)
      .then((result) => !cancelled && setData(result))
      .catch((caught) => !cancelled && setError(caught?.message ?? "تعذر التحليل"));
    return () => {
      cancelled = true;
    };
  }, [code, style, ready]);

  return { data, error };
}

const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Big EGP figures the way people say them: مليار / مليون. */
const egpBig = (value: number) =>
  Math.abs(value) >= 1e9
    ? `${fmt(value / 1e9)} مليار ج`
    : Math.abs(value) >= 1e6
      ? `${fmt(value / 1e6)} مليون ج`
      : `${int(value)} ج`;

const num = (text: string) => <span className="num">{text}</span>;
const tonedPct = (value: number) => <span className={cn("num", tone(value))}>{pct(value)}</span>;

/** A row for MetricPanel; null (no value to show) is dropped rather than rendered as a dash. */
type Metric = [label: string, value: ReactNode, hint?: string | undefined] | null;
const metric = (
  label: string,
  value: unknown,
  render: (value: number) => ReactNode,
  hint?: string | null,
): Metric => (isNum(value) ? [label, render(value), hint ?? undefined] : null);

const MACD_STATE: Record<string, string> = {
  bullish_cross: "تقاطع صعودي جديد",
  bearish_cross: "تقاطع هابط جديد",
  bullish: "فوق خط الإشارة",
  bearish: "تحت خط الإشارة",
};

/** Definitions shown on hover for jargon labels, keyed by the exact label text used below. */
const GLOSSARY: Record<string, string> = {
  RSI: "مؤشر القوة النسبية: يقيس سرعة وحجم حركة السعر من 0 إلى 100. فوق 70 يعني تشبع شرائي، وتحت 30 يعني تشبع بيعي.",
  "RSI (14)":
    "مؤشر القوة النسبية: يقيس سرعة وحجم حركة السعر من 0 إلى 100. فوق 70 يعني تشبع شرائي، وتحت 30 يعني تشبع بيعي.",
  "تباعد RSI":
    "لما السعر بيعمل قمة أو قاع جديد لكن مؤشر RSI مابيأكدش الحركة — إشارة على ضعف محتمل في الاتجاه الحالي.",
  MACD: "مؤشر تقارب وتباعد المتوسطات المتحركة: الفرق بين متوسطين أسيين (12 و26 يوم) بيوضح قوة واتجاه الزخم.",
  "خط إشارة MACD": "متوسط أسي لخط MACD نفسه (9 أيام)؛ تقاطع MACD معه لأعلى أو لأسفل بيدي إشارة شراء أو بيع.",
  "هيستوجرام MACD": "الفرق بين خط MACD وخط الإشارة؛ كل ما زاد الهيستوجرام كل ما قوي الزخم في نفس الاتجاه.",
  "متوسط 20 يوم (SMA)": "المتوسط المتحرك البسيط لآخر 20 جلسة تداول، بيوضح الاتجاه قصير المدى للسعر.",
  "متوسط 50 يوم (SMA)": "المتوسط المتحرك البسيط لآخر 50 جلسة تداول، بيوضح الاتجاه متوسط المدى للسعر.",
  "متوسط 200 يوم (SMA)": "المتوسط المتحرك البسيط لآخر 200 جلسة تداول، بيوضح الاتجاه طويل المدى للسعر.",
  "متوسط 9 أيام (EMA)":
    "متوسط متحرك أسي لآخر 9 أيام؛ زي المتوسط البسيط بس بيدي وزن أكبر للأسعار الأحدث فبيتفاعل أسرع.",
  "متوسط 21 يوم (EMA)":
    "متوسط متحرك أسي لآخر 21 يوم؛ زي المتوسط البسيط بس بيدي وزن أكبر للأسعار الأحدث فبيتفاعل أسرع.",
  "متوسط 50 مقابل 200":
    "لما المتوسط الأقصر (50 يوم) يعدي فوق الأطول (200 يوم) بيبقى تقاطع ذهبي (إشارة صعود)، ولما يعدي تحته بيبقى تقاطع الموت (إشارة هبوط).",
  "قوة الاتجاه (ADX)": "مؤشر متوسط الحركة الاتجاهية: يقيس قوة الاتجاه (مش اتجاهه) من 0 إلى 100. فوق 25 يعني اتجاه قوي.",
  "+DI": "يقيس قوة الضغط الشرائي، ويُستخدم مع -DI ومؤشر ADX لتحديد اتجاه الترند.",
  "-DI": "يقيس قوة الضغط البيعي، ويُستخدم مع +DI ومؤشر ADX لتحديد اتجاه الترند.",
  "ستوكاستك %K": "الخط الأساسي لمؤشر ستوكاستك: بيقارن سعر الإغلاق بمدى التداول خلال فترة معينة.",
  "ستوكاستك %D": "المتوسط المتحرك لخط %K في مؤشر ستوكاستك؛ تقاطعه مع %K بيدي إشارات شراء أو بيع.",
  "معدل التغير (20 يوم)": "النسبة المئوية للتغير في السعر مقارنة بسعره قبل 20 جلسة، بيقيس سرعة الزخم.",
  "اختراق حديث": "اختراق مستوى دعم أو مقاومة مهم بحركة سعر واضحة، وأقوى لما يكون مؤكد بارتفاع في حجم التداول.",
  "متوسط المدى الحقيقي (ATR 14)":
    "متوسط حجم تذبذب السعر يوميًا على مدار 14 جلسة، بيُستخدم لتحديد حجم الوقف ومدى تقلب السهم.",
  "التذبذب السنوي": "مقياس لحجم تقلب سعر السهم خلال سنة؛ كل ما زادت النسبة كل ما زادت المخاطرة.",
  "بولنجر العلوي": "النطاق العلوي لمؤشر بولنجر: متوسط 20 يوم زائد انحرافين معياريين، بيوضح حد أعلى محتمل للتذبذب.",
  "بولنجر الأوسط": "الخط الأوسط لمؤشر بولنجر، وهو نفسه المتوسط المتحرك البسيط لآخر 20 جلسة.",
  "بولنجر السفلي": "النطاق السفلي لمؤشر بولنجر: متوسط 20 يوم ناقص انحرافين معياريين، بيوضح حد أدنى محتمل للتذبذب.",
  "موقع السعر داخل النطاق (%B)": "موقع السعر الحالي داخل نطاق بولنجر: 1 يعني عند النطاق العلوي، 0 يعني عند النطاق السفلي.",
  "ضغط النطاق": "لما نطاقات بولنجر تضيق جدًا، وده غالبًا بيسبق حركة سعرية أقوى في أي اتجاه.",
  "الحجم النسبي": "حجم التداول الحالي مقسوم على متوسط حجم آخر 20 جلسة؛ فوق 1× يعني تداول أعلى من المعتاد.",
  "تدفق الحجم (OBV)":
    "مؤشر تراكمي بيضيف حجم التداول يوم الصعود ويطرحه يوم الهبوط، بيوضح هل الحجم بيدعم الاتجاه الحالي ولا لأ.",
  "مكرر الربحية (P/E)": "سعر السهم مقسوم على ربحية السهم؛ كل ما زاد الرقم كل ما كان السهم أغلى نسبة لأرباحه.",
  "ربحية السهم (EPS)": "صافي ربح الشركة مقسوم على عدد الأسهم القائمة.",
  "السعر ÷ القيمة الدفترية":
    "سعر السهم مقسوم على القيمة الدفترية له؛ بيوضح هل السهم بيتداول بسعر أعلى أو أقل من صافي أصول الشركة.",
  "عائد التوزيعات": "التوزيعات النقدية السنوية للسهم كنسبة من سعره الحالي.",
  "العائد على حقوق الملكية": "صافي الربح مقسوم على حقوق المساهمين؛ بيقيس كفاءة الشركة في تحقيق أرباح من أموال المساهمين.",
  "الدين ÷ حقوق الملكية": "إجمالي دين الشركة مقسوم على حقوق الملكية؛ بيوضح مدى اعتمادها على الاقتراض مقارنة بأموال المساهمين.",
  "نسبة التداول (السيولة)":
    "الأصول المتداولة مقسومة على الالتزامات المتداولة؛ بتقيس قدرة الشركة على سداد التزاماتها قصيرة الأجل.",
};

/** A label with a dotted underline that shows its definition on hover, when one exists in GLOSSARY. */
function TermLabel({ children }: { children: string }) {
  const definition = GLOSSARY[children];
  if (!definition) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted underline-offset-4">{children}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-center leading-relaxed">{definition}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const SHARIAH_LABEL: Record<string, { label: string; className: string }> = {
  compliant: { label: "متوافق مع الشريعة", className: "border-up/40 bg-up-soft text-up" },
  non_compliant: { label: "غير متوافق مع الشريعة", className: "border-down/40 bg-down-soft text-down" },
  review: { label: "الشريعة: تحت المراجعة", className: "border-border bg-surface text-muted-foreground" },
};

export function ShariahBadge({ value }: { value?: string | null }) {
  const entry = value ? SHARIAH_LABEL[value] : undefined;
  if (!entry) return null;
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", entry.className)}>
      {entry.label}
    </Badge>
  );
}

/**
 * The analysis itself. `full` is the standalone page: same sections as the
 * popup plus the numbers behind them (performance, indicators, volume,
 * fundamentals, the open position), laid out in two columns.
 */
export function StockAnalysisBody({
  data,
  error,
  full = false,
}: {
  data: StockAnalysis | null;
  error: string | null;
  full?: boolean;
}) {
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingBlock rows={3} />;

  const { snapshot, plan, position, technical, classification, fundamentals, liquidity } = data;
  if (!snapshot || !plan || !technical) return <EmptyState title="مفيش بيانات كافية لهذا السهم." />;
  const oneTarget = mergedTarget(plan.targets?.mid, plan.targets?.long);

  const summary = (
    <div className="grid grid-cols-2 gap-3 rounded-lg border bg-surface p-4 sm:grid-cols-4">
      <Stat
        label="السعر"
        value={fmt(snapshot.price.close)}
        sub={<span className={tone(snapshot.price.changePct)}>{pct(snapshot.price.changePct)}</span>}
      />
      <Stat label="التقييم" value={`${technical.score}/100`} sub={technical.signal?.ar} />
      <Stat label="الاتجاه" value={<span className="text-[14px]">{snapshot.trend.label}</span>} />
      <Stat label={<TermLabel>RSI</TermLabel>} value={fmt(snapshot.momentum.rsi14, 1)} />
    </div>
  );

  const chart = <PriceHistoryChart code={data.code} />;

  const fundamentalsNote = fundamentals && (
    <Notice tone="info">
      <b>الأساسيات:</b> {fundamentals.valuation ?? "—"}
    </Notice>
  );

  const classificationPanel = classification?.investmentScore != null && (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-surface px-4 py-2.5">
        <span className="text-[13px] font-semibold">التصنيف الاستثماري</span>
        <Badge
          variant="outline"
          className={CLASSIFICATION_TONE_CLASS[classification.type as ClassificationType]}
        >
          {CLASSIFICATION_LABEL[classification.type as ClassificationType] ?? classification.type}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-3 p-4">
        <Stat label="نقاط الاستثمار" value={`${classification.investmentScore}/100`} />
        <Stat label="نقاط المضاربة" value={`${classification.speculationScore}/100`} />
        <Stat label="الثقة في التصنيف" value={`${classification.confidence}%`} />
      </div>
      {(classification.reasons?.investment?.length > 0 ||
        classification.reasons?.speculation?.length > 0) && (
        <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
          {classification.reasons.investment?.length > 0 && (
            <ReasonList title="دوافع الاستثمار" items={classification.reasons.investment} tone="up" />
          )}
          {classification.reasons.speculation?.length > 0 && (
            <ReasonList
              title="دوافع المضاربة"
              items={classification.reasons.speculation}
              tone="warn"
            />
          )}
        </div>
      )}
      {classification.reasons?.risks?.length > 0 && (
        <div className="border-t px-4 py-3">
          <p className="text-[12px] font-semibold text-muted-foreground">مخاطر التصنيف</p>
          <ul className="mt-1.5 space-y-1.5 text-[12.5px] leading-relaxed">
            {classification.reasons.risks.map((riskText: string) => (
              <li key={riskText} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
                <span>{riskText}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const planPanel = (
    <div className="rounded-lg border">
      <div className="border-b bg-surface px-4 py-2.5 text-[13px] font-semibold">الخطة</div>
      <dl className="divide-y text-[13px]">
        <Line label="الدخول" value={plan.entryNote} />
        <Line
          label="الوقف"
          value={
            // A position already open enforces its own live,
            // ratcheted stop (see position-recommendation rules) —
            // that's the number that actually triggers an exit, not
            // the entry-plan stop for a fresh buy today, which is
            // shown only when there's no open position to defend.
            position ? (
              <span className="num text-down">
                {fmt(position.stop)} ج · مسافة {position.distanceToStopPct}%
              </span>
            ) : (
              <span className="num text-down">
                {fmt(plan.stop.stop)} ج · مخاطرة {plan.stop.riskPct}%
              </span>
            )
          }
        />
        {oneTarget ? (
          <Line
            label="الهدف"
            value={
              <span className="num text-up">
                {fmt(oneTarget.price)} ج · {pct(oneTarget.upsidePct)}
              </span>
            }
            hint={[
              oneTarget.basis,
              oneTarget.horizon?.ar,
              oneTarget.riskReward ? `ع/م ${oneTarget.riskReward}` : null,
              (plan.targets.long?.price ?? 0) <= (plan.targets.mid?.price ?? 0)
                ? "الهدف البعيد أقرب من المتوسط، فاعتُمد كهدف واحد"
                : "الهدف المتوسط والبعيد على نفس المستوى تقريبًا",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ) : (
          <>
            {plan.targets.mid && (
              <Line
                label="الهدف المتوسط"
                value={
                  <span className="num text-up">
                    {fmt(plan.targets.mid.price)} ج · {pct(plan.targets.mid.upsidePct)}
                  </span>
                }
                hint={`${plan.targets.mid.basis} · ${plan.targets.mid.horizon.ar} · ع/م ${plan.targets.mid.riskReward}`}
              />
            )}
            {plan.targets.long?.price ? (
              <Line
                label="الهدف البعيد"
                value={
                  <span className="num text-up">
                    {fmt(plan.targets.long.price)} ج · {pct(plan.targets.long.upsidePct)}
                  </span>
                }
                hint={[plan.targets.long.basis, plan.targets.long.horizon.ar, plan.targets.long.caveat]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ) : (
              <Line label="الهدف البعيد" value={plan.targets.long?.note ?? "—"} />
            )}
          </>
        )}
      </dl>
    </div>
  );

  const supports = <LevelList title="الدعوم" levels={snapshot.levels.supports} empty="مفيش" />;
  const resistances = (
    <LevelList
      title="المقاومات"
      levels={snapshot.levels.resistances}
      empty="مساحة مفتوحة"
      positive
    />
  );

  const reasons = (technical.reasons.bullish.length > 0 || technical.reasons.bearish.length > 0) && (
    <div className="grid gap-4 sm:grid-cols-2">
      {technical.reasons.bullish.length > 0 && (
        <ReasonList title="مؤيد" items={technical.reasons.bullish} tone="up" />
      )}
      {technical.reasons.bearish.length > 0 && (
        <ReasonList title="معارض" items={technical.reasons.bearish} tone="down" />
      )}
    </div>
  );

  if (!full) {
    return (
      <div className="space-y-4">
        {summary}
        {chart}
        {fundamentalsNote}
        {classificationPanel}
        {planPanel}
        <div className="grid gap-4 sm:grid-cols-2">
          {supports}
          {resistances}
        </div>
        {reasons}
      </div>
    );
  }

  // ---- Page-only sections ----------------------------------------------------

  const { price, returns, movingAverages: ma, momentum, strength, volatility, volume, trend } = snapshot;

  const qualityWarnings: string[] = (data.quality?.issues ?? [])
    .filter((issue: { level: string }) => issue.level === "warn")
    .map((issue: { message: string }) => issue.message);

  const positionPanel = position && (
    <MetricPanel
      title="مركزك في السهم"
      rows={[
        metric("عدد الأسهم", position.shares, (v) => num(int(v)), position.sharesEstimated ? "تقديري — راجعه من «إدخال يدوي»" : null),
        metric("متوسط التكلفة", position.avgCost, (v) => num(`${fmt(v)} ج`)),
        metric("قيمة الشراء", position.purchaseValue, (v) => num(`${int(v)} ج`)),
        metric("القيمة الحالية", position.marketValue, (v) => num(`${int(v)} ج`), position.pricedAt === "live" ? "بالسعر اللحظي" : "بآخر إغلاق"),
        metric("الربح / الخسارة", position.unrealizedEgp, (v) => (
          <span className={cn("num", tone(v))}>
            {signed(v)} ج · {pct(position.unrealizedPct)}
          </span>
        )),
      ]}
    />
  );

  const performancePanel = (
    <MetricPanel
      title="الأداء"
      rows={[
        metric("اليوم", returns.d1, tonedPct),
        metric("أسبوع", returns.w1, tonedPct),
        metric("شهر", returns.m1, tonedPct),
        metric("3 شهور", returns.m3, tonedPct),
        metric("6 شهور", returns.m6, tonedPct),
        metric("سنة", returns.y1, tonedPct),
        metric("أقصى تراجع خلال سنة", returns.maxDrawdown, tonedPct),
        metric("أعلى سعر خلال 52 أسبوع", price.high52w, (v) => num(`${fmt(v)} ج`), isNum(price.pctFrom52wHigh) ? `السعر الحالي ${pct(price.pctFrom52wHigh)} منه` : null),
        metric("أقل سعر خلال 52 أسبوع", price.low52w, (v) => num(`${fmt(v)} ج`), isNum(price.pctFrom52wLow) ? `السعر الحالي ${pct(price.pctFrom52wLow)} منه` : null),
        metric("افتتاح آخر جلسة", price.open, (v) => num(`${fmt(v)} ج`)),
        metric("أعلى آخر جلسة", price.high, (v) => num(`${fmt(v)} ج`)),
        metric("أدنى آخر جلسة", price.low, (v) => num(`${fmt(v)} ج`)),
      ]}
    />
  );

  const vsMa = (value: unknown) => (isNum(value) ? `السعر ${pct(value)} عنه` : null);
  const trendPanel = (
    <MetricPanel
      title="الاتجاه والمتوسطات"
      rows={[
        trend?.label ? ["الاتجاه العام", trend.label, isNum(trend.score) ? `الدرجة ${trend.score} من -100 إلى 100` : undefined] : null,
        metric("متوسط 20 يوم (SMA)", ma.sma20, (v) => num(fmt(v)), vsMa(ma.priceVsSma20Pct)),
        metric("متوسط 50 يوم (SMA)", ma.sma50, (v) => num(fmt(v)), vsMa(ma.priceVsSma50Pct)),
        metric("متوسط 200 يوم (SMA)", ma.sma200, (v) => num(fmt(v)), vsMa(ma.priceVsSma200Pct)),
        metric("متوسط 9 أيام (EMA)", ma.ema9, (v) => num(fmt(v))),
        metric("متوسط 21 يوم (EMA)", ma.ema21, (v) => num(fmt(v))),
        typeof ma.goldenCross === "boolean"
          ? ["متوسط 50 مقابل 200", ma.goldenCross ? "فوقه (تقاطع ذهبي)" : "تحته (تقاطع الموت)"]
          : null,
        metric("قوة الاتجاه (ADX)", strength.adx, (v) => num(fmt(v, 1)), strength.trendQuality),
        metric("+DI", strength.plusDI, (v) => num(fmt(v, 1))),
        metric("-DI", strength.minusDI, (v) => num(fmt(v, 1))),
      ]}
    />
  );

  const breakout = snapshot.breakout;
  const momentumPanel = (
    <MetricPanel
      title="الزخم"
      rows={[
        metric("RSI (14)", momentum.rsi14, (v) => num(fmt(v, 1)), momentum.rsiState),
        metric("MACD", momentum.macd, (v) => num(fmt(v)), MACD_STATE[momentum.macdCross] ?? null),
        metric("خط إشارة MACD", momentum.macdSignal, (v) => num(fmt(v))),
        metric("هيستوجرام MACD", momentum.macdHistogram, (v) => num(fmt(v))),
        metric("ستوكاستك %K", momentum.stochK, (v) => num(fmt(v, 1))),
        metric("ستوكاستك %D", momentum.stochD, (v) => num(fmt(v, 1))),
        metric("معدل التغير (20 يوم)", momentum.roc20, tonedPct),
        momentum.divergence?.type && momentum.divergence.type !== "none"
          ? [
              "تباعد RSI",
              momentum.divergence.type === "bullish" ? "صعودي" : "هابط",
              momentum.divergence.detail ?? undefined,
            ]
          : null,
        breakout
          ? [
              "اختراق حديث",
              `${breakout.direction === "up" ? "صعودي" : "هابط"} عند ${fmt(breakout.level)}`,
              [
                breakout.barsAgo === 0 ? "اليوم" : `من ${breakout.barsAgo} جلسات`,
                breakout.volumeConfirmed ? "مؤكد بحجم تداول" : "بدون تأكيد من الحجم",
              ].join(" · "),
            ]
          : null,
      ]}
    />
  );

  const volatilityPanel = (
    <MetricPanel
      title="التذبذب"
      rows={[
        metric("متوسط المدى الحقيقي (ATR 14)", volatility.atr14, (v) => num(`${fmt(v)} ج`), isNum(volatility.atrPct) ? `${fmt(volatility.atrPct)}% من السعر` : null),
        metric("التذبذب السنوي", volatility.annualizedVolPct, (v) => num(`${fmt(v, 1)}%`)),
        metric("بولنجر العلوي", volatility.bollingerUpper, (v) => num(fmt(v))),
        metric("بولنجر الأوسط", volatility.bollingerMid, (v) => num(fmt(v))),
        metric("بولنجر السفلي", volatility.bollingerLower, (v) => num(fmt(v))),
        metric("موقع السعر داخل النطاق (%B)", volatility.percentB, (v) => num(fmt(v))),
        volatility.squeeze === true ? ["ضغط النطاق", "نطاق ضيق — تذبذب منخفض", "غالبًا بيسبق حركة أقوى"] : null,
      ]}
    />
  );

  const volumePanel = (
    <MetricPanel
      title="الحجم والسيولة"
      rows={[
        metric("حجم آخر جلسة", volume.last, (v) => num(int(v))),
        metric("متوسط 20 جلسة", volume.avg20, (v) => num(int(v))),
        metric("الحجم النسبي", volume.relativeVolume, (v) => num(`${fmt(v)}×`), "مقارنة بمتوسط 20 جلسة"),
        volume.obvTrend ? ["تدفق الحجم (OBV)", volume.obvTrend] : null,
        metric("متوسط التداول اليومي", volume.avgTurnoverEgp, (v) => num(egpBig(v))),
        liquidity ? ["السيولة", liquidity.ok ? "كافية" : "ضعيفة", liquidity.note ?? undefined] : null,
      ]}
    />
  );

  const fundamentalsPanel = fundamentals && (
    <div className="space-y-3">
      {fundamentals.valuation && (
        <Notice tone="info">
          <b>قراءة الأساسيات:</b> {fundamentals.valuation}
        </Notice>
      )}
      <MetricPanel
        title="الأساسيات"
        rows={[
          fundamentals.industry ? ["القطاع", fundamentals.industry] : null,
          metric("مكرر الربحية (P/E)", fundamentals.peRatio, (v) => num(fmt(v))),
          metric("ربحية السهم (EPS)", fundamentals.epsEgp, (v) => num(`${fmt(v)} ج`)),
          metric("السعر ÷ القيمة الدفترية", fundamentals.priceToBook, (v) => num(`${fmt(v)}×`)),
          metric("عائد التوزيعات", fundamentals.dividendYieldPct, (v) => num(`${fmt(v)}%`)),
          metric("العائد على حقوق الملكية", fundamentals.returnOnEquityPct, (v) => num(`${fmt(v, 1)}%`)),
          metric("الدين ÷ حقوق الملكية", fundamentals.debtToEquity, (v) => num(fmt(v))),
          metric("نسبة التداول (السيولة)", fundamentals.currentRatio, (v) => num(fmt(v))),
          metric("القيمة السوقية", fundamentals.marketCapEgp, (v) => num(egpBig(v))),
          metric("الإيرادات (12 شهر)", fundamentals.revenueEgp, (v) => num(egpBig(v))),
          metric("صافي الربح (12 شهر)", fundamentals.netIncomeEgp, (v) => num(egpBig(v))),
        ]}
      />
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        {summary}
        {qualityWarnings.length > 0 && (
          <Notice tone="warn">
            {qualityWarnings.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </Notice>
        )}
        {positionPanel}
        {chart}
        {planPanel}
        {classificationPanel}
        {reasons}
        <div className="grid gap-4 sm:grid-cols-2">
          {supports}
          {resistances}
        </div>
        {fundamentalsPanel}
      </div>
      <div className="min-w-0 space-y-4">
        {performancePanel}
        {trendPanel}
        {momentumPanel}
        {volatilityPanel}
        {volumePanel}
      </div>
    </div>
  );
}

/** A titled list of label/value rows; rows with nothing to show are skipped, and an empty panel isn't drawn. */
function MetricPanel({ title, rows }: { title: string; rows: Metric[] }) {
  const shown = rows.filter((row): row is NonNullable<Metric> => row !== null);
  if (!shown.length) return null;
  return (
    <div className="rounded-lg border">
      <div className="border-b bg-surface px-4 py-2.5 text-[13px] font-semibold">{title}</div>
      <dl className="divide-y text-[13px]">
        {shown.map(([label, value, hint]) => (
          <Line key={label} label={label} value={value} hint={hint} />
        ))}
      </dl>
    </div>
  );
}

function Line({ label, value, hint }: { label: string; value: ReactNode; hint?: string | undefined }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <dt className="text-muted-foreground">
        <TermLabel>{label}</TermLabel>
      </dt>
      <dd className="text-end font-medium">
        {value}
        {hint && <div className="mt-0.5 text-[11.5px] font-normal text-muted-foreground">{hint}</div>}
      </dd>
    </div>
  );
}

type Level = { price: number; distancePct: number; strength: number };

function LevelList({
  title,
  levels,
  empty,
  positive = false,
}: {
  title: string;
  levels: Level[];
  empty: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-lg border">
      <div className="border-b bg-surface px-4 py-2 text-[13px] font-semibold">{title}</div>
      <div className="divide-y text-[13px]">
        {levels?.length ? (
          levels.slice(0, 4).map((level) => (
            <div key={level.price} className="flex justify-between px-4 py-2">
              <span className="num font-medium">{fmt(level.price)}</span>
              <span className="num text-muted-foreground">
                {positive ? "+" : ""}
                {level.distancePct}% · قوة {level.strength}
              </span>
            </div>
          ))
        ) : (
          <p className="px-4 py-3 text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  );
}

const REASON_TONE_CLASS: Record<"up" | "down" | "warn", string> = {
  up: "border-up/40 text-up",
  down: "border-down/40 text-down",
  warn: "border-warn/40 text-warn",
};

function ReasonList({
  title,
  items,
  tone: variant,
}: {
  title: string;
  items: string[];
  tone: "up" | "down" | "warn";
}) {
  return (
    <div>
      <Badge variant="outline" className={REASON_TONE_CLASS[variant]}>
        {title}
      </Badge>
      <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
