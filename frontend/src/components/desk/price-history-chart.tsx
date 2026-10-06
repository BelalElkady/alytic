import { useEffect, useState } from "react";
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

import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { arDay, fmt, pct, tone } from "@/lib/format";
import { cn } from "@/lib/utils";

type RangeKey = "1d" | "1w" | "1m" | "6m" | "1y" | "5y";
/** `d` is an ISO date, or `YYYY-MM-DDTHH:mm` (Cairo time) for the intraday views. */
type Point = { d: string; c: number };
/** Mirrors backend/src/data/priceHistory.js. `base` is yesterday's close, for the one-day view only. */
type History = { from: string; to: string; base: number | null; points: Point[] };

const RANGES: { value: RangeKey; label: string; note: string }[] = [
  { value: "1d", label: "اليوم", note: "كل 5 دقايق" },
  { value: "1w", label: "أسبوع", note: "كل 15 دقيقة" },
  { value: "1m", label: "شهر", note: "إغلاق يومي" },
  { value: "6m", label: "6 شهور", note: "إغلاق يومي" },
  { value: "1y", label: "سنة", note: "إغلاق يومي" },
  { value: "5y", label: "5 سنين", note: "إغلاق أسبوعي" },
];

/** The x values where a new group (hour, day, month, year) begins — what the axis labels sit on. */
const firstOfEach = (points: Point[], group: (d: string) => string, includeFirst: boolean) =>
  points
    .filter((p, i) => (i === 0 ? includeFirst : group(p.d) !== group(points[i - 1]!.d)))
    .map((p) => p.d);

/** At most `max` ticks, evenly thinned, so labels never crowd on a phone. */
const thin = (ticks: string[], max: number) =>
  ticks.length <= max ? ticks : ticks.filter((_, i) => i % Math.ceil(ticks.length / max) === 0);

const dayMonth = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const monthName = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("ar-EG", {
    month: "short",
    numberingSystem: "latn",
  });

/** Where the axis labels go, and how each reads, for each zoom level. */
function axisFor(range: RangeKey, points: Point[]): { ticks: string[]; format: (d: string) => string } {
  switch (range) {
    case "1d":
      return {
        ticks: firstOfEach(points, (d) => d.slice(0, 13), true),
        format: (d) => `${d.slice(11, 13)}:00`,
      };
    case "1w":
      return { ticks: firstOfEach(points, (d) => d.slice(0, 10), true), format: dayMonth };
    case "1m": {
      const last = points.length - 1;
      const spaced = [0, 1, 2, 3, 4].map((i) => points[Math.round((i * last) / 4)]!.d);
      return { ticks: [...new Set(spaced)], format: dayMonth };
    }
    case "6m":
    case "1y":
      return { ticks: thin(firstOfEach(points, (d) => d.slice(0, 7), false), 6), format: monthName };
    default:
      return {
        ticks: firstOfEach(points, (d) => d.slice(0, 4), false),
        format: (d) => d.slice(0, 4),
      };
  }
}

/**
 * Snap the price axis to human numbers (1/2/2.5/5 × 10ⁿ steps) so the labels
 * read 32.2, 32.4… rather than whatever the data happens to span.
 */
function niceScale(lo: number, hi: number, targetTicks = 4) {
  const span = hi - lo || Math.abs(hi) * 0.02 || 1;
  const magnitude = 10 ** Math.floor(Math.log10(span / targetTicks));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((m) => m * magnitude)
      .find((candidate) => candidate >= span / targetTicks) ?? 10 * magnitude;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(+value.toFixed(6));
  return { min: +min.toFixed(6), max: +max.toFixed(6), ticks, step };
}

/**
 * Price chart for one stock at six zoom levels — from today's session to five
 * years. Every stock opens on today's session: the dialog re-mounts this per
 * stock, and what the price is doing now is the first thing anyone opens it for.
 */
