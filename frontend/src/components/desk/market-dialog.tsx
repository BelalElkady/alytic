import { useEffect, useState } from "react";

import { ErrorState, LoadingBlock, Notice } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { fmt, int, pct } from "@/lib/format";
import { INVEST_STYLES, useActiveInvestStyle } from "@/lib/invest-style";
import { useDesk } from "@/lib/store";
import { mergedTarget } from "@/lib/targets";
import { cn } from "@/lib/utils";

const INDEX_OPTIONS = [
  { value: "ALL", label: "الكل" },
  { value: "EGX30", label: "EGX30" },
  { value: "EGX70", label: "EGX70" },
  { value: "EGX33", label: "EGX33" },
  { value: "EGX100", label: "EGX100" },
];

const action = (row: any) => {
  if (row.position) return { label: `موجود عندك · ${row.signal?.ar ?? "راجع المركز"}`, tone: "wait" };
  if (row.worthBuyingNow) return { label: "فرصة قابلة للتنفيذ الآن", tone: "buy" };
  if (row.entryStatus === "limit_pullback") return { label: "استنى تصحيح وأمر محدد", tone: "wait" };
  if (row.entryStatus === "too_extended") return { label: "ممتد — لا تطارد السعر", tone: "wait" };
  return { label: row.signal?.ar ?? "استنى", tone: "avoid" };
};

const toneClass: Record<string, string> = {
  buy: "border-up/40 bg-up-soft text-up",
  wait: "border-warn/40 bg-warn-soft text-foreground",
  avoid: "border-border bg-surface text-muted-foreground",
};

