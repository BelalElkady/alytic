import { createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StockPicker } from "@/components/desk/stock-picker";
import { EmptyState, Notice, Panel, Spinner, Stat } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, post } from "@/lib/api";
import { fmt, int, pct, tone } from "@/lib/format";
import { INVEST_STYLES, STYLE_RULES, useActiveInvestStyle } from "@/lib/invest-style";
import { siteUrl, siteName } from "@/lib/seo";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/_app/cash")({
  head: ({ matches }) => ({
    meta: [
      { title: `تحليل الكاش والأسهم المفضلة — ${siteName(matches)}` },
      {
        name: "description",
        content: "إدارة الكاش المتاح ونسبته من رأس المال، ومتابعة سعر وتغيّر الأسهم المفضلة عندك.",
      },
      { property: "og:title", content: `تحليل الكاش والأسهم المفضلة — ${siteName(matches)}` },
      {
        property: "og:description",
        content: "إدارة الكاش المتاح ونسبته من رأس المال، ومتابعة سعر وتغيّر الأسهم المفضلة عندك.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${siteUrl(matches)}/cash` },
    ],
  }),
  component: CashPage,
});

type FavoriteRow = {
  code: string;
  name?: string;
  sector?: string;
  price?: number;
  changePct?: number | null;
  score?: number;
  signal?: { ar?: string };
};

// These mirror what backend/src/api/server.js (runScan) and config/rules.js
// actually do, so the explanation below can't promise more than the plan
// delivers. The per-style numbers (risk per trade, max position, minimum
// reward/risk) are read live from STYLE_RULES instead of being copied here.
const CASH_RESERVE_PCT = 5; // sizing.minCashBufferPct — held back from the cash before anything is spread
const MAX_PICKS = 6; // MAX_RECOMMENDATIONS in runScan
const MIN_TICKET_EGP = 5000; // MIN_TICKET_EGP in runScan — fewer names when the cash is small
const MAX_SECTOR_PCT = 30; // sizing.maxSectorPct
const MAX_DAILY_TURNOVER_PCT = 10; // liquidity.maxPositionVsDailyTurnover

/**
 * A plain-language account of exactly what "حلل استخدام الكاش" does, from the
 * cash you type in to the plan it hands back, and — as importantly — what it
 * does not do. Collapsed by default so it doesn't crowd the page, but sits
 * right under the button it explains. A native <details> keeps it keyboard-
 * and screen-reader-accessible without another dependency.
 */
