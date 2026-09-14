import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Camera,
  CalendarDays,
  Coins,
  Crosshair,
  HelpCircle,
  LineChart,
  PencilLine,
  Radar,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  Wallet,
} from "lucide-react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/how-to-use")({
  head: () => ({
    meta: [
      { title: "طريقة الاستخدام — EGXpert" },
      {
        name: "description",
        content:
          "شرح مبسّط لطريقة استخدام EGXpert خطوة بخطوة: عمل الحساب، إضافة أسهمك، استخدام التوصيات وتحليل الكاش، وفهم كل شاشة في لوحة التحكم.",
      },
      { property: "og:title", content: "طريقة الاستخدام — EGXpert" },
      {
        property: "og:description",
        content: "شرح مبسّط لكل خطوة، من عمل الحساب لحد فهم التوصية اليومية لكل سهم.",
      },
      { property: "og:url", content: `${SITE_URL}/how-to-use` },
    ],
  }),
  component: HowToUsePage,
});

const START_STEPS = [
  {
    n: "١",
    title: "اعمل حساب",
    text: "سجّل ببريدك الإلكتروني في دقيقة واحدة. هتاخد تجربة مجانية ٤ أيام تداول بكل المزايا، بدون بطاقة ائتمان.",
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
    title: "تابع يوميًا",
    text: "كل يوم هتلاقي توصية واضحة لكل سهم (احتفاظ، بيع جزئي، جني أرباح، خروج)، مع تنبيه لو أي سهم قرب من وقف الخسارة. وإغلاق كل يوم بيتسجّل لوحده — مش محتاج تعمل حاجة.",
  },
];

const TOOLBAR = [
  {
    icon: Radar,
    label: "تحليل السوق",
    text: "نافذة تحليل تفصيلي — إما نظرة عامة على السوق كله، أو تحليل عميق لسهم واحد تختاره: مستويات الدخول والخروج، والسيناريوهات المحتملة.",
  },
  {
    icon: Upload,
    label: "رفع صور المحفظة",
    text: "ارفع لقطة شاشة من تطبيق السمسار بتاعك، وEGXpert بيقرأ الأسهم والكميات والكاش من الصورة ويحدّث محفظتك تلقائيًا. الرفع بيستبدل مراكزك الحالية بالكامل بما يظهر في الصورة، فاستخدمه لما تكون عايز تزامن كامل مش إضافة سهم واحد بس.",
  },
  {
    icon: PencilLine,
    label: "إدخال يدوي",
    text: "لتعديل عدد الأسهم ومتوسط الشراء والوقف والهدف من غير رفع صورة. وفيه زرار «إدخال صفقة جديدة» تسجّل منه أي بيع أو شراء اتنفذ (السهم، النوع، العدد، السعر، التاريخ)، وتحته سجل الصفقات بالعمولات والربح المحقق.",
  },
];

// Labels mirror backend/src/scoring/risk.js positionRecommendation.
const REC_LABELS = [
  {
    label: "احتفاظ",
    tone: "border-border bg-surface-2 text-foreground",
    text: "السهم داخل نطاقه ومش محتاج قرار. لو مكتوب «قريب من الوقف» راقبه كويس — إغلاق تحت الوقف يعني خروج.",
  },
  {
    label: "بيع جزئي",
    tone: "border-warn/40 bg-warn-soft text-foreground",
    text: "السهم مربح كفاية. بيع الكمية المكتوبة بأمر محدد عند السعر المقترح، وسيب الباقي بوقف متحرك.",
  },
  {
    label: "جني أرباح",
    tone: "border-warn/40 bg-warn-soft text-foreground",
    text: "السهم وصل الهدف. بيع الكمية المكتوبة، وارفع الوقف للباقي للسعر اللي في التوصية.",
  },
  {
    label: "خروج — وقف",
    tone: "border-down/40 bg-down-soft text-down",
    text: "السهم قفل تحت وقف الخسارة. بيع الكمية كلها — ده القرار الوحيد اللي مفيهوش نقاش.",
  },
  {
    label: "زيادة شراء",
    tone: "border-up/40 bg-up-soft text-up",
    text: "سهم قوي نزل مؤقتًا وهو لسه فوق متوسط ٢٠٠ يوم. فرصة تحسّن متوسط سعرك بأمر محدد عند الدعم.",
  },
];

