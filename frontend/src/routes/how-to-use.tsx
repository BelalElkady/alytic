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
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";

import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canonical, siteUrl, siteName } from "@/lib/seo";
import { useTenant, withBrand } from "@/lib/tenant";

export const Route = createFileRoute("/how-to-use")({
  head: ({ match }) => ({
    meta: [
      { title: `طريقة الاستخدام — ${siteName(match)}` },
      {
        name: "description",
        content: `شرح مبسّط لطريقة استخدام ${siteName(match)} خطوة بخطوة: عمل الحساب، إضافة أسهمك، استخدام التوصيات وتحليل الكاش، وفهم كل شاشة في لوحة التحكم.`,
      },
      { property: "og:title", content: `طريقة الاستخدام — ${siteName(match)}` },
      {
        property: "og:description",
        content: "شرح مبسّط لكل خطوة، من عمل الحساب لحد فهم التوصية اليومية لكل سهم.",
      },
      { property: "og:url", content: `${siteUrl(match)}/how-to-use` },
    ],
    links: [canonical(match, "/how-to-use")],
  }),
  component: HowToUsePage,
});

const START_STEPS = [
  {
    n: "١",
    title: "اعمل حساب",
    text: "سجّل ببريدك الإلكتروني وفعّله من الرابط اللي هيوصلك. هتاخد تجربة مجانية ٥ أيام تداول بكل المزايا، بدون بطاقة ائتمان. أول ما تدخل هنطلب منك رقم موبايلك.",
  },
  {
    n: "٢",
    title: "اختار أسلوبك في الاستثمار",
    text: "أول مرة تفتح لوحة التحكم هيظهرلك سؤال لازم تجاوبه: مضارب (أيام) ولا متوسط المدى (أسابيع) ولا طويل المدى (شهور). اختيارك بيحدد مسافة وقف الخسارة وجني الأرباح وحجم الصفقة، وتقدر تغيّره بعدين من «البروفايل والإعدادات».",
  },
  {
    n: "٣",
    title: "ضيف أسهمك",
    text: "صوّر شاشة محفظتك من تطبيق السمسار وارفعها من زرار «رفع صور المحفظة» فوق، وهي تتقرا تلقائيًا. أو افتح «إدخال يدوي» ← «صفقة جديدة» وسجّل كل سهم بالكمية وسعر الشراء.",
  },
  {
    n: "٤",
    title: "تابع يوميًا وسجّل كل صفقة",
    text: "كل سهم عليه توصية واضحة (احتفاظ، بيع جزئي، جني أرباح، خروج) بالسعر اللحظي، مع تنبيه لو قرب من وقف الخسارة. وأي بيع أو شراء تنفّذه عند السمسار سجّله فورًا عشان التحليل يفضل على أرقامك الحقيقية. إغلاق كل يوم بيتسجّل لوحده — مش محتاج تعمل حاجة.",
  },
];