function CashAnalysisExplainer() {
  const { pf } = useDesk();
  const { style } = useActiveInvestStyle(pf?.trades);
  const rules = STYLE_RULES[style];
  const styleLabel = INVEST_STYLES.find((item) => item.key === style)?.label ?? "متوسط المدى";

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: "بيسيب احتياطي",
      body: (
        <>
          بيحجز <b className="num">{CASH_RESERVE_PCT}%</b> من الكاش المسجّل عندك كاحتياطي مبيتوزّعش. الباقي هو
          اللي بيتحلل ويتوزّع.
        </>
      ),
    },
    {
      title: "بيفحص الأسهم",
      body: "بيحلل فنيًا كل الأسهم اللي التطبيق بيتابعها (أو مؤشر واحد لو اخترته من الأزرار فوق): الاتجاه والزخم والدعم والمقاومة والسيولة، ويدي كل سهم تقييم من 100. أسهمك الحالية بتدخل الحساب كمان، بس عشان يعرف كل قطاع واخد كام من محفظتك.",
    },
    {
      title: "بيستبعد اللي مش مناسب",
      body: (
        <>
          بيسيب بس الأسهم اللي: مش موجودة عندك، ودخولها مناسب دلوقتي (شراء فوري أو أمر محدد على تصحيح — مش
          سهم ممتد فات وقته)، وليها هدف واضح، والهدف بيدفع على الأقل{" "}
          <b className="num">{fmt(rules.entry.minRiskReward, 1)}</b> ضعف المخاطرة (حسب أسلوبك «{styleLabel}»)،
          وحجمها حسب القواعد أكبر من صفر.
        </>
      ),
    },
    {
      title: "بيرتّب ويختار",
      body: (
        <>
          بيرتّب المرشّحين حسب التقييم والعائد مقابل المخاطرة وقرب الوقف، ويختار لحد{" "}
          <b className="num">{MAX_PICKS}</b> أسهم — بيفضّل سهم واحد من كل قطاع عشان مايبقاش كله في حتة واحدة.
          كل ما الكاش يقل عدد الأسهم بيقل، لأنه مبيقسّمش على تذاكر أقل من حوالي{" "}
          <b className="num">{int(MIN_TICKET_EGP)} ج</b>.
        </>
      ),
    },
    {
      title: "بيوزّع الفلوس حسب قوة كل فرصة",
      body: (
        <>
          التوزيع مش بالتساوي: السهم الأقوى ياخد نصيب أكبر. وعدد أسهم كل واحد بيتحدد بأصغر حد من أربعة:
          ميزانية المخاطرة (<b className="num">{fmt(rules.sizing.riskPerTradePct, 1)}%</b> من رأس المال في
          الصفقة)، وأقصى وزن للسهم الواحد (<b className="num">{rules.sizing.maxPositionPct}%</b> من محفظتك)،
          والسيولة (مش أكتر من <b className="num">{MAX_DAILY_TURNOVER_PCT}%</b> من تداوله اليومي)، وحد القطاع (
          <b className="num">{MAX_SECTOR_PCT}%</b> من المحفظة). سهم نصيبه مايكفيش سهم واحد بيتشال، والفلوس
          بتتوزّع على الباقي.
        </>
      ),
    },
    {
      title: "بيديك خطة جاهزة لكل سهم",
      body: "سعر الدخول (بأمر محدد)، ووقف الخسارة، والهدف، وعدد الأسهم، والتكلفة، والمتبقي من الكاش بعدها، وأقصى خسارة لو الوقف اتضرب.",
    },
    {
      title: "مراجعة بالذكاء الاصطناعي (لو متاحة)",
      body: "بتقيّم الخطة نفسها ومتغيّرش فيها رقم: على كل سهم بتقولك اشتري دلوقتي / اشتري على تصحيح / استنى / سيبه، ودرجة ثقة، وتعليق، وهل بيناسب محفظتك، وإيه اللي تراقبه. كل الأرقام بتيجي من الحساب، مش من الذكاء الاصطناعي.",
    },
  ];

  return (
    <details className="group mt-4 rounded-lg border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
        تحليل الكاش بيعمل إيه بالظبط؟
        <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>

      <div className="space-y-4 border-t px-4 py-4 text-[13px] leading-relaxed">
        <p>
          بياخد الكاش المسجّل عندك ويقترحلك تشتري إيه وبكام، على أسهم مش موجودة في محفظتك. كل ده حسابات مباشرة
          على أسعار وبيانات السوق، مش تخمين.
        </p>

        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="font-semibold">{step.title}</div>
                <div className="mt-0.5 text-muted-foreground">{step.body}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2.5">
          <div className="font-semibold">اللي مبيعملوش</div>
          <ul className="mt-1 list-disc space-y-1 ps-5 text-muted-foreground">
            <li>
              مبينفّذش أي أمر ومش متوصّل بالسمسار — إنت اللي بتدخل الأمر عنده، وبعدها سجّل الصفقة من «إدخال
              يدوي» عشان الكاش والمراكز يتحدّثوا.
            </li>
            <li>بيشتغل على الكاش المسجّل هنا، فلو مش محدّثه الأرقام هتطلع غلط.</li>
            <li>مش توصية مالية مرخّصة — القرار الأخير مسؤوليتك.</li>
          </ul>
        </div>

        <p className="text-[12px] text-muted-foreground">
          فتح التحليل بيخصم محاولة من رصيدك الشهري، ولو فتحته تاني خلال 10 دقايق مبيتحسبش محاولة تانية.
        </p>
      </div>
    </details>
  );
}