const REC_STEPS = [
  {
    title: "ابدأ بالتنبيهات",
    text: "أول ما تفتح «الأسهم» هتلاقي فوق تنبيه لأي سهم قرب من الوقف أو كسره — دول أول حاجة تبص عليها.",
  },
  {
    title: "اقرأ التوصية والأمر",
    text: "تحت كل سهم مكتوب توصية اليوم وسببها. ولو فيها عملية، هتلاقي سطر «الأمر»: بيع أو شراء، عدد الأسهم، السعر، والقيمة التقريبية بالجنيه.",
  },
  {
    title: "نفّذ من تطبيق السمسار",
    text: "حط أمر محدد بنفس الكمية والسعر المكتوبين. EGXpert مش بيتصل بحسابك عند السمسار ومش بينفّذ حاجة لوحده.",
  },
  {
    title: "سجّل الصفقة",
    text: "بعد التنفيذ افتح «إدخال يدوي» ← «إدخال صفقة جديدة». كده الكمية والكاش بيتحدّثوا، والتوصية الجاية بتتحسب على مركزك الجديد.",
  },
  {
    title: "عايز رأي أعمق؟ اطلب توصية اليوم",
    text: "دوس «قولي توصية اليوم» على كارت السهم، أو «توصية اليوم لكل الأسهم» فوق عشان تاخدها لكل الأسهم مرة واحدة. التحليل بيراجع السهم ويكتب القرار ودرجة ثقته، والأمر أو المستوى اللي تراقبه — وبتاخد مكان التوصية الأساسية على الكارت.",
  },
];

const CASH_STEPS = [
  {
    title: "حدّث رصيد الكاش",
    text: "من شاشة «تحليل الكاش» اكتب رصيدك الفعلي في «المبلغ» ودوس «حفظ». الصفقات اللي بتسجّلها من «إدخال يدوي» بتعدّله لوحدها. تحته هتلاقي نسبة الكاش من محفظتك ونصيحة سريعة حسب النسبة دي.",
  },
  {
    title: "دوس «حلل استخدام الكاش»",
    text: "هتفتح نافذة «أفضل توزيع للكاش». لو عايز الاختيار يبقى من مؤشر معيّن اختاره من فوق (EGX30، EGX70، …)، أو سيبها «الكل».",
  },
  {
    title: "اقرأ الملخص",
    text: "الكاش المتاح، والمبلغ «القابل للتوزيع» بعد ما يتشال الاحتياطي، و«متوسط لكل سهم» — يعني تقريبًا هتحط كام في كل سهم.",
  },
  {
    title: "شوف اقتراح كل سهم",
    text: "لكل سهم مختار: عدد الأسهم، سعر الدخول، التكلفة، والكاش اللي هيفضل معاك بعد الشراء — ومعاه وقف الخسارة والهدف والتقييم من ١٠٠.",
  },
  {
    title: "اقرأ مراجعة الكاش",
    text: "لو عندك كاش، بيظهر فوق الموقف العام: «انشر الكاش دلوقتي» أو «انشر على دفعات» أو «احتفظ بالكاش»، مع قراءة للسوق ومحفظتك وأسلوبك في التداول، وإزاي تنفّذ، والمخاطر، والأولوية. وعلى كل سهم بيقولك: اشتري دلوقتي، اشتري على تصحيح، استنى، أو سيبه — والحاجة اللي تراقبها.",
  },
  {
    title: "نفّذ وسجّل",
    text: "اشتري بأوامر محددة من تطبيق السمسار، مش بسعر السوق. ولو الموقف «على دفعات» ماتنزلش الكاش كله مرة واحدة. بعد كل عملية سجّلها من «إدخال يدوي» عشان الكاش يتحدّث.",
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
    text: "تقويم شهري فيه كل يوم تداول اتسجّل إغلاقه تلقائيًا. دوس على أي تاريخ عشان تشوف قيمة محفظتك، سعر كل سهم، الوقف والتوصية اللي كانت عليه ساعتها، وتقدر تكتب ملاحظة على اليوم ده.",
  },
  {
    icon: BarChart3,
    to: "/charts",
    label: "الرسوم",
    text: 'رسوم بيانية لتوزيع محفظتك بين الأسهم، ومساهمة كل سهم في الربح أو الخسارة، وتطوّر قيمة المحفظة يوم بيوم — مبنية على سجل الإغلاق اليومي اللي بيتحفظ تلقائيًا. لو بدأت متأخر، فيه زرار لبناء سجل تقديري لآخر ٩٠ يوم من أسعار السوق الحقيقية.',
  },
  {
    icon: LineChart,
    to: "/cash",
    label: "تحليل الكاش",
    text: "رصيدك النقدي ونسبته من محفظتك، وزرار «حلل استخدام الكاش» اللي بيقترح تشتري إيه وبكام. وفيها كمان «الأسهم المفضلة» عشان تتابع سعر وتقييم أسهم مش معاك.",
  },
  {
    icon: Settings,
    to: "/settings",
    label: "الإعدادات",
    text: "تحديد أسلوبك في الاستثمار (مضارب / متوسط المدى / طويل المدى)، وضبط بيانات حسابك.",
  },
];

