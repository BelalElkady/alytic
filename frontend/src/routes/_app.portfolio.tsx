import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ArrowDownUp, Info, PencilLine, Sparkles, Trash2 } from "lucide-react";

import { PortfolioDesk } from "@/components/desk/portfolio-desk";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api, post } from "@/lib/api";
import { arDay, fmt, int, pct, signed, tone } from "@/lib/format";
import { STYLE_RULES, styleRecommendation, useActiveInvestStyle, type StyleKey } from "@/lib/invest-style";
import { POSITION_SORT_OPTIONS, sortPositions, usePositionSort, type PositionSortKey } from "@/lib/position-sort";
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
  component: PortfolioRoute,
});

function PortfolioRoute() {
  return (
    <PortfolioDesk>
      <PositionsPage />
    </PortfolioDesk>
  );
}

const REC_TONE: Record<string, string> = {
  buy: "border-up/40 bg-up-soft text-up",
  buy_more: "border-up/40 bg-up-soft text-up",
  hold: "border-border bg-surface-2 text-foreground",
  sell: "border-down/40 bg-down-soft text-down",
  sell_part: "border-warn/40 bg-warn-soft text-foreground",
  halted: "border-warn/40 bg-warn-soft text-foreground",
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
// getOrGenerateStockReview in backend/src/agent/analyst.js). The last verdict
// is kept on the portfolio (pf.lastVerdicts, see rememberVerdict in
// backend/src/portfolio.js), so a reload or another device still shows it
// without paying for another request. How many uses an account has left this
// month is TIERS-based (backend/src/billing/plans.js), reflected in
// pf.recommendationsLeft.
/** Where browsers used to keep their own copy of each stock's verdict (see clearLocalVerdicts). */
const LEGACY_REVIEW_STORAGE_PREFIX = "alytic-stock-review:";
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
  /** The investor style it was written under; null when unknown. */
  style: StyleKey | null;
  /** The holding (`shares@avgCost`) it was written about; null when unknown. */
  positionKey: string | null;
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
    return `السعر اتحرك ${pct(movePct)} من وقت التوصية`;
  }
  return null;
}

