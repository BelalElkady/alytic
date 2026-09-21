import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState, Notice, Panel, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { post } from "@/lib/api";
import { arDay, int, pct, signed, tone } from "@/lib/format";
import { siteUrl, siteName } from "@/lib/seo";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/charts")({
  head: ({ matches }) => ({
    meta: [
      { title: `رسوم المحفظة — ${siteName(matches)}` },
      {
        name: "description",
        content: "قيمة المحفظة يوم بيوم، ربح وخسارة كل سهم، وموقع السعر بين الوقف والهدف.",
      },
      { property: "og:title", content: `رسوم المحفظة — ${siteName(matches)}` },
      {
        property: "og:description",
        content: "قيمة المحفظة يوم بيوم، ربح وخسارة كل سهم، وموقع السعر بين الوقف والهدف.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${siteUrl(matches)}/charts` },
    ],
  }),
  component: ChartsPage,
});

function ChartsPage() {
  const { log, rows, reloadLog } = useDesk();
  const [backfilling, setBackfilling] = useState(false);
  const [backfillNote, setBackfillNote] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  const days = Object.keys(log).sort();
  const series = days.map((day) => ({ day, value: log[day].total as number }));

  const backfill = async () => {
    setBackfilling(true);
    setBackfillError(null);
    try {
      const result = await post("/api/log/backfill", { days: 90 });
      await reloadLog();
      setBackfillNote(
        `اتبنى ${result.added} يوم من أسعار السوق الحقيقية (${result.from} → ${result.to}) — محسوبة على عدد الأسهم اللي معاك دلوقتي، يعني "كانت هتساوي كام"، مش سجل فعلي.`,
      );
    } catch (caught) {
      setBackfillError(caught instanceof Error ? caught.message : "تعذر بناء السجل");
    } finally {
      setBackfilling(false);
    }
  };

  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.position.unrealizedPct ?? 0)));
  const sortedRows = [...rows].sort(
    (a, b) => (b.position.unrealizedPct ?? 0) - (a.position.unrealizedPct ?? 0),
  );

  return (
    <div className="space-y-4">
      {backfillNote && <Notice tone="warn">{backfillNote}</Notice>}

      <Panel
        title="قيمة المحفظة يوم بيوم"
        description="كل نقطة = إغلاق يوم محفوظ. الخط الصاعد يعني المحفظة بتكبر."
      >
        {series.length < 2 ? (
          <EmptyState
            title="محتاج يومين محفوظين على الأقل لرسم الخط"
            hint={backfillError ?? "أو ابنِ السجل من أسعار السوق التاريخية."}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => void backfill()}
                disabled={backfilling}
              >
                {backfilling && <Spinner />}
                ابنِ السجل من أسعار السوق التاريخية
              </Button>
            }
          />
        ) : (
          <EquityCurve series={series} />
        )}
      </Panel>

      <Panel
        title="ربح/خسارة كل سهم من الشراء"
        description="أخضر = مكسب، أحمر = خسارة. الأطول = الأبعد عن سعر شراءك."
      >
        {rows.length === 0 ? (
          <EmptyState title="مفيش مراكز." />
        ) : (
          <div className="space-y-2.5">
            {sortedRows.map((row) => {
              const value = row.position.unrealizedPct ?? 0;
              return (
                <div key={row.code} className="grid grid-cols-[3.5rem_1fr_4rem] items-center gap-3">
                  <span className="truncate text-[12.5px] font-medium">{row.code}</span>
                  <span className="relative h-2.5 rounded-full bg-surface-2">
                    <span
                      className={cn(
                        "absolute top-0 h-full rounded-full",
                        value >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down",
                      )}
                      style={{ width: `${(Math.abs(value) / maxAbs) * 50}%` }}
                    />
                  </span>
                  <span className={cn("num text-end text-[12.5px] font-medium", tone(value))}>
                    {pct(value, 1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

const RANGES = [
  { value: "1M", label: "شهر", sessions: 22 },
  { value: "3M", label: "3 شهور", sessions: 66 },
  { value: "ALL", label: "الكل", sessions: Infinity },
];

/** Compact axis label: 508,055 -> "508K". The tooltip still shows it in full. */
const compact = (value: number) =>
  Math.abs(value) >= 1000
    ? `${Math.round(value / 1000).toLocaleString("en-US")}K`
    : String(Math.round(value));

/** DD/MM — enough to place a point in time without crowding the axis. */
const shortDay = (iso: string) =>
  iso?.length === 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso;

/**
 * Snap the value axis to human numbers. Left to itself the chart labels
 * whatever the data happens to span (271K, 291K, 311K…), which is evenly
 * spaced but reads as noise; this picks a 1/2/2.5/5×10ⁿ step and rounds the
 * bounds outward onto it, so the labels land on 270K, 290K, 310K instead.
 */
function niceScale(lo: number, hi: number, targetTicks = 4) {
  const span = hi - lo || Math.abs(hi) || 1;
  const magnitude = 10 ** Math.floor(Math.log10(span / targetTicks));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((m) => m * magnitude)
      .find((candidate) => candidate >= span / targetTicks) ?? 10 * magnitude;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(Math.round(value));
  return { min, max, ticks };
}

function EquityCurve({ series }: { series: { day: string; value: number }[] }) {
  const [range, setRange] = useState("ALL");

  const shown = useMemo(() => {
    const sessions = RANGES.find((r) => r.value === range)?.sessions ?? Infinity;
    return Number.isFinite(sessions) ? series.slice(-sessions) : series;
  }, [series, range]);

  const first = shown[0]?.value ?? 0;
  const last = shown.at(-1)?.value ?? 0;
  const change = last - first;
  const changePct = first ? (change / first) * 100 : 0;
  const rising = change >= 0;
  const color = rising ? "var(--up)" : "var(--down)";

  // Breathing room so the line never rides the top or bottom edge, then round
  // the bounds onto human tick values.
  const values = shown.map((point) => point.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const padding = (hi - lo || Math.abs(hi) || 1) * 0.12;
  const scale = niceScale(lo - padding, hi + padding);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="num text-[22px] font-semibold leading-none tracking-tight">
            {int(last)} ج
          </div>
          {/* Each number is isolated: without <bdi> the bidi algorithm reorders
              the signed figures and the "ج ·" separators into a jumble. */}
          <div className={cn("num mt-1.5 text-[13px] font-medium", tone(change))}>
            <bdi>{signed(change)} ج</bdi>
            <span className="mx-1 text-muted-foreground">·</span>
            <bdi>{pct(changePct, 1)}</bdi>
            <span className="mr-1.5 font-normal text-muted-foreground">
              {range === "ALL"
                ? `خلال ${shown.length} يوم محفوظ`
                : `خلال ${RANGES.find((r) => r.value === range)?.label}`}
            </span>
          </div>
        </div>
        {series.length > RANGES[0]!.sessions && (
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(value) => value && setRange(value)}
            className="justify-start"
          >
            {RANGES.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                size="sm"
                className="text-[12px]"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      <div dir="ltr" className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={shown} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
            <XAxis
              dataKey="day"
              tickFormatter={shortDay}
              tickLine={false}
              axisLine={false}
              minTickGap={44}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              orientation="right"
              domain={[scale.min, scale.max]}
              ticks={scale.ticks}
              tickFormatter={compact}
              tickLine={false}
              axisLine={false}
              width={46}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            {/* Where the shown period started — instantly answers "am I above it?". */}
            <ReferenceLine
              y={first}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={<EquityTooltip start={first} />}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill="url(#equityFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11.5px] text-muted-foreground">
        من {arDay(shown[0]?.day)} إلى {arDay(shown.at(-1)?.day)} · {shown.length} يوم محفوظ · الخط
        المتقطع = قيمة بداية الفترة
      </p>
    </div>
  );
}

function EquityTooltip({
  active,
  payload,
  start,
}: {
  active?: boolean;
  payload?: { payload: { day: string; value: number } }[];
  start: number;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const diff = point.value - start;
  return (
    <div dir="rtl" className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <div className="text-[11.5px] text-muted-foreground">{arDay(point.day)}</div>
      <div className="num mt-0.5 text-[14px] font-semibold">{int(point.value)} ج</div>
      <div className={cn("num text-[11.5px]", tone(diff))}>{signed(diff)} ج من بداية الفترة</div>
    </div>
  );
}
