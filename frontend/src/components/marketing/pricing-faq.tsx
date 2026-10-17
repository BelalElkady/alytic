import { useWhatsappNumber, WhatsAppIcon, whatsappLink } from "@/components/support/whatsapp";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/lib/tenant";

/** The billing/trial FAQ shared by the pricing page and the free tools page. */
export function PricingFaq({ className = "" }: { className?: string }) {
  const { name: brandName } = useTenant();
  const whatsappNumber = useWhatsappNumber();

  const faqs = [
    {
      q: "هل التجربة محتاجة بطاقة؟",
      a: "لا. تعمل حساب وتستخدم الباقة المجانية 5 أيام تداول بحدودها — الإجازات الرسمية وعطلة نهاية الأسبوع مش بتتحسب (صورتين، 15 توصية، و3 مرات تحليل كاش و3 مرات تحليل سوق)، وبعدها تختار باقة النفس الطويل أو الحريفة.",
    },
    {
      q: "الحدود دي بتتجدد إزاي؟",
      a: "عدد مرات كل ميزة في النفس الطويل والحريفة بيتجدد أول كل شهر ميلادي، سواء اشتراكك شهري أو سنوي.",
    },
    {
      q: "إيه اللي بيحصل للرصيد الإضافي لو اشتراكي خلص؟",
      a: "الرصيد الإضافي بيفضل في حسابك ومش بيتلغي، بس مينفعش تستخدمه وباقتك منتهية — بيتجمّد ويرجع يشتغل أول ما تجدد. أما اللي فاضل من حدود باقتك الشهرية فمش بيتنقل للشهر الجديد.",
    },
    {
      q: "بدفع إزاي؟",
      a: "ابعتلنا سكرين من الدفع على الواتساب — وبنفعّل حسابك أول ما نراجع التحويل.",
      whatsapp: true,
    },
    {
      q: "أقدر ألغي في أي وقت؟",
      a: "مفيش تجديد تلقائي أصلًا — الاشتراك بيشتغل لآخر مدته وبعدها بيقف لحد ما تحوّل تاني.",
    },
    {
      q: "هل ده استشارة مالية؟",
      a: `لا. ${brandName} أداة تحليل بقواعد واضحة تساعدك في القرار، والقرار الأخير مسؤوليتك.`,
    },
  ];

  return (
    <div className={`grid gap-4 md:grid-cols-3 ${className}`}>
      {faqs.map((faq) => (
        <article key={faq.q} className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="text-[14px] font-semibold">{faq.q}</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{faq.a}</p>
          {faq.whatsapp && (
            <Button asChild size="sm" className="mt-3 bg-[#25D366] text-white hover:bg-[#1ebe5b]">
              <a
                href={whatsappLink(whatsappNumber, "أهلًا، حوّلت اشتراك ودي صورة الدفع.")}
                target="_blank"
                rel="noopener noreferrer"
              >
                <WhatsAppIcon className="size-4" />
                ابعت على واتساب
              </a>
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}
