import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The plan cards (monthly/yearly toggle + three tiers) — shared by /pricing and the landing page so the two never drift. */
type Period = "monthly" | "yearly";

/** كل رقم شهري — يتجدد أول كل شهر ميلادي، بلا علاقة بمدة الاشتراك (شهري أو سنوي). الأسعار مطابقة لـ PLANS في backend/src/billing/plans.js. */
export const PLANS = [
  {
    key: "free",
    name: "الباقة المجانية",
    monthlyPrice: null,
    yearlyPrice: null,
    freeUnit: "لمدة 5 أيام تداول",
    note: "بدون بطاقة، بكل المزايا بحدود التجربة. بتتحسب أيام التداول بس — العطلات والإجازات مش بتتحسب.",
    cta: "ابدأ التجربة المجانية",
    highlight: false,
    limits: { screenshots: 2, recommendations: 15, cashScans: 3, marketAnalysis: 3 },
    portfolios: 1,
  },
  {
    key: "long",
    name: "باقة النفس الطويل",
    monthlyPrice: 299,
    yearlyPrice: 2990,
    note: "لمستثمر متوسط وطويل المدى.",
    cta: "اشترك في النفس الطويل",
    highlight: true,
    limits: { screenshots: 7, recommendations: 230, cashScans: 10, marketAnalysis: 30 },
    portfolios: 1,
  },
  {
    key: "trader",
    name: "باقة الحريفة",
    monthlyPrice: 499,
    yearlyPrice: 4990,
    note: "للمضارب النشط ومتوسط وطويل المدى.",
    cta: "اشترك في الحريفة",
    highlight: false,
    limits: { screenshots: 12, recommendations: 550, cashScans: 20, marketAnalysis: 70 },
    // Up to 3 Portfolios (#103) — a standing cap, not a monthly quota, so it
    // sits outside FEATURE_ROWS/ADDON_PACKS (no "/شهر" suffix, no top-up pack).
    portfolios: 3,
  },
] as const;

/**
 * The headline yearly discount: the smallest saving across the paid plans
 * (today both work out to the same 16.7%), rounded down to a whole percent (16%) so the label
 * never overstates one.
 */
const YEARLY_DISCOUNT_PCT = Math.floor(
  Math.min(
    ...PLANS.flatMap((plan) =>
      plan.monthlyPrice !== null && plan.yearlyPrice !== null
        ? [(1 - plan.yearlyPrice / (plan.monthlyPrice * 12)) * 100]
        : [],
    ),
  ),
);

export const FEATURE_ROWS = [
  { key: "screenshots", label: "رفع سكرين شوت للمحفظة", unit: "صورة" },
  { key: "recommendations", label: "توصيات الأسهم", unit: "توصية" },
  { key: "cashScans", label: "تحليل استخدام الكاش", unit: "مرة" },
  { key: "marketAnalysis", label: "تحليل السوق", unit: "مرة" },
] as const;


/** One tier as GET /api/billing/plans returns it: the caps, Portfolio cap and card text the platform panel sets (see publicTiers in backend/src/api/server.js). */
type LiveTier = {
  screenshots: number;
  recommendations: number;
  cashScans: number;
  marketAnalysis: number;
  portfolios: number;
  card: { name: string; note: string; bullets: string[] };
};

/**
 * The live tier settings, or null until they load (or if the request fails) — the
 * cards then show the built-in values above, so the page is never empty.
 */