const TOOLBAR = [
  {
    icon: Radar,
    label: "تحليل السوق",
    text: "بيفتحلك صفحة تحليل السوق: ترتيب الأسهم حسب التقييم والفرص القابلة للتنفيذ. تقدر تبحث عن أي سهم بالكود أو الاسم، ولما تدوس على أي سهم بيفتح تحليله التفصيلي: مستويات الدخول والوقف والأهداف والدعوم والمقاومات.",
  },
  {
    icon: Upload,
    label: "رفع صور المحفظة",
    text: "ارفع لقطة شاشة (أو أكتر) من تطبيق السمسار بتاعك، وEGXpert بيقرأ الأسهم والكميات من الصورة. بعد الرفع هيسألك: «إضافة/تحديث» بيحدّث الأسهم اللي في الصور بس ويسيب الباقي زي ما هو، و«استبدال المحفظة بالكامل» بيمسح أي سهم مش ظاهر في الصور. ولو الصورة لقائمة متابعة من غير كميات، الأسهم بتتضاف لـ«الأسهم المفضلة» بس ومحفظتك والكاش بيفضلوا زي ما هم. صناديق المؤشرات (ETF) مش مدعومة، فالصورة اللي فيها صندوق مبتضيفش حاجة — ضيف أسهمها من «إدخال يدوي».",
  },
  {
    icon: PencilLine,
    label: "إدخال يدوي",
    text: "فيه ٣ تبويبات: «تعديل» لتصحيح عدد الأسهم ومتوسط الشراء من غير رفع صورة، و«صفقة جديدة» تسجّل منه أي بيع أو شراء اتنفذ (السهم، النوع، العدد، السعر، التاريخ) — أو «توزيعات أرباح» نقدية وصلتك: عدد الأسهم المستحقة والتوزيع للسهم، وبتتضاف للكاش والربح المحقق من غير ما تغيّر عدد أسهمك أو متوسط الشراء، و«سجل الصفقات» فيه جدول بكل الصفقات بالعمولات والربح المحقق، وتقدر تصحّح منه أي صفقة اتسجلت غلط.",
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
    text: "السهم وصل الهدف. بيع الكمية المكتوبة، وارفع الوقف للباقي للسعر اللي في التوصية. ولو السعر عدّى الهدف، EGXpert بيحسب هدف جديد للباقي ويكتبه لك.",
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
    text: "أول ما تفتح «الأسهم» هتلاقي فوق تنبيه لأي سهم قرب من الوقف أو كسره أو وصل الهدف — دول أول حاجة تبص عليها.",
  },
  {
    title: "اقرأ التوصية والأمر",
    text: "تحت كل سهم مكتوب توصية اليوم وسببها. ولو فيها عملية، هتلاقي سطر «الأمر»: بيع أو شراء، عدد الأسهم، السعر، والقيمة التقريبية بالجنيه. ولو التوصية محسوبة على إغلاق يوم قبل كده (لسه ماتحدّثتش النهارده)، هتلاقي مكتوب «توصية قديمة» بالأحمر بدل «توصية اليوم» — خد بالك منها قبل ما تتصرف.",
  },
  {
    title: "نفّذ من تطبيق السمسار",
    text: "حط أمر محدد بنفس الكمية والسعر المكتوبين. EGXpert مش بيتصل بحسابك عند السمسار ومش بينفّذ حاجة لوحده.",
  },
  {
    title: "سجّل الصفقة",
    text: "بعد التنفيذ دوس «سجّل صفقة» في التنبيه اللي فوق الشاشة، أو افتح «إدخال يدوي» ← «صفقة جديدة». كده الكمية والكاش بيتحدّثوا، والتوصية الجاية بتتحسب على مركزك الجديد.",
  },
  {
    title: "عايز رأي أعمق؟ اطلب توصية اليوم",
    text: "دوس «قولي توصية اليوم» على كارت السهم. التحليل بيراجع السهم ويكتب القرار ودرجة ثقته، والأمر أو المستوى اللي تراقبه — وبتاخد مكان التوصية الأساسية على الكارت. ولو عايزها لكل الأسهم مرة واحدة دوس «توصية اليوم لكل الأسهم» فوق: بتطلب بس للأسهم اللي مالهاش توصية النهارده، وقبل ما تأكد بيقولك هتتكلف كام توصية من رصيدك.",
  },
  {
    title: "التوصية بتفضل لحد ما تطلب جديدة",
    text: "آخر توصية طلبتها بتفضل على الكارت ومكتوب جنبها تاريخها، حتى في الأيام اللي بعدها. ولو السعر عدّى الوقف أو الهدف أو اتحرك ٣٪ أو أكتر من وقت ما اتكتبت، هيظهر تحتها «التوصية دي قديمة» — ساعتها دوس «توصية جديدة» قبل ما تتصرف.",
  },
];

const LIVE_POINTS = [
  "الربح والخسارة والمسافة للوقف والهدف على كل كارت بتتحسب بالسعر اللحظي وقت الجلسة، مش بسعر إغلاق امبارح.",
  "وقف الخسارة بيحدده الذكاء الاصطناعي لكل سهم حسب حركته وأسلوبك. ولما السهم يطلع، الوقف بيطلع وراه خلال الجلسة — عمره ما بينزل.",
  "الخروج بيتحسب على الإغلاق: لازم السهم يقفل تحت الوقف، مش مجرد يلمسه في نص الجلسة.",
  "لو السعر عدّى الهدف المتوسط أو البعيد، بيتحسب هدف جديد من السعر الحالي، والهدف اللي اتعدّى بيفضل ظاهر عشان تعرف إنه اتحقق.",
];

