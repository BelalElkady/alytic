import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PencilLine, Sparkles, Trash2 } from "lucide-react";

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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api, post } from "@/lib/api";
import { arDay, fmt, int, pct, signed, tone } from "@/lib/format";
import { STYLE_RULES, styleRecommendation, useActiveInvestStyle, type StyleKey } from "@/lib/invest-style";
import { siteName, siteUrl } from "@/lib/seo";
import { useDesk, type Row, type Verdict } from "@/lib/store";

import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/portfolio")({
  head: ({ match }) => ({
    meta: [
      { title: siteName(match) },
      {
        name: "description",
        content:
          "متابعة مراكزك في البورصة المصرية: الأسعار الحية، وقف الخسارة، الأهداف وتوصية كل سهم.",
      },
      { property: "og:title", content: siteName(match) },
      {
        property: "og:description",
        content:
          "متابعة مراكزك في البورصة المصرية: الأسعار الحية، وقف الخسارة، الأهداف وتوصية كل سهم.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${siteUrl(match)}/portfolio` },
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

// A per-stock AI review is a real, paid model call and a pure spend-until-
// empty credit — the server never serves a cached answer for free, so
// re-asking for the same stock the same day spends a new use (see
// getOrGenerateStockReview in backend/src/agent/analyst.js). This local
// cache is purely a client-side "what did I last see" convenience so a page
// reload still shows the last verdict without paying for another request —
// it plays no part in what's billed. How many uses an account has left this
// month is TIERS-based (backend/src/billing/plans.js), reflected in
// pf.recommendationsLeft.
const reviewStorageKey = (code: string) => `alytic-stock-review:${code}`;
/** The calendar day (Cairo) of a timestamp, as YYYY-MM-DD — what arDay() takes. */
const cairoDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(ms);
const isFromToday = (at: number | null | undefined) => at != null && cairoDay(at) === cairoDay(Date.now());
// Short on purpose: /api/review/status already holds each request open until
// the job finishes (up to 15s), so this is only the gap between long-polls.
const REVIEW_POLL_MS = 1000;
const REVIEW_MAX_WAIT_MS = 15 * 60 * 1000;

// Every stock review — a single card's click or the page's "all stocks" button —
// takes one of these slots, so a whole book never hits the model (or a free
// tier's rate limit) all at once. Each review is its own job, so the batch
// still finishes in about the time of its slowest few stocks, not their sum.
const REVIEW_CONCURRENCY = 3;
let reviewSlotsInUse = 0;
const reviewSlotWaiters: (() => void)[] = [];

async function withReviewSlot<T>(run: () => Promise<T>): Promise<T> {
  if (reviewSlotsInUse < REVIEW_CONCURRENCY) reviewSlotsInUse++;
  else await new Promise<void>((resolve) => reviewSlotWaiters.push(resolve));
  try {
    return await run();
  } finally {
    // Hand the slot straight to the next waiter instead of releasing it.
    const next = reviewSlotWaiters.shift();
    if (next) next();
    else reviewSlotsInUse--;
  }
}

type StoredVerdict = {
  verdict: Verdict;
  /** When it was generated (ms); null for an entry saved before this was recorded and undatable. */
  at: number | null;
  /** The live price on the card when it was requested; null for an entry saved before this was recorded. */
  price: number | null;
};

/** A move this large since a verdict was written is enough to call it outdated on its own. */
const VERDICT_STALE_MOVE_PCT = 3;

/**
 * Why a saved verdict no longer describes the position, or null while it still
 * does. A verdict is a snapshot of the price it was written at, and it can say
 * "far from the stop" or "still below the target" long after the price has
 * crossed either — so crossing a level, or simply moving a lot, retires it.
 */
function verdictStaleReason(
  then: number | null,
  now: number | undefined,
  stop: number | null | undefined,
  // Every target level in play — the current one and, once a passed target was
  // replaced, the one that was passed.
  targets: (number | null | undefined)[],
): string | null {
  if (then == null || !(then > 0) || now == null || !(now > 0)) return null;
  if (typeof stop === "number" && then >= stop !== now >= stop) {
    return now < stop ? "السعر نزل تحت الوقف بعد التوصية" : "السعر رجع فوق الوقف بعد التوصية";
  }
  for (const target of targets) {
    if (typeof target === "number" && then < target !== now < target) {
      return now >= target ? "السعر عدّى الهدف بعد التوصية" : "السعر رجع تحت الهدف بعد التوصية";
    }
  }
  const movePct = ((now - then) / then) * 100;
  if (Math.abs(movePct) >= VERDICT_STALE_MOVE_PCT) {
    return `السعر اتحرك ${pct(movePct, 1)} من وقت التوصية`;
  }
  return null;
}

// The last verdict the user asked for stays on the card — across days and
// reloads — until they press the button again; nothing refreshes it by
// itself. Only a change to what it was written about drops it: a trade on the
// position (e.g. acting on the verdict — its "sell 223 shares" order would be
// stale) or a different investor style. This is purely a "what to display"
// convenience, not a billing cache (see the block comment above).
function readStoredVerdict(code: string, style: StyleKey, positionKey: string): StoredVerdict | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(reviewStorageKey(code)) ?? "null");
    if (!stored || stored.style !== style || stored.positionKey !== positionKey || !stored.verdict) return null;
    // Entries saved before `at` existed only carry `day` (a Date.toDateString()).
    const at = Number.isFinite(stored.at) ? stored.at : Date.parse(stored.day);
    return {
      verdict: stored.verdict,
      at: Number.isFinite(at) ? at : null,
      price: typeof stored.price === "number" ? stored.price : null,
    };
  } catch {
    return null;
  }
}

function useStockReview(code: string, style: StyleKey, positionKey: string, livePrice: number | undefined) {
  const { refreshUser, reloadPortfolio } = useDesk();
  const [saved, setSaved] = useState<StoredVerdict | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read when the request is *sent*: the server prices the analysis at its own
  // live quote then, which is the price on the card at that moment.
  const livePriceRef = useRef(livePrice);
  livePriceRef.current = livePrice;

  useEffect(() => {
    setSaved(readStoredVerdict(code, style, positionKey));
  }, [code, style, positionKey]);

  const request = useCallback(
    async (force: boolean) => {
      setLoading(true);
      setError(null);
      const priceAtRequest = livePriceRef.current ?? null;
      try {
        // Usually answered inline; a slow model call becomes a server-side
        // job that this polls, so no request outlives nginx's 180s timeout.
        const result = await withReviewSlot(async () => {
          let res = await post("/api/review/stock", { code, style, force });
          const giveUpAt = Date.now() + REVIEW_MAX_WAIT_MS;
          while (res?.status === "running") {
            if (Date.now() > giveUpAt) throw new Error("التحليل أخد وقت أطول من المتوقع — جرّب تاني بعد شوية.");
            await new Promise((resolve) => setTimeout(resolve, REVIEW_POLL_MS));
            res = await api(`/api/review/status?style=${style}&code=${encodeURIComponent(code)}`);
          }
          return res;
        });
        const at = Date.now();
        setSaved({ verdict: result.verdict, at, price: priceAtRequest });
        try {
          window.localStorage.setItem(
            reviewStorageKey(code),
            JSON.stringify({ at, style, positionKey, price: priceAtRequest, verdict: result.verdict }),
          );
        } catch {
          /* storage unavailable — the verdict still shows for this session */
        }
        // A forced review may have spent a recommendation credit.
        if (force) void reloadPortfolio().catch(() => {});
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
    [code, style, positionKey, refreshUser, reloadPortfolio],
  );

  return {
    verdict: saved?.verdict ?? null,
    verdictAt: saved?.at ?? null,
    verdictPrice: saved?.price ?? null,
    loading,
    error,
    request,
  };
}

/**
 * Standing reminder at the top of the dashboard. Nothing here is fed by the
 * broker: positions, average cost and cash only change when the user records
 * a trade, and every recommendation is computed from them — so an executed
 * buy or sell that never gets logged quietly turns the analysis into advice
 * about a portfolio the user no longer has. Deliberately not dismissible: the
 * cost of forgetting is a wrong recommendation, not an annoyance. The button
 * lands straight on the "صفقة جديدة" tab.
 */
function TradeReminder() {
  const { openManual } = useDesk();

  return (
    <Alert className="flex flex-col gap-3 border-primary/40 bg-primary/10 sm:flex-row sm:items-center sm:justify-between">
      <AlertDescription className="flex items-start gap-2.5 text-[13px] leading-relaxed">
        <PencilLine className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="font-semibold">سجّل أي صفقة جديدة — شراء أو بيع — أول ما تنفّذها.</span>{" "}
          التحليل والتوصيات بتتحسب على المراكز والكاش المسجّلين هنا بس، فأي صفقة نفّذتها عند السمسار
          ومسجّلتهاش هتخلّي التوصية تتبني على أرقام قديمة.
        </span>
      </AlertDescription>
      <Button size="sm" className="shrink-0" onClick={() => openManual("new")}>
        <PencilLine className="size-4" />
        سجّل صفقة
      </Button>
    </Alert>
  );
}

function PositionsPage() {
  const { rows, loading, error, reload, openDetail, pf, aiAvailable, user } = useDesk();
  const { style } = useActiveInvestStyle(pf?.trades);
  const nearStopPct = STYLE_RULES[style].nearStopPct;
  const isAdmin = Boolean(user?.isAdmin);
  const recommendationsLeft =
    typeof pf?.recommendationsLeft === "number" ? pf.recommendationsLeft : null;

  // "All stocks" button: a batch is just every card without a verdict from
  // today running its own per-stock review (queued through withReviewSlot).
  // Only fills in what's missing or left over from an earlier day — never
  // regenerates today's, not even for an admin.
  const [batch, setBatch] = useState<{ id: number; codes: Set<string> }>({ id: 0, codes: new Set() });
  const [batchPending, setBatchPending] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState<string[] | null>(null);

  const onBatchSettled = useCallback((code: string) => {
    setBatchPending((prev) => {
      if (!prev.has(code)) return prev;
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
  }, []);

  const openBatchConfirm = () => {
    const missing = rows
      .filter(
        (row) =>
          !isFromToday(readStoredVerdict(row.code, style, `${row.position.shares}@${row.position.avgCost}`)?.at),
      )
      .map((row) => row.code);
    if (missing.length === 0) {
      toast.info("كل الأسهم عندها توصية النهاردة بالفعل");
      return;
    }
    setBatchConfirm(missing);
  };

  const startBatch = (codes: string[]) => {
    setBatchConfirm(null);
    setBatchPending(new Set(codes));
    setBatch((prev) => ({ id: prev.id + 1, codes: new Set(codes) }));
  };

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
          hint="سجّل أول صفقة من «إدخال يدوي» ← «إدخال صفقة جديدة»، أو ارفع صورة المحفظة من الأعلى."
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
        // The row's targets have already moved up to the new one by now, so the
        // level that was reached comes from reachedTarget.
        const reachedTarget =
          p.reachedTarget?.price ??
          (style === "long" ? (row.longTarget?.price ?? row.midTarget?.price) : row.midTarget?.price);
        return {
          tone: "success" as const,
          text: `${row.code}: وصل الهدف ${fmt(reachedTarget)}${
            p.reachedTarget?.next != null ? ` — الهدف الجديد ${fmt(p.reachedTarget.next)}` : ""
          }`,
        };
      }
      return null;
    })
    .filter(Boolean) as { tone: "danger" | "warn" | "success"; text: string }[];

  return (
    <div className="space-y-4">
      <TradeReminder />

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

      {aiAvailable && rows.length > 1 && (
        // The page is RTL, so justify-start (and the button coming first) puts it on the right.
        <div className="flex flex-wrap items-center justify-start gap-2">
          <Button className="font-semibold shadow-sm" disabled={batchPending.size > 0} onClick={openBatchConfirm}>
            {batchPending.size > 0 ? <Spinner /> : <Sparkles className="size-4" />}
            توصية اليوم لكل الأسهم
          </Button>
          {batchPending.size > 0 && (
            <span className="text-[12px] text-muted-foreground">
              باقي {int(batchPending.size)} من {int(batch.codes.size)} — كل كارت بيظهر أول ما يخلص
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <PositionCard
            key={row.code}
            row={row}
            onOpen={() => openDetail(row.code)}
            batchId={batch.codes.has(row.code) ? batch.id : 0}
            onBatchSettled={onBatchSettled}
          />
        ))}
      </div>

      <AlertDialog open={batchConfirm !== null} onOpenChange={(open) => !open && setBatchConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>
              متأكد إنك عايز توصية اليوم لـ {int(batchConfirm?.length ?? 0)} سهم دلوقتي؟
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {`الأسهم اللي مالهاش توصية: ${batchConfirm?.join("، ") ?? ""}. `}
              {isAdmin
                ? "كل سهم فيهم هيتعمل له تحليل جديد؛ الأسهم اللي عندها توصية مش هتتعاد."
                : recommendationsLeft !== null && recommendationsLeft < (batchConfirm?.length ?? 0)
                  ? `عندك ${recommendationsLeft} بس في رصيدك — هيتكلف ${recommendationsLeft} توصية وياخدوا توصية أول ${recommendationsLeft} سهم، والباقي لأ.`
                  : `هيتكلف ${int(batchConfirm?.length ?? 0)} توصية من رصيدك${recommendationsLeft !== null ? ` (باقي ${recommendationsLeft} دلوقتي)` : ""}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction onClick={() => batchConfirm && startBatch(batchConfirm)}>أيوة</AlertDialogAction>
            <AlertDialogCancel>لسه</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PositionCard({
  row,
  onOpen,
  batchId,
  onBatchSettled,
}: {
  row: Row;
  onOpen: () => void;
  /** Non-zero when this stock is part of a page batch; a new id starts a new run. */
  batchId: number;
  onBatchSettled: (code: string) => void;
}) {
  const { reload, indices, pf, aiAvailable, user } = useDesk();
  const memberOf = indices[row.code] ?? [];
  const p = row.position;
  const { style } = useActiveInvestStyle(pf?.trades);
  const rec = styleRecommendation(row, p, style);
  const critical = p.stopBreached;
  const near = !critical && (p.distanceToStopPct ?? 99) <= STYLE_RULES[style].nearStopPct;
  // Mirrors the server's governingTarget (analyze.js) — the long style reads
  // its target off the long-horizon price, every other style off the mid one.
  // The server reports the exact level its own target distance is measured to
  // (p.targetLevel); preferring it keeps the rail and the "للهدف" tile on one
  // target even if the row was scanned under a different style than this card's.
  const primaryTarget =
    p.targetLevel ?? (style === "long" ? (row.longTarget?.price ?? row.midTarget?.price) : row.midTarget?.price);
  // Every fresh (non-cached) verdict spends from that account's monthly
  // recommendations allowance (see TIERS in backend/src/billing/plans.js) —
  // admins included, though their tier's allowance is generous. Requesting
  // this stock's cached same-day verdict again costs nothing.
  const isAdmin = Boolean(user?.isAdmin);
  const {
    verdict,
    verdictAt,
    verdictPrice,
    loading: reviewLoading,
    error: reviewError,
    request: requestReview,
  } = useStockReview(row.code, style, `${p.shares}@${p.avgCost}`, row.price);
  const staleReason = verdict
    ? verdictStaleReason(verdictPrice, row.price, p.stop, [primaryTarget, p.reachedTarget?.price])
    : null;
  // A verdict stays on the card until the next request, so it can be from an earlier day.
  const verdictIsToday = isFromToday(verdictAt);
  const [confirmReviewOpen, setConfirmReviewOpen] = useState(false);
  const recommendationsLeft =
    typeof pf?.recommendationsLeft === "number" ? pf.recommendationsLeft : null;
  const recommendationsExhausted = recommendationsLeft !== null && recommendationsLeft <= 0;

  // Run this card's review once per page batch it's part of. Already has
  // today's verdict, or a single-card request is already running: nothing to
  // add, so it counts as settled straight away. A verdict from an earlier day
  // doesn't count — the batch is "today's recommendation for every stock".
  const handledBatchId = useRef(0);
  useEffect(() => {
    if (!batchId || handledBatchId.current === batchId) return;
    handledBatchId.current = batchId;
    if (verdictIsToday || reviewLoading) {
      onBatchSettled(row.code);
      return;
    }
    void requestReview(false).finally(() => onBatchSettled(row.code));
  }, [batchId, verdictIsToday, reviewLoading, requestReview, onBatchSettled, row.code]);

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
            dir="rtl"
            className="line-clamp-2 text-right"
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
            <span className="text-muted-foreground">
              توصية اليوم{row.asOf && ` (${arDay(row.asOf)})`} ·{" "}
            </span>
            {rec.text}
            {rec.order && (
              <div dir="rtl" className="mt-1.5 text-right font-medium">
                الأمر: {rec.order.side === "buy" ? "شراء" : "بيع"} {int(rec.order.qty)} سهم عند{" "}
                {fmt(rec.order.price)} ≈ {int(rec.order.qty * rec.order.price)} ج
              </div>
            )}
          </>
        )}
      </div>

      {staleReason && (
        <p dir="rtl" className="mt-2 text-right text-[12px] leading-relaxed text-warn">
          ⚠️ التوصية دي قديمة: {staleReason}. اطلب توصية جديدة قبل ما تتصرف عليها.
        </p>
      )}

      {aiAvailable && (
        <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
          {reviewError && <span className="text-[12px] text-down">{reviewError}</span>}
          {/* The date it was generated — fixed, so it never moves until a new one is requested. */}
          {verdict && verdictAt != null && (
            <span className="text-[11.5px] text-muted-foreground">
              آخر توصية: {arDay(cairoDay(verdictAt))}
            </span>
          )}
          {!isAdmin && recommendationsLeft !== null && (
            <span className="text-[11.5px] text-muted-foreground">
              {recommendationsExhausted
                ? "خلصت توصيات الشهر ده — كلّمنا في الشات لو محتاج رصيد إضافي"
                : `باقي ${recommendationsLeft} ${recommendationsLeft === 1 ? "توصية" : "توصيات"} الشهر ده`}
            </span>
          )}
          <Button
            // Filled while a recommendation is still on offer, so it stands out
            // on the card; once used it drops back to the quiet outline style.
            variant={verdict ? "outline" : "default"}
            size="sm"
            className={cn(!verdict && "font-semibold shadow-sm")}
            disabled={reviewLoading || (!isAdmin && recommendationsExhausted)}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmReviewOpen(true);
            }}
          >
            {reviewLoading ? <Spinner /> : !verdict && <Sparkles className="size-4" />}
            {verdict ? "توصية جديدة" : "قولي توصية اليوم"}
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
                ? "كمشرف تقدر تطلبها أكتر من مرة — كل مرة بتعمل تحليل جديد ضمن رصيدك."
                : recommendationsExhausted
                  ? "خلصت توصياتك."
                  : `هتستهلك توصية من رصيدك (باقي ${recommendationsLeft}) — كل طلب بتحليل جديد، حتى لو نفس السهم ونفس اليوم.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              onClick={() => {
                setConfirmReviewOpen(false);
                void requestReview(Boolean(verdict));
              }}
            >
              أيوة
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
