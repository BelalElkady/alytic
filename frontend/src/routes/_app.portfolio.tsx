import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { PriceRail } from "@/components/desk/price-rail";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  Panel,
  Spinner,
  Stat,
} from "@/components/desk/state-blocks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { post } from "@/lib/api";
import { fmt, int, pct, signed, tone } from "@/lib/format";
import { styleRecommendation, useActiveInvestStyle } from "@/lib/invest-style";
import { useDesk, type Row } from "@/lib/store";

import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/portfolio")({
  head: () => ({
    meta: [
      { title: "EGXpert" },
      {
        name: "description",
        content:
          "متابعة مراكزك في البورصة المصرية: الأسعار الحية، وقف الخسارة، الأهداف وتوصية كل سهم.",
      },
      { property: "og:title", content: "EGXpert" },
      {
        property: "og:description",
        content:
          "متابعة مراكزك في البورصة المصرية: الأسعار الحية، وقف الخسارة، الأهداف وتوصية كل سهم.",
      },
    ],
  }),
  component: PositionsPage,
});

const REC_TONE: Record<string, string> = {
  buy: "border-up/40 bg-up-soft text-up",
  buy_more: "border-up/40 bg-up-soft text-up",
  hold: "border-border bg-surface-2 text-foreground",
  sell: "border-down/40 bg-down-soft text-down",
  sell_part: "border-warn/40 bg-warn-soft text-foreground",
};

function PositionsPage() {
  const { rows, loading, error, reload, openDetail } = useDesk();

  if (error) {
    return (
      <ErrorState
        message={error}
        action={
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            حاول تاني
          </Button>
        }
      />
    );
  }

  if (loading && rows.length === 0) return <LoadingBlock rows={3} />;

  if (rows.length === 0) {
    return (
      <Panel title="المراكز المفتوحة">
        <EmptyState
          title="مفيش مراكز مفتوحة"
          hint="سجّل أول صفقة من تبويب «الصفقات»، أو ارفع صورة المحفظة من الأعلى."
        />
      </Panel>
    );
  }

  const alerts = rows
    .map((row) => {
      const p = row.position;
      if (p.stopBreached)
        return {
          tone: "danger" as const,
          text: `${row.code}: أغلق تحت وقف الخسارة ${fmt(p.stop)} — خروج`,
        };
      if ((p.distanceToStopPct ?? 99) <= 3)
        return {
          tone: "warn" as const,
          text: `${row.code}: قريب من الوقف (${fmt(p.distanceToStopPct, 1)}%)`,
        };
      if (p.triggers?.atTarget)
        return {
          tone: "success" as const,
          text: `${row.code}: وصل الهدف ${fmt(row.midTarget?.price)}`,
        };
      return null;
    })
    .filter(Boolean) as { tone: "danger" | "warn" | "success"; text: string }[];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {alerts.length ? (
          alerts.map((alert) => (
            <Notice key={alert.text} tone={alert.tone}>
              {alert.text}
            </Notice>
          ))
        ) : (
          <Notice tone="success">لا توجد تنبيهات — كل الأسهم داخل نطاقها.</Notice>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <PositionCard key={row.code} row={row} onOpen={() => openDetail(row.code)} />
        ))}
      </div>
    </div>
  );
}

function PositionCard({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const { reload, indices, pf } = useDesk();
  const memberOf = indices[row.code] ?? [];
  const p = row.position;
  const { style } = useActiveInvestStyle(pf?.trades);
  const rec = styleRecommendation(row, p, style);
  const critical = p.stopBreached;
  const near = !critical && (p.distanceToStopPct ?? 99) <= 3;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await post("/api/portfolio/holding", { code: row.code, shares: 0 });
      toast.success(`تم حذف ${row.code} من المحفظة`);
      void reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر حذف السهم");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm transition-colors",
        critical && "border-down/50",
        near && "border-warn/50",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpen}
              className="truncate text-[15px] font-semibold underline-offset-4 hover:underline"
            >
              {row.code}
            </button>
            <Badge variant="outline" className={REC_TONE[rec.action] ?? REC_TONE["hold"]}>
              {rec.label}
            </Badge>
            {p.sharesEstimated && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="cursor-help border-warn/40 bg-warn-soft text-[10.5px]"
                    >
                      ⚠️ عدد تقديري
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 text-center leading-relaxed">
                    عدد الأسهم ده اتحسب تقديريًا من القيمة السوقية مش من الصورة مباشرة، فممكن يكون
                    غير دقيق. لتصحيحه: افتح «إدخال يدوي» واكتب عدد الأسهم الفعلي، أو ارفع صورة توضّح
                    رقم الكمية بشكل واضح.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {memberOf.map((name) => (
              <Badge
                key={name}
                variant="outline"
                className="border-border bg-surface-2 text-[10.5px] text-muted-foreground"
              >
                {name}
              </Badge>
            ))}
          </div>
          <p className="mt-1 truncate text-[12px] text-muted-foreground">
            {row.name} · <span className="num">{int(p.shares)}</span> سهم @{" "}
            <span className="num">{fmt(p.avgCost)}</span>
          </p>
        </div>
        <div className="shrink-0 text-end">
          <div className="num text-[17px] font-semibold tracking-tight">{fmt(row.price)}</div>
          {row.changePct != null && (
            <div className={cn("num text-[12px]", tone(row.changePct))}>
              {pct(row.changePct)} اليوم
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-start pt-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-down"
            aria-label={`حذف ${row.code}`}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <PriceRail
        className="mt-4"
        price={row.price}
        stop={p.stop}
        cost={p.avgCost}
        target={row.midTarget?.price}
        longStop={p.longTermStop?.stop}
        longTarget={row.longTarget?.price}
      />

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border bg-surface p-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="قيمة الشراء" value={int(p.purchaseValue)} />
        <Stat label="القيمة السوقية" value={int(p.marketValue)} />
        <Stat
          label="الربح"
          value={signed(p.unrealizedEgp)}
          valueClassName={tone(p.unrealizedEgp)}
          sub={pct(p.unrealizedPct, 1)}
        />
        <Stat
          label="للوقف"
          value={pct(p.distanceToStopPct, 1)}
          valueClassName={(p.distanceToStopPct ?? 99) <= 3 ? "text-down" : ""}
        />
        <Stat
          label="للهدف"
          value={
            row.midTarget && row.price
              ? pct(((row.midTarget.price - row.price) / row.price) * 100, 1)
              : "—"
          }
        />
      </div>

      <div
        className={cn(
          "mt-3 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed",
          REC_TONE[rec.action] ?? REC_TONE["hold"],
        )}
      >
        <span className="text-muted-foreground">توصية اليوم · </span>
        {rec.text}
        {rec.order && (
          <div className="num mt-1.5 font-medium">
            الأمر: {rec.order.side === "buy" ? "شراء" : "بيع"} {int(rec.order.qty)} سهم عند{" "}
            {fmt(rec.order.price)} ≈ {int(rec.order.qty * rec.order.price)} ج
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>حذف {row.code}؟</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              هيتم مسح مركز {row.name ?? row.code} بالكامل من المحفظة. مش هينفع التراجع بعد الحذف.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="bg-down text-white hover:bg-down/90"
            >
              {deleting ? <Spinner /> : <Trash2 className="size-4" />}
              نعم، احذف
            </AlertDialogAction>
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
