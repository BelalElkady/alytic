import { createFileRoute } from "@tanstack/react-router";
import { Download, Info, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState, ErrorState, LoadingBlock, Notice, Panel, Spinner } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { arDay, fmt, isoDay, pct, tone } from "@/lib/format";
import { siteUrl, siteName } from "@/lib/seo";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/track-record")({
  head: ({ match }) => ({
    meta: [
      { title: `سجل الأداء — ${siteName(match)}` },
      {
        name: "description",
        content: "كل توصية بتتسجل لحظة إصدارها ومبتتعدلش، وبتتقيّم يوميًا بعد الإغلاق مقابل المستهدف والوقف ومؤشرات البورصة.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: `سجل الأداء — ${siteName(match)}` },
      { property: "og:url", content: `${siteUrl(match)}/track-record` },
    ],
  }),
  component: TrackRecordRoute,
});

type Action = "buy" | "hold" | "sell" | "reduce";
type Status = "open" | "hit_target" | "hit_stop" | "expired";

type RecRow = {
  id: number;
  ticker: string;
  name: string;
  sector: string | null;
  action: Action;
  issuedAt: string;
  issuedOn: string;
  refPrice: number;
  targetPrice: number | null;
  stopPrice: number | null;
  horizon: number;
  status: Status;
  closedAt: string | null;
  exitPrice: number | null;
  returnPct: number | null;
  excessPct: number | null;
  benchmark: Benchmark | null;
  excessBy: Record<Vs, number | null>;
  sessions: number;
  win: boolean | null;
  stockMovePrice: number | null;
  stockMovePct: number | null;
  stockMoveSessions: number;
  stockMoveFinal: boolean;
  right: boolean | null;
  /** Scored under the original rules: listed, but outside the figures. */
  legacy: boolean;
  mine: boolean;
  model: string;
};

type TrackRecord = {
  vs: Vs;
  summary: {
    total: number;
    open: number;
    closed: number;
    wins: number;
    hitRate: number | null;
    avgReturn: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    winLossRatio: number | null;
    avgExcess: number | null;
    excessCovered: number;
    avgSessionsToTarget: number | null;
  };
  outcomes: Record<"hit_target" | "hit_stop" | "expired_win" | "expired_loss", { count: number; pct: number }>;
  byAction: { action: Action; total: number; closed: number; hitRate: number | null }[];
  /** Which calls the figures cover — see CURRENT_SCORING in backend/src/recommendations.js. */
  scoring: { version: number; minClosed: number; tooEarly: boolean; legacyTotal: number; legacyClosed: number };
  series: { date: string; strategy: number; index: number }[];
  rows: RecRow[];
  rowsTruncated: boolean;
};

type Vs = "own" | "egx30" | "egx70" | "egx33" | "egx100";
type Benchmark = "EGX30" | "EGX70" | "EGX100";

/** What excess return is measured against — see COMPARISONS in backend/src/recommendations.js. */
const VS_OPTIONS: { value: Vs; label: string; short: string }[] = [
  { value: "own", label: "مؤشر كل سهم", short: "مؤشر كل سهم" },
  { value: "egx30", label: "EGX30", short: "EGX30" },
  { value: "egx70", label: "EGX70", short: "EGX70" },
  { value: "egx33", label: "EGX33 (شريعة)", short: "EGX33" },
  { value: "egx100", label: "EGX100", short: "EGX100" },
];
const vsShort = (vs: Vs) => VS_OPTIONS.find((o) => o.value === vs)!.short;

const BENCHMARK_LABEL: Record<Benchmark, string> = { EGX30: "EGX30", EGX70: "EGX70", EGX100: "EGX100" };

const ACTION_LABEL: Record<Action, string> = { buy: "شراء", sell: "بيع", reduce: "تخفيف", hold: "احتفاظ" };

const STATUS_LABEL: Record<Status, string> = {
  open: "مفتوحة",
  hit_target: "حققت المستهدف",
  hit_stop: "ضربت الوقف",
  expired: "انتهت المدة",
};

const STATUS_CLASS: Record<Status, string> = {
  open: "border-border bg-surface-2 text-muted-foreground",
  hit_target: "border-primary/25 bg-primary/10 text-primary",
  hit_stop: "border-down/30 bg-down-soft text-down",
  expired: "border-warn/40 bg-warn-soft text-foreground",
};

const HORIZONS = [
  { value: "all", label: "كل الآفاق" },
  { value: "short", label: "حتى 10 جلسات" },
  { value: "medium", label: "11–40 جلسة" },
  { value: "long", label: "+40 جلسة" },
];

const PERIODS = [
  { value: "3m", label: "آخر 3 شهور", months: 3 },
  { value: "6m", label: "آخر 6 شهور", months: 6 },
  { value: "1y", label: "آخر سنة", months: 12 },
  { value: "all", label: "كل الفترات", months: null },
  { value: "custom", label: "فترة مخصصة", months: null },
] as const;

type Period = (typeof PERIODS)[number]["value"];

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return isoDay(date);
}

const monthLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("ar-EG", { month: "short", timeZone: "UTC" });

/**
 * An ⓘ that opens a short explanation. A popover rather than a tooltip, so it
 * opens on a tap too — tooltips never show on a phone.
 */
