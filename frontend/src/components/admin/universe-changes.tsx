import { useEffect, useState } from "react";

import { Notice, Panel } from "@/components/desk/state-blocks";
import { api } from "@/lib/api";
import { arDay, int } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Mirrors currentUniverseChanges() in backend/src/universeWatch.js. */
type UniverseChanges = {
  added: {
    code: string;
    name: string;
    /** Which feeds carry it — null when that one couldn't be checked. */
    sources: { tradingview: boolean; mubasher: boolean | null; yahoo: boolean | null };
  }[];
  removed: {
    code: string;
    name: string;
    reason: "unlisted" | "no-sessions";
    lastSession: string | null;
    sessionsSince: number | null;
  }[];
  checkedAt: string;
  universeBuiltAt: string | null;
  tradingviewCount: number;
  /** null when Mubasher's directory couldn't be reached and no recent upload exists. */
  mubasher: { count: number; fetchedAt: string; via: "live" | "upload" } | null;
  universeCount: number;
  removedAfterSessions: number;
};

/** Whether one price feed carries a stock: yes, no, or couldn't be checked. */
function SourceBadge({ label, has }: { label: string; has: boolean | null }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5",
        has === true && "border-up/40 bg-up-soft text-up",
        has === false && "border-border bg-surface text-muted-foreground line-through",
        has === null && "border-border bg-surface text-muted-foreground",
      )}
      title={has === null ? "لم يتم الفحص" : has ? "متاح" : "غير متاح"}
    >
      {label}
      {has === null ? " ؟" : ""}
    </span>
  );
}

/**
 * Stocks that have joined or left the EGX listing since the app's stock list
 * was built. A report only: nothing here adds or drops a stock — a new one
 * still goes in through the index lists below or a rebuild of the list
 * (backend/scripts/build-universe.js).
 */
export function UniverseChangesPanel() {
  const [data, setData] = useState<UniverseChanges | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<UniverseChanges>("/api/admin/indices/universe-changes")
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "تعذر فحص قائمة الأسهم"));
  }, []);

  if (error) return <Notice tone="warn">تعذر فحص تغيّرات قائمة أسهم البورصة: {error}</Notice>;
  if (!data) return null;

  const unchanged = data.added.length === 0 && data.removed.length === 0;
  return (
    <Panel title="تغيّرات قائمة أسهم البورصة">
      <div className="space-y-3 text-[13px]">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          مقارنة قائمة التطبيق ({int(data.universeCount)} سهم
          {data.universeBuiltAt ? `، اتبنت ${arDay(data.universeBuiltAt.slice(0, 10))}` : ""}) بقائمة
          TradingView ({int(data.tradingviewCount)} سهم)
          {data.mubasher
            ? ` وقائمة Mubasher (${int(data.mubasher.count)} سهم ليه تداول حديث، بتاريخ ${arDay(data.mubasher.fetchedAt.slice(0, 10))})`
            : " — قائمة Mubasher مش متاحة دلوقتي"}
          . للعلم بس — مفيش سهم بيتضاف أو يتشال تلقائيًا.
        </p>

        {unchanged && <Notice tone="success">مفيش أسهم جديدة أو متوقفة من وقت بناء القائمة.</Notice>}

        {data.added.length > 0 && (
          <div>
            <div className="mb-1.5 font-semibold">
              أسهم جديدة مش في التطبيق ({int(data.added.length)})
            </div>
            <ul className="divide-y rounded-lg border">
              {data.added.map((stock) => (
                <li key={stock.code} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="num font-semibold">{stock.code}</span>
                    <span className="truncate text-muted-foreground">{stock.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                    <span className="text-muted-foreground">مصادر الأسعار:</span>
                    <SourceBadge label="Yahoo" has={stock.sources.yahoo} />
                    <SourceBadge label="TradingView" has={stock.sources.tradingview} />
                    <SourceBadge label="Mubasher" has={stock.sources.mubasher} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.removed.length > 0 && (
          <div>
            <div className="mb-1.5 font-semibold">
              أسهم في التطبيق ويبدو إنها اتوقفت ({int(data.removed.length)})
            </div>
            <ul className="divide-y rounded-lg border">
              {data.removed.map((stock) => (
                <li key={stock.code} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="num font-semibold">{stock.code}</span>
                    <span className="truncate text-muted-foreground">{stock.name}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">
                    {stock.reason === "unlisted"
                      ? "مش موجود في قائمة TradingView"
                      : `مفيش تداول من ${int(stock.sessionsSince)} جلسة`}
                    {stock.lastSession ? ` · آخر جلسة ${arDay(stock.lastSession)}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
