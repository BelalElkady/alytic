import { Link, createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  Camera,
  Crosshair,
  LineChart,
  Radar,
  ShieldCheck,
  Sliders,
  Wallet,
} from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import { SiteShell } from "@/components/marketing/site-shell";
import { ToolExplainer } from "@/components/marketing/tool-explainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EGXpert — خبير البورصة المصرية لإدارة محفظتك" },
      {
        name: "description",
        content:
          "EGXpert يحلّل أسهم البورصة المصرية، يحسب وقف الخسارة والأهداف، ويعطيك توصية واضحة لكل سهم حسب سلوكك الاستثماري.",
      },
      { property: "og:title", content: "EGXpert — خبير البورصة المصرية" },
      {
        property: "og:description",
        content:
          "محفظتك، أسعار لحظية، وقف خسارة وأهداف محسوبة، وتوصية يومية لكل سهم — بالعربي وبقواعد واضحة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

const FEATURES = [
  {
    icon: Wallet,
    title: "محفظة واضحة في شاشة واحدة",
    text: "كل سهم في صف مستقل: عدد الأسهم، متوسط التكلفة، القيمة الحالية، والربح أو الخسارة بالجنيه وبالنسبة.",
  },
  {
    icon: Crosshair,
    title: "وقف خسارة وأهداف محسوبة",
    text: "شريط سعري يوضح مكان السهم بين وقف الخسارة والهدف المتوسط والهدف البعيد، وتنبيه لو قرب من الوقف.",
  },
  {
    icon: Sliders,
    title: "توصيات تتغيّر مع سلوكك",
    text: "اختار: مضارب (أيام)، متوسط المدى (أسابيع)، أو طويل المدى (شهور) — وقواعد التوصية تتعدّل على أساس اختيارك.",
  },
  {
    icon: Camera,
    title: "رفع صورة المحفظة",
    text: "صوّر شاشة محفظتك من التطبيق بتاع السماسرة، وارفعها — يتقرأ الأسهم والكميات ويحدّث مراكزك.",
  },
  {
    icon: Radar,
    title: "تحليل السوق والأسهم",
    text: "نظرة على السوق العام وتحليل تفصيلي لكل سهم مع مستويات الدخول والخروج والسيناريوهات.",
  },
  {
    icon: CalendarDays,
    title: "تقويم وسجل إغلاقات",
    text: "سجّل إغلاق كل يوم وشوف أداء محفظتك على التقويم بالشهر والسنة، مع رسوم بيانية للأداء.",
  },
  {
    icon: BarChart3,
    title: "رسوم وأداء",
    text: "توزيع المحفظة، مساهمة كل سهم في الربح، وتطوّر القيمة الكلية بشكل بصري بسيط.",
  },
  {
    icon: LineChart,
    title: "أسعار لحظية",
    text: "تحديث تلقائي لأسعار أسهمك كل ثوانٍ، مع تغيّر اليوم وقيمة المحفظة والكاش المتاح.",
  },
];

const STEPS = [
  { n: "١", title: "اعمل حساب", text: "دقيقة واحدة، وتجربة مجانية ٤ أيام بدون أي التزام." },
  { n: "٢", title: "ضيف أسهمك", text: "إدخال يدوي سريع أو رفع صورة محفظتك ويتقرأ تلقائيًا." },
  {
    n: "٣",
    title: "اتابع وقرّر",
    text: "توصية يومية لكل سهم، تنبيهات الوقف، وأهداف محدّدة بأرقام.",
  },
];

function LandingPage() {
  return (
    <SiteShell>
      {/* Hero */}
      <section className="border-b bg-card">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Badge variant="outline" className="border-up/40 bg-up-soft text-up">
              تجربة مجانية ٤ أيام — بدون بطاقة
            </Badge>
            <h1 className="mt-4 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl lg:text-[42px]">
              خبير البورصة المصرية في جيبك
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              EGXpert بيتابع أسهمك لحظة بلحظة، بيحسب وقف الخسارة والأهداف، وبيقول لك تعمل إيه في كل
              سهم النهاردة — بقواعد واضحة تقدر تشوفها وتعدّلها، مش كلام عام.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/pricing">ابدأ التجربة المجانية</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/pricing">شوف الأسعار</Link>
              </Button>
            </div>
            <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <ShieldCheck className="size-4 text-up" />
              بياناتك في حسابك الخاص — وتقدر تلغي في أي وقت.
            </p>
          </div>

          <PreviewCard />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
        <h2 className="text-2xl font-bold tracking-tight">إيه اللي بتعمله الأداة بالظبط؟</h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          كل حاجة هنا مبنية على محفظتك الحقيقية وأسعار السوق — مش نماذج جاهزة.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article
              key={title}
              className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
            >
              <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
                <Icon className="size-4.5" />
              </span>
              <h3 className="mt-3 text-[14.5px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="border-y bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight">تبدأ في ٣ خطوات</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-xl border bg-card p-5 shadow-sm">
                <span className="num grid size-8 place-items-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
                  {step.n}
                </span>
                <h3 className="mt-3 text-[15px] font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {step.text}
                </p>
              </li>
            ))}
          </ol>
          <Link
            to="/how-to-use"
            className="mt-6 inline-block text-[13px] font-medium text-primary underline-offset-4 hover:underline"
          >
            شرح تفصيلي لطريقة استخدام الأداة ←
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="flex flex-col items-start gap-5 rounded-2xl border bg-card p-7 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">جرّبها على محفظتك الحقيقية</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              ٤ أيام مجانًا بكل المزايا. لو مش عاجبتك، سيبها بدون أي خصم.
            </p>
          </div>
          <Button asChild size="lg">
            <Link to="/pricing">ابدأ تجربتك المجانية</Link>
          </Button>
        </div>
      </section>

      {/* Last on the page for everyone: it's reference detail, read by someone
          who has already decided the pitch above is worth a closer look. */}
      <ToolExplainer />
    </SiteShell>
  );
}

