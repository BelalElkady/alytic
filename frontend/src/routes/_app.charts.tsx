import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, Notice, Panel, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/api";
import { int, pct, tone } from "@/lib/format";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/_app/charts")({
  head: () => ({
    meta: [
      { title: "رسوم المحفظة — EGXpert" },
      {
        name: "description",
        content: "قيمة المحفظة يوم بيوم، ربح وخسارة كل سهم، وموقع السعر بين الوقف والهدف.",
      },
      { property: "og:title", content: "رسوم المحفظة — EGXpert" },
      {
        property: "og:description",
        content: "قيمة المحفظة يوم بيوم، ربح وخسارة كل سهم، وموقع السعر بين الوقف والهدف.",
      },
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
    } catch (caught: any) {
      setBackfillError(caught?.message ?? "تعذر بناء السجل");
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
              <Button size="sm" variant="outline" onClick={() => void backfill()} disabled={backfilling}>
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

function EquityCurve({ series }: { series: { day: string; value: number }[] }) {
  const width = 640;
  const height = 180;
  const pad = 26;
  const values = series.map((point) => point.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (index: number) => pad + (index * (width - pad * 2)) / (series.length - 1);
  const y = (value: number) => height - pad - ((value - lo) / span) * (height - pad * 2);
  const points = series.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`);
  const rising = (series.at(-1)?.value ?? 0) >= (series[0]?.value ?? 0);
  const stroke = rising ? "var(--up)" : "var(--down)";

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        style={{ direction: "ltr" }}
        role="img"
        aria-label="قيمة المحفظة يوم بيوم"
      >
        <polygon
          points={`${x(0).toFixed(1)},${height - pad} ${points.join(" ")} ${x(series.length - 1).toFixed(1)},${height - pad}`}
          fill={stroke}
          opacity="0.1"
        />
        <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        {series.map((point, index) => (
          <circle key={point.day} cx={x(index)} cy={y(point.value)} r="2.5" fill={stroke} />
        ))}
        <text x={width - 4} y="12" textAnchor="end" fontSize="10" fill="var(--muted-foreground)">
          {int(hi)}
        </text>
        <text x={width - 4} y={height - 4} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">
          {int(lo)}
        </text>
      </svg>
      <p className="num mt-1 text-[11.5px] text-muted-foreground">
        من {series[0]?.day} إلى {series.at(-1)?.day} · {series.length} يوم محفوظ
      </p>
    </div>
  );
}
