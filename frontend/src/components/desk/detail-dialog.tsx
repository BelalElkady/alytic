import { useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingBlock, Notice, Stat } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { fmt, pct, tone } from "@/lib/format";
import { useDesk } from "@/lib/store";
import { mergedTarget } from "@/lib/targets";

/** Per-stock analysis, same /api/analyze/:code payload as before. */
export function DetailDialog() {
  const { detailCode, openDetail } = useDesk();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the /api/analyze response shape
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detailCode) return;
    let cancelled = false;
    setData(null);
    setError(null);
    api(`/api/analyze/${detailCode}`)
      .then((result) => !cancelled && setData(result))
      .catch((caught) => !cancelled && setError(caught?.message ?? "تعذر التحليل"));
    return () => {
      cancelled = true;
    };
  }, [detailCode]);

  const snapshot = data?.snapshot;
  const plan = data?.plan;
  const technical = data?.technical;
  const oneTarget = mergedTarget(plan?.targets?.mid, plan?.targets?.long);

  return (
    <Dialog open={Boolean(detailCode)} onOpenChange={(open) => !open && openDetail(null)}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle className="text-base">
            {data ? `${data.code} — ${data.name}` : (detailCode ?? "")}
          </DialogTitle>
          {data && (
            <p className="text-[12.5px] text-muted-foreground">
              {data.sectorAr ?? ""} · إغلاق {data.asOf}
            </p>
          )}
        </DialogHeader>

        {error && <ErrorState message={error} />}
        {!data && !error && <LoadingBlock rows={3} />}

        {data && snapshot && plan && technical && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-surface p-4 sm:grid-cols-4">
              <Stat
                label="السعر"
                value={fmt(snapshot.price.close)}
                sub={
                  <span className={tone(snapshot.price.changePct)}>
                    {pct(snapshot.price.changePct)}
                  </span>
                }
              />
              <Stat label="التقييم" value={`${technical.score}/100`} sub={technical.signal?.ar} />
              <Stat
                label="الاتجاه"
                value={<span className="text-[14px]">{snapshot.trend.label}</span>}
              />
              <Stat label="RSI" value={fmt(snapshot.momentum.rsi14, 1)} />
            </div>

            {data.fundamentals && (
              <Notice tone="info">
                <b>الأساسيات:</b> {data.fundamentals.valuation ?? "—"}
              </Notice>
            )}

            <div className="rounded-lg border">
              <div className="border-b bg-surface px-4 py-2.5 text-[13px] font-semibold">الخطة</div>
              <dl className="divide-y text-[13px]">
                <Line label="الدخول" value={plan.entryNote} />
                <Line
                  label="الوقف"
                  value={
                    <span className="num text-down">
                      {fmt(plan.stop.stop)} ج · مخاطرة {plan.stop.riskPct}%
                    </span>
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
                        hint={[
                          plan.targets.long.basis,
                          plan.targets.long.horizon.ar,
                          plan.targets.long.caveat,
                        ]
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

            <div className="grid gap-4 sm:grid-cols-2">
              <LevelList title="الدعوم" levels={snapshot.levels.supports} empty="مفيش" />
              <LevelList
                title="المقاومات"
                levels={snapshot.levels.resistances}
                empty="مساحة مفتوحة"
                positive
              />
            </div>

            {(technical.reasons.bullish.length > 0 || technical.reasons.bearish.length > 0) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {technical.reasons.bullish.length > 0 && (
                  <ReasonList title="مؤيد" items={technical.reasons.bullish} tone="up" />
                )}
                {technical.reasons.bearish.length > 0 && (
                  <ReasonList title="معارض" items={technical.reasons.bearish} tone="down" />
                )}
              </div>
            )}
          </div>
        )}

        {data && !snapshot && <EmptyState title="مفيش بيانات كافية لهذا السهم." />}
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">
        {value}
        {hint && (
          <div className="mt-0.5 text-[11.5px] font-normal text-muted-foreground">{hint}</div>
        )}
      </dd>
    </div>
  );
}

function LevelList({
  title,
  levels,
  empty,
  positive = false,
}: {
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the /api/analyze response shape
  levels: any[];
  empty: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-lg border">
      <div className="border-b bg-surface px-4 py-2 text-[13px] font-semibold">{title}</div>
      <div className="divide-y text-[13px]">
        {levels?.length ? (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the /api/analyze response shape
          levels.slice(0, 4).map((level: any) => (
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

function ReasonList({
  title,
  items,
  tone: variant,
}: {
  title: string;
  items: string[];
  tone: "up" | "down";
}) {
  return (
    <div>
      <Badge
        variant="outline"
        className={variant === "up" ? "border-up/40 text-up" : "border-down/40 text-down"}
      >
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
