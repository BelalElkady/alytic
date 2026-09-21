import { Link, createFileRoute } from "@tanstack/react-router";
import { BarChart3, CalendarCheck, LineChart, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canonical, siteUrl, siteName } from "@/lib/seo";
import { useTenant, withBrand } from "@/lib/tenant";

const DESCRIPTION =
  "EGXpert منصة ذكية لتحليل محافظ الأسهم في البورصة المصرية: متابعة المحفظة، وقف الخسارة والأهداف، توصيات يومية، وتحليل السوق والسيولة.";

export const Route = createFileRoute("/about")({
  head: ({ matches }) => ({
    meta: [
      { title: `من نحن — ${siteName(matches)}` },
      { name: "description", content: withBrand(DESCRIPTION, siteName(matches)) },
      { property: "og:title", content: `من نحن — ${siteName(matches)}` },
      { property: "og:description", content: withBrand(DESCRIPTION, siteName(matches)) },
      { property: "og:url", content: `${siteUrl(matches)}/about` },
    ],
    links: [canonical(matches, "/about")],
  }),
  component: AboutPage,
});

const OFFERINGS = [
  {
    Icon: LineChart,
    title: "متابعة كاملة لمحفظتك",
    body: "سجّل مراكزك وتابع أداءها أول بأول.",
  },
  {
    Icon: ShieldCheck,
    title: "حساب وقف الخسارة والأهداف",
    body: "مستويات دقيقة لكل سهم بناءً على بياناتك.",
  },
  {
    Icon: CalendarCheck,
    title: "توصيات يومية",
    body: "تحليل يومي لكل سهم في محفظتك يساعدك تقرر تمسك، تزيد، ولا تخرج.",
  },
  {
    Icon: BarChart3,
    title: "تحليل السوق والسيولة",
    body: "قراءة مبسطة للسوق تكمّل قرارك على مستوى السهم.",
  },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function AboutPage() {
  const { name: brandName } = useTenant();
  return (
    <SiteShell>
      <section className="border-b bg-card">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <Badge variant="outline">من نحن</Badge>
          <h1 className="mt-4 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl">
            {brandName} – خبير البورصة المصرية بين يديك
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            في سوق الأوراق المالية المصري، القرار الصح محتاج معلومة دقيقة وتوقيت سليم. من هنا جت
            فكرة {brandName}.
          </p>
        </div>
      </section>

      <article className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
        <Section title="مين إحنا">
          <p>
            {brandName} منصة ذكية لتحليل محافظ الأسهم في البورصة المصرية، اتبنت عشان تحل مشكلة
            بيواجهها كل مستثمر مصري: إزاي تتابع محفظتك، تعرف نقاط الدخول والخروج، وتاخد قرارك من غير
            ما تضيع ساعات في التحليل اليدوي أو تعتمد على حدسك بس.
          </p>
        </Section>

        <Section title="اللي بنقدمه">
          <div className="grid gap-3 sm:grid-cols-2">
            {OFFERINGS.map(({ Icon, title, body }) => (
              <div key={title} className="rounded-xl border bg-card p-4">
                <Icon className="size-5 text-primary" />
                <p className="mt-2 text-[14.5px] font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title={`ليه ${brandName}`}>
          <p>
            إحنا مش شركة استثمار ومش بديل عن قرارك، إحنا أداة بتنظّم لك المعلومة وتوفّر لك وقتك،
            وتخليك تاخد قرارك وانت شايف الصورة كاملة.
          </p>
          <p>
            المنصة اتبنت من واقع خبرة تزيد عن 14 سنة في السوق المصري ومنطقة الخليج، في مجالات
            الاستراتيجية التجارية والتسويق، وترجمة البيانات المعقدة لقرارات بسيطة وعملية — وده
            بالظبط اللي بنقدمه هنا لمستثمر البورصة المصرية.
          </p>
        </Section>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-bold tracking-tight">رسالتنا</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              نبسّط تحليل الأسهم لكل مستثمر في البورصة المصرية، من خلال أدوات بتحوّل بيانات السوق
              المعقدة لتوصيات واضحة وقابلة للتنفيذ، كل يوم وعلى كل سهم في محفظتك.
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-bold tracking-tight">رؤيتنا</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              نكون الأداة اليومية اللي يعتمد عليها كل مستثمر في البورصة المصرية، صغير كان أو محترف،
              عشان يدير محفظته بثقة وبيانات مش بتخمين.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/pricing">ابدأ مجانًا</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/contact">تواصل معنا</Link>
          </Button>
        </div>

        <p className="mt-12 rounded-xl border border-warn/40 bg-warn-soft p-4 text-[12.5px] leading-relaxed">
          <strong>تنويه:</strong> {brandName} أداة تحليل ومساعدة في اتخاذ القرار الاستثماري، وليست
          جهة استشارية مالية مرخّصة. القرار الاستثماري النهائي ومسؤوليته بالكامل على المستخدم.
        </p>
      </article>
    </SiteShell>
  );
}