function PreviewCard() {
  return (
    <div className="rounded-2xl border bg-surface p-3 shadow-sm sm:p-4">
      <div className="flex items-center gap-2.5 rounded-xl border bg-card px-3.5 py-3">
        <LogoMark className="size-8" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">EGXpert</p>
          <p className="text-[11px] text-muted-foreground">تحديث الأسعار الآن</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: "قيمة الأسهم", value: "٢٤٨٫٣٠٠" },
          { label: "ربح/خسارة", value: "+١٩٫٤٥٠", tone: "text-up" },
          { label: "تغيّر اليوم", value: "+١٫٢٪", tone: "text-up" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card px-3 py-2.5 text-end">
            <p className="text-[11px] text-muted-foreground">{stat.label}</p>
            <p className={`num mt-1 text-[14px] font-semibold ${stat.tone ?? ""}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {[
          {
            code: "COMI",
            rec: "احتفاظ",
            tone: "border-border bg-surface-2 text-foreground",
            price: "٧٥٫٤٠",
          },
          { code: "SWDY", rec: "زيادة", tone: "border-up/40 bg-up-soft text-up", price: "٨٫١٨" },
          {
            code: "TMGH",
            rec: "تخفيف",
            tone: "border-warn/40 bg-warn-soft text-foreground",
            price: "٤٥٫١٠",
          },
        ].map((row) => (
          <div
            key={row.code}
            className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3"
          >
            <div className="flex items-center gap-2">
              <span className="num text-[13.5px] font-semibold" dir="ltr">
                {row.code}
              </span>
              <span className={`rounded-md border px-2 py-0.5 text-[11px] ${row.tone}`}>
                {row.rec}
              </span>
            </div>
            <span className="num text-[13.5px] font-semibold">{row.price}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
