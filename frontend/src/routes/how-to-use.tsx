import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Camera,
  CalendarDays,
  Crosshair,
  LineChart,
  PencilLine,
  RefreshCw,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/how-to-use")({
  head: () => ({
    meta: [
      { title: "طريقة الاستخدام — EGXpert" },
      {
        name: "description",
        content:
          "شرح مبسّط لطريقة استخدام EGXpert خطوة بخطوة: عمل الحساب، إضافة أسهمك، وفهم كل شاشة في لوحة التحكم.",
      },
      { property: "og:title", content: "طريقة الاستخدام — EGXpert" },
      {
        property: "og:description",
        content: "شرح مبسّط لكل خطوة، من عمل الحساب لحد فهم التوصية اليومية لكل سهم.",
      },
    ],
  }),
  component: HowToUsePage,
});

const START_STEPS = [
  {
    n: "١",
    title: "اعمل حساب",
    text: "سجّل ببريدك الإلكتروني في دقيقة واحدة. هتاخد تجربة مجانية ٤ أيام بكل المزايا، بدون بطاقة ائتمان.",
  },
  {
    n: "٢",
    title: "ضيف أسهمك",
    text: "من شاشة \"الأسهم\" دوس على إضافة سهم واكتب الكمية ومتوسط سعر الشراء يدويًا، أو صوّر شاشة محفظتك من تطبيق السمسار وارفعها ليتقرأ كل شيء تلقائيًا.",
  },
  {
    n: "٣",
    title: "اختار أسلوبك في الاستثمار",
    text: "من شاشة \"الإعدادات\" حدّد إنك مضارب (أيام) أو متوسط المدى (أسابيع) أو طويل المدى (شهور) — عشان التوصيات والأهداف تتحسب على أساس ده.",
  },
  {
    n: "٤",
    title: "اتابع يوميًا",
    text: "كل يوم هتلاقي توصية واضحة لكل سهم (احتفاظ، زيادة، تخفيف)، مع تنبيه لو أي سهم قرب من وقف الخسارة.",
  },
];

const SCREENS = [
  {
    icon: Wallet,
    to: "/portfolio",
    label: "الأسهم",
    text: "الشاشة الرئيسية لمحفظتك: كل سهم في صف، بالكمية ومتوسط التكلفة والسعر اللحظي والربح أو الخسارة. من هنا تضيف أو تعدّل أو تبيع سهم.",
  },
  {
    icon: Activity,
    to: "/indices",
    label: "المؤشرات",
    text: "نظرة سريعة على حالة السوق العام (المؤشرات الرئيسية) عشان تفهم الاتجاه العام قبل ما تاخد قرار في أسهمك.",
  },
  {
    icon: Crosshair,
    to: "/targets",
    label: "الأهداف",
    text: "لكل سهم شريط بيوضح مكانه بين وقف الخسارة والهدف المتوسط والهدف البعيد، محسوبين تلقائيًا حسب أسلوبك في الاستثمار.",
  },
  {
    icon: CalendarDays,
    to: "/calendar",
    label: "التقويم",
    text: "سجل يومي لإغلاق محفظتك على مدار الشهر والسنة، عشان تتابع أداءك بمرور الوقت مش بس النهاردة.",
  },
  {
    icon: BarChart3,
    to: "/charts",
    label: "الرسوم",
    text: "رسوم بيانية لتوزيع محفظتك بين الأسهم، ومساهمة كل سهم في الربح أو الخسارة، وتطوّر قيمة المحفظة بشكل عام.",
  },
  {
    icon: LineChart,
    to: "/cash",
    label: "الكاش",
    text: "متابعة رصيدك النقدي المتاح، وإضافة إيداع أو سحب، عشان قيمة محفظتك الكلية تفضل دقيقة.",
  },
  {
    icon: RefreshCw,
    to: "/trades",
    label: "الصفقات",
    text: "سجل بكل عمليات الشراء والبيع اللي عملتها، بتاريخها وسعرها والعمولة المحسوبة عليها.",
  },
  {
    icon: Settings,
    to: "/settings",
    label: "الإعدادات",
    text: "تحديد أسلوبك في الاستثمار (مضارب / متوسط المدى / طويل المدى)، وضبط بيانات حسابك.",
  },
];

