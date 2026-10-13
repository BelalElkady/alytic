import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { InvestorFlows } from "@/components/desk/investor-flows";
import { MarketHeatmap } from "@/components/desk/market-heatmap";
import { ErrorState, LoadingBlock, Panel } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { fmt, pct, signed, tone } from "@/lib/format";
import { siteUrl, siteName } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/indices")({
  head: ({ match }) => ({
    meta: [
      { title: `المؤشرات — ${siteName(match)}` },
      {
        name: "description",
        content:
          "الأداء اليومي لمؤشرات البورصة المصرية، وأفضل وأسوأ سهم في كل مؤشر، وخريطة السوق لكل الأسهم.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: `المؤشرات — ${siteName(match)}` },
      { property: "og:url", content: `${siteUrl(match)}/indices` },
    ],
  }),
  component: IndicesPage,
});

type IndexStock = { code: string; name: string; price: number; changePct: number };

type IndexRow = {
  name: string;
  changePct: number | null;
  changePoints: number | null;
  avgChangePct: number | null;
  spotValue: number | null;
  constituentCount: number;
  quotedCount: number;
  best: IndexStock | null;
  worst: IndexStock | null;
};

const LABELS: Record<string, string> = {
  EGX30: "EGX30",
  EGX70: "EGX70 EWI",
  EGX33: "EGX33 (شريعة)",
  EGX100: "EGX100",
};

function IndicesPage() {
  const [rows, setRows] = useState<IndexRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  const load = () => {
    api("/api/indices/performance")
      .then((result) => {
        setRows(result.indices);
        setAsOf(result.asOf);
        setError(null);
      })
      .catch((caught) => setError(caught?.message ?? "تعذر تحميل بيانات المؤشرات"));
  };

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <ErrorState
        message={error}
        action={
          <Button variant="outline" size="sm" onClick={load}>
            حاول تاني
          </Button>
        }
      />
    );
  }
  if (!rows) return <LoadingBlock rows={4} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[17px] font-semibold tracking-tight">المؤشرات</h1>
        {asOf && (
          <span className="text-[12px] text-muted-foreground">
            آخر تحديث{" "}
            {new Date(asOf).toLocaleTimeString("ar-EG", {
              hour: "2-digit",
              minute: "2-digit",
              numberingSystem: "latn",
            })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((row) => (
          <IndexCard key={row.name} row={row} />
        ))}
      </div>

      <InvestorFlows />

      <MarketHeatmap />
    </div>
  );
}

function IndexCard({ row }: { row: IndexRow }) {
  const hasChange = row.changePct !== null;
  const hasPoints = row.changePoints !== null;

  return (
    <Panel
      title={LABELS[row.name] ?? row.name}
      description={
        <>
          {row.constituentCount} سهم متابَع
          {row.spotValue !== null && ` · القيمة ${fmt(row.spotValue)}`}
        </>
      }
      action={
        <span
          className={cn(
            "num text-[20px] font-bold tabular-nums",
            hasChange ? tone(row.changePct) : "text-muted-foreground",
          )}
        >
          {hasChange ? pct(row.changePct) : "—"}
        </span>
      }
    >
      <div className="space-y-3">
        {hasPoints && (
          <p className="text-[12px] text-muted-foreground">
            التغيّر اليوم:{" "}
            <span className={cn("num", tone(row.changePoints))}>
              {signed(row.changePoints)} نقطة
            </span>
          </p>
        )}
        {row.quotedCount === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            مفيش أسعار حية متاحة دلوقتي لأسهم المؤشر.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <MoverBox label="أفضل سهم اليوم" stock={row.best} positive />
            <MoverBox label="أسوأ سهم اليوم" stock={row.worst} positive={false} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function MoverBox({
  label,
  stock,
  positive,
}: {
  label: string;
  stock: IndexStock | null;
  positive: boolean;
}) {
  if (!stock) return null;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        positive ? "border-up/40 bg-up-soft" : "border-down/40 bg-down-soft",
      )}
    >
      <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{stock.code}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">{stock.name}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("num font-semibold", tone(stock.changePct))}>
            {pct(stock.changePct)}
          </div>
          <div className="num text-[11.5px] text-muted-foreground">{fmt(stock.price)}</div>
        </div>
      </div>
    </div>
  );
}
