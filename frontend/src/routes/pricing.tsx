import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { FEATURE_ROWS, PricingPlans } from "@/components/marketing/pricing-plans";
import { PricingFaq } from "@/components/marketing/pricing-faq";
import { SiteShell } from "@/components/marketing/site-shell";
import { useWhatsappNumber, WhatsAppIcon, whatsappLink } from "@/components/support/whatsapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canonical, siteUrl, siteName } from "@/lib/seo";

export const Route = createFileRoute("/pricing")({
  head: ({ match }) => ({
    meta: [
      { title: `الأسعار — ${siteName(match)}` },
      {
        name: "description",
        content:
          "3 باقات: تجربة مجانية 5 أيام تداول، باقة النفس الطويل من 299 جنيه شهريًا، وباقة الحريفة من 499 جنيه شهريًا.",
      },
      { property: "og:title", content: `الأسعار — ${siteName(match)}` },
      {
        property: "og:description",
        content: "تجربة مجانية 5 أيام تداول، ثم اختار باقة النفس الطويل أو الحريفة حسب نشاطك.",
      },
      { property: "og:url", content: `${siteUrl(match)}/pricing` },
    ],
    links: [canonical(match, "/pricing")],
  }),
  component: PricingPage,
});

const BASE_INCLUDED = [
  "متابعة كل أسهمك بأسعار لحظية",
  "وقف خسارة وأهداف محسوبة لكل سهم",
  "تقويم إغلاقات ورسوم أداء",
  "إدارة الكاش والصفقات والعمولات",
];

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
  const whatsappNumber = useWhatsappNumber();

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

        <div className="mt-12">
          <PricingPlans />
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
            <a
              href={whatsappLink(whatsappNumber, "أهلًا، عايز أطلب رصيد إضافي.")}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WhatsAppIcon className="size-4" />
              اطلب رصيد إضافي
            </a>
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

        <PricingFaq className="mt-8" />
      </section>
    </SiteShell>
  );
}