function HowToUsePage() {
  return (
    <SiteShell>
      <section className="border-b bg-card">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <Badge variant="outline">دليل الاستخدام</Badge>
          <h1 className="mt-4 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl">
            طريقة استخدام EGXpert
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            شرح مبسّط بالعربي لكل خطوة، من عمل الحساب لحد ما تبدأ تاخد قرارك اليومي في كل سهم عندك.
          </p>
        </div>
      </section>

      {/* Getting started */}
      <section className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
        <h2 className="text-2xl font-bold tracking-tight">تبدأ إزاي</h2>
        <ol className="mt-8 space-y-4">
          {START_STEPS.map((step) => (
            <li key={step.n} className="flex gap-4 rounded-xl border bg-card p-5 shadow-sm">
              <span className="num grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
                {step.n}
              </span>
              <div>
                <h3 className="text-[15px] font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                  {step.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Screens walkthrough */}
      <section className="border-y bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">شاشات لوحة التحكم</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            بعد ما تعمل حسابك، هتلاقي القائمة دي في لوحة التحكم — كل شاشة وظيفتها إيه:
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {SCREENS.map(({ icon: Icon, label, text }) => (
              <article key={label} className="rounded-xl border bg-card p-4 shadow-sm">
                <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
                  <Icon className="size-4.5" />
                </span>
                <h3 className="mt-3 text-[14.5px] font-semibold">{label}</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Tips */}
      <section className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
        <h2 className="text-2xl font-bold tracking-tight">نصائح سريعة</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <article className="rounded-xl border bg-card p-5 shadow-sm">
            <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
              <Camera className="size-4.5" />
            </span>
            <h3 className="mt-3 text-[14.5px] font-semibold">أسرع طريقة لإضافة أسهمك</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              بدل ما تكتب كل سهم يدويًا، صوّر شاشة محفظتك من تطبيق السمسار وارفعها من شاشة "الأسهم" —
              العدد والكمية ومتوسط السعر بيتقرأوا تلقائيًا.
            </p>
          </article>
          <article className="rounded-xl border bg-card p-5 shadow-sm">
            <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
              <PencilLine className="size-4.5" />
            </span>
            <h3 className="mt-3 text-[14.5px] font-semibold">راجع أسلوب استثمارك بين فترة وفترة</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              وقف الخسارة والأهداف والتوصية اليومية كلهم بيتغيروا حسب اختيارك في "الإعدادات"، فلو
              هدفك اتغيّر (من مضاربة لطويل المدى مثلًا) عدّله من هناك.
            </p>
          </article>
          <article className="rounded-xl border bg-card p-5 shadow-sm">
            <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
              <Crosshair className="size-4.5" />
            </span>
            <h3 className="mt-3 text-[14.5px] font-semibold">تابع شريط وقف الخسارة يوميًا</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              لو سهم قرب من وقف الخسارة هتلاقي تنبيه واضح في شاشة "الأهداف" — ده مش قرار بيع تلقائي،
              لكنه علامة تستاهل انتباهك.
            </p>
          </article>
          <article className="rounded-xl border bg-card p-5 shadow-sm">
            <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
              <ShieldCheck className="size-4.5" />
            </span>
            <h3 className="mt-3 text-[14.5px] font-semibold">القرار الأخير ليك</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              EGXpert أداة تحليل ومساعدة في القرار مبنية على قواعد واضحة، مش توصية مالية مرخّصة —
              استخدمها كمساعد، والقرار النهائي مسؤوليتك.
            </p>
          </article>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-3xl px-4 pb-16">
        <div className="flex flex-col items-start gap-5 rounded-2xl border bg-card p-7 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">جاهز تجرّب؟</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              ٤ أيام مجانًا بكل المزايا، وتقدر تبدأ من غير أي تعقيد.
            </p>
          </div>
          <Button asChild size="lg">
            <Link to="/login" search={{ mode: "register" }}>
              ابدأ تجربتك المجانية
            </Link>
          </Button>
        </div>
      </section>
    </SiteShell>
  );
}