/** Market / cash-allocation scan, same /api/scan payload as before. */
export function MarketDialog() {
  const { marketFocus, openMarket, pf } = useDesk();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState("ALL");
  const { style, auto } = useActiveInvestStyle(pf?.trades);

  useEffect(() => {
    if (!marketFocus) return;
    let cancelled = false;
    setData(null);
    setError(null);
    const params = new URLSearchParams();
    if (marketFocus === "cash") params.set("focus", "cash");
    if (index !== "ALL") params.set("index", index);
    // Same rules the position-level recommendation already uses per style —
    // which setups clear the risk/reward bar, and how big a position sizes
    // to, both shift with it. See backend/src/config/styles.js.
    params.set("style", style);
    const qs = params.toString();
    api(`/api/scan${qs ? `?${qs}` : ""}`)
      .then((result) => !cancelled && setData(result))
      .catch((caught) => !cancelled && setError(caught?.message ?? "تعذر تحليل السوق"));
    return () => {
      cancelled = true;
    };
  }, [marketFocus, index, style]);

  const isCash = marketFocus === "cash";
  const rows = [...(data?.results ?? [])].sort(
    (a: any, b: any) =>
      (b.worthBuyingNow ? 1 : 0) - (a.worthBuyingNow ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0),
  );
  const shown = isCash ? rows.filter((row: any) => row.cashPlanSelected) : rows.slice(0, 60);
  const actionable = rows.filter((row: any) => row.worthBuyingNow).length;
  const held = rows.filter((row: any) => row.position).length;

  return (
    <Dialog open={Boolean(marketFocus)} onOpenChange={(open) => !open && openMarket(null)}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-start">
          <DialogTitle className="text-base">{isCash ? "أفضل توزيع للكاش" : "تحليل السوق"}</DialogTitle>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {isCash
              ? `أسهم مختارة من أقل المخاطر وأعلى الجودة، بتوزيع متساوٍ تقريبًا واحتياطي ${fmt(data?.cashPlan?.reserveCash ?? 0)} ج.`
              : `ترتيب الأسهم حسب التقييم والفرص القابلة للتنفيذ${index !== "ALL" ? ` — أسهم ${index} بس` : ""}.`}
            {" "}
            حسب أسلوبك: {INVEST_STYLES.find((s) => s.key === style)?.label ?? "متوسط المدى"}
            {auto ? " (مستنتج من سلوكك في التداول)" : ""}.
          </p>
        </DialogHeader>

        <ToggleGroup
          type="single"
          value={index}
          onValueChange={(value) => value && setIndex(value)}
          className="flex-wrap justify-start"
        >
          {INDEX_OPTIONS.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value} size="sm" className="text-[12.5px]">
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {error && <ErrorState message={error} />}
        {!data && !error && <LoadingBlock rows={4} />}

        {data && (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border bg-surface px-4 py-3 text-[12.5px]">
              <span>
                الكاش المتاح: <b className="num">{int(data.cash ?? 0)} ج</b>
              </span>
              {isCash ? (
                <>
                  <span>
                    القابل للتوزيع: <b className="num">{int(data.cashPlan?.investableCash ?? 0)} ج</b>
                  </span>
                  <span>
                    لكل سهم: <b className="num">{int(data.cashPlan?.allocationPerStock ?? 0)} ج</b>
                  </span>
                </>
              ) : (
                <span>
                  فرص الآن: <b className="text-up">{actionable}</b>
                </span>
              )}
              <span>
                مراكزك: <b>{held}</b>
              </span>
              <span className="text-muted-foreground">آخر تحديث: {data.asOf ?? "—"}</span>
            </div>

            <div className="space-y-3">
              {shown.map((row: any) => {
                const state = action(row);
                return (
                  <div
                    key={row.code}
                    className={cn(
                      "rounded-lg border p-4",
                      row.position ? "bg-surface" : "bg-card",
                    )}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{row.code}</div>
                        <div className="truncate text-[12px] text-muted-foreground">
                          {row.name} · {row.sector}
                        </div>
                      </div>
                      <div className="num shrink-0 text-end text-[15px] font-semibold">
                        {row.score ?? "—"}
                        <span className="text-[11px] font-normal text-muted-foreground">/100</span>
                      </div>
                    </div>

                    <div className="num mt-2 text-[12px] text-muted-foreground">
                      السعر {fmt(row.price)} · وقف {fmt(row.stop)}
                    </div>

                    <Badge variant="outline" className={cn("mt-2.5", toneClass[state.tone])}>
                      {state.label}
                    </Badge>

                    {(() => {
                      const one = mergedTarget(row.midTarget, row.longTarget);
                      return one ? (
                        <div className="mt-3">
                          <TargetBox
                            label="الهدف"
                            price={one.price ?? undefined}
                            hint={`${pct(one.upsidePct, 1)} · ${one.horizon?.ar ?? ""}`}
                          />
                        </div>
                      ) : (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <TargetBox
                            label="هدف متوسط"
                            price={row.midTarget?.price}
                            hint={
                              row.midTarget
                                ? `${pct(row.midTarget.upsidePct, 1)} · ${row.midTarget.horizon?.ar ?? ""}`
                                : "لا يوجد هدف صالح"
                            }
                          />
                          <TargetBox
                            label="هدف بعيد"
                            price={row.longTarget?.price}
                            hint={
                              row.longTarget?.price
                                ? `${pct(row.longTarget.upsidePct, 1)} · ${row.longTarget.horizon?.ar ?? ""}`
                                : (row.longTarget?.note ?? "لا يوجد هدف بعيد")
                            }
                          />
                        </div>
                      );
                    })()}

                    {!row.position && row.buyPlan && (
                      <Notice tone="info" className="mt-3">
                        {row.buyPlan.shares > 0 ? (
                          <>
                            الاقتراح: <b className="num">{int(row.buyPlan.shares)} سهم</b> عند{" "}
                            <b className="num">{fmt(row.buyPlan.entry)}</b> · التكلفة{" "}
                            <b className="num">{int(row.buyPlan.cost)} ج</b> · المتبقي{" "}
                            <b className="num">{int(row.buyPlan.cashAfter)} ج</b>
                            <div className="mt-1 text-muted-foreground">{row.buyPlan.reason}</div>
                          </>
                        ) : (
                          row.buyPlan.reason
                        )}
                      </Notice>
                    )}
                  </div>
                );
              })}
            </div>

            {data.errors?.length ? (
              <Notice tone="warn">تعذر تحليل {data.errors.length} سهم بسبب نقص البيانات.</Notice>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TargetBox({
  label,
  price,
  hint,
}: {
  label: string;
  price?: number | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-md border bg-surface px-3 py-2">
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
      <div className="num text-[15px] font-semibold">{price ? fmt(price) : "—"}</div>
      <div className="num text-[11.5px] text-muted-foreground">{hint}</div>
    </div>
  );
}
