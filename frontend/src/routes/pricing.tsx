import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canonical, SITE_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "الأسعار — EGXpert" },
      {
        name: "description",
        content:
          "٣ باقات: تجربة مجانية ٤ أيام تداول، باقة النفس الطويل من ٢٩٩ جنيه شهريًا، وباقة الحريفة من ٤٩٩ جنيه شهريًا.",
      },
      { property: "og:title", content: "الأسعار — EGXpert" },
      {
        property: "og:description",
        content: "تجربة مجانية ٤ أيام تداول، ثم اختار باقة النفس الطويل أو الحريفة حسب نشاطك.",
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
  "وضع ليلي ودعم كامل للعربية",
];

/** كل رقم شهري — يتجدد أول كل شهر ميلادي، بلا علاقة بمدة الاشتراك (شهري أو سنوي). */
const PLANS = [
  {
    key: "free",
    name: "الباقة المجانية",
    price: "مجانًا",
    unit: "لمدة ٤ أيام تداول",
    yearlyNote: null,
    note: "بدون بطاقة، بكل المزايا بحدود التجربة.",
    cta: "ابدأ التجربة",
    highlight: false,
    limits: { screenshots: 2, recommendations: 4, cashScans: 1, marketAnalysis: 1 },
  },
  {
    key: "long",
    name: "باقة النفس الطويل",
    price: "٢٩٩",
    unit: "جنيه / شهر",
    yearlyNote: "أو ٢٩٩٠ جنيه سنويًا",
    note: "لمستثمر متوسط وطويل المدى.",
    cta: "اشترك في النفس الطويل",
    highlight: true,
    tag: "الأكثر اختيارًا",
    limits: { screenshots: 7, recommendations: 480, cashScans: 7, marketAnalysis: 7 },
  },
  {
    key: "trader",
    name: "باقة الحريفة",
    price: "٤٩٩",
    unit: "جنيه / شهر",
    yearlyNote: "أو ٤٩٩٠ جنيه سنويًا",
    note: "للمضارب النشط ومتوسط وطويل المدى.",
    cta: "اشترك في الحريفة",
    highlight: false,
    tag: "أعلى الحدود",
    limits: { screenshots: 12, recommendations: 960, cashScans: 15, marketAnalysis: 15 },
  },
] as const;

const FEATURE_ROWS = [
  { key: "screenshots", label: "رفع سكرين شوت للمحفظة", unit: "صورة" },
  { key: "recommendations", label: "توصيات الأسهم", unit: "توصية" },
  { key: "cashScans", label: "تحليل استخدام الكاش", unit: "مرة" },
  { key: "marketAnalysis", label: "تحليل السوق", unit: "مرة" },
] as const;

/** رصيد صور إضافي فوق حد الباقة الشهري — يتباع مرة واحدة، مش اشتراك. مطابقة لـ SCREENSHOT_ADDONS في backend/src/billing/plans.js. */
const SCREENSHOT_ADDONS = [
  { screenshots: 8, priceEgp: 20 },
  { screenshots: 14, priceEgp: 40 },
  { screenshots: 22, priceEgp: 60 },
] as const;

function PricingPage() {
  return (
    <SiteShell>
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
        <div className="max-w-2xl">
          <Badge variant="outline">٣ باقات — اختار اللي يناسب نشاطك</Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">أسعار واضحة لكل مستوى</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            نفس الأدوات في كل الباقات — الفرق في عدد مرات استخدام كل ميزة شهريًا. ابدأ بـ ٤ أيام
            تداول مجانًا وقرّر بعد كده.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <article
              key={plan.key}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-6 shadow-sm",
                plan.highlight && "border-primary/60 ring-1 ring-primary/20",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[16px] font-semibold">{plan.name}</h2>
                {"tag" in plan && plan.tag && (
                  <Badge
                    variant="outline"
                    className={plan.highlight ? "border-primary/40 bg-secondary" : ""}
                  >
                    {plan.tag}
                  </Badge>
                )}
              </div>
              <p className="mt-5 flex items-end gap-2">
                <span className="num text-4xl font-bold tracking-tight">{plan.price}</span>
                <span className="pb-1 text-[12.5px] text-muted-foreground">{plan.unit}</span>
              </p>
              {plan.yearlyNote && (
                <p className="mt-1 text-[12.5px] text-muted-foreground">{plan.yearlyNote}</p>
              )}
              <p className="mt-2 text-[12.5px] text-muted-foreground">{plan.note}</p>

              <ul className="mt-5 space-y-2 border-t pt-4">
                {FEATURE_ROWS.map((row) => (
                  <li key={row.key} className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="num font-semibold">
                      {plan.limits[row.key]} {row.unit}
                      {plan.limits[row.key] === 1 ? "" : plan.key === "free" ? "" : "/شهر"}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                asChild
                className="mt-6 w-full"
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
          ))}
        </div>

        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold">رصيد صور إضافي</h2>
            <Badge variant="outline">دفعة واحدة — مش اشتراك</Badge>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            خلصت صور المحفظة المسموح بيها الشهر ده قبل ما يجي الشهر الجاي؟ زوّد رصيدك برصيد إضافي
            فوق حد باقتك.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {SCREENSHOT_ADDONS.map((addon) => (
              <div key={addon.screenshots} className="rounded-xl border bg-surface p-4 text-center">
                <p className="num text-2xl font-bold tracking-tight">{addon.screenshots}</p>
                <p className="text-[12px] text-muted-foreground">صورة إضافية</p>
                <p className="num mt-2 text-[15px] font-semibold">{addon.priceEgp} جنيه</p>
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
              a: "لا. تعمل حساب وتستخدم الباقة المجانية ٤ أيام تداول بحدودها (صورتين، ٤ توصيات، تحليل كاش وتحليل سوق مرة لكل واحد)، وبعدها تختار باقة النفس الطويل أو الحريفة.",
            },
            {
              q: "الحدود دي بتتجدد إزاي؟",
              a: "عدد مرات كل ميزة في النفس الطويل والحريفة بيتجدد أول كل شهر ميلادي، سواء اشتراكك شهري أو سنوي.",
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