const CASH_STEPS = [
  {
    title: "حدّث رصيد الكاش",
    text: "من شاشة «تحليل الكاش» اكتب رصيدك الفعلي في «المبلغ» ودوس «حفظ». الصفقات اللي بتسجّلها من «إدخال يدوي» بتعدّله لوحدها. تحته هتلاقي نسبة الكاش من محفظتك ونصيحة سريعة حسب النسبة دي.",
  },
  {
    title: "دوس «حلل استخدام الكاش»",
    text: "هتفتح نافذة «أفضل توزيع للكاش». لو عايز الاختيار يبقى من مؤشر معيّن اختاره من فوق (EGX30، EGX70، …)، أو سيبها «الكل». ولو عايز تعرف الحساب ماشي إزاي، افتح «تحليل الكاش بيعمل إيه بالظبط؟» تحت الزرار — فيه كل خطوة بالأرقام اللي بتنطبق على أسلوبك.",
  },
  {
    title: "اقرأ الملخص",
    text: "الكاش المتاح، والمبلغ «القابل للتوزيع» بعد ما يتشال الاحتياطي، و«متوسط لكل سهم» — يعني تقريبًا هتحط كام في كل سهم. الخطة بتوزّع الفلوس على سهمين على الأقل (لو فيه أسهم مناسبة كفاية)، عشان متحطش الكاش كله في سهم واحد.",
  },
  {
    title: "شوف اقتراح كل سهم",
    text: "لكل سهم مختار: عدد الأسهم، سعر الدخول، التكلفة، والكاش اللي هيفضل معاك بعد الشراء — ومعاه وقف الخسارة والهدف والتقييم من ١٠٠. ودوس «التحليل الكامل» لو عايز تشوف السهم بالتفصيل.",
  },
  {
    title: "اقرأ رأي الذكاء الاصطناعي في كل سهم",
    text: "تحت كل اقتراح بيظهر تعليق بيقولك: اشتري دلوقتي، اشتري على تصحيح، استنى، أو سيبه — مع درجة الثقة، وهل السهم بيناسب محفظتك، والحاجة اللي تراقبها. التعليق ده بيقيّم الخطة بس ومبيغيّرش أي رقم فيها.",
  },
  {
    title: "نفّذ وسجّل",
    text: "اشتري بأوامر محددة من تطبيق السمسار، مش بسعر السوق. بعد كل عملية سجّلها من «إدخال يدوي» ← «صفقة جديدة» عشان الكاش والمراكز يتحدّثوا.",
  },
];