// The last verdict the user asked for stays on the card — across days,
// reloads, trades and style changes — until they press the button again;
// nothing replaces or hides it by itself. When what it was written about has
// changed since (a trade on the position, a different investor style, a big
// price move) it is flagged as outdated instead (see verdictStaleReason).
// Only the server's copy (pf.lastVerdicts) is shown, so every device shows the
// same one. Browsers used to keep their own copy too; one saved there before
// the server kept verdicts showed on that device alone, so it is cleared.
function clearLocalVerdicts() {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(LEGACY_REVIEW_STORAGE_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/** A stock's last verdict as the server keeps it (rememberVerdict in backend/src/portfolio.js). */
type ServerVerdict = {
  verdict?: Verdict;
  at?: number;
  price?: number | null;
  style?: StyleKey;
  shares?: number;
  avgCost?: number;
};

/**
 * The holding a verdict was written about, as `shares@avgCost`. The average is
 * rounded to 2 decimals, as the card's row gets it (r2 in backend/src/analyze.js):
 * the server stores the unrounded one (e.g. 62.8537 from a screenshot import or
 * several buys), and comparing that to the card's 62.85 flagged every such
 * holding as traded on ("اتسجلت حركة على السهم بعد التوصية") when it wasn't.
 */
const positionKeyOf = (shares: number, avgCost: number) => `${shares}@${+avgCost.toFixed(2)}`;

function serverVerdict(entry: ServerVerdict | null | undefined): StoredVerdict | null {
  if (!entry?.verdict) return null;
  return {
    verdict: entry.verdict,
    at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : null,
    price: typeof entry.price === "number" ? entry.price : null,
    style: entry.style ?? null,
    positionKey:
      entry.shares != null && entry.avgCost != null ? positionKeyOf(entry.shares, entry.avgCost) : null,
  };
}

/**
 * What "محتاجة تحديث" / "قديمة" on a saved verdict means, one tap away. A
 * popover rather than a tooltip so it opens on a phone too; it swallows its
 * own clicks, which React would otherwise bubble (through the portal) to the
 * card and open the stock.
 */
function StaleVerdictHint({ reason, fromToday }: { reason: string; fromToday: boolean }) {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="يعني إيه التوصية محتاجة تحديث؟"
          onClick={stop}
          onKeyDown={stop}
          className="ms-1 inline-flex size-4 items-center justify-center rounded-full align-[-2px] text-warn transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        dir="rtl"
        side="top"
        className="w-72 space-y-1.5 text-right text-[12.5px] leading-relaxed"
        onClick={stop}
        onKeyDown={stop}
      >
        <p className="font-semibold">
          {fromToday ? "يعني إيه «محتاجة تحديث»؟" : "يعني إيه «توصية قديمة»؟"}
        </p>
        <p>
          {fromToday
            ? "التوصية دي اتكتبت النهارده، بس حاجة اتغيرت من ساعتها فممكن متبقاش مناسبة دلوقتي:"
            : "التوصية دي اتكتبت في يوم قبل النهارده، وحاجة اتغيرت من ساعتها فممكن متبقاش مناسبة دلوقتي:"}{" "}
          <span className="font-medium">{reason}</span>.
        </p>
        <p className="text-muted-foreground">
          التوصية بتتعلّم كده لو السعر اتحرك {VERDICT_STALE_MOVE_PCT}% أو أكتر من وقت ما اتكتبت، أو عدّى
          الوقف أو الهدف، أو سجّلت شراء أو بيع على السهم، أو غيّرت أسلوب الاستثمار.
        </p>
        <p className="text-muted-foreground">
          اطلب «توصية جديدة» عشان تتحسب على السعر والمركز الحاليين قبل ما تتصرف.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** Why the verdict was written about something else than what the card shows now, or null. */
function verdictChangedReason(
  saved: StoredVerdict,
  style: StyleKey,
  positionKey: string,
): string | null {
  if (saved.positionKey && saved.positionKey !== positionKey)
    return "اتسجلت حركة على السهم بعد التوصية";
  if (saved.style && saved.style !== style) return "غيّرت أسلوب الاستثمار بعد التوصية";
  return null;
}

function useStockReview(code: string, style: StyleKey, positionKey: string, livePrice: number | undefined) {
  const { refreshUser, reloadPortfolio, pf } = useDesk();
  const serverEntry = pf?.lastVerdicts?.[code];
  const [saved, setSaved] = useState<StoredVerdict | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read when the request is *sent*: the server prices the analysis at its own
  // live quote then, which is the price on the card at that moment.
  const livePriceRef = useRef(livePrice);
  livePriceRef.current = livePrice;

  useEffect(() => {
    setSaved(serverVerdict(serverEntry));
  }, [code, serverEntry]);

  const request = useCallback(
    async (force: boolean) => {
      setLoading(true);
      setError(null);
      const priceAtRequest = livePriceRef.current ?? null;
      try {
        // Usually answered inline; a slow model call becomes a server-side
        // job that this polls, so no request outlives nginx's 180s timeout.
        const result = await withReviewSlot(async () => {
          let res = await post("/api/review/stock", { code, style, force, price: priceAtRequest });
          const giveUpAt = Date.now() + REVIEW_MAX_WAIT_MS;
          while (res?.status === "running") {
            if (Date.now() > giveUpAt) throw new Error("التحليل أخد وقت أطول من المتوقع — جرّب تاني بعد شوية.");
            await new Promise((resolve) => setTimeout(resolve, REVIEW_POLL_MS));
            res = await api(`/api/review/status?style=${style}&code=${encodeURIComponent(code)}`);
          }
          return res;
        });
        const at = Date.now();
        setSaved({ verdict: result.verdict, at, price: priceAtRequest, style, positionKey });
        // Picks up the credit it spent and the verdict the server now keeps.
        void reloadPortfolio().catch(() => {});
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
    verdictChanged: saved ? verdictChangedReason(saved, style, positionKey) : null,
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

function PositionSortControl({
  sort,
  onChange,
}: {
  sort: ReturnType<typeof usePositionSort>["sort"];
  onChange: ReturnType<typeof usePositionSort>["setSort"];
}) {
  const reversed = sort.direction === "reversed";
  const directionLabel =
    sort.key === "added" ? (reversed ? "الأحدث أولاً" : "الأقدم أولاً") : reversed ? "الأقل أولاً" : "الأعلى أولاً";
  return (
    <div className="flex items-center justify-start gap-2">
      <span className="text-[12px] text-muted-foreground">ترتيب:</span>
      <Select value={sort.key} onValueChange={(key) => onChange({ key: key as PositionSortKey, direction: "natural" })}>
        <SelectTrigger className="h-8 w-40 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {POSITION_SORT_OPTIONS.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1 text-[12px]"
        aria-label={`عكس الترتيب — الحالي: ${directionLabel}`}
        onClick={() => onChange({ ...sort, direction: reversed ? "natural" : "reversed" })}
      >
        <ArrowDownUp className="size-3.5" />
        {directionLabel}
      </Button>
    </div>
  );
}

/**
 * A held stock the list below can't show is never just left out: each one is
 * named here with what's missing and the way to fix it, since it is counted
 * in none of the page's totals either.
 */
function UnlistedHoldings() {
  const { unlisted, reload, openManual, loading } = useDesk();
  if (!unlisted.length) return null;
  return (
    <div className="space-y-2">
      {unlisted.map(({ code, reason, detail }) => (
        <Notice key={code} tone="warn">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              <span className="num font-semibold">{code}</span>
              {reason === "no-cost"
                ? " موجود في المحفظة بس مش ظاهر في المراكز ولا محسوب في الإجمالي — متوسط سعر الشراء مش متسجل."
                : detail
                  ? " موجود في محفظتك، بس مش ظاهر في المراكز ولا محسوب في الإجمالي دلوقتي."
                  : " موجود في محفظتك، بس مش ظاهر في المراكز ولا محسوب في الإجمالي دلوقتي — تحليل السهم ما اكتملش."}
              {reason === "analysis" && detail && (
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">{detail}</span>
              )}
            </span>
            {reason === "no-cost" ? (
              <Button size="sm" variant="outline" className="ms-auto" onClick={() => openManual("edit")}>
                سجّل سعر الشراء
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="ms-auto" disabled={loading} onClick={() => void reload()}>
                حاول تاني
              </Button>
            )}
          </div>
        </Notice>
      ))}
    </div>
  );
}

function PositionsPage() {
  const { rows, loading, error, reload, openDetail, pf, aiAvailable, user, unlisted } = useDesk();
  const { style } = useActiveInvestStyle(pf?.trades);
  const nearStopPct = STYLE_RULES[style].nearStopPct;
  const { sort, setSort } = usePositionSort();
  const isAdmin = Boolean(user?.isAdmin);
  const recommendationsLeft =
    typeof pf?.recommendationsLeft === "number" ? pf.recommendationsLeft : null;

  useEffect(clearLocalVerdicts, []);

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
    const needVerdict = rows.filter((row) => {
      const saved = serverVerdict(pf?.lastVerdicts?.[row.code]);
      const positionKey = positionKeyOf(row.position.shares, row.position.avgCost);
      return (
        !saved || !isFromToday(saved.at) || verdictChangedReason(saved, style, positionKey) != null
      );
    });
    // A suspended stock is skipped: no order could be filled until it trades again.
    const halted = needVerdict.filter((row) => row.halted).map((row) => row.code);
    const missing = needVerdict.filter((row) => !row.halted).map((row) => row.code);
    if (missing.length === 0) {
      toast.info(
        halted.length
          ? `مفيش أسهم محتاجة توصية — ${halted.join("، ")} موقوف عن التداول`
          : "كل الأسهم عندها توصية النهاردة بالفعل",
      );
      return;
    }
    if (halted.length) toast.info(`${halted.join("، ")} موقوف عن التداول — مش هيتحلل`);
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
    // Holdings exist but none could be listed: say which, not "no positions".
    if (unlisted.length) return <UnlistedHoldings />;
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
          text: `${row.code}: قريب من الوقف (${fmt(p.distanceToStopPct)}%)`,
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

      <UnlistedHoldings />

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

      <PositionSortControl sort={sort} onChange={setSort} />

      <div className="flex flex-col gap-3">
        {sortPositions(rows, pf, sort).map((row) => (
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

const CORPORATE_ACTION_KIND: Record<string, string> = {
  bonus: "أسهم مجانية",
  split: "تجزئة",
  reverse_split: "تجميع أسهم",
  merger: "اندماج",
  rights: "اكتتاب (حقوق أولوية)",
};

type HoldingLevels = {
  shares: number;
  avgCost: number;
  stop: number | null;
  target: number | null;
};
type CorporateActionRecord = {
  code: string;
  lastBefore: string;
  status: "applied" | "pending" | "undone";
  factor: number;
  kind: string | null;
  summary: string | null;
  sourceUrl: string | null;
  confirmedBy: "research" | "prices" | null;
  levelsOnly?: boolean;
  before: HoldingLevels;
  after?: HoldingLevels;
  at: string;
  dismissedAt?: string;
};

/** EGX's session closes at 14:30 Cairo, Sunday to Thursday. */
const SESSION_CLOSE_MINUTE = 14 * 60 + 30;
const cairoParts = (ms: number) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: cairoDay(ms),
    weekday: get("weekday"),
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
};
const isSessionDay = (weekday: string) => weekday !== "Fri" && weekday !== "Sat";

/**
 * An applied notice is news for the session it lands in: it stays on the card
 * until that session closes — the first 14:30 Cairo close on a trading day
 * after it was applied — unless the user presses "تمام" before then.
 */
function appliedNoticeExpired(at: string, now = Date.now()): boolean {
  const appliedAt = Date.parse(at);
  if (!Number.isFinite(appliedAt)) return true;
  const applied = cairoParts(appliedAt);
  let closeDay = applied.day;
  if (!isSessionDay(applied.weekday) || applied.minute >= SESSION_CLOSE_MINUTE) {
    // Walk forward a day at a time (from noon, clear of any DST shift) to the next trading day.
    let probe = Date.parse(`${applied.day}T12:00:00Z`);
    do {
      probe += 86_400_000;
    } while (!isSessionDay(cairoParts(probe).weekday));
    closeDay = cairoDay(probe);
  }
  const current = cairoParts(now);
  return (
    current.day > closeDay || (current.day === closeDay && current.minute >= SESSION_CLOSE_MINUTE)
  );
}

/**
 * A bonus issue, split or merger the backend found on this holding (see
 * backend/src/corporateActions.js): what it changed — or, when
 * the ratio couldn't be confirmed, the suggested numbers to apply by hand.
 */
function CorporateActionNotice({ code }: { code: string }) {
  const { pf, reload } = useDesk();
  const [busy, setBusy] = useState(false);
  const records: CorporateActionRecord[] = pf?.corporateActions ?? [];
  const record = [...records]
    .reverse()
    .find(
      (r) =>
        r.code === code &&
        !r.dismissedAt &&
        (r.status === "pending" || (r.status === "applied" && !appliedNoticeExpired(r.at))),
    );
  if (!record) return null;

  const act = async (action: "apply" | "dismiss", done: string) => {
    setBusy(true);
    try {
      await post("/api/portfolio/corporate-action", {
        code,
        lastBefore: record.lastBefore,
        action,
      });
      toast.success(done);
      void reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر تنفيذ الطلب");
    } finally {
      setBusy(false);
    }
  };

  const kind = (record.kind && CORPORATE_ACTION_KIND[record.kind]) || "تعديل في عدد أسهم الشركة";
  const ratio = Number(record.factor).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const suggestedShares = Math.max(1, Math.round(record.before.shares * record.factor));
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <div
      dir="rtl"
      onClick={stop}
      onKeyDown={stop}
      className="mt-3 cursor-default rounded-lg border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-right text-[12.5px] leading-relaxed"
    >
      {record.status === "applied" && record.after && record.levelsOnly ? (
        <p>
          <span className="font-medium">{kind} — الوقف والهدف اتعدّلوا على السعر الجديد</span>
          <br />
          <span className="text-muted-foreground">
            السعر نزل بنسبة الأسهم الجديدة ({ratio} سهم لكل سهم) مش بحركة السوق، فالوقف{" "}
            <span className="num">{fmt(record.before.stop)}</span> بقى{" "}
            <span className="num">{fmt(record.after.stop)}</span> — مش كسر وقف.
          </span>
        </p>
      ) : record.status === "applied" && record.after ? (
        <p>
          <span className="font-medium">
            {kind} — اتحدّث عدد الأسهم تلقائيًا:{" "}
            <span className="num">{int(record.before.shares)}</span> ←{" "}
            <span className="num">{int(record.after.shares)}</span> سهم
          </span>
          <br />
          <span className="text-muted-foreground">
            النسبة <span className="num">{ratio}</span> سهم لكل سهم، ومتوسط الشراء{" "}
            <span className="num">{fmt(record.before.avgCost)}</span> ←{" "}
            <span className="num">{fmt(record.after.avgCost)}</span> — قيمة الشراء زي ما هي.
            {record.confirmedBy === "prices" &&
              " النسبة محسوبة من الأسعار، راجع العدد مع شركة السمسرة."}
          </span>
          {record.summary && (
            <>
              <br />
              <span className="text-muted-foreground">{record.summary}</span>
            </>
          )}
        </p>
      ) : (
        <p>
          <span className="font-medium">
            سعر {code} اتعدّل بنسبة حوالي <span className="num">{ratio}</span> — غالبًا {kind}
          </span>
          <br />
          <span className="text-muted-foreground">
            {record.kind === "rights"
              ? "لو اكتتبت في الزيادة سجّل الأسهم الجديدة كصفقة شراء. "
              : `لو شركة السمسرة زودت أسهمك، عددك هيبقى حوالي ${int(suggestedShares)} سهم. `}
            {record.summary}
          </span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {record.status !== "applied" && record.kind !== "rights" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act("apply", "اتحدّث عدد الأسهم")}
          >
            حدّث العدد
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("dismiss", "تمام")}>
          {record.status === "applied" ? "تمام" : "تجاهل"}
        </Button>
      </div>
    </div>
  );
}

type Scenario = { trigger: string; levels: string; assumptions: string };

const SCENARIO_ROWS = [
  { key: "bull", label: "لو طلع", className: "text-up" },
  { key: "base", label: "الأرجح", className: "text-foreground" },
  { key: "bear", label: "لو كسر", className: "text-down" },
] as const;

/**
 * The verdict's bull / base / bear cases, folded away under the order so the
 * card still reads as one decision first. Absent on a verdict written without
 * a review (a quiet hold), and on one saved before scenarios existed.
 */
function VerdictScenarios({ scenarios }: { scenarios: Partial<Record<"bull" | "base" | "bear", Scenario>> }) {
  const rows = SCENARIO_ROWS.filter((row) => scenarios[row.key]);
  if (!rows.length) return null;
  return (
    // The whole card opens the stock page on click and on Enter/Space; stop
    // both here so unfolding the scenarios doesn't navigate away.
    <details
      dir="rtl"
      className="mt-2 border-t pt-2 text-right"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <summary className="cursor-pointer text-[12.5px] font-semibold text-muted-foreground">
        السيناريوهات
      </summary>
      <ul className="mt-1.5 space-y-2 text-[12.5px]">
        {rows.map(({ key, label, className }) => {
          const s = scenarios[key]!;
          return (
            <li key={key}>
              <span className={cn("font-semibold", className)}>{label}: </span>
              {s.trigger}
              <div className="text-muted-foreground">
                {s.levels} — {s.assumptions}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
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
  // Suspended: the rule-book call and any AI verdict wait until it trades again.
  const halted = Boolean(row.halted);
  const critical = !halted && p.stopBreached;
  const near =
    !halted && !critical && (p.distanceToStopPct ?? 99) <= STYLE_RULES[style].nearStopPct;
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
    verdictChanged,
    loading: reviewLoading,
    error: reviewError,
    request: requestReview,
  } = useStockReview(row.code, style, positionKeyOf(p.shares, p.avgCost), row.price);
  const staleReason = verdict
    ? (verdictChanged ??
      verdictStaleReason(verdictPrice, row.price, p.stop, [primaryTarget, p.reachedTarget?.price]))
    : null;
  // A verdict stays on the card until the next request, so it can be from an
  // earlier day — or written before a trade or style change, which the batch
  // treats like one from an earlier day.
  const verdictIsToday = isFromToday(verdictAt) && !verdictChanged;
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
    if (verdictIsToday || reviewLoading || halted) {
      onBatchSettled(row.code);
      return;
    }
    void requestReview(false).finally(() => onBatchSettled(row.code));
  }, [batchId, verdictIsToday, reviewLoading, halted, requestReview, onBatchSettled, row.code]);

  // The AI analyst's own verdict — see backend/src/agent/schemas.js — takes
  // over the badge and recommendation box when one has been fetched for this
  // stock; the mechanical rec above stays the fallback (and still drives
  // critical/near, which are the engine's own triggers, not the AI's opinion).
  // A suspended stock's badge says so, but its last verdict still stays in
  // the box until a new one is requested.
  const shownVerdict = verdict;
  // Written about a position, style or price that no longer holds — still
  // shown, but marked old everywhere it appears so it isn't read as today's call.
  const verdictIsStale = Boolean(shownVerdict && !halted && staleReason);
  // No recommendation yet, or only one from an earlier day: the button offers today's.
  const offerToday = !halted && !isFromToday(verdictAt);
  // Outdated can mean a big move or a trade since this morning's verdict, not
  // just an earlier day's — only the latter is "not today's".
  const staleLabel = isFromToday(verdictAt) ? "محتاجة تحديث" : "قديمة";
  const badgeLabel =
    shownVerdict && !halted
      ? (AI_ACTION_LABEL[shownVerdict.action] ?? shownVerdict.action)
      : rec.label;
  const badgeTone =
    shownVerdict && !halted
      ? (AI_ACTION_TONE[shownVerdict.action] ?? AI_ACTION_TONE["hold"])
      : (REC_TONE[rec.action] ?? REC_TONE["hold"]);

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
              {verdictIsStale && ` · ${staleLabel}`}
            </Badge>
            {shownVerdict?.conviction && !halted && (
              <span className="text-[11px] text-muted-foreground">
                ثقة {shownVerdict.conviction}
              </span>
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
          </div>
          {/* Name, holding and indices each get their own line: a long Arabic
              company name used to push the share count and cost off the end. */}
          <p className="mt-1 text-[12.5px] leading-snug text-foreground/80">{row.name}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            <span className="num">{int(p.shares)}</span> سهم بمتوسط <span className="num">{fmt(p.avgCost)}</span>
          </p>
          {memberOf.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
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
          )}
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

      <CorporateActionNotice code={row.code} />

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
          sub={pct(p.unrealizedPct)}
        />
        <Stat
          label="للوقف"
          value={pct(p.distanceToStopPct)}
          valueClassName={(p.distanceToStopPct ?? 99) <= 3 ? "text-down" : ""}
        />
        <Stat
          label="للهدف"
          value={pct(p.distanceToTargetPct)}
        />
      </div>

      <div className={cn("mt-3 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed", badgeTone)}>
        {shownVerdict ? (
          // The decision, then the order (or the level to watch on a hold),
          // each shown in full: clamped to two lines, a narrow phone screen
          // cut the order off mid-sentence.
          <>
            <p dir="rtl" className="text-right">
              {verdictIsStale && (
                <>
                  <span className="font-semibold text-warn">
                    {isFromToday(verdictAt)
                      ? "توصية النهارده — بس محتاجة تحديث"
                      : `توصية قديمة${verdictAt != null ? ` (${arDay(cairoDay(verdictAt))})` : ""} — مش توصية النهارده`}
                  </span>
                  {staleReason && <StaleVerdictHint reason={staleReason} fromToday={isFromToday(verdictAt)} />}
                  <br />
                </>
              )}
              <span className="font-medium">{shownVerdict.headline}</span>
              {(shownVerdict.orderInstruction ?? shownVerdict.invalidation) && (
                <>
                  <br />
                  <span className="text-muted-foreground">{shownVerdict.orderInstruction ?? shownVerdict.invalidation}</span>
                </>
              )}
              {shownVerdict.reentryPlan && (
                <>
                  <br />
                  <span className="text-muted-foreground">
                    <span className="font-medium">الرجوع: </span>
                    {shownVerdict.reentryPlan}
                    {" "}أي دخول جديد يحتاج نسبة مخاطرة/عائد ≥ {STYLE_RULES[style].entry.minRiskReward} وموافقة القاعدة R6.
                  </span>
                </>
              )}
            </p>
            {shownVerdict.scenarios && <VerdictScenarios scenarios={shownVerdict.scenarios} />}
          </>
        ) : (
          <>
            <span className="text-muted-foreground">
              {!row.asOf || row.asOf === cairoDay(Date.now()) ? (
                "توصية اليوم"
              ) : (
                <span className="font-medium text-down">توصية قديمة</span>
              )}
              {row.asOf && ` (${arDay(row.asOf)})`} ·{" "}
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

      {shownVerdict && halted ? (
        <p dir="rtl" className="mt-2 text-right text-[12px] leading-relaxed text-warn">
          ⚠️ دي آخر توصية قبل إيقاف السهم عن التداول — اطلب توصية جديدة أول ما التداول يرجع.
        </p>
      ) : (
        staleReason && (
          <p dir="rtl" className="mt-2 text-right text-[12px] leading-relaxed text-warn">
            ⚠️ التوصية دي {staleLabel}: {staleReason}. عشان كده ممكن تختلف عن توصية «تحليل السوق»، اللي
            بتتحسب على السعر الحالي. اطلب توصية جديدة قبل ما تتصرف عليها.
          </p>
        )
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
            // Filled while today's recommendation is still on offer — none yet,
            // or only an earlier day's — so it stands out on the card each new
            // day; once today's is asked for it drops to the quiet outline style.
            variant={offerToday ? "default" : "outline"}
            size="sm"
            className={cn(offerToday && "font-semibold shadow-sm")}
            disabled={halted || reviewLoading || (!isAdmin && recommendationsExhausted)}
            title={
              halted ? "السهم موقوف عن التداول — التوصية هتتاح أول ما التداول يرجع" : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              setConfirmReviewOpen(true);
            }}
          >
            {reviewLoading ? <Spinner /> : offerToday && <Sparkles className="size-4" />}
            {halted ? "موقوف عن التداول" : offerToday ? "قولي توصية اليوم" : "توصية جديدة"}
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
