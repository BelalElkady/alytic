import { Link, createFileRoute } from "@tanstack/react-router";

import { SubscribePanel } from "@/components/billing/subscribe-panel";
import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/subscribe")({
  head: () => ({
    meta: [
      { title: "طريقة الاشتراك — EGXpert" },
      {
        name: "description",
        content:
          "اشترك في EGXpert بتحويل InstaPay: شهري ١٤٩ جنيه أو سنوي ١٦١٠ جنيه، وبنفعّل حسابك بعد مراجعة التحويل.",
      },
      { property: "og:title", content: "طريقة الاشتراك — EGXpert" },
      {
        property: "og:description",
        content: "حوّل على InstaPay وابعتلنا الإيصال، وهنفعّل اشتراكك يدويًا.",
      },
    ],
  }),
  component: SubscribePage,
});

function SubscribePage() {
  const { user, authChecked } = useDesk();

  return (
    <SiteShell>
      <section className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
        <Badge variant="outline">الاشتراك بتحويل InstaPay</Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">طريقة الاشتراك</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          مفيش دفع بالبطاقة على الموقع. بتحوّل على InstaPay، وبنراجع التحويل ونفعّل حسابك يدويًا —
          وبعدها بتستخدم كل المزايا لحد تاريخ انتهاء الاشتراك.
        </p>

        <div className="mt-8">
          <SubscribePanel />
        </div>

        {authChecked && !user && (
          <div className="mt-8 rounded-xl border bg-surface p-5">
            <h2 className="text-[15px] font-semibold">لسه معندكش حساب؟</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              اعمل حساب الأول وجرّب المنتج ٤ أيام مجانًا — تقدر تشترك بعدها أو خلال التجربة، والأيام
              الباقية بتتضاف لاشتراكك.
            </p>
            <Button asChild className="mt-4">
              <Link to="/login" search={{ mode: "register" }}>
                ابدأ التجربة المجانية
              </Link>
            </Button>
          </div>
        )}
      </section>
    </SiteShell>
  );
}
