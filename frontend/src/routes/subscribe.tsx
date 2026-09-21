import { Link, createFileRoute } from "@tanstack/react-router";

import { SubscribePanel } from "@/components/billing/subscribe-panel";
import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { siteUrl, siteName } from "@/lib/seo";
import { useDesk } from "@/lib/store";

/** Set by a plan's button on /pricing: which tier to show alone, and which billing period starts selected. Both optional, so plain /subscribe links still offer everything. */
type SubscribeSearch = { tier?: "long" | "trader"; period?: "monthly" | "yearly" };

const TIER_TITLE = { long: "النفس الطويل", trader: "الحريفة" } as const;

export const Route = createFileRoute("/subscribe")({
  validateSearch: (search: Record<string, unknown>): SubscribeSearch => ({
    tier: search["tier"] === "long" || search["tier"] === "trader" ? search["tier"] : undefined,
    period: search["period"] === "monthly" || search["period"] === "yearly" ? search["period"] : undefined,
  }),
  head: ({ match }) => ({
    meta: [
      { title: `طريقة الاشتراك — ${siteName(match)}` },
      {
        name: "description",
        content: `اشترك في ${siteName(match)}: باقة النفس الطويل من ٢٩٩ جنيه أو باقة الحريفة من ٤٩٩ جنيه شهريًا. كلّمنا في الشات وهنبعتلك بيانات الدفع ونفعّل حسابك.`,
      },
      { property: "og:title", content: `طريقة الاشتراك — ${siteName(match)}` },
      {
        property: "og:description",
        content: "كلّمنا في الشات وهنبعتلك بيانات الدفع وكل التفاصيل.",
      },
      { property: "og:url", content: `${siteUrl(match)}/subscribe` },
    ],
  }),
  component: SubscribePage,
});

function SubscribePage() {
  const { tier, period } = Route.useSearch();
  const { user, authChecked } = useDesk();

  return (
    <SiteShell>
      <section className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
        <Badge variant="outline">الاشتراك عن طريق الشات</Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
          {tier ? `الاشتراك في باقة ${TIER_TITLE[tier]}` : "طريقة الاشتراك"}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          مفيش دفع بالبطاقة على الموقع. كلّمنا في الشات جوّه التطبيق وقولّنا الباقة اللي عايزها،
          وهنبعتلك بيانات الدفع وكل التفاصيل — وبنفعّل حسابك أول ما نراجع التحويل.
        </p>

        <div className="mt-8">
          <SubscribePanel
            lockedTier={tier}
            initialMonths={period === "monthly" ? 1 : period === "yearly" ? 12 : undefined}
          />
        </div>

        {authChecked && !user && (
          <div className="mt-8 rounded-xl border bg-surface p-5">
            <h2 className="text-[15px] font-semibold">لسه معندكش حساب؟</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              اعمل حساب الأول وجرّب المنتج ٥ أيام تداول مجانًا — تقدر تشترك بعدها أو خلال التجربة، والأيام
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
