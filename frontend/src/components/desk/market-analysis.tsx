import { ChevronLeft, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  Spinner,
} from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError, api, post } from "@/lib/api";
import { fmt, int, pct } from "@/lib/format";
import {
  INVEST_STYLES,
  styleRecommendation,
  useActiveInvestStyle,
  type StyleKey,
} from "@/lib/invest-style";
import { searchStocks } from "@/lib/stock-search";
import { applyQuote, useDesk } from "@/lib/store";
import { mergedTarget } from "@/lib/targets";
import { cn } from "@/lib/utils";

const INDEX_OPTIONS = [
  { value: "ALL", label: "الكل" },
  { value: "EGX30", label: "EGX30" },
  { value: "EGX70", label: "EGX70" },
  { value: "EGX33", label: "EGX33" },
  { value: "EGX100", label: "EGX100" },
];

/** Mirrors the /api/scan response shape, kept loose like the rest of the desk types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScanRow = any;

// A held stock shows the same position recommendation as its card on the
// portfolio page — not the raw technical-score signal, which is a verdict for
// someone deciding whether to enter and would contradict that card.
const HELD_TONE: Record<string, string> = { buy_more: "buy", hold: "avoid" };

const action = (row: ScanRow, style: StyleKey) => {
  if (row.position) {
    const rec = styleRecommendation(row, row.position, style);
    return { label: `موجود عندك · ${rec.label}`, tone: HELD_TONE[rec.action] ?? "wait" };
  }
  if (row.worthBuyingNow) return { label: "فرصة قابلة للتنفيذ الآن", tone: "buy" };
  if (row.entryStatus === "limit_pullback") return { label: "استنى تصحيح وأمر محدد", tone: "wait" };
  if (row.entryStatus === "too_extended") return { label: "ممتد — لا تطارد السعر", tone: "wait" };
  return { label: row.signal?.ar ?? "استنى", tone: "avoid" };
};

/** The fundamental (investment) score, or null when the screener has no company figures to build one from. */
const fundamentalScore = (row: ScanRow): number | null =>
  row.classification?.hasFundamentals && row.classification.investmentScore != null
    ? row.classification.investmentScore
    : null;

/**
 * How far the stock's target sits from the price shown — the nearer target
 * when the two are really one (see mergedTarget), else the mid-term one —
 * measured from the live price, not the close the target was drawn off.
 */
const potentialMove = (row: ScanRow): { pct: number; horizon: string } | null => {
  const target = mergedTarget(row.midTarget, row.longTarget) ?? row.midTarget;
  if (!target?.price || !row.price) return null;
  return { pct: ((target.price - row.price) / row.price) * 100, horizon: target.horizon?.ar ?? "" };
};

const STRONGEST_COUNT = 5;

/** What each style ranks stocks by — mirrors STYLE_STRENGTH_WEIGHTS in backend/src/api/server.js. */
const STYLE_BASIS: Record<StyleKey, string> = {
  trader: "أسهم المضاربة: قوة الحركة الفنية مع السيولة والزخم وحجم التداول",
  medium: "أسهم لحركة أسابيع لشهور: قوة فنية وشركة سليمة أساسيًا بنفس الوزن",
  long: "أسهم الاستثمار: قوة الشركة أساسيًا أولًا، ثم الاتجاه الفني",
};

/** Technical score, fundamental score and potential move, side by side — plus the trading score for a trader. */
function StockFigures({ row, style, className }: { row: ScanRow; style: StyleKey; className?: string }) {
  const fundamental = fundamentalScore(row);
  const move = potentialMove(row);
  const trading = style === "trader" ? row.classification?.speculationScore : null;
  const cell = "rounded-md border bg-surface px-2.5 py-1.5";
  const label = "text-[11px] text-muted-foreground";
  return (
    <div
      className={cn(
        "grid gap-2 text-[12.5px]",
        trading != null ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
        className,
      )}
    >
      {trading != null && (
        <div className={cell}>
          <div className={label}>قوة المضاربة</div>
          <div className="num font-semibold">{int(Math.round(trading))}/100</div>
        </div>
      )}
      <div className={cell}>
        <div className={label}>التحليل الفني</div>
        <div className="num font-semibold">{row.score != null ? `${int(row.score)}/100` : "—"}</div>
      </div>
      <div className={cell}>
        <div className={label}>التحليل الأساسي</div>
        <div className="num font-semibold">{fundamental != null ? `${int(Math.round(fundamental))}/100` : "—"}</div>
      </div>
      <div className={cell}>
        <div className={label}>الحركة المتوقعة</div>
        <div className={cn("num font-semibold", move && move.pct > 0 && "text-up")}>
          {move ? pct(Math.round(move.pct * 10) / 10) : "—"}
        </div>
        {move?.horizon && <div className="truncate text-[10.5px] text-muted-foreground">{move.horizon}</div>}
      </div>
    </div>
  );
}