export function PriceHistoryChart({ code }: { code: string }) {
  const [range, setRange] = useState<RangeKey>("1d");
  const [results, setResults] = useState<Record<string, History>>({});
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const key = `${code}:${range}`;
  const history = results[key];

  // Each (stock, range) is fetched once per dialog session; switching back to
  // one already seen is instant. A failure isn't remembered, so picking that
  // range again retries it.
  useEffect(() => {
    if (history) return;
    let cancelled = false;
    setFailedKey((current) => (current === key ? null : current));
    api<History>(`/api/history/${code}?range=${range}`)
      .then((result) => !cancelled && setResults((prev) => ({ ...prev, [key]: result })))
      .catch(() => !cancelled && setFailedKey(key));
    return () => {
      cancelled = true;
    };
  }, [code, range, key, history]);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">حركة السعر</span>
        <ToggleGroup
          type="single"
          value={range}
          onValueChange={(value) => {
            if (!value) return;
            setRange(value as RangeKey);
          }}
          className="flex-wrap justify-start"
        >
          {RANGES.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              size="sm"
              className="px-2.5 text-[12px]"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {history ? (
        <PriceArea range={range} history={history} />
      ) : failedKey === key ? (
        <div className="flex h-44 items-center justify-center text-[12.5px] text-muted-foreground">
          تعذر تحميل الرسم لهذه الفترة.
        </div>
      ) : (
        <Skeleton className="h-44 w-full rounded-lg" />
      )}
    </div>
  );
}

function PriceArea({ range, history }: { range: RangeKey; history: History }) {
  const { points, base } = history;
  if (points.length < 2) {
    return (
      <div className="flex h-44 items-center justify-center text-[12.5px] text-muted-foreground">
        مفيش بيانات كافية للفترة دي.
      </div>
    );
  }

  const first = points[0]!.c;
  const last = points[points.length - 1]!.c;
  // The one-day view is measured against yesterday's close, like the % beside
  // the price; every other view against where its own period began.
  const start = base ?? first;
  const changePct = start ? ((last - start) / start) * 100 : 0;
  const color = last >= start ? "var(--up)" : "var(--down)";

  const closes = points.map((p) => p.c);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  // The baseline joins the range so its dashed line is always in view.
  const low = Math.min(lo, start);
  const high = Math.max(hi, start);
  const pad = (high - low || high * 0.02) * 0.1;
  const scale = niceScale(low - pad, high + pad);
  const axis = axisFor(range, points);
  const note = RANGES.find((option) => option.value === range)?.note;

  return (
    <div className="space-y-3">
      <div className={cn("num text-[13px] font-medium", tone(changePct))}>
        <bdi>{pct(changePct)}</bdi>
        <span className="mr-1.5 font-normal text-muted-foreground">
          {base != null ? "عن إغلاق أمس" : "خلال الفترة"}
        </span>
      </div>

      <div dir="ltr" className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="priceHistoryFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
            <XAxis
              dataKey="d"
              ticks={axis.ticks}
              tickFormatter={axis.format}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              orientation="right"
              domain={[scale.min, scale.max]}
              ticks={scale.ticks}
              tickFormatter={(value: number) => fmt(value)}
              tickLine={false}
              axisLine={false}
              width={46}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <ReferenceLine
              y={start}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={
                <PriceTooltip start={start} label={base != null ? "عن إغلاق أمس" : "من بداية الفترة"} />
              }
            />
            <Area
              type="monotone"
              dataKey="c"
              stroke={color}
              strokeWidth={2}
              fill="url(#priceHistoryFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11.5px] text-muted-foreground">
        {range === "1d" ? (
          <>جلسة {arDay(history.to.slice(0, 10))}</>
        ) : (
          <>
            من {arDay(history.from.slice(0, 10))} إلى {arDay(history.to.slice(0, 10))}
          </>
        )}{" "}
        · {note} · أعلى <span className="num">{fmt(hi)}</span> · أدنى{" "}
        <span className="num">{fmt(lo)}</span> · الخط المتقطع ={" "}
        {base != null ? "إغلاق أمس" : "سعر بداية الفترة"}
      </p>
    </div>
  );
}

function PriceTooltip({
  active,
  payload,
  start,
  label,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
  start: number;
  label: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const sincePct = start ? ((point.c - start) / start) * 100 : 0;
  return (
    <div dir="rtl" className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <div className="text-[11.5px] text-muted-foreground">
        {arDay(point.d.slice(0, 10))}
        {point.d.length > 10 && <bdi className="num mr-1.5">{point.d.slice(11, 16)}</bdi>}
      </div>
      <div className="num mt-0.5 text-[14px] font-semibold">{fmt(point.c)} ج</div>
      <div className={cn("num text-[11.5px]", tone(sincePct))}>
        <bdi>{pct(sincePct)}</bdi> {label}
      </div>
    </div>
  );
}
