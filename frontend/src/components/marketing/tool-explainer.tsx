import {
  BarChart3,
  Brain,
  CalendarCheck,
  Crosshair,
  ShieldAlert,
  Sliders,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * The long-form "what this actually does" section. The FEATURES grid on the
 * landing page is a one-line-per-capability skim; this explains the mechanism
 * behind each one — what the numbers are computed from and what they mean —
 * for someone deciding whether to trust the tool with a real portfolio.
 */
const SECTIONS = [
  {
    icon: Wallet,
    title: "بيشتغل على محفظتك الحقيقية، مش مثال",
    body: "بتدخّل أسهمك بالكمية ومتوسط سعر الشراء — يدويًا، أو بترفع لقطة شاشة من تطبيق السمسار وEGXpert يقراها ويطلّع منها الأسهم والكميات. بعدها كل رقم في الأداة محسوب من مراكزك إنت: التكلفة الفعلية، القيمة الحالية بأسعار السوق، الربح أو الخسارة بالجنيه وبالنسبة، والكاش المتاح. الأسعار بتتحدّث تلقائيًا كل ٢٠ ثانية طول ما السوق شغال.",
  },
  {
    icon: Sliders,
    title: "بيسأل الأول: إنت بتستثمر إزاي؟",
    body: "مضارب (أيام)، متوسط المدى (أسابيع)، ولا طويل المدى (شهور)؟ الإجابة دي مش شكلية — هي اللي بتحدّد قواعد الحساب كلها. نفس السهم بالظبط ممكن يطلع «تخفيف» لمضارب و«احتفاظ» لمستثمر طويل المدى، لأن مدى الحركة المقبولة ومسافة وقف الخسارة بتختلف. والأداة بتقدر تستنتج أسلوبك تلقائيًا من صفقاتك الفعلية لو مخترتش.",
  },
  {
    icon: Crosshair,
    title: "بيحوّل «السهم ده كويس؟» لأرقام",
    body: "لكل سهم بيحسب ثلاث مستويات: وقف الخسارة، الهدف المتوسط، والهدف البعيد — مبنية على حركة السهم نفسه (التذبذب، الدعوم والمقاومات، الاتجاه) وعلى أسلوبك. وبيوريك على شريط سعري السهم واقف فين بين الوقف والهدف دلوقتي، وبينبّهك لو قرب من الوقف. يعني بدل «ممكن يطلع»، بتبقى عارف: بتخرج عند كام، وبتستنى لحد كام.",
  },
  {
    icon: Brain,
    title: "توصية يومية بسبب مكتوب",
    body: "كل يوم بتلاقي لكل سهم توصية واضحة — شراء، زيادة، احتفاظ، تخفيف، أو بيع — مش مجرد كلمة، ومعاها الأساس اللي اتبنت عليه. وفوق ده فيه طبقة تحليل أعمق: تحليل للسوق ككل، وتحليل عميق لأي سهم تختاره بمستويات الدخول والخروج والسيناريوهات المحتملة، وتحليل للكاش المتاح يقترح توزيعه (مرة واحدة كل يوم).",
  },
  {
    icon: CalendarCheck,
    title: "بيبني ذاكرة لمحفظتك يوم بيوم",
    body: "كل يوم تداول بعد إغلاق السوق، EGXpert بيحفظ لوحده لقطة كاملة من محفظتك: القيمة، سعر كل سهم، الوقف، والتوصية. الأسعار الحية بتتغيّر وبتمسح بعضها، فاللقطة دي هي اللي بتتحوّل لتاريخ حقيقي تقدر ترجع له في «التقويم» وترسمه في «الرسوم» — من غير ما تضغط أي زرار.",
  },
  {
    icon: BarChart3,
    title: "بيوريك أداءك على حقيقته",
    body: "توزيع محفظتك بين الأسهم، مساهمة كل سهم في الربح أو الخسارة، وتطوّر القيمة الكلية بمرور الوقت. وسجل الصفقات بيحسب العمولات والربح المحقق فعليًا — عشان الرقم اللي قدامك يكون صافي، مش نظري.",
  },
];

export function ToolExplainer() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-t bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
        <Badge variant="outline">شرح تفصيلي</Badge>
        <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          الأداة بتشتغل إزاي بالظبط؟
        </h2>
        <p className="mt-3 max-w-3xl text-[14.5px] leading-relaxed text-muted-foreground">
          EGXpert مش موقع أخبار ولا مجموعة توصيات جاهزة. هو محرّك بيقرأ محفظتك الحقيقية وأسعار
          البورصة المصرية اللحظية، وبيطلّع لك لكل سهم: تعمل إيه النهاردة، تخرج عند كام، وتستنى لحد
          كام — بقواعد ثابتة تقدر تشوفها، مش إحساس.
        </p>

        <div className="mt-9 grid gap-4 md:grid-cols-2">
          {SECTIONS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <span className="grid size-10 place-items-center rounded-xl bg-secondary text-foreground">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold">{title}</h3>
              <p className="mt-2 text-[13.5px] leading-[1.9] text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn-soft p-5">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          <div>
            <h3 className="text-[15px] font-semibold">وحاجة مهمة: الأداة مش بتقرّر بدالك</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed">
              EGXpert أداة تحليل ومساعدة في القرار، وليست توصية مالية مرخّصة. بيوريك الأرقام والأساس
              اللي اتبنت عليه بوضوح، عشان تقرّر إنت وإنت شايف كل حاجة قدامك — والقرار الأخير
              ومسؤوليته عليك.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