function CashPage() {
  const { pf, totals, reloadPortfolio, openMarket } = useDesk();
  const [cash, setCash] = useState("");
  const [savingCash, setSavingCash] = useState(false);
  const [watchCode, setWatchCode] = useState("");
  const [watchNote, setWatchNote] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [addingWatch, setAddingWatch] = useState(false);
  const [favRows, setFavRows] = useState<Record<string, FavoriteRow>>({});
  const [favLoading, setFavLoading] = useState(false);

  useEffect(() => {
    setCash(String(pf?.cash ?? 0));
  }, [pf?.cash]);

  // From GET /api/portfolio (server-enforced) — every tier (including the
  // free trial) has a monthly allowance for this feature, see TIERS in
  // backend/src/billing/plans.js.
  const cashScansLeft = typeof pf?.cashScansLeft === "number" ? pf.cashScansLeft : null;
  const cashScansPerMonth =
    typeof pf?.cashScansPerMonth === "number" ? pf.cashScansPerMonth : null;
  const cashScanExhausted = cashScansLeft !== null && cashScansLeft <= 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the portfolio watchlist shape
  const watchlist: [string, any][] = Object.entries(pf?.watchlist ?? {});
  const watchCodes = watchlist
    .map(([code]) => code)
    .sort()
    .join(",");

  // Re-fetches price/score/signal for every favorite whenever the set changes —
  // this is what makes the list "monitor" a stock rather than just remember it.
  useEffect(() => {
    if (!watchCodes) {
      setFavRows({});
      return;
    }
    let cancelled = false;
    setFavLoading(true);
    api(`/api/scan?codes=${watchCodes}`)
      .then((result) => {
        if (cancelled) return;
        const byCode: Record<string, FavoriteRow> = {};
        for (const row of result?.results ?? []) byCode[row.code] = row;
        setFavRows(byCode);
      })
      .catch(() => {})
      .finally(() => !cancelled && setFavLoading(false));
    return () => {
      cancelled = true;
    };
  }, [watchCodes]);

  const share = totals.value + totals.cash ? (totals.cash / (totals.value + totals.cash)) * 100 : 0;
  const advice =
    totals.cash <= 0
      ? "مفيش كاش متاح حاليًا. أي شراء جديد لازم يجي من بيع جزئي لسهم مربح — ما تشتريش بالدين."
      : share < 10
        ? `الكاش ${fmt(share, 0)}% بس من المحفظة — قليل. احتفظ به كاحتياطي، وما تدخلش صفقة جديدة إلا على فرصة واضحة من أسهمك المفضلة أو تحليل السوق.`
        : share < 30
          ? `الكاش ${fmt(share, 0)}% — نسبة صحية. وزّعه: ثلث على أوامر محددة، وثلث ينتظر تصحيح المؤشر، وثلث يفضل نقدي.`
          : `الكاش ${fmt(share, 0)}% — عالي. ابدأ نشر تدريجي على 3 أسابيع بأوامر محددة. الباقي صندوق نقدي — مش فلوس نايمة، ده عائد + ذخيرة.`;

  const saveCash = async () => {
    setSavingCash(true);
    try {
      await post("/api/portfolio/cash", { cash: +cash });
      await reloadPortfolio();
      toast.success("تم تحديث الكاش");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر تحديث الكاش");
    } finally {
      setSavingCash(false);
    }
  };

  const addWatch = async () => {
    if (!watchCode) {
      setWatchError("اختار سهم من القائمة الأول.");
      return;
    }
    setAddingWatch(true);
    setWatchError(null);
    try {
      await post("/api/portfolio/watchlist", { code: watchCode, note: watchNote || null });
      await reloadPortfolio();
      setWatchCode("");
      setWatchNote("");
      toast.success("تمت الإضافة للأسهم المفضلة");
    } catch (caught) {
      setWatchError(caught instanceof Error ? caught.message : "تعذر الإضافة");
    } finally {
      setAddingWatch(false);
    }
  };

  const removeWatch = async (code: string) => {
    try {
      await post("/api/portfolio/watchlist", { code, remove: true });
      await reloadPortfolio();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحذف");
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="الكاش المتاح"
        description="حدّثه لما تحوّل فلوس أو تسحب. الصفقات اللي بتسجّلها من «إدخال يدوي» بتعدّله أوتوماتيك."
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="cash-in">المبلغ</Label>
            <Input
              id="cash-in"
              className="num"
              type="number"
              value={cash}
              onChange={(event) => setCash(event.target.value)}
            />
          </div>
          <Button onClick={() => void saveCash()} disabled={savingCash}>
            {savingCash && <Spinner />}
            حفظ
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border bg-surface p-3 sm:grid-cols-4">
          <Stat label="نسبة الكاش من الإجمالي" value={`${fmt(share, 1)}%`} />
          <Stat label="التكلفة الكلية" value={int(totals.cost)} />
          <Stat label="قيمة الأسهم" value={int(totals.value)} />
          <Stat label="إجمالي رأس المال" value={int(totals.value + totals.cash)} />
        </div>

        <Notice className="mt-4">{advice}</Notice>

        <Button
          variant="outline"
          className="mt-4"
          onClick={() => openMarket("cash")}
          disabled={cashScanExhausted}
        >
          حلل استخدام الكاش
        </Button>
        {cashScansLeft !== null && (
          <p
            className={`mt-2 text-[12px] ${cashScanExhausted ? "text-down" : "text-muted-foreground"}`}
          >
            {cashScanExhausted
              ? "خلصت محاولات تحليل الكاش المتاحة الشهر ده — تقدر تكمّل الشهر الجاي."
              : `باقي ${cashScansLeft}${cashScansPerMonth && !pf?.credits?.cashScans ? ` من ${cashScansPerMonth}` : ""} ${cashScansLeft === 1 ? "محاولة" : "محاولات"} الشهر ده.`}
          </p>
        )}

        <CashAnalysisExplainer />
      </Panel>

      <Panel
        title="الأسهم المفضلة"
        description="اختار الأسهم اللي يهمك سعرها، والصفحة تتابع سعرها وتغيّرها اليومي وتقييمها أولًا بأول — من غير خطة شراء."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label>السهم</Label>
            <StockPicker value={watchCode} onChange={setWatchCode} className="sm:w-full" />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="watch-note">ملاحظة (اختياري)</Label>
            <Input
              id="watch-note"
              value={watchNote}
              onChange={(event) => setWatchNote(event.target.value)}
              placeholder="مثلاً: استنى تصحيح لمستوى الدعم"
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full sm:w-auto"
              onClick={() => void addWatch()}
              disabled={addingWatch}
            >
              {addingWatch && <Spinner />}
              إضافة
            </Button>
          </div>
        </div>

        {watchError && <p className="mt-2 text-[13px] text-down">{watchError}</p>}

        <div className="mt-4">
          {watchlist.length === 0 ? (
            <EmptyState
              title="مفيش أسهم مفضلة لسه"
              hint="ضيف سهم وهيظهر هنا مع سعره وتغيّره اليومي."
            />
          ) : (
            <div className="scrollbar-slim overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">الاسم</TableHead>
                    <TableHead className="text-start">السعر</TableHead>
                    <TableHead className="text-start">التغير اليومي</TableHead>
                    <TableHead className="text-start">التقييم</TableHead>
                    <TableHead className="text-start">الإشارة</TableHead>
                    <TableHead className="text-start">ملاحظة</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {watchlist.map(([code, item]) => {
                    const row = favRows[code];
                    return (
                      <TableRow key={code}>
                        <TableCell className="font-medium">{code}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row
                            ? `${row.name ?? "—"} · ${row.sector ?? "—"}`
                            : favLoading
                              ? "…"
                              : "—"}
                        </TableCell>
                        <TableCell className="num text-right">
                          {row ? fmt(row.price) : "—"}
                        </TableCell>
                        <TableCell className={`num text-right ${tone(row?.changePct)}`}>
                          {row?.changePct != null ? pct(row.changePct, 1) : "—"}
                        </TableCell>
                        <TableCell className="num text-right">{row?.score ?? "—"}</TableCell>
                        <TableCell className="text-right">{row?.signal?.ar ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{item.note || "—"}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`حذف ${code}`}
                            onClick={() => void removeWatch(code)}
                          >
                            <Trash2 className="size-4 text-down" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