function useLiveTiers(): Record<string, LiveTier> | null {
  const [tiers, setTiers] = useState<Record<string, LiveTier> | null>(null);
  useEffect(() => {
    let cancelled = false;
    api("/api/billing/plans")
      .then((result) => {
        if (!cancelled) setTiers(result?.tiers ?? null);
      })
      .catch(() => {
        if (!cancelled) setTiers(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return tiers;
}

export function PricingPlans() {
  const liveTiers = useLiveTiers();
  // Yearly by default: it's the better deal, and it's the price quoted per month below.
  const [period, setPeriod] = useState<Period>("yearly");

  return (
    <>
      {/* mt-12: room for the discount label that sits above the yearly tab. */}
      <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)} className="mt-12">
        <TabsList>
          <TabsTrigger value="monthly">شهري</TabsTrigger>
          <TabsTrigger value="yearly" className="relative">
            سنوي
            <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold text-up">
              وفّر <span className="num">{fmt(YEARLY_DISCOUNT_PCT)}%</span>
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const live = liveTiers?.[plan.key];
          const name = live?.card.name ?? plan.name;
          const note = live?.card.note ?? plan.note;
          const portfolios = live?.portfolios ?? plan.portfolios;
          const bullets = live?.card.bullets ?? [];
          const limits: Record<(typeof FEATURE_ROWS)[number]["key"], number> = live ?? plan.limits;
          // The yearly tab quotes the yearly price as a per-month figure, rounded to whole pounds
          // (2,990 → 249 on screen), with the real one-time total and the saving spelled out beneath it.
          let price: number | null = plan.monthlyPrice;
          let yearlyTotal = 0;
          let yearlySaving = 0;
          if (period === "yearly" && plan.monthlyPrice !== null && plan.yearlyPrice !== null) {
            price = Math.round(plan.yearlyPrice / 12);
            yearlyTotal = plan.yearlyPrice;
            // Same saving the backend's PLANS comment quotes: twelve monthly payments vs the yearly price.
            yearlySaving = plan.monthlyPrice * 12 - plan.yearlyPrice;
          }
          return (
          <article
            key={plan.key}
            className={cn(
              "flex flex-col rounded-2xl border bg-card p-6 shadow-sm",
              plan.highlight && "border-primary/60 ring-1 ring-primary/20",
            )}
          >
            <h2 className="text-[16px] font-semibold">{name}</h2>
            <p className="mt-5 flex items-end gap-2">
              {price === null ? (
                <>
                  <span className="text-4xl font-bold tracking-tight">مجانًا</span>
                  <span className="pb-1 text-[12.5px] text-muted-foreground">{plan.freeUnit}</span>
                </>
              ) : (
                <>
                  <span className="num text-4xl font-bold tracking-tight">{fmt(price)}</span>
                  <span className="pb-1 text-[12.5px] text-muted-foreground">جنيه / شهر</span>
                  {yearlySaving > 0 && plan.monthlyPrice !== null && (
                    // ml-auto (physical) pins it to the left edge of the card in this RTL row.
                    <span className="ml-auto pb-1 text-[12.5px] text-muted-foreground">
                      بدلًا من{" "}
                      <s className="num text-xl font-semibold">{fmt(plan.monthlyPrice)}</s>
                    </span>
                  )}
                </>
              )}
            </p>
            {yearlySaving > 0 && (
              <div className="mt-1 space-y-0.5 text-[12.5px]">
                <p className="text-muted-foreground">
                  بتدفع <span className="num">{fmt(yearlyTotal)}</span> جنيه مرة واحدة في السنة
                </p>
                <p className="font-semibold text-up">
                  هتوفّر <span className="num">{fmt(yearlySaving)}</span> جنيه في السنة
                </p>
              </div>
            )}
            {/* The free card has no yearly total or saving, but the paid cards' two-line block above
                pushes their feature list down — an invisible copy of the same two lines keeps
                every card's divider, feature rows and CTA on the same lines. */}
            {plan.key === "free" && period === "yearly" && (
              <div aria-hidden className="invisible mt-1 space-y-0.5 text-[12.5px]">
                <p>&nbsp;</p>
                <p>&nbsp;</p>
              </div>
            )}
            <p
              className={cn(
                "mt-2 text-[12.5px]",
                // The free note carries the pill's vertical padding and border (transparent) so
                // it is as tall as the paid cards' pill, not just their text.
                plan.key === "free"
                  ? "border border-transparent py-1 text-muted-foreground"
                  : "w-fit rounded-md border border-primary/30 bg-secondary px-2 py-1 font-semibold text-foreground",
              )}
            >
              {note}
            </p>

            <ul className="mb-6 mt-5 space-y-2 border-t pt-4">
              {/* A standing cap, not a monthly quota (#103) — no "/شهر" suffix, listed first. */}
              <li className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">عدد المحافظ</span>
                <span className="font-semibold">
                  <span className="num">{portfolios}</span> محفظة
                </span>
              </li>
              {FEATURE_ROWS.map((row) => (
                <li key={row.key} className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-foreground">{row.label}</span>
                  {/* Only the digits are isolated LTR — the row itself stays RTL so the number sits on the right of its unit word. */}
                  <span className="font-semibold">
                    {limits[row.key] === 0 ? (
                      "غير متاحة"
                    ) : (
                      <>
                        <span className="num">{limits[row.key]}</span> {row.unit}
                        {limits[row.key] === 1 ? "" : plan.key === "free" ? "" : "/شهر"}
                      </>
                    )}
                  </span>
                </li>
              ))}
              {/* Extra lines the platform panel adds to this tier's card. */}
              {bullets.map((line) => (
                <li key={line} className="flex items-start gap-2 text-[13px]">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-up" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {/* mt-auto: the cards stretch to equal height, so this keeps every CTA on the same line. */}
            <Button
              asChild
              className="mt-auto w-full"
              variant={plan.highlight ? "default" : "outline"}
            >
              {plan.key === "free" ? (
                <Link to="/login" search={{ mode: "register" }}>
                  {plan.cta}
                </Link>
              ) : (
                // Carries the plan and the billing tab the visitor was looking at, so /subscribe shows only that tier's prices.
                <Link to="/subscribe" search={{ tier: plan.key, period }}>
                  {plan.cta}
                </Link>
              )}
            </Button>
          </article>
          );
        })}
      </div>
    </>
  );
}
