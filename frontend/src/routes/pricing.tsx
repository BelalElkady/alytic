import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canonical, SITE_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "الأسعار — EGXpert" },
      {
        name: "description",
        content:
          "3 باقات: تجربة مجانية 5 أيام تداول، باقة النفس الطويل من 299 جنيه شهريًا، وباقة الحريفة من 499 جنيه شهريًا.",
      },
      { property: "og:title", content: "الأسعار — EGXpert" },
      {
        property: "og:description",
        content: "تجربة مجانية 5 أيام تداول، ثم اختار باقة النفس الطويل أو الحريفة حسب نشاطك.",
      },
      { property: "og:url", content: `${SITE_URL}/pricing` },
    ],
    links: [canonical("/pricing")],
  }),
  component: PricingPage,
});

const BASE_INCLUDED = [
  "متابعة كل أسهمك بأسعار لحظية",
  "وقف خسارة وأهداف محسوبة لكل سهم",
  "تقويم إغلاقات ورسوم أداء",
  "إدارة الكاش والصفقات والعمولات",
];

type Period = "monthly" | "yearly";

/** English (Western) digits with thousands separators — the site's Arabic copy still quotes prices as 2,990, not ٢٬٩٩٠. */
const fmt = (n: number) => n.toLocaleString("en-US");

/** كل رقم شهري — يتجدد أول كل شهر ميلادي، بلا علاقة بمدة الاشتراك (شهري أو سنوي). الأسعار مطابقة لـ PLANS في backend/src/billing/plans.js. */
const PLANS = [
  {
    key: "free",
    name: "الباقة المجانية",
    monthlyPrice: null,
    yearlyPrice: null,
    freeUnit: "لمدة 5 أيام تداول",
    note: "بدون بطاقة، بكل المزايا بحدود التجربة.",
    cta: "ابدأ التجربة",
    highlight: false,
    limits: { screenshots: 2, recommendations: 15, cashScans: 3, marketAnalysis: 3 },
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
  },
] as const;

/**
 * The headline yearly discount: the smallest saving across the paid plans
 * (today both work out to the same 16.7%), so the label never overstates one.
 */
const YEARLY_DISCOUNT_PCT = Math.min(
  ...PLANS.flatMap((plan) =>
    plan.monthlyPrice !== null && plan.yearlyPrice !== null
      ? [Math.round((1 - plan.yearlyPrice / (plan.monthlyPrice * 12)) * 100)]
      : [],
  ),
);

const FEATURE_ROWS = [
  { key: "screenshots", label: "رفع سكرين شوت للمحفظة", unit: "صورة" },
  { key: "recommendations", label: "توصيات الأسهم", unit: "توصية" },
  { key: "cashScans", label: "تحليل استخدام الكاش", unit: "مرة" },
  { key: "marketAnalysis", label: "تحليل السوق", unit: "مرة" },
] as const;

/** رصيد إضافي فوق حد الباقة الشهري لأي ميزة — يتباع مرة واحدة، مش اشتراك. مطابقة لـ ADDONS في backend/src/billing/plans.js. */
const ADDON_PACKS: Record<(typeof FEATURE_ROWS)[number]["key"], { label: string; count: number; priceEgp: number }[]> = {
  screenshots: [
    { label: "سريع", count: 3, priceEgp: 20 },
    { label: "الأفضل قيمة", count: 6, priceEgp: 39 },
    { label: "بالجملة", count: 12, priceEgp: 75 },
  ],
  recommendations: [
    { label: "سريع", count: 50, priceEgp: 50 },
    { label: "الأفضل قيمة", count: 100, priceEgp: 75 },
    { label: "بالجملة", count: 150, priceEgp: 100 },
  ],
  cashScans: [
    { label: "سريع", count: 20, priceEgp: 25 },
    { label: "الأفضل قيمة", count: 60, priceEgp: 50 },
    { label: "بالجملة", count: 150, priceEgp: 80 },
  ],
  marketAnalysis: [
    { label: "سريع", count: 20, priceEgp: 25 },
    { label: "الأفضل قيمة", count: 60, priceEgp: 50 },
    { label: "بالجملة", count: 150, priceEgp: 80 },
  ],
};

