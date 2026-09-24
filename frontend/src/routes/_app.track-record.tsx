import { createFileRoute } from "@tanstack/react-router";
import { Download, Search } from "lucide-react";
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
  component: TrackRecordPage,
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
  series: { date: string; strategy: number; index: number }[];
  rows: RecRow[];
  rowsTruncated: boolean;
};

type Vs = "own" | "egx30" | "egx70" | "egx33" | "egx100";
type Benchmark = "EGX30" | "EGX70" | "EGX100";

/** What excess return is measured against — see COMPARISONS in backend/src/recommendations.js. */
const VS_OPTIONS: { value: Vs; label: string; short: string }[] = [
  { value: "own", label: "مؤشر كل سهم", short: "مؤشر السهم" },
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
        <ToggleGroup
          type="single"
          variant="outline"
          value={scope}
          onValueChange={(value) => value && setScope(value as "all" | "mine")}
          className="shrink-0 justify-start"
        >
          <ToggleGroupItem value="all" size="sm" className="px-3 text-[12.5px]">
            كل التوصيات
          </ToggleGroupItem>
          <ToggleGroupItem value="mine" size="sm" className="px-3 text-[12.5px]">
            توصياتي فقط
          </ToggleGroupItem>
        </ToggleGroup>
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
      ) : data.summary.total === 0 ? (
        <EmptyState
          title="لسه مفيش توصيات في النطاق ده"
          hint="أول ما التطبيق يدي توصية شراء أو بيع أو تخفيف أو احتفاظ بتتسجل هنا، وبتتقيّم كل يوم بعد إغلاق السوق."
        />
      ) : (
        <>
          <Kpis data={data} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title={`الأداء التراكمي مقابل ${vsShort(data.vs)}`}
              description={
                data.vs === "own"
                  ? "محفظة افتراضية تنفّذ كل التوصيات المحسومة بأوزان متساوية، مقابل نفس الفلوس في مؤشر كل سهم (EGX30 أو EGX70 أو EGX100) على نفس الفترات"
                  : `محفظة افتراضية تنفّذ كل التوصيات المحسومة بأوزان متساوية، مقابل نفس الفلوس في ${vsShort(data.vs)} على نفس الفترات`
              }
            >
              <PerformanceChart series={data.series} indexLabel={vsShort(data.vs)} />
            </Panel>
            <div className="space-y-4">
              <Panel title="نتائج الحسم">
                <Outcomes outcomes={data.outcomes} closed={data.summary.closed} />
              </Panel>
              <Panel title="النجاح حسب نوع التوصية">
                <ByAction byAction={data.byAction} />
              </Panel>
            </div>
          </div>

          <Panel
            title="سجل التوصيات"
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
      <span className="text-[12px] font-medium text-muted-foreground">أفق التقييم</span>
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
  valueClassName,
  highlight = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
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
      <span className={cn("text-[12px]", highlight ? "text-primary-foreground/80" : "text-muted-foreground")}>
        {label}
      </span>
      <span className={cn("num text-[26px] font-semibold leading-tight tracking-tight", valueClassName)}>{value}</span>
      {sub && (
        <span className={cn("text-[11.5px]", highlight ? "text-primary-foreground/75" : "text-muted-foreground")}>
          {sub}
        </span>
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
      />
      <KpiCard label="متوسط العائد لكل توصية" value={pct(s.avgReturn)} valueClassName={tone(s.avgReturn)} sub="قبل العمولات" />
      <KpiCard
        label={`العائد الزائد عن ${vsShort(data.vs)}`}
        value={pct(s.avgExcess)}
        sub={
          s.excessCovered < s.closed
            ? `متوسط ${fmt(s.excessCovered)} من ${fmt(s.closed)} توصية مسجل لها المؤشر`
            : "متوسط الفرق لكل توصية"
        }
        highlight
      />
      <KpiCard
        label="متوسط الربح / الخسارة"
        value={
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-up">{pct(s.avgWin)}</span>
            <span className="text-[16px] text-muted-foreground">/</span>
            <span className="text-down">{pct(s.avgLoss)}</span>
          </span>
        }
        sub={s.winLossRatio == null ? "نسبة الربح للخسارة —" : `نسبة الربح للخسارة ${fmt(s.winLossRatio)}`}
      />
      <KpiCard
        label="متوسط الوصول للمستهدف"
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
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-[12px]">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-primary" />
          التوصيات <span className={cn("num font-semibold", tone(last.strategy))}>{pct(last.strategy)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" />
          {indexLabel} <span className={cn("num font-semibold", tone(last.index))}>{pct(last.index)}</span>
        </span>
      </div>
      <div dir="ltr" className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="trackFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.14} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
            <XAxis
              dataKey="date"
              tickFormatter={monthLabel}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
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
              stroke="var(--primary)"
              strokeWidth={2}
              fill="url(#trackFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="index"
              stroke="var(--muted-foreground)"
              strokeWidth={1.75}
              strokeDasharray="5 4"
              dot={false}
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
      <div className="num mt-0.5 text-[13px]">
        التوصيات <span className={cn("font-semibold", tone(point.strategy))}>{pct(point.strategy)}</span>
      </div>
      <div className="num text-[13px]">
        {indexLabel} <span className={cn("font-semibold", tone(point.index))}>{pct(point.index)}</span>
      </div>
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
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
        {OUTCOME_PARTS.map((part) => (
          <div key={part.key} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 shrink-0 rounded-sm", part.className)} />
            <span className="truncate text-muted-foreground">{part.label}</span>
            <span className="num ms-auto font-semibold">{fmt(outcomes[part.key].pct)}%</span>
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

function StatusBadge({ row }: { row: RecRow }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", STATUS_CLASS[row.status])}>
      {STATUS_LABEL[row.status]}
      {row.status === "expired" && row.win != null ? (row.win ? " · ربح" : " · خسارة") : ""}
    </Badge>
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
            <TableHead className="text-start">مقابل {vsShort(vs)}</TableHead>
            <TableHead className="text-start">الجلسات</TableHead>
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
  const header = ["ticker", "name", "sector", "action", "issued_on", "ref_price", "target_price", "stop_price", "horizon_sessions", "status", "closed_at", "exit_price", "return_pct", "benchmark", "excess_vs_benchmark_pct", "excess_vs_egx30_pct", "excess_vs_egx70_pct", "excess_vs_egx33_pct", "excess_vs_egx100_pct", "sessions_elapsed", "model_version"];
  const lines = rows.map((r) =>
    [r.ticker, r.name, r.sector, r.action, r.issuedOn, r.refPrice, r.targetPrice, r.stopPrice, r.horizon, r.status, r.closedAt?.slice(0, 10), r.exitPrice, r.returnPct, r.benchmark, r.excessBy.own, r.excessBy.egx30, r.excessBy.egx70, r.excessBy.egx33, r.excessBy.egx100, r.sessions, r.model]
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
