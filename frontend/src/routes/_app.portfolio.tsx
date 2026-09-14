import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
import { ApiError, api, post } from "@/lib/api";
import { fmt, int, pct, signed, tone } from "@/lib/format";
import { STYLE_RULES, styleRecommendation, useActiveInvestStyle, type StyleKey } from "@/lib/invest-style";
import { SITE_URL } from "@/lib/seo";
import { useDesk, type Row, type Verdict } from "@/lib/store";

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
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${SITE_URL}/portfolio` },
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

// backend/src/agent/schemas.js ACTIONS — the AI analyst's own action enum,
// distinct from the mechanical engine's (REC_TONE above).
const AI_ACTION_LABEL: Record<string, string> = {
  buy: "شراء",
  accumulate: "زيادة شراء",
  hold: "احتفاظ",
  reduce: "تخفيف",
  take_profit: "جني أرباح",
  exit: "خروج",
  avoid: "تجنب",
  wait: "انتظار",
};
const AI_ACTION_TONE: Record<string, string> = {
  buy: "border-up/40 bg-up-soft text-up",
  accumulate: "border-up/40 bg-up-soft text-up",
  hold: "border-border bg-surface-2 text-foreground",
  reduce: "border-warn/40 bg-warn-soft text-foreground",
  take_profit: "border-warn/40 bg-warn-soft text-foreground",
  exit: "border-down/40 bg-down-soft text-down",
  avoid: "border-down/40 bg-down-soft text-down",
  wait: "border-border bg-surface-2 text-muted-foreground",
};

// A per-stock AI review is a real, paid model call, so each stock gets one
// "قولي توصية اليوم" per day (admins unlimited). The verdict is kept in
// localStorage for the day, so a reload shows it without another request;
// the server caches it per user/day/style/stock too (see /api/review/stock).
const todayKey = () => new Date().toDateString();
const reviewStorageKey = (code: string) => `alytic-stock-review:${code}`;
const REVIEW_POLL_MS = 5 * 1000;
const REVIEW_MAX_WAIT_MS = 15 * 60 * 1000;

// A trade on the position (e.g. acting on the verdict) makes it stale, so the
// stored verdict is only reused for the same day, style and position.
function readStoredVerdict(code: string, style: StyleKey, positionKey: string): Verdict | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(reviewStorageKey(code)) ?? "null");
    return stored?.day === todayKey() && stored?.style === style && stored?.positionKey === positionKey
      ? stored.verdict
      : null;
  } catch {
    return null;
  }
}

function useStockReview(code: string, style: StyleKey, positionKey: string) {
  const { refreshUser } = useDesk();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVerdict(readStoredVerdict(code, style, positionKey));
  }, [code, style, positionKey]);

  const request = useCallback(
    async (force: boolean) => {
      setLoading(true);
      setError(null);
      try {
        // Usually answered inline; a slow model call becomes a server-side
        // job that this polls, so no request outlives nginx's 180s timeout.
        let result = await post("/api/review/stock", { code, style, force });
        const giveUpAt = Date.now() + REVIEW_MAX_WAIT_MS;
        while (result?.status === "running") {
          if (Date.now() > giveUpAt) throw new Error("التحليل أخد وقت أطول من المتوقع — جرّب تاني بعد شوية.");
          await new Promise((resolve) => setTimeout(resolve, REVIEW_POLL_MS));
          result = await api(`/api/review/status?style=${style}&code=${encodeURIComponent(code)}`);
        }
        setVerdict(result.verdict);
        try {
          window.localStorage.setItem(
            reviewStorageKey(code),
            JSON.stringify({ day: todayKey(), style, positionKey, verdict: result.verdict }),
          );
        } catch {
          /* storage unavailable — the verdict still shows for this session */
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 402) {
          await refreshUser();
          return;
        }
        setError(caught instanceof Error ? caught.message : "تعذر تحليل السهم");
      } finally {
        setLoading(false);
      }
    },
    [code, style, positionKey, refreshUser],
  );

  return { verdict, loading, error, request };
}

function PositionsPage() {
  const { rows, loading, error, reload, openDetail, pf } = useDesk();
  const { style } = useActiveInvestStyle(pf?.trades);
  const nearStopPct = STYLE_RULES[style].nearStopPct;

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
      if ((p.distanceToStopPct ?? 99) <= nearStopPct)
        return {
          tone: "warn" as const,
          text: `${row.code}: قريب من الوقف (${fmt(p.distanceToStopPct, 1)}%)`,
        };
      if (p.triggers?.atTarget) {
        const reachedTarget = style === "long" ? (row.longTarget?.price ?? row.midTarget?.price) : row.midTarget?.price;
        return {
          tone: "success" as const,
          text: `${row.code}: وصل الهدف ${fmt(reachedTarget)}`,
        };
      }
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
  const { reload, indices, pf, aiAvailable, user } = useDesk();
  const memberOf = indices[row.code] ?? [];
  const p = row.position;
  const { style } = useActiveInvestStyle(pf?.trades);
  const rec = styleRecommendation(row, p, style);
  const critical = p.stopBreached;
  const near = !critical && (p.distanceToStopPct ?? 99) <= STYLE_RULES[style].nearStopPct;
  // Mirrors the server's governingTarget (analyze.js) — the long style reads
  // its target off the long-horizon price, every other style off the mid one.
  const primaryTarget = style === "long" ? (row.longTarget?.price ?? row.midTarget?.price) : row.midTarget?.price;
  const { verdict, loading: reviewLoading, error: reviewError, request: requestReview } = useStockReview(
    row.code,
    style,
    `${p.shares}@${p.avgCost}`,
  );
  // Admins aren't held to one per day: each confirmed click regenerates
  // (the server only honors `force` for admins).
  const isAdmin = Boolean(user?.isAdmin);
  const [confirmReviewOpen, setConfirmReviewOpen] = useState(false);
  // The AI analyst's own verdict — see backend/src/agent/schemas.js — takes
  // over the badge and recommendation box when one has been fetched for this
  // stock; the mechanical rec above stays the fallback (and still drives
  // critical/near, which are the engine's own triggers, not the AI's opinion).
  const badgeLabel = verdict ? (AI_ACTION_LABEL[verdict.action] ?? verdict.action) : rec.label;
  const badgeTone = verdict ? (AI_ACTION_TONE[verdict.action] ?? AI_ACTION_TONE["hold"]) : (REC_TONE[rec.action] ?? REC_TONE["hold"]);

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
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "cursor-pointer rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-foreground/30 hover:bg-accent/40",
        critical && "border-down/50",
        near && "border-warn/50",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{row.code}</span>
            <Badge variant="outline" className={badgeTone}>
              {badgeLabel}
            </Badge>
            {verdict?.conviction && (
              <span className="text-[11px] text-muted-foreground">ثقة {verdict.conviction}</span>
            )}
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
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
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
        target={primaryTarget}
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
          value={pct(p.distanceToTargetPct, 1)}
        />
      </div>

      <div className={cn("mt-3 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed", badgeTone)}>
        {verdict ? (
          // Two lines, always: the decision, then the order (or the level to
          // watch on a hold). The clamp is a backstop if the model runs long.
          <p
            className="num line-clamp-2"
            title={[verdict.headline, verdict.orderInstruction ?? verdict.invalidation].filter(Boolean).join(" — ")}
          >
            <span className="font-medium">{verdict.headline}</span>
            {(verdict.orderInstruction ?? verdict.invalidation) && (
              <>
                <br />
                <span className="text-muted-foreground">{verdict.orderInstruction ?? verdict.invalidation}</span>
              </>
            )}
          </p>
        ) : (
          <>
            <span className="text-muted-foreground">توصية اليوم · </span>
            {rec.text}
            {rec.order && (
              <div className="num mt-1.5 font-medium">
                الأمر: {rec.order.side === "buy" ? "شراء" : "بيع"} {int(rec.order.qty)} سهم عند{" "}
                {fmt(rec.order.price)} ≈ {int(rec.order.qty * rec.order.price)} ج
              </div>
            )}
          </>
        )}
      </div>

      {aiAvailable && (
        <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
          {reviewError && <span className="text-[12px] text-down">{reviewError}</span>}
          <Button
            variant="outline"
            size="sm"
            disabled={reviewLoading || (Boolean(verdict) && !isAdmin)}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmReviewOpen(true);
            }}
          >
            {reviewLoading && <Spinner />}
            {verdict && isAdmin ? "توصية جديدة" : "قولي توصية اليوم"}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmReviewOpen} onOpenChange={setConfirmReviewOpen}>
        {/* The dialog renders in a portal, but React events still bubble to the
            clickable card — stop them so confirming doesn't also open details. */}
        <AlertDialogContent onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>متأكد إنك عايز توصية اليوم لسهم {row.code} دلوقتي؟</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {isAdmin
                ? "كمشرف تقدر تطلبها أكتر من مرة — كل مرة بتعمل تحليل جديد بالذكاء الاصطناعي."
                : "بتتحسب مرة واحدة بس في اليوم لكل سهم، والزرار هيتقفل لحد بكرة بعد ما تستخدمه."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              onClick={() => {
                setConfirmReviewOpen(false);
                void requestReview(isAdmin);
              }}
            >
              أيوه، هاتها
            </AlertDialogAction>
            <AlertDialogCancel>لسه</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