const FAQ = [
  {
    q: "لازم أسجّل إغلاق اليوم بنفسي؟",
    a: 'لأ. كل يوم تداول بعد إغلاق السوق، EGXpert بيحفظ لوحده لقطة من محفظتك: قيمتها، سعر كل سهم، الوقف والتوصية — وهي اللي بتظهر في "التقويم" و"الرسوم". أيام الجمعة والسبت والإجازات الرسمية مفيش تسجيل لأن مفيش جلسة.',
  },
  {
    q: "إمتى بيتسجّل بالظبط؟",
    a: "بعد إغلاق الجلسة (٢:٣٠ الضهر بتوقيت القاهرة)، عشان السعر المحفوظ يبقى سعر الإغلاق الفعلي مش سعر في نص التداول. ممكن ياخد شوية وقت بعد الإغلاق، فلو اليوم لسه مش ظاهر في التقويم ارجع بعد شوية.",
  },
  {
    q: "مفيش سجل للأيام اللي قبل ما أبدأ، أعمل إيه؟",
    a: 'من شاشة "الرسوم" فيه زرار يبني سجل تقديري لآخر ٩٠ يوم من أسعار السوق الحقيقية — لكنه محسوب على عدد الأسهم اللي معاك دلوقتي ("كانت هتساوي كام لو كانت معاك يومها")، مش سجل فعلي لمراكزك وقتها.',
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
      <section id="start" className="mx-auto scroll-mt-20 w-full max-w-3xl px-4 py-14 sm:py-16">
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

      {/* Toolbar */}
      <section className="border-y bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">أزرار الشاشة العلوية</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            في أعلى لوحة التحكم هتلاقي شريط بيه ٣ أزرار سريعة تستخدمها يوميًا:
          </p>
          <ol className="mt-8 space-y-4">
            {TOOLBAR.map((item, index) => (
              <li key={item.label} className="flex gap-4 rounded-xl border bg-card p-5 shadow-sm">
                <span className="num grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <div>
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                    <item.icon className="size-4 text-muted-foreground" />
                    {item.label}
                  </h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                    {item.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Screens walkthrough */}
      <section className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
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
      </section>

      {/* Recommendations */}
      <section id="recommendations" className="scroll-mt-16 border-y bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Sparkles className="size-5 text-primary" />
            إزاي تستخدم التوصيات
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            في شاشة "الأسهم" كل سهم له توصية لليوم — كلمة ملوّنة جنب اسمه، وتحتها السبب والأمر
            المقترح. بتتحسب من قواعد ثابتة على حركة السهم ومركزك وأسلوبك في الاستثمار.
          </p>

          <h3 className="mt-8 text-[15px] font-semibold">كل توصية معناها إيه</h3>
          <div className="mt-4 space-y-3">
            {REC_LABELS.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-start sm:gap-4"
              >
                <Badge variant="outline" className={`shrink-0 sm:mt-0.5 sm:w-24 sm:justify-center ${item.tone}`}>
                  {item.label}
                </Badge>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{item.text}</p>
              </div>
            ))}
          </div>

          <h3 className="mt-10 text-[15px] font-semibold">تستخدمها إزاي كل يوم</h3>
          <ol className="mt-4 space-y-4">
            {REC_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4 rounded-xl border bg-card p-5 shadow-sm">
                <span className="num grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <div>
                  <h4 className="text-[14.5px] font-semibold">{step.title}</h4>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {step.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 rounded-xl border border-warn/40 bg-warn-soft p-4 text-[12.5px] leading-relaxed">
            المشترك له توصية تحليلية واحدة لكل سهم في اليوم، وفي التجربة المجانية توصية واحدة
            لكل سهم. وتغيير أسلوبك في الاستثمار من "الإعدادات" بيغيّر التوصيات والوقف والأهداف كلهم.
          </p>
        </div>
      </section>

      {/* Cash analysis */}
      <section id="cash-analysis" className="mx-auto scroll-mt-20 w-full max-w-3xl px-4 py-14 sm:py-16">
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Coins className="size-5 text-primary" />
          إزاي تستخدم تحليل الكاش
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          لو معاك فلوس مش مستثمرة، تحليل الكاش بيقولك تعمل بيها إيه: تشتري أنهي أسهم، بكمية كام
          وبسعر كام، وتسيب قد إيه احتياطي.
        </p>
        <ol className="mt-8 space-y-4">
          {CASH_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-xl border bg-card p-5 shadow-sm">
              <span className="num grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <div>
                <h3 className="text-[14.5px] font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {step.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 rounded-xl border border-warn/40 bg-warn-soft p-4 text-[12.5px] leading-relaxed">
          في التجربة المجانية عدد مرات تحليل الكاش محدود، والعدد الباقي مكتوب تحت الزرار. بعد
          الاشتراك مفيش حد.
        </p>
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

      {/* FAQ */}
      <section className="border-y bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">أسئلة شائعة عن السجل اليومي</h2>
          <div className="mt-8 space-y-4">
            {FAQ.map((item) => (
              <article key={item.q} className="rounded-xl border bg-card p-5 shadow-sm">
                <h3 className="flex items-start gap-2 text-[14px] font-semibold">
                  <HelpCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {item.q}
                </h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-3xl px-4 pb-16">
        <div className="flex flex-col items-start gap-5 rounded-2xl border bg-card p-7 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">جاهز تجرّب؟</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              ٤ أيام تداول مجانًا بكل المزايا، وتقدر تبدأ من غير أي تعقيد.
            </p>
          </div>
          <Button asChild size="lg">
            <Link to="/pricing">ابدأ تجربتك المجانية</Link>
          </Button>
        </div>
      </section>
    </SiteShell>
  );
}
