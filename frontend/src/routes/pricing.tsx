import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "الأسعار — EGXpert" },
      {
        name: "description",
        content:
          "باقة واحدة بكل المزايا: تجربة مجانية ٤ أيام، ثم اشتراك شهري ١٤٩ جنيه أو سنوي ١٦١٠ جنيه بخصم ١٠٪.",
      },
      { property: "og:title", content: "الأسعار — EGXpert" },
      {
        property: "og:description",
        content: "تجربة مجانية ٤ أيام، ثم شهري أو سنوي — نفس المزايا كاملة بدون حدود.",
      },
    ],
  }),
  component: PricingPage,
});

const INCLUDED = [
  "متابعة كل أسهمك بأسعار لحظية",
  "وقف خسارة وأهداف محسوبة لكل سهم",
  "توصية يومية حسب سلوكك الاستثماري",
  "رفع صورة المحفظة وقراءتها تلقائيًا",
  "تحليل السوق وتحليل كل سهم",
  "تقويم إغلاقات ورسوم أداء",
  "إدارة الكاش والصفقات والعمولات",
  "وضع ليلي ودعم كامل للعربية",
];

const PLANS = [
  {
    key: "trial",
    name: "تجربة مجانية",
    price: "مجانًا",
    unit: "لمدة ٤ أيام",
    note: "بدون بطاقة، بكل المزايا.",
    cta: "ابدأ التجربة",
    highlight: false,
  },
  {
    key: "monthly",
    name: "شهري",
    price: "١٤٩",
    unit: "جنيه / شهر",
    note: "تلغي في أي وقت.",
    cta: "اشترك شهري",
    highlight: true,
    tag: "الأكثر اختيارًا",
  },
  {
    key: "yearly",
    name: "سنوي",
    price: "١٦١٠",
    unit: "جنيه / سنة",
    note: "بتوفّر ١٠٪ مقارنة بالشهري.",
    cta: "اشترك سنوي",
    highlight: false,
    tag: "وفّر ١٠٪",
  },
] as const;

function PricingPage() {
  return (
    <SiteShell>
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
        <div className="max-w-2xl">
          <Badge variant="outline">باقة واحدة — بدون مستويات مربكة</Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">أسعار بسيطة وواضحة</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            نفس المزايا كاملة في كل الخطط. الفرق بس في مدة الاشتراك. ابدأ بـ ٤ أيام مجانًا وقرّر بعد
            كده.
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
              <p className="mt-2 text-[12.5px] text-muted-foreground">{plan.note}</p>
              <Button
                asChild
                className="mt-6 w-full"
                variant={plan.highlight ? "default" : "outline"}
              >
                {plan.key === "trial" ? (
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

        <div className="mt-8 rounded-2xl border bg-surface p-6">
          <h2 className="text-[16px] font-semibold">كل الخطط بتشمل</h2>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {INCLUDED.map((item) => (
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
              a: "لا. تعمل حساب وتستخدم كل المزايا ٤ أيام، وبعدها تختار خطة لو عجبتك. تحليل الكاش متاح مرة واحدة يوميًا طول التجربة.",
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
