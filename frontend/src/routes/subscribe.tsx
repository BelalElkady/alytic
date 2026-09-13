import { Link, createFileRoute } from "@tanstack/react-router";

import { SubscribePanel } from "@/components/billing/subscribe-panel";
import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SITE_URL } from "@/lib/seo";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/subscribe")({
  head: () => ({
    meta: [
      { title: "طريقة الاشتراك — EGXpert" },
      {
        name: "description",
        content:
          "اشترك في EGXpert: شهري ١٤٩ جنيه أو سنوي ١٥٩٩ جنيه. كلّمنا في الشات وهنبعتلك بيانات الدفع ونفعّل حسابك.",
      },
      { property: "og:title", content: "طريقة الاشتراك — EGXpert" },
      {
        property: "og:description",
        content: "كلّمنا في الشات وهنبعتلك بيانات الدفع وكل التفاصيل.",
      },
      { property: "og:url", content: `${SITE_URL}/subscribe` },
    ],
  }),
  component: SubscribePage,
});

function SubscribePage() {
  const { user, authChecked } = useDesk();

  return (
    <SiteShell>
      <section className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
        <Badge variant="outline">الاشتراك عن طريق الشات</Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">طريقة الاشتراك</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          مفيش دفع بالبطاقة على الموقع. كلّمنا في الشات جوّه التطبيق وقولّنا الباقة اللي عايزها،
          وهنبعتلك بيانات الدفع وكل التفاصيل — وبنفعّل حسابك أول ما نراجع التحويل.
        </p>

        <div className="mt-8">
          <SubscribePanel />
        </div>

        {authChecked && !user && (
          <div className="mt-8 rounded-xl border bg-surface p-5">
            <h2 className="text-[15px] font-semibold">لسه معندكش حساب؟</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              اعمل حساب الأول وجرّب المنتج ٤ أيام تداول مجانًا — تقدر تشترك بعدها أو خلال التجربة، والأيام
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