const toneClass: Record<string, string> = {
  buy: "border-up/40 bg-up-soft text-up",
  wait: "border-warn/40 bg-warn-soft text-foreground",
  avoid: "border-border bg-surface text-muted-foreground",
};

/** backend/src/agent/schemas.js CashPlanReviewSchema — judgement only, every number stays the scan's. */
type CashPick = {
  code: string;
  action: string;
  conviction: string;
  comment: string;
  // Absent on a review cached before these fields existed.
  portfolioFit?: string;
  watchFor: string;
};
/** backend/src/scoring/behavior.js behaviorProfile — the subset shown here. */
type BehaviorStats = {
  tradesCount: number;
  sells: number;
  avgHoldDays: number | null;
  winRatePct: number | null;
  averagingDownBuys: number;
  avgCashPct: number | null;
};
type CashReview = {
  stance: string;
  headline: string;
  marketRead: string;
  portfolioRead?: string;
  behaviorRead?: string;
  deploymentPlan: string;
  picks: CashPick[];
  reserveAdvice: string;
  risks: string[];
  topPriority: string;
  _meta?: { behavior?: BehaviorStats };
};

const PICK_ACTION: Record<string, { label: string; tone: string }> = {
  buy_now: { label: "اشتري دلوقتي", tone: "buy" },
  buy_on_pullback: { label: "اشتري على تصحيح", tone: "wait" },
  wait: { label: "استنى", tone: "wait" },
  skip: { label: "سيبه", tone: "avoid" },
};

// Same cadence as the per-stock review on the portfolio page: the status
// endpoint already long-polls, so this is only the gap between requests.
const CASH_REVIEW_POLL_MS = 1000;
const CASH_REVIEW_MAX_WAIT_MS = 10 * 60 * 1000;

// Without a search the list is every stock the scan covers, so an index tab
// shows all of its members. A search shows the best matches, capped so a
// one-letter query doesn't render the whole bourse.
const MAX_SEARCH_RESULTS = 30;

/**
 * Market / cash-allocation scan, same /api/scan payload as before. Renders the
 * body only — the market page and the cash dialog each supply their own frame,
 * and mount this on open, so every visit starts from a fresh scan and search.
 */
