import { Link, createFileRoute } from "@tanstack/react-router";
import { BarChart3, CalendarCheck, LineChart, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canonical, siteUrl, siteName } from "@/lib/seo";
import { useTenant, withBrand } from "@/lib/tenant";

const DESCRIPTION =
  "EGXpert منصة لتحليل محافظ الأسهم في البورصة المصرية: متابعة المحفظة، مستويات وقف الخسارة والأهداف، مؤشرات تحليلية يومية، وتحليل السوق والسيولة.";

export const Route = createFileRoute("/about")({
  head: ({ match }) => ({
    meta: [
      { title: `من نحن — ${siteName(match)}` },
      { name: "description", content: withBrand(DESCRIPTION, siteName(match)) },
      { property: "og:title", content: `من نحن — ${siteName(match)}` },
      { property: "og:description", content: withBrand(DESCRIPTION, siteName(match)) },
      { property: "og:url", content: `${siteUrl(match)}/about` },
    ],
    links: [canonical(match, "/about")],
  }),
  component: AboutPage,
});

const OFFERINGS = [
  {
    Icon: LineChart,
    title: "متابعة المحفظة",
    body: "تسجّل مراكزك وتتابع أداءها.",
  },
  {
    Icon: ShieldCheck,
    title: "وقف الخسارة والأهداف",
    body: "مستويات لكل سهم، محسوبة من بياناتك.",
  },
  {
    Icon: CalendarCheck,
    title: "مؤشرات تحليلية يومية",
    body: "على مراكزك (احتفاظ، زيادة، تقليل)، مبنية على قواعد تحليل معلنة، مش نصيحة شخصية.",
  },
  {
    Icon: BarChart3,
    title: "تحليل السوق والسيولة",
    body: "تحليل مبسّط للسوق والسيولة بيدعم قرارك على مستوى السهم.",
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
  const { name: brandName, contactEmail, features } = useTenant();
  const mail = contactEmail ? (
    <a href={`mailto:${contactEmail}`} dir="ltr" className="font-medium text-foreground underline underline-offset-4">
      {contactEmail}
    </a>
  ) : null;

  return (
    <SiteShell>
      <section className="border-b bg-card">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <Badge variant="outline">من نحن</Badge>
          <h1 className="mt-4 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl">
            عن {brandName}
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            {brandName} منصة لتحليل محافظ الأسهم في البورصة المصرية. بتساعد المستثمر الفرد يتابع
            مراكزه، ويشوف مستويات وقف الخسارة والأهداف المحسوبة من بياناته، ويقرأ تحليل مبسّط للسوق
            والسيولة عشان يقرر بوعي بدل ما يعتمد على الحدس بس.
          </p>
        </div>
      </section>

      <article className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
        <Section title={`مين وراء ${brandName}`}>
          <p>
            {brandName} اتبنت في القاهرة، من واقع خبرة تزيد عن 14 سنة في الاستراتيجية التجارية
            والتسويق في أسواق مصر والخليج، عشان تحوّل بيانات السوق المعقدة لقرارات عملية بسيطة
            للمستثمر العادي.
          </p>
          <p>{brandName} بالتعاون مع Growpin.</p>
        </Section>

        <Section title="بنقدّم إيه">
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

        {features.blog && (
          <Section title="إزاي بنجهّز المحتوى">
            <p>
              مقالات مدونة {brandName} بيكتبها فريق {brandName} التحريري، وبنراجع كل رقم فيها قبل
              النشر:
            </p>
            <ul className="list-disc space-y-1.5 ps-5">
              <li>
                الأرقام والقرارات بناخدها من مصادر رسمية: إفصاحات البورصة المصرية، والهيئة العامة
                للرقابة المالية، والبنك المركزي المصري، وبيانات الشركات نفسها.
              </li>
              <li>كل مقال بيتنشر معاه قسم "المصادر" بروابطه.</li>
              <li>مبننشرش توصيات شراء أو بيع لأسهم بعينها، ولا توقعات لأسعار الأسهم.</li>
              <li>
                لو لقينا خطأ، بنصلّحه وبنحدّث تاريخ المقال. ولو لاحظت خطأ، ابعتلنا
                {mail ? <> على {mail}</> : null}.
              </li>
            </ul>
          </Section>
        )}

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-bold tracking-tight">رسالتنا</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              نسهّل تحليل الأسهم لكل مستثمر في البورصة المصرية بمعلومات واضحة وقابلة للتطبيق.
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-bold tracking-tight">رؤيتنا</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              نكون الأداة اليومية اللي المستثمر بيدير بيها محفظته بالبيانات.
            </p>
          </div>
        </div>

        <p className="mt-10 rounded-xl border border-warn/40 bg-warn-soft p-4 text-[12.5px] leading-relaxed">
          <strong>تنويه مهم:</strong> {brandName} أداة تحليل ومساعدة في اتخاذ القرار، وليست جهة
          استشارات مالية مرخّصة. المستويات والمؤشرات اللي بتظهر في الأداة نتيجة حسابات وقواعد على
          بيانات المحفظة، ومش توصية شخصية. القرار الاستثماري النهائي ومسؤوليته على المستخدم.
        </p>

        <Section title="تواصل معنا">
          <p>
            {mail && <>{mail} | </>}
            <Link to="/contact" className="font-medium text-foreground underline underline-offset-4">
              صفحة تواصل معنا
            </Link>
          </p>
        </Section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/pricing">ابدأ مجانًا</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/contact">تواصل معنا</Link>
          </Button>
        </div>
      </article>
    </SiteShell>
  );
}