const SCREENS = [
  {
    icon: Wallet,
    to: "/portfolio",
    label: "الأسهم",
    text: "الشاشة الرئيسية لمحفظتك: كارت لكل سهم فيه الكمية ومتوسط التكلفة والربح أو الخسارة بالسعر اللحظي، وشريط بيوضح مكان السعر بين الوقف والهدف، وتوصية اليوم. فوق فيها تذكير بتسجيل الصفقات والتنبيهات. ومن «ترتيب:» تقدر ترتّب أسهمك بترتيب الإضافة، أو الربح (٪ أو بالجنيه)، أو القيمة السوقية، أو تغيّر اليوم، أو التقييم الفني، والزرار اللي جنبها بيعكس الترتيب — واختيارك بيتحفظ للمرة الجاية. دوس على أي سهم تفتح تفاصيله.",
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
    text: "جدول بأهداف أسهمك مرتبة من الأقرب للأبعد: السعر الحالي، الهدف، المسافة ليه، تقدير زمني للوصول، والعائد مقابل المخاطرة لو اشتريت من السعر الحالي. الهدف اللي في الجدول هو اللي بيناسب أسلوبك: الهدف المتوسط، أو البعيد لو أسلوبك طويل المدى — والمسافة والتقدير الزمني محسوبين لنفس الهدف ده.",
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
    text: "رسوم بيانية لتوزيع محفظتك بين الأسهم، ومساهمة كل سهم في الربح أو الخسارة، وتطوّر قيمة المحفظة يوم بيوم — مبنية على سجل الإغلاق اليومي اللي بيتحفظ تلقائيًا. لو بدأت متأخر، فيه زرار لبناء سجل تقديري لآخر ٩٠ يوم من أسعار السوق الحقيقية.",
  },
  {
    icon: Radar,
    to: "/market",
    label: "تحليل السوق",
    text: "بتفتحها من زرار «تحليل السوق» فوق. ترتيب أسهم السوق حسب التقييم والفرص القابلة للتنفيذ، مع فلتر بالمؤشر وبحث عن أي سهم بالكود أو الاسم (عربي أو إنجليزي). فتح الصفحة بيخصم محاولة من رصيدك الشهري، ولو فتحتها تاني خلال 10 دقايق مبيتحسبش محاولة تانية.",
  },
  {
    icon: TrendingUp,
    to: "/market",
    label: "صفحة السهم",
    text: "من تفاصيل أي سهم دوس «صفحة السهم الكاملة»: رسم لحركة السعر (اليوم، أسبوع، شهر، ٦ شهور، سنة، ٥ سنين)، الأداء، المؤشرات الفنية، الأساسيات، التصنيف (استثماري / مضاربي)، الدعوم والمقاومات، خطة الدخول والوقف والأهداف، ومركزك في السهم لو معاك. ولو مش فاهم مصطلح زي RSI أو MACD أو مكرر الربحية، دوس عليه (أو قف عليه بالماوس) وهيظهرلك شرحه.",
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
    label: "البروفايل والإعدادات",
    text: "بياناتك (الاسم ورقم الموبايل) وتقدر تعدّلها، رصيدك المتبقي هذا الشهر في كل ميزة، وتحديد أسلوبك في الاستثمار (مضارب / متوسط المدى / طويل المدى).",
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
  const { name: brandName } = useTenant();
  return (
    <SiteShell>
      <section className="border-b bg-card">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <Badge variant="outline">دليل الاستخدام</Badge>
          <h1 className="mt-4 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl">
            طريقة استخدام {brandName}
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
                    {withBrand(item.text, brandName)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 rounded-xl border border-warn/40 bg-warn-soft p-4 text-[12.5px] leading-relaxed">
            «تحليل السوق» و«رفع صور المحفظة» ليهم رصيد شهري حسب باقتك (شوف صفحة الأسعار)، والعدد
            الباقي مكتوب جنب الزرار — أما «إدخال يدوي» فبلا حدود. لو خلص رصيد أي ميزة قبل ما يجي
            الشهر الجاي، تقدر تشتري رصيد إضافي دفعة واحدة من صفحة الأسعار. وتقدر تشوف رصيدك في كل
            ميزة أول ما تحب من صفحة «البروفايل والإعدادات».
          </p>
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
            المقترح. بتتحسب من قواعد واضحة على حركة السهم ومركزك وأسلوبك في الاستثمار.
          </p>

          <h3 className="mt-8 text-[15px] font-semibold">الأرقام بتتحرك مع السعر</h3>
          <ul className="mt-4 space-y-2 rounded-xl border bg-card p-5 shadow-sm">
            {LIVE_POINTS.map((point) => (
              <li
                key={point}
                className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground"
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                {point}
              </li>
            ))}
          </ul>

          <h3 className="mt-8 text-[15px] font-semibold">كل توصية معناها إيه</h3>
          <div className="mt-4 space-y-3">
            {REC_LABELS.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-start sm:gap-4"
              >
                <Badge
                  variant="outline"
                  className={`shrink-0 sm:mt-0.5 sm:w-24 sm:justify-center ${item.tone}`}
                >
                  {item.label}
                </Badge>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {withBrand(item.text, brandName)}
                </p>
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
                    {withBrand(step.text, brandName)}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 rounded-xl border border-warn/40 bg-warn-soft p-4 text-[12.5px] leading-relaxed">
            كل باقة معاها رصيد توصيات (شوف صفحة الأسعار) تستخدمه براحتك — كل مرة تطلب توصية، حتى لو
            لنفس السهم أكتر من مرة في اليوم، بتستهلك واحدة من الرصيد لحد ما يخلص. وتغيير أسلوبك في
            الاستثمار من "الإعدادات" بيغيّر التوصيات والوقف والأهداف كلهم.
          </p>
        </div>
      </section>

      {/* Cash analysis */}
      <section
        id="cash-analysis"
        className="mx-auto scroll-mt-20 w-full max-w-3xl px-4 py-14 sm:py-16"
      >
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
          كل باقة ليها عدد مرات تحليل كاش متاح في الشهر (شوف صفحة الأسعار)، والعدد الباقي مكتوب تحت
          الزرار. فتح التحليل بيخصم محاولة، ولو فتحته تاني خلال 10 دقايق مبيتحسبش محاولة تانية.
          والتحليل بيشتغل على الكاش المسجّل عندك بس، فحدّثه الأول.
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
              بدل ما تكتب كل سهم يدويًا، صوّر شاشة محفظتك من تطبيق السمسار وارفعها من زرار «رفع صور
              المحفظة» فوق — الأسهم والكميات بيتقرأوا تلقائيًا. لو الكمية اتحسبت تقديري هتلاقي عليها
              «⚠️ عدد تقديري»، صحّحها من «إدخال يدوي».
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
              على كل كارت في "الأسهم" شريط بيوضح السعر فين بين الوقف والهدف، ولو سهم قرب من الوقف
              هتلاقي تنبيه واضح فوق الشاشة — ده مش قرار بيع تلقائي، لكنه علامة تستاهل انتباهك.
            </p>
          </article>
          <article className="rounded-xl border bg-card p-5 shadow-sm">
            <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
              <ShieldCheck className="size-4.5" />
            </span>
            <h3 className="mt-3 text-[14.5px] font-semibold">القرار الأخير ليك</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {brandName} أداة تحليل ومساعدة في القرار مبنية على قواعد واضحة، مش توصية مالية مرخّصة،
              ومش متوصّلة بحسابك عند السمسار — استخدمها كمساعد، والقرار النهائي مسؤوليتك. ولو عندك
              أي سؤال كلّمنا من الشات أو واتساب في ركن الشاشة.
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
                  {withBrand(item.a, brandName)}
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
              ٥ أيام تداول مجانًا بكل المزايا، وتقدر تبدأ من غير أي تعقيد.
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