export function MarketAnalysis({ focus }: { focus: "market" | "cash" }) {
  const {
    openDetail,
    universe,
    pf,
    reloadPortfolio,
    aiAvailable,
    refreshUser,
    quotes,
    watchQuotes,
  } = useDesk();
  const [data, setData] = useState<ScanRow>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState("ALL");
  const [search, setSearch] = useState("");
  const { style, auto } = useActiveInvestStyle(pf?.trades);
  const [review, setReview] = useState<CashReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // The invest style can still change once the portfolio loads (a saved one is
  // adopted then), and every change re-runs the whole-universe scan — so on a
  // page opened cold, hold the scan until it is known rather than run it twice.
  const portfolioReady = Boolean(pf);

  useEffect(() => {
    if (!portfolioReady) return;
    let cancelled = false;
    setData(null);
    setError(null);
    const params = new URLSearchParams();
    // Always sent explicitly (not just for "cash") — the backend meters
    // opening either tab against that account's monthly tier allowance (see
    // TIERS in backend/src/billing/plans.js), keyed off this exact value.
    params.set("focus", focus);
    if (index !== "ALL") params.set("index", index);
    // Same rules the position-level recommendation already uses per style —
    // which setups clear the risk/reward bar, and how big a position sizes
    // to, both shift with it. See backend/src/config/styles.js.
    params.set("style", style);
    const qs = params.toString();
    api(`/api/scan${qs ? `?${qs}` : ""}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        // Picks up the updated allowance counts (cashScansLeft/
        // marketAnalysisLeft) shown elsewhere without waiting for its own
        // next portfolio load.
        void reloadPortfolio();
      })
      .catch((caught) => !cancelled && setError(caught?.message ?? "تعذر تحليل السوق"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, index, style, portfolioReady]);

  // The AI read on the plan, asked only once this scan has loaded — the scan
  // is what opens (or joins) the trial's cash-scan use the review rides on.
  // Cached server-side per day, portfolio, style and index, so reopening the
  // dialog on an unchanged book doesn't ask the model again.
  const cashToReview =
    focus === "cash" && aiAvailable && Boolean(data) && (data.cash ?? 0) > 0;
  useEffect(() => {
    setReview(null);
    if (!cashToReview) {
      setReviewLoading(false);
      return;
    }
    let cancelled = false;
    setReviewLoading(true);
    (async () => {
      try {
        let res = await post("/api/review/cash", { style, styleAuto: auto, index });
        const giveUpAt = Date.now() + CASH_REVIEW_MAX_WAIT_MS;
        while (!cancelled && res?.status === "running") {
          if (Date.now() > giveUpAt)
            throw new Error(
              "مراجعة الكاش أخدت وقت أطول من المتوقع — جرّب تاني بعد شوية.",
            );
          await new Promise((resolve) => setTimeout(resolve, CASH_REVIEW_POLL_MS));
          if (cancelled) return;
          res = await api(
            `/api/review/cash/status?style=${style}&index=${encodeURIComponent(index)}`,
          );
        }
        if (!cancelled) setReview(res?.review ?? null);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 402) {
          await refreshUser();
          return;
        }
        // Only the per-stock pick badges depend on this — no dedicated error UI,
        // they just stay absent, same as when aiAvailable is false.
        console.warn("cash review failed:", caught instanceof Error ? caught.message : caught);
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `data` changes once per finished scan, which is exactly when to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cashToReview]);

  // Keep this scan's stocks on the desk's shared price poll, so each one shows
  // the same live price here as on the portfolio page, updated on the same tick.
  const scannedCodes = (data?.results ?? []).map((row: ScanRow) => row.code).join(",");
  useEffect(
    () => (scannedCodes ? watchQuotes(scannedCodes.split(",")) : undefined),
    [scannedCodes, watchQuotes],
  );

  const isCash = focus === "cash";
  const pickByCode = new Map((review?.picks ?? []).map((pick) => [pick.code, pick]));
  const rows = (data?.results ?? [])
    .map((row: ScanRow) => applyQuote(row, quotes[row.code]))
    .sort(
      (a: ScanRow, b: ScanRow) =>
        (b.worthBuyingNow ? 1 : 0) - (a.worthBuyingNow ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0),
    );
  const actionable = rows.filter((row: ScanRow) => row.worthBuyingNow).length;
  const held = rows.filter((row: ScanRow) => row.position).length;

  // Stocks the scan couldn't analyse (no usable price history) come back in
  // `errors` instead of `results`. They are listed apart below, so an index
  // never looks like it has fewer members than it does without saying why.
  const failed: { code: string; error?: string }[] = data?.errors ?? [];
  const nameOf = (code: string) => {
    const stock = universe.find((item) => item.code === code);
    return stock?.ar || stock?.en || code;
  };

  // Search runs over the whole universe, not just this scan's rows: the list
  // follows the index tab, so a stock outside it would otherwise be
  // unreachable. Hits the scan has a row for get the full card; the rest
  // (another index, or nothing to analyse yet) still open the same detail
  // dialog, which analyses on demand.
  const query = search.trim();
  const searching = !isCash && query !== "";
  const matches = useMemo(
    () => (searching ? searchStocks(universe, query) : []),
    [searching, universe, query],
  );
  const hits = matches.slice(0, MAX_SEARCH_RESULTS);
  const rowByCode = new Map<string, ScanRow>(rows.map((row: ScanRow) => [row.code, row]));
  const shown: ScanRow[] = searching
    ? hits.flatMap((stock) => rowByCode.get(stock.code) ?? [])
    : isCash
      ? rows.filter((row: ScanRow) => row.cashPlanSelected)
      : rows;
  const unscanned = searching ? hits.filter((stock) => !rowByCode.has(stock.code)) : [];

  // The market's strongest stocks, beside the cash plan and independent of it:
  // no cash, sector or sizing limit applies — only that both analyses exist
  // (the server leaves styleStrength null for a stock with no fundamental
  // data) and that it is trading. Ranked by the same style-weighted strength
  // the cash plan picks by — see styleStrength in backend/src/api/server.js.
  const strongest: ScanRow[] = isCash
    ? rows
        .filter((row: ScanRow) => !row.halted && row.styleStrength != null)
        .sort((a: ScanRow, b: ScanRow) => b.styleStrength - a.styleStrength)
        .slice(0, STRONGEST_COUNT)
    : [];

  // Every stock card opens the same per-stock analysis the portfolio does.
  const openable = (code: string) => ({
    role: "button" as const,
    tabIndex: 0,
    onClick: () => openDetail(code),
    onKeyDown: (event: React.KeyboardEvent) => {
      // Ignore keys that bubble up from anything focusable inside the card.
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail(code);
      }
    },
  });
  const openableClass =
    "cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {isCash
          ? `${STYLE_BASIS[style]} — بتوزيع مرجّح حسب قوة كل فرصة واحتياطي ${fmt(data?.cashPlan?.reserveCash ?? 0)} ج.`
          : `ترتيب الأسهم حسب التقييم والفرص القابلة للتنفيذ${index !== "ALL" ? ` — أسهم ${index} بس` : ""}.`}{" "}
        حسب أسلوبك: {INVEST_STYLES.find((s) => s.key === style)?.label ?? "متوسط المدى"}
        {auto ? " (مستنتج من سلوكك في التداول)" : ""}.
      </p>

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

      {!isCash && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث عن أي سهم بالكود أو الاسم…"
            aria-label="بحث عن سهم"
            autoComplete="off"
            enterKeyHint="search"
            className="ps-9"
          />
        </div>
      )}

      {error && <ErrorState message={error} />}
      {!data && !error && (
        <div className="space-y-3">
          <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Spinner />
            {isCash ? "جاري تحليل استخدام الكاش…" : "جاري تحليل السوق…"}
          </p>
          <LoadingBlock rows={4} />
        </div>
      )}

      {(data || searching) && (
        <>
          {data && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border bg-surface px-4 py-3 text-[12.5px]">
              <span>
                الكاش المتاح: <b className="num">{int(data.cash ?? 0)} ج</b>
              </span>
              {isCash ? (
                <>
                  <span>
                    القابل للتوزيع:{" "}
                    <b className="num">{int(data.cashPlan?.investableCash ?? 0)} ج</b>
                  </span>
                  <span>
                    متوسط لكل سهم:{" "}
                    <b className="num">{int(data.cashPlan?.allocationPerStock ?? 0)} ج</b>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    الأسهم: <b className="num">{rows.length}</b>
                    {failed.length > 0 && (
                      <span className="text-muted-foreground"> (+{failed.length} بدون بيانات)</span>
                    )}
                  </span>
                  <span>
                    فرص الآن: <b className="text-up">{actionable}</b>
                  </span>
                </>
              )}
              <span>
                مراكزك: <b>{held}</b>
              </span>
              <span className="text-muted-foreground">آخر تحديث: {data.asOf ?? "—"}</span>
            </div>
          )}

          <div className={cn(isCash ? "space-y-3" : "grid gap-3 md:grid-cols-2")}>
            {isCash && data && shown.length === 0 && (
              <Notice tone="info">
                مفيش سهم دلوقتي مستوفي شروط خطة الكاش: فرصة قابلة للتنفيذ فنيًا ومعاها بيانات أساسية
                للشركة. جرّب مؤشر تاني أو ارجع بعد جلسة.
              </Notice>
            )}
            {shown.map((row: ScanRow) => {
              const state = action(row, style);
              return (
                <div
                  key={row.code}
                  {...openable(row.code)}
                  className={cn(
                    "rounded-lg border p-4",
                    row.position ? "bg-surface" : "bg-card",
                    openableClass,
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{row.code}</div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {row.name} · {row.sector}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <div className="num text-end text-[15px] font-semibold">
                        {row.score ?? "—"}
                        <span className="text-[11px] font-normal text-muted-foreground">
                          /100
                        </span>
                      </div>
                      <ChevronLeft className="size-4 text-muted-foreground" aria-hidden />
                    </div>
                  </div>

                  <div className="num mt-2 text-[12px] text-muted-foreground">
                    {/* A held stock's stop is its open position's live (ratcheted) one — the
                        same number the stock page shows — not the fresh-entry plan stop. */}
                    السعر {fmt(row.price)} · وقف {fmt(row.position?.stop ?? row.stop)}
                  </div>

                  <Badge variant="outline" className={cn("mt-2.5", toneClass[state.tone])}>
                    {state.label}
                  </Badge>

                  {isCash && <StockFigures row={row} style={style} className="mt-3" />}

                  {(() => {
                    const one = mergedTarget(row.midTarget, row.longTarget);
                    return one ? (
                      <div className="mt-3">
                        <TargetBox
                          label="الهدف"
                          price={one.price ?? undefined}
                          hint={`${pct(one.upsidePct)} · ${one.horizon?.ar ?? ""}`}
                        />
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <TargetBox
                          label="هدف متوسط"
                          price={row.midTarget?.price}
                          hint={
                            row.midTarget
                              ? `${pct(row.midTarget.upsidePct)} · ${row.midTarget.horizon?.ar ?? ""}`
                              : "لا يوجد هدف صالح"
                          }
                        />
                        <TargetBox
                          label="هدف بعيد"
                          price={row.longTarget?.price}
                          hint={
                            row.longTarget?.price
                              ? `${pct(row.longTarget.upsidePct)} · ${row.longTarget.horizon?.ar ?? ""}`
                              : (row.longTarget?.note ?? "لا يوجد هدف بعيد")
                          }
                        />
                      </div>
                    );
                  })()}

                  {isCash && !row.position && row.buyPlan && (
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

                  {isCash &&
                    (() => {
                      const pick = pickByCode.get(row.code);
                      const pickAction = pick && PICK_ACTION[pick.action];
                      if (pick && pickAction) {
                        return (
                          <div className="mt-3 rounded-md border bg-surface px-3 py-2 text-[12.5px] leading-relaxed">
                            <div className="flex flex-wrap items-center gap-2">
                              <Sparkles className="size-3.5 text-primary" aria-hidden />
                              <Badge variant="outline" className={toneClass[pickAction.tone]}>
                                {pickAction.label}
                              </Badge>
                              <span className="text-muted-foreground">ثقة {pick.conviction}</span>
                            </div>
                            <p className="mt-1.5">{pick.comment}</p>
                            {pick.portfolioFit && (
                              <p className="mt-1">
                                <span className="text-muted-foreground">مع محفظتك: </span>
                                {pick.portfolioFit}
                              </p>
                            )}
                            <p className="mt-1 text-muted-foreground">راقب: {pick.watchFor}</p>
                          </div>
                        );
                      }
                      if (reviewLoading) {
                        return (
                          <p
                            role="status"
                            className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground"
                          >
                            <Spinner />
                            جاري تحليل الفرصة بالذكاء الاصطناعي…
                          </p>
                        );
                      }
                      return null;
                    })()}
                </div>
              );
            })}

            {unscanned.map((stock) => (
              <div
                key={stock.code}
                {...openable(stock.code)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border bg-card p-4",
                  openableClass,
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold">{stock.code}</div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {stock.ar || stock.en}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
                  التحليل الكامل
                  <ChevronLeft className="size-4" aria-hidden />
                </span>
              </div>
            ))}

            {searching && hits.length === 0 && (
              <div className="md:col-span-2">
                <EmptyState
                  title="مفيش سهم بالاسم ده."
                  hint="جرّب كود السهم أو جزء من اسمه بالعربي أو الإنجليزي."
                />
              </div>
            )}
            {searching && matches.length > hits.length && (
              <p className="text-center text-[12px] text-muted-foreground md:col-span-2">
                معروض أول {MAX_SEARCH_RESULTS} نتيجة من {matches.length} — اكتب أكتر عشان تضيّق
                البحث.
              </p>
            )}
            {!searching && !isCash && failed.length > 0 && (
              <details className="rounded-lg border bg-surface md:col-span-2">
                <summary className="cursor-pointer px-4 py-3 text-[12.5px] font-semibold">
                  {failed.length} سهم مفيش لها بيانات كافية للتحليل دلوقتي
                </summary>
                <ul className="divide-y border-t text-[12.5px]">
                  {failed.map((item) => (
                    <li key={item.code} className="px-4 py-2.5">
                      <span className="font-semibold">{item.code}</span>
                      <span className="text-muted-foreground"> · {nameOf(item.code)}</span>
                      {item.error && (
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {item.error}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {strongest.length > 0 && (
            <section className="space-y-2.5 border-t pt-4" aria-label="أقوى الأسهم في السوق">
              <div>
                <h3 className="text-[14px] font-semibold">أقوى الأسهم في السوق دلوقتي</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  أعلى {int(strongest.length)} أسهم حسب أسلوب محفظتك — {STYLE_BASIS[style]} — بغض النظر
                  عن الكاش وحدود القطاعات. قوة السهم مش معناها إن ده وقت الشراء — شوف حالة كل سهم.
                </p>
              </div>
              {strongest.map((row: ScanRow) => {
                const state = action(row, style);
                return (
                  <div
                    key={row.code}
                    {...openable(row.code)}
                    className={cn("rounded-lg border bg-card p-3", openableClass)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{row.code}</span>
                          {row.cashPlanSelected && (
                            <Badge variant="outline" className="text-[10.5px]">
                              ضمن خطة الكاش
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-[12px] text-muted-foreground">
                          {row.name} · {row.sector}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="num text-[12px] text-muted-foreground">السعر {fmt(row.price)}</span>
                        <ChevronLeft className="size-4 text-muted-foreground" aria-hidden />
                      </div>
                    </div>
                    <StockFigures row={row} style={style} className="mt-2.5" />
                    <Badge variant="outline" className={cn("mt-2.5", toneClass[state.tone])}>
                      {state.label}
                    </Badge>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
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