function PricingPage() {
  // Yearly by default: it's the better deal, and it's the price quoted per month below.
  const [period, setPeriod] = useState<Period>("yearly");

  return (
    <SiteShell>
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
        <div className="max-w-2xl">
          <Badge variant="outline">3 باقات — اختار اللي يناسب نشاطك</Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">أسعار واضحة لكل مستوى</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            نفس الأدوات في كل الباقات — الفرق في عدد مرات استخدام كل ميزة شهريًا. ابدأ بـ 5 أيام
            تداول مجانًا وقرّر بعد كده.
          </p>
        </div>

        {/* mt-12: room for the discount label that sits above the yearly tab. */}
        <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)} className="mt-12">
          <TabsList>
            <TabsTrigger value="monthly">شهري</TabsTrigger>
            <TabsTrigger value="yearly" className="relative">
              سنوي
              <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold text-up">
                وفّر <span className="num">{YEARLY_DISCOUNT_PCT}%</span>
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {PLANS.map((plan) => {
            // The yearly tab quotes the yearly price as a per-month figure (2,990 → 249), whole
            // pounds only, with the real one-time total and the saving spelled out beneath it.
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
              <h2 className="text-[16px] font-semibold">{plan.name}</h2>
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
              <p
                className={cn(
                  "mt-2 text-[12.5px]",
                  plan.key === "free"
                    ? "text-muted-foreground"
                    : "w-fit rounded-md border border-primary/30 bg-secondary px-2 py-1 font-semibold text-foreground",
                )}
              >
                {plan.note}
              </p>

              <ul className="mb-6 mt-5 space-y-2 border-t pt-4">
                {FEATURE_ROWS.map((row) => (
                  <li key={row.key} className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">{row.label}</span>
                    {/* Only the digits are isolated LTR — the row itself stays RTL so the number sits on the right of its unit word. */}
                    <span className="font-semibold">
                      <span className="num">{plan.limits[row.key]}</span> {row.unit}
                      {plan.limits[row.key] === 1 ? "" : plan.key === "free" ? "" : "/شهر"}
                    </span>
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
                  <Link to="/subscribe">{plan.cta}</Link>
                )}
              </Button>
            </article>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold">رصيد إضافي</h2>
            <Badge variant="outline">دفعة واحدة — مش اشتراك</Badge>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            خلصت رصيد أي ميزة الشهر ده قبل ما يجي الشهر الجاي؟ زوّد رصيدك فوق حد باقتك بأي ميزة على
            حدة.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURE_ROWS.map((row) => (
              <div key={row.key} className="rounded-xl border bg-surface p-4">
                <p className="text-[13px] font-semibold">{row.label}</p>
                <div className="mt-3 space-y-2">
                  {ADDON_PACKS[row.key].map((pack) => (
                    <div key={pack.label} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-muted-foreground">
                        {pack.label} · {pack.count} {row.unit}
                      </span>
                      <span className="font-semibold">
                        <span className="num">{pack.priceEgp}</span> ج
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/subscribe">اطلب رصيد إضافي</Link>
          </Button>
        </div>

        <div className="mt-8 rounded-2xl border bg-surface p-6">
          <h2 className="text-[16px] font-semibold">كل الباقات بتشمل</h2>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {BASE_INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[13px] leading-relaxed">
                <Check className="mt-0.5 size-4 shrink-0 text-up" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              q: "هل التجربة محتاجة بطاقة؟",
              a: "لا. تعمل حساب وتستخدم الباقة المجانية 5 أيام تداول بحدودها (صورتين، 15 توصية، و3 مرات تحليل كاش و3 مرات تحليل سوق)، وبعدها تختار باقة النفس الطويل أو الحريفة.",
            },
            {
              q: "الحدود دي بتتجدد إزاي؟",
              a: "عدد مرات كل ميزة في النفس الطويل والحريفة بيتجدد أول كل شهر ميلادي، سواء اشتراكك شهري أو سنوي.",
            },
            {
              q: "إيه اللي بيحصل للرصيد الإضافي لو اشتراكي خلص؟",
              a: "الرصيد الإضافي بيفضل في حسابك ومش بيتلغي، بس مينفعش تستخدمه وباقتك منتهية — بيتجمّد ويرجع يشتغل أول ما تجدد. أما اللي فاضل من حدود باقتك الشهرية فمش بيتنقل للشهر الجديد.",
            },
            {
              q: "بدفع إزاي؟",
              a: "كلّمنا في الشات جوّه التطبيق وقولّنا الباقة اللي عايزها، وهنبعتلك بيانات الدفع وكل التفاصيل هناك — وبنفعّل حسابك أول ما نراجع التحويل.",
            },
            {
              q: "أقدر ألغي في أي وقت؟",
              a: "مفيش تجديد تلقائي أصلًا — الاشتراك بيشتغل لآخر مدته وبعدها بيقف لحد ما تحوّل تاني.",
            },
            {
              q: "هل ده استشارة مالية؟",
              a: "لا. EGXpert أداة تحليل بقواعد واضحة تساعدك في القرار، والقرار الأخير مسؤوليتك.",
            },
          ].map((faq) => (
            <article key={faq.q} className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="text-[14px] font-semibold">{faq.q}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{faq.a}</p>
            </article>
          ))}
        </div>
      </section>
    </SiteShell>
  );
}