function Hint({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`شرح: ${label}`}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" side="top" className="w-72 space-y-1.5 text-[12.5px] leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** A panel title with its hint beside it. */
function HintedTitle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {title}
      <Hint label={title}>{children}</Hint>
    </span>
  );
}

/** Admins only for now — the API refuses everyone else too (see /api/track-record in server.js). */
function TrackRecordRoute() {
  const { user } = useDesk();
  if (!user?.isAdmin) return <ErrorState message="الصفحة دي للمشرفين بس." />;
  return <TrackRecordPage />;
}

function TrackRecordPage() {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [vs, setVs] = useState<Vs>("own");
  const [action, setAction] = useState<"all" | Action>("all");
  const [horizon, setHorizon] = useState("all");
  const [period, setPeriod] = useState<Period>("6m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<TrackRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (period === "custom") return { from: customFrom || null, to: customTo || null };
    const months = PERIODS.find((p) => p.value === period)?.months ?? null;
    return { from: months ? monthsAgo(months) : null, to: null };
  }, [period, customFrom, customTo]);

  useEffect(() => {
    const params = new URLSearchParams({ scope, vs });
    if (action !== "all") params.set("action", action);
    if (horizon !== "all") params.set("horizon", horizon);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);

    let cancelled = false;
    setLoading(true);
    api<TrackRecord>(`/api/track-record?${params}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((caught) => !cancelled && setError(caught?.message ?? "تعذر تحميل سجل الأداء"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [scope, vs, action, horizon, range]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!data || !needle) return data?.rows ?? [];
    return data.rows.filter((r) => r.ticker.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle));
  }, [data, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-tight">سجل أداء التوصيات</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            كل توصية بتتسجل لحظة إصدارها ومبتتعدلش، وبتتقيّم يوميًا بعد الإغلاق مقابل المستهدف والوقف ومؤشرات البورصة.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            value={scope}
            onValueChange={(value) => value && setScope(value as "all" | "mine")}
            className="justify-start"
          >
            <ToggleGroupItem value="all" size="sm" className="px-3 text-[12.5px]">
              كل التوصيات
            </ToggleGroupItem>
            <ToggleGroupItem value="mine" size="sm" className="px-3 text-[12.5px]">
              توصياتي فقط
            </ToggleGroupItem>
          </ToggleGroup>
          <Hint label="كل التوصيات أو توصياتي فقط">
            <p>
              <b>كل التوصيات:</b> كل التوصيات اللي التطبيق إداها لكل المستخدمين على الموقع.
            </p>
            <p>
              <b>توصياتي فقط:</b> التوصيات اللي اتدت لك إنت بس، من مراجعة محفظتك أو تحليل سهم أو تقرير السوق أو خطة
              الكاش.
            </p>
          </Hint>
        </div>
      </div>

      <Filters
        vs={vs}
        setVs={setVs}
        action={action}
        setAction={setAction}
        horizon={horizon}
        setHorizon={setHorizon}
        period={period}
        setPeriod={setPeriod}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        loading={loading && Boolean(data)}
      />

      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <LoadingBlock rows={3} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          title="لسه مفيش توصيات في النطاق ده"
          hint="أول ما التطبيق يدي توصية شراء أو بيع أو تخفيف أو احتفاظ بتتسجل هنا، وبتتقيّم كل يوم بعد إغلاق السوق."
        />
      ) : (
        <>
          <ScoringNotice data={data} />
          {!data.scoring.tooEarly && <Kpis data={data} />}

          {!data.scoring.tooEarly && (
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel
                className="lg:col-span-2"
                title={
                  <HintedTitle
                    title={`لو نفّذت كل التوصيات بمبالغ متساوية — مقابل ${vsShort(data.vs)}`}
                  >
                    <p>
                      بيوضح الفلوس كانت هتعمل إيه مع الوقت لو حد نفّذ كل توصية اتحسمت، بنفس المبلغ
                      لكل واحدة. يعني ده أداء التوصيات كلها مع بعض، مش سهم واحد.
                    </p>
                    <p>
                      <b>ده مش أداء محفظتك.</b> الرسم مابيعرفش إنت اشتريت كام ولا بكام، ولا نفّذت
                      التوصية أصلًا ولا لأ، ولا باقي أسهمك اللي مفيش عليها توصيات. أداء محفظتك
                      الحقيقي في صفحة «الرسوم».
                    </p>
                    <p>
                      التوصيات اللي داخلة فيه بتتحدد من «كل التوصيات» أو «توصياتي فقط» فوق. توصياتك
                      مش أسهم محفظتك بس: فيها كمان ترشيحات تقرير السوق وخطة الكاش.
                    </p>
                    <p>
                      <b>الخط الأزرق المتصل:</b> التوصيات. <b>الخط البرتقالي المتقطع:</b> نفس الفلوس
                      لو كانت في المؤشر خلال نفس الفترات بالظبط.
                    </p>
                    <p>
                      كل نقطة هي يوم اتحسمت فيه توصية أو أكتر، والرقم هو المكسب أو الخسارة التراكمية
                      من أول الفترة. لما الأزرق يبقى فوق البرتقالي، التوصيات سابقة المؤشر.
                    </p>
                    {data.vs === "own" && (
                      <p>
                        في «مؤشر كل سهم» الخط المتقطع مش مؤشر واحد: كل توصية بتتقارن بمؤشر سهمها
                        (EGX30 أو EGX70 أو EGX100) في نفس مدتها، والخط هو مجموعهم. لو عايز تقارن
                        بالسوق كله اختار EGX100 من «مقابل».
                      </p>
                    )}
                    <p>قرّب الماوس أو المس الرسم لأي نقطة تشوف أرقامها.</p>
                  </HintedTitle>
                }
                description={
                  <>
                    {data.vs === "own"
                      ? "محفظة افتراضية بتنفّذ كل التوصيات المحسومة بنفس المبلغ، مقابل نفس الفلوس في مؤشر كل سهم (EGX30 أو EGX70 أو EGX100) على نفس الفترات."
                      : `محفظة افتراضية بتنفّذ كل التوصيات المحسومة بنفس المبلغ، مقابل نفس الفلوس في ${vsShort(data.vs)} على نفس الفترات.`}{" "}
                    <span className="font-medium text-foreground">ده مش أداء محفظتك الحقيقية.</span>
                  </>
                }
              >
                <PerformanceChart series={data.series} indexLabel={vsShort(data.vs)} />
              </Panel>
              <div className="space-y-4">
                <Panel
                  title={
                    <HintedTitle title="نتائج الحسم">
                      <p>إزاي اتقفلت التوصيات المحسومة، كنسبة من إجماليها:</p>
                      <p>
                        <b>حققت المستهدف:</b> السعر لمس الهدف. <b>ضربت الوقف:</b> السعر لمس وقف
                        الخسارة. <b>انتهت المدة بربح أو بخسارة:</b> الأفق خلص من غير ما يلمس أي
                        مستوى، فاتحسمت بسعر إغلاق آخر جلسة.
                      </p>
                      <p>البيع والتخفيف مالهمش مستهدف ولا وقف، فدايمًا بيتحسموا بانتهاء المدة.</p>
                    </HintedTitle>
                  }
                >
                  <Outcomes outcomes={data.outcomes} closed={data.summary.closed} />
                </Panel>
                <Panel
                  title={
                    <HintedTitle title="النجاح حسب نوع التوصية">
                      <p>نسبة النجاح لكل نوع قرار لوحده: شراء، بيع، تخفيف، واحتفاظ.</p>
                      <p>
                        الرقم بين القوسين عدد التوصيات من النوع ده، شامل المفتوحة. النسبة محسوبة على
                        المحسوم بس.
                      </p>
                    </HintedTitle>
                  }
                >
                  <ByAction byAction={data.byAction} />
                </Panel>
              </div>
            </div>
          )}

          <Panel
            title={
              <HintedTitle title="سجل التوصيات">
                <p>كل توصية لوحدها، الأحدث الأول.</p>
                <p>
                  <b>سعر المرجع:</b> السعر وقت إصدار التوصية. <b>المستهدف والوقف:</b> المستويين اللي بتتحسم عليهم، والبيع
                  والتخفيف مالهمش مستويات.
                </p>
                <p>
                  <b>العائد:</b> النهائي لو اتحسمت، أو لحد آخر إغلاق لو لسه مفتوحة. <b>مقابل المؤشر:</b> العائد ناقص حركة
                  المؤشر في نفس المدة.
                </p>
                <p>
                  <b>الجلسات:</b> الجلسات اللي عدّت من أفق التوصية، يعني 5 / 20 = عدّت 5 جلسات من 20.
                </p>
              </HintedTitle>
            }
            description={
              data.rowsTruncated ? `أحدث ${data.rows.length} توصية — الأرقام فوق محسوبة على الكل` : undefined
            }
            bodyClassName="px-0 py-0 sm:px-0"
            action={
              <div className="flex items-center gap-2">
                <div className="relative hidden sm:block">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="ابحث بالرمز أو اسم الشركة"
                    className="h-8 w-56 ps-8 text-[12.5px]"
                    aria-label="بحث في التوصيات"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => downloadCsv(rows)} disabled={!rows.length}>
                  <Download className="size-3.5" />
                  تصدير CSV
                </Button>
              </div>
            }
          >
            <div className="px-4 pt-3 sm:hidden">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث بالرمز أو اسم الشركة"
                className="h-9 text-[13px]"
                aria-label="بحث في التوصيات"
              />
            </div>
            <RecordTable rows={rows} vs={data.vs} />
            <RecordCards rows={rows} />
          </Panel>
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="المنهجية">
          <ul className="list-disc space-y-1.5 ps-4 text-[12.5px] leading-relaxed text-muted-foreground">
            <li>سعر المرجع هو السعر اللي اتبنت عليه التوصية لحظة إصدارها، والتقييم بيبدأ من أول جلسة بعد يوم الإصدار.</li>
            <li>
              توصية الشراء أو الاحتفاظ تنجح لو لمست المستهدف قبل الوقف خلال الأفق. لو الجلسة لمست الاتنين بتتحسب
              وقف، ولو السعر فتح بفجوة بعد المستوى بيتحسب سعر الفتح.
            </li>
            <li>البيع والتخفيف عائدهم بيتحسب بعكس اتجاه السعر، وبيتحسموا بنهاية الأفق.</li>
            <li>
              كل توصية بتتقارن بمؤشر سهمها وقت الإصدار: EGX30 لو السهم فيه، EGX70 لو فيه، وEGX100 لو مش في
              الاتنين. وممكن تقارن الكل بمؤشر واحد (EGX30 أو EGX70 أو EGX33 للشريعة أو EGX100) من اختيار «مقابل».
            </li>
            <li>
              اللي ينتهي أفقها من غير ما تلمس مستوى بتتحسم بسعر إغلاق آخر جلسة، وتنجح لو كسبت. الاحتفاظ اللي
              ينتهي أفقه بيتقاس نسبيًا: ينجح لو ماتأخرش عن مؤشر سهمه.
            </li>
            <li>العوائد قبل العمولات. كل توصية بتفضل في السجل، ومفيش توصية بتتشال أو تتعدل بعد إصدارها.</li>
          </ul>
        </Panel>
        <Notice tone="warn" className="h-fit">
          <p className="font-semibold">تنبيه مهم</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            الإشارات المعروضة تحليلية وآلية ولا تُعد نصيحة استثمارية أو دعوة للشراء أو البيع. الأداء السابق لا يضمن
            النتائج المستقبلية، والعوائد المعروضة افتراضية ولا تشمل تكاليف التنفيذ الفعلية. قراراتك الاستثمارية
            مسؤوليتك الشخصية.
          </p>
        </Notice>
      </div>
    </div>
  );
}

function Filters({
  vs,
  setVs,
  action,
  setAction,
  horizon,
  setHorizon,
  period,
  setPeriod,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  loading,
}: {
  vs: Vs;
  setVs: (value: Vs) => void;
  action: "all" | Action;
  setAction: (value: "all" | Action) => void;
  horizon: string;
  setHorizon: (value: string) => void;
  period: Period;
  setPeriod: (value: Period) => void;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5">
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
        أفق التقييم
        <Hint label="أفق التقييم">
          <p>
            <b>الأفق</b> هو المدة اللي التوصية بتتقيّم خلالها، يعني الموعد اللي المفروض يبان فيه هي صح ولا غلط. ده خاص
            بالتوصية مش بالسهم.
          </p>
          <p>
            بيتحسب بـ<b>جلسات التداول</b> مش بالأيام (من الأحد للخميس من غير الإجازات)، يعني 20 جلسة ≈ 4 أسابيع.
          </p>
          <p>
            <b>بيتحدد إزاي:</b> في الشراء والاحتفاظ، من المدة المتوقعة إن السهم يوصل فيها للمستهدف حسب سرعة حركته. لو
            مفيش تقدير، أو لو التوصية بيع أو تخفيف، بياخد مدة ثابتة حسب الأسلوب: 10 جلسات للمضارب، 20 للمتوسط، 60
            للطويل.
          </p>
          <p>
            <b>مثال:</b> شراء بسعر 100، والمستهدف 110، والأفق 20 جلسة. لو وصل 110 في الجلسة 8، تتحسم «حققت المستهدف».
            ولو عدّت الـ 20 جلسة من غير ما يلمس المستهدف ولا الوقف، تتحسم بسعر إغلاق الجلسة 20. وحركة السهم الفعلية
            بتتقاس في الحالتين لحد الجلسة 20.
          </p>
          <p>الفلتر ده بيعرض التوصيات حسب طول أفقها: قصير (حتى 10 جلسات)، متوسط (11–40)، أو طويل (أكتر من 40).</p>
        </Hint>
      </span>
      <ToggleGroup
        type="single"
        value={horizon}
        onValueChange={(value) => value && setHorizon(value)}
        className="justify-start"
      >
        {HORIZONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} size="sm" className="text-[12px]">
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="ms-auto flex flex-wrap items-center gap-2">
        {loading && <Spinner className="text-muted-foreground" />}
        <Hint label="مقابل">
          <p>المؤشر اللي بنقارن بيه أداء التوصيات، في «العائد الزائد» والرسم البياني وعمود المقارنة في الجدول.</p>
          <p>
            <b>مؤشر كل سهم:</b> كل توصية بتتقارن بمؤشر سهمها وقت الإصدار: EGX30 لو السهم فيه، EGX70 لو فيه، وEGX100 لو
            مش في الاتنين. دي أعدل مقارنة، لأن الأسهم الصغيرة بتتحرك غير الكبيرة.
          </p>
          <p>
            أو قارن الكل بمؤشر واحد: <b>EGX30</b> (أكبر 30 شركة)، <b>EGX70</b> (الـ 70 اللي بعدهم)، <b>EGX33</b> (الأسهم
            المتوافقة مع الشريعة)، أو <b>EGX100</b> (الاتنين مع بعض).
          </p>
        </Hint>
        <Select value={vs} onValueChange={(value) => setVs(value as Vs)}>
          <SelectTrigger className="h-8 w-[150px] text-[12.5px]" aria-label="المقارنة">
            <span className="text-muted-foreground">مقابل</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={(value) => setAction(value as "all" | Action)}>
          <SelectTrigger className="h-8 w-[118px] text-[12.5px]" aria-label="القرار">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل القرارات</SelectItem>
            {(Object.keys(ACTION_LABEL) as Action[]).map((key) => (
              <SelectItem key={key} value={key}>
                {ACTION_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
          <SelectTrigger className="h-8 w-[130px] text-[12.5px]" aria-label="الفترة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {period === "custom" && (
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span>من</span>
            <Input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="h-8 w-[140px] text-[12.5px]"
              aria-label="من تاريخ"
            />
            <span>إلى</span>
            <Input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => setCustomTo(event.target.value)}
              className="h-8 w-[140px] text-[12.5px]"
              aria-label="إلى تاريخ"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  hint,
  valueClassName,
  highlight = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint: ReactNode;
  valueClassName?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-xl border px-4 py-3.5",
        highlight ? "border-primary bg-primary text-primary-foreground" : "bg-card",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-between gap-2 text-[12px]",
          highlight ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {label}
        <Hint label={label} className={highlight ? "text-primary-foreground/80 hover:text-primary-foreground" : undefined}>
          {hint}
        </Hint>
      </span>
      <span className={cn("num text-[26px] font-semibold leading-tight tracking-tight", valueClassName)}>{value}</span>      {sub && (
        <span className={cn("text-[11.5px]", highlight ? "text-primary-foreground/75" : "text-muted-foreground")}>
          {sub}
        </span>
      )}
    </div>
  );
}

/**
 * Says what the figures cover: too few resolved calls under the current rules
 * to show rates at all, and how many older calls are listed but left out.
 */
function ScoringNotice({ data }: { data: TrackRecord }) {
  const { scoring, summary } = data;
  if (!scoring.tooEarly && !scoring.legacyTotal) return null;
  return (
    <div className="space-y-3">
      {scoring.tooEarly && (
        <Notice tone="info">
          <p className="font-semibold">لسه بدري نحكم على الأداء</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            الأرقام (نسبة النجاح ومتوسط العائد والرسم) مش بتظهر قبل ما يتحسم{" "}
            <span className="num">{fmt(scoring.minClosed)}</span> توصية على الأقل بقواعد التقييم
            الحالية، لأن عدد أقل من كده بيدّي أرقام مضللة في الاتجاهين. لحد دلوقتي:{" "}
            <span className="num font-semibold text-foreground">{fmt(summary.closed)}</span> محسومة
            و<span className="num font-semibold text-foreground"> {fmt(summary.open)}</span> مفتوحة.
          </p>
        </Notice>
      )}
      {scoring.legacyTotal > 0 && (
        <Notice tone="warn">
          <p className="text-[12.5px] leading-relaxed">
            <span className="num font-semibold">{fmt(scoring.legacyTotal)}</span> توصية (
            <span className="num">{fmt(scoring.legacyClosed)}</span> منها محسومة) اتقيّمت بقواعد
            التقييم القديمة، فبتظهر في السجل بعلامة «قواعد قديمة» ومش داخلة في الأرقام. القواعد
            الجديدة: وقف الخسارة بيتحسب بإغلاق تحته مش بلمسة خلال الجلسة، والاحتفاظ بيتقيّم في نهاية
            أفقه مقابل المؤشر، وتقسيمات الأسهم وأسهم المنحة مابتتحسبش خسارة.
          </p>
        </Notice>
      )}
    </div>
  );
}

function Kpis({ data }: { data: TrackRecord }) {
  const s = data.summary;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KpiCard
        label="نسبة النجاح"
        value={s.hitRate == null ? "—" : `${fmt(s.hitRate)}%`}
        valueClassName="text-primary"
        sub={
          s.closed
            ? `${fmt(s.wins)} من ${fmt(s.closed)} توصية محسومة${s.open ? ` · ${fmt(s.open)} مفتوحة` : ""}`
            : `${fmt(s.open)} توصية مفتوحة — لسه مفيش محسوم`
        }
        hint={
          <>
            <p>نسبة التوصيات المحسومة اللي نجحت. التوصيات المفتوحة مش داخلة في الحساب.</p>
            <p>
              التوصية <b>بتنجح</b> لو لمست المستهدف، أو خلص أفقها وهي كسبانة. <b>بتفشل</b> لو لمست الوقف، أو خلص أفقها
              وهي خسرانة.
            </p>
            <p>الاحتفاظ اللي يخلص أفقه بينجح لو سهمه ماتأخرش عن مؤشره.</p>
          </>
        }
      />
      <KpiCard
        label="متوسط العائد لكل توصية"
        value={pct(s.avgReturn)}
        valueClassName={tone(s.avgReturn)}
        sub="قبل العمولات"
        hint={
          <>
            <p>متوسط مكسب أو خسارة التوصية الواحدة، من سعر المرجع لسعر الخروج، على التوصيات المحسومة بس.</p>
            <p>في البيع والتخفيف، نزول السعر بيتحسب مكسب لأن التوصية كانت إنك تطلع من السهم.</p>
            <p>الأرقام قبل عمولات السمسرة والضرايب.</p>
          </>
        }
      />
      <KpiCard
        label={`العائد الزائد عن ${vsShort(data.vs)}`}
        value={pct(s.avgExcess)}
        sub={
          s.excessCovered < s.closed
            ? `متوسط ${fmt(s.excessCovered)} من ${fmt(s.closed)} توصية مسجل لها المؤشر`
            : "متوسط الفرق لكل توصية"
        }
        highlight
        hint={
          <>
            <p>الفرق بين عائد التوصية وحركة المؤشر في نفس المدة بالظبط، والرقم ده متوسطه على التوصيات المحسومة.</p>
            <p>
              <b>موجب:</b> التوصيات كسبت أكتر من إنك تحط نفس الفلوس في المؤشر في نفس الوقت. <b>سالب:</b> المؤشر كان
              أحسن.
            </p>
            <p>المؤشر بيتغير من اختيار «مقابل» فوق.</p>
          </>
        }
      />
      <KpiCard
        label="متوسط الربح / الخسارة"
        value={
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-up">{pct(s.avgWin)}</span>
            <span className="text-[15px] text-muted-foreground">/</span>
            <span className="text-down">{pct(s.avgLoss)}</span>
          </span>
        }
        valueClassName="text-[20px]"
        sub={s.winLossRatio == null ? "نسبة الربح للخسارة —" : `نسبة الربح للخسارة ${fmt(s.winLossRatio)}`}
        hint={
          <>
            <p>
              <b>الأخضر:</b> متوسط مكسب التوصيات اللي كسبت. <b>الأحمر:</b> متوسط خسارة التوصيات اللي خسرت.
            </p>
            <p>
              <b>نسبة الربح للخسارة</b> = الأخضر ÷ الأحمر. لو أكبر من 1، المكسب المعتاد أكبر من الخسارة المعتادة، فممكن
              تكسب في الإجمالي حتى لو نسبة النجاح أقل من 50%.
            </p>
          </>
        }
      />
      <KpiCard
        label="متوسط الوصول للمستهدف"
        hint={
          <p>
            متوسط عدد جلسات التداول من يوم إصدار التوصية لحد ما لمست المستهدف، محسوب على التوصيات اللي وصلت له بس. كل
            ما قل، كل ما التوصيات بتحقق هدفها أسرع.
          </p>
        }
        value={
          s.avgSessionsToTarget == null ? (
            "—"
          ) : (
            <span>
              {fmt(s.avgSessionsToTarget)} <span className="text-[14px] font-normal text-muted-foreground">جلسة</span>
            </span>
          )
        }
        sub="للتوصيات اللي حققت المستهدف"
      />
    </div>
  );
}

function PerformanceChart({ series, indexLabel }: { series: TrackRecord["series"]; indexLabel: string }) {
  if (series.length < 2) {
    return (
      <EmptyState
        title="المنحنى محتاج توصيات محسومة"
        hint="أول ما توصيات تتحسم بالمستهدف أو الوقف أو انتهاء المدة هيظهر أداؤها التراكمي هنا."
      />
    );
  }
  const last = series[series.length - 1]!;
  // One tick per month (its first point), not one per point — daily points
  // with a month-only label printed the same month several times.
  const monthTicks = series
    .filter((point, i) => i === 0 || point.date.slice(0, 7) !== series[i - 1]!.date.slice(0, 7))
    .map((point) => point.date);
  // Each line's name at its end, the higher line's above it and the lower's below, so they don't collide.
  const strategyOnTop = last.strategy >= last.index;
  const endLabel = (text: string, color: string, above: boolean) =>
    function EndLabel(props: { index?: number; x?: number | string; y?: number | string }) {
      if (props.index !== series.length - 1 || props.x == null || props.y == null) return <g />;
      return (
        <text
          x={Number(props.x) - 6}
          y={Number(props.y) + (above ? -9 : 16)}
          textAnchor="end"
          fill={color}
          fontSize={11.5}
          fontWeight={600}
        >
          {text}
        </text>
      );
    };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="flex items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5">
          <span className="h-[3px] w-6 rounded bg-primary" />
          <span>التوصيات (محفظة افتراضية)</span>
          <span className={cn("num font-semibold", tone(last.strategy))}>{pct(last.strategy)}</span>
        </span>
        <span className="flex items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5">
          <span className="h-0 w-6 border-t-[3px] border-dashed border-warn" />
          <span>نفس الفلوس في {indexLabel}</span>
          <span className={cn("num font-semibold", tone(last.index))}>{pct(last.index)}</span>
        </span>
      </div>
      <div dir="ltr" className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 22, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="trackFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.14} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
            <XAxis
              dataKey="date"
              ticks={monthTicks}
              tickFormatter={monthLabel}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              orientation="right"
              tickFormatter={(value: number) => `${value > 0 ? "+" : ""}${value}%`}
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <Tooltip cursor={{ stroke: "var(--border)" }} content={<SeriesTooltip indexLabel={indexLabel} />} />
            <Area
              type="monotone"
              dataKey="strategy"
              name="التوصيات"
              stroke="var(--primary)"
              strokeWidth={2.5}
              fill="url(#trackFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              label={endLabel("التوصيات", "var(--primary)", strategyOnTop)}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="index"
              name={indexLabel}
              stroke="var(--warn)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: "var(--warn)" }}
              label={endLabel(indexLabel, "var(--warn)", !strategyOnTop)}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SeriesTooltip({
  active,
  payload,
  indexLabel,
}: {
  active?: boolean;
  payload?: { payload: { date: string; strategy: number; index: number } }[];
  indexLabel: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div dir="rtl" className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <div className="text-[11.5px] text-muted-foreground">{arDay(point.date)}</div>
      <div className="num mt-1 flex items-center gap-1.5 text-[13px]">
        <span className="h-[3px] w-4 rounded bg-primary" />
        التوصيات <span className={cn("font-semibold", tone(point.strategy))}>{pct(point.strategy)}</span>
      </div>
      <div className="num flex items-center gap-1.5 text-[13px]">
        <span className="h-0 w-4 border-t-[3px] border-dashed border-warn" />
        {indexLabel} <span className={cn("font-semibold", tone(point.index))}>{pct(point.index)}</span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">التراكمي من أول الفترة</div>
    </div>
  );
}

const OUTCOME_PARTS = [
  { key: "hit_target", label: "حققت المستهدف", className: "bg-primary" },
  { key: "expired_win", label: "انتهت المدة بربح", className: "bg-primary/45" },
  { key: "hit_stop", label: "ضربت الوقف", className: "bg-down" },
  { key: "expired_loss", label: "انتهت المدة بخسارة", className: "bg-down/40" },
] as const;

function Outcomes({ outcomes, closed }: { outcomes: TrackRecord["outcomes"]; closed: number }) {
  if (!closed) return <p className="text-[12.5px] text-muted-foreground">لسه مفيش توصيات محسومة.</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {OUTCOME_PARTS.map((part) => (
          <span key={part.key} className={part.className} style={{ width: `${outcomes[part.key].pct}%` }} />
        ))}
      </div>
      {/* One row per outcome: the panel sits in a narrow column, and two per row cut the labels short. */}
      <div className="space-y-1.5 text-[12.5px]">
        {OUTCOME_PARTS.map((part) => (
          <div key={part.key} className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-sm", part.className)} />
            <span className="text-muted-foreground">{part.label}</span>
            <span className="num ms-auto text-[11.5px] text-muted-foreground">{fmt(outcomes[part.key].count)} توصية</span>
            <span className="num w-14 text-end font-semibold">{fmt(outcomes[part.key].pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ByAction({ byAction }: { byAction: TrackRecord["byAction"] }) {
  const shown = byAction.filter((row) => row.total > 0);
  if (!shown.length) return <p className="text-[12.5px] text-muted-foreground">مفيش توصيات.</p>;
  return (
    <div className="space-y-3">
      {shown.map((row) => (
        <div key={row.action} className="space-y-1">
          <div className="flex items-center justify-between text-[12.5px]">
            <span>
              <span className="font-semibold">{ACTION_LABEL[row.action]}</span>{" "}
              <span className="num text-muted-foreground">({fmt(row.total)})</span>
            </span>
            <span className="num font-semibold">
              {row.hitRate == null ? (
                <span className="font-normal text-muted-foreground">لسه مفتوحة</span>
              ) : (
                `${fmt(row.hitRate)}%`
              )}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary" style={{ width: `${row.hitRate ?? 0}%` }} />
          </div>
        </div>
      ))}
      <p className="text-[11.5px] text-muted-foreground">الاحتفاظ بيتقاس نسبيًا مقابل مؤشر سهمه.</p>
    </div>
  );
}

/** The stock's real move over the call's horizon, with whether the call got its direction right. */
function StockMoveCell({ row }: { row: RecRow }) {
  if (row.stockMovePct == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className={cn("num font-semibold", tone(row.stockMovePct))}>{pct(row.stockMovePct)}</span>
        {row.stockMoveFinal ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-semibold",
              row.right ? "bg-up-soft text-up" : "bg-down-soft text-down",
            )}
          >
            {row.right ? "✔ صح" : "✖ غلط"}
          </span>
        ) : (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">لسه</span>
        )}
      </div>
      <div className="num text-[11px] text-muted-foreground">
        {fmt(row.refPrice)} ← {fmt(row.stockMovePrice)}
      </div>
    </div>
  );
}

function StatusBadge({ row }: { row: RecRow }) {
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Badge
        variant="outline"
        className={cn("whitespace-nowrap font-medium", STATUS_CLASS[row.status])}
      >
        {STATUS_LABEL[row.status]}
        {row.status === "expired" && row.win != null ? (row.win ? " · ربح" : " · خسارة") : ""}
      </Badge>
      {row.legacy && (
        <span
          className="whitespace-nowrap text-[10.5px] text-muted-foreground"
          title="اتقيّمت بقواعد التقييم القديمة (لمسة الوقف خلال الجلسة، واحتفاظ بوقف) — مش داخلة في الأرقام فوق."
        >
          قواعد قديمة
        </span>
      )}
    </span>
  );
}

function RecordTable({ rows, vs }: { rows: RecRow[]; vs: Vs }) {
  if (!rows.length) {
    return <p className="hidden px-5 py-6 text-center text-[13px] text-muted-foreground sm:block">مفيش نتائج للبحث ده.</p>;
  }
  return (
    <div className="scrollbar-slim hidden overflow-x-auto sm:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-start">السهم</TableHead>
            <TableHead className="text-start">القرار</TableHead>
            <TableHead className="text-start">تاريخ الإصدار</TableHead>
            <TableHead className="text-start">سعر المرجع</TableHead>
            <TableHead className="text-start">المستهدف</TableHead>
            <TableHead className="text-start">الوقف</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
            <TableHead className="text-start">العائد</TableHead>
            <TableHead className="text-start">
              <span className="inline-flex items-center gap-1">
                مقابل {vsShort(vs)}
                <Hint label="مقابل المؤشر">
                  <p>عائد التوصية ناقص حركة المؤشر في نفس المدة. موجب يعني التوصية سبقت المؤشر.</p>
                  {vs === "own" && <p>اسم المؤشر تحت الرقم هو مؤشر السهم اللي اتقارن بيه.</p>}
                </Hint>
              </span>
            </TableHead>
            <TableHead className="text-start">
              <span className="inline-flex items-center gap-1">
                حركة السهم الفعلية
                <Hint label="حركة السهم الفعلية">
                  <p>اللي حصل للسهم فعلًا من سعر التوصية لسعره في آخر أفقها، بغض النظر عن المستهدف والوقف.</p>
                  <p>
                    <b>✔ صح:</b> السهم مشي في اتجاه التوصية (شراء وطلع، بيع أو تخفيف ونزل، احتفاظ ومانزلش).{" "}
                    <b>✖ غلط:</b> مشي عكسها. <b>لسه:</b> الأفق لسه ماخلصش، والرقم لحد آخر إغلاق.
                  </p>
                  <p>تحت الرقم: سعر التوصية ← سعر السهم في آخر الأفق.</p>
                </Hint>
              </span>
            </TableHead>
            <TableHead className="text-start">
              <span className="inline-flex items-center gap-1">
                الجلسات
                <Hint label="الجلسات">
                  <p>الجلسات اللي عدّت من إصدار التوصية / أفقها الكامل. مثلًا 5 / 20 = عدّت 5 جلسات من 20.</p>
                  <p>للمحسومة، الرقم الأول هو الجلسة اللي اتقفلت فيها.</p>
                </Hint>
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-semibold">
                  <span dir="ltr">{row.ticker}</span>
                </div>
                <div className="max-w-40 truncate text-[11.5px] text-muted-foreground">{row.name}</div>
              </TableCell>
              <TableCell className="font-semibold">{ACTION_LABEL[row.action]}</TableCell>
              <TableCell className="num text-muted-foreground">{row.issuedOn}</TableCell>
              <TableCell className="num">{fmt(row.refPrice)}</TableCell>
              <TableCell className="num">{fmt(row.targetPrice)}</TableCell>
              <TableCell className="num">{fmt(row.stopPrice)}</TableCell>
              <TableCell>
                <StatusBadge row={row} />
              </TableCell>
              <TableCell className={cn("num font-semibold", tone(row.returnPct))}>{pct(row.returnPct)}</TableCell>
              <TableCell className={cn("num font-semibold", tone(row.excessPct))}>
                {pct(row.excessPct)}
                {vs === "own" && row.benchmark && (
                  <div className="text-[11px] font-normal text-muted-foreground">{BENCHMARK_LABEL[row.benchmark]}</div>
                )}
              </TableCell>
              <TableCell>
                <StockMoveCell row={row} />
              </TableCell>
              <TableCell className="num text-muted-foreground">
                {row.sessions ? `${row.sessions} / ${row.horizon}` : `— / ${row.horizon}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RecordCards({ rows }: { rows: RecRow[] }) {
  return (
    <div className="space-y-2.5 p-4 sm:hidden">
      {!rows.length && <p className="text-center text-[13px] text-muted-foreground">مفيش نتائج للبحث ده.</p>}
      {rows.map((row) => (
        <div key={row.id} className="rounded-lg border bg-card px-3.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold">
                <span dir="ltr">{row.ticker}</span>
              </div>
              <div className="truncate text-[11.5px] text-muted-foreground">
                {row.name} · {ACTION_LABEL[row.action]}
              </div>
            </div>
            <StatusBadge row={row} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
            <span className="num text-muted-foreground">
              مرجع {fmt(row.refPrice)}
              {row.targetPrice != null && ` ← هدف ${fmt(row.targetPrice)}`}
              {row.targetPrice == null && row.stopPrice != null && ` ← وقف ${fmt(row.stopPrice)}`}
            </span>
            <span className={cn("num font-semibold", tone(row.returnPct))}>{pct(row.returnPct)}</span>
          </div>
          {row.stockMovePct != null && (
            <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[12px]">
              <span className="text-muted-foreground">السهم فعلًا في آخر الأفق</span>
              <StockMoveCell row={row} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function downloadCsv(rows: RecRow[]) {
  const header = ["ticker", "name", "sector", "action", "issued_on", "ref_price", "target_price", "stop_price", "horizon_sessions", "status", "closed_at", "exit_price", "return_pct", "benchmark", "excess_vs_benchmark_pct", "excess_vs_egx30_pct", "excess_vs_egx70_pct", "excess_vs_egx33_pct", "excess_vs_egx100_pct", "sessions_elapsed", "stock_price_at_horizon_end", "stock_move_pct", "horizon_over", "direction_right", "model_version", "old_scoring_rules"];
  const lines = rows.map((r) =>
    [r.ticker, r.name, r.sector, r.action, r.issuedOn, r.refPrice, r.targetPrice, r.stopPrice, r.horizon, r.status, r.closedAt?.slice(0, 10), r.exitPrice, r.returnPct, r.benchmark, r.excessBy.own, r.excessBy.egx30, r.excessBy.egx70, r.excessBy.egx33, r.excessBy.egx100, r.sessions, r.stockMovePrice, r.stockMovePct, r.stockMoveFinal, r.stockMoveFinal ? r.right : null, r.model, r.legacy]
      .map(csvCell)
      .join(","),
  );
  // The BOM makes Excel read the Arabic names as UTF-8.
  const blob = new Blob([`﻿${[header.join(","), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `track-record-${isoDay()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
