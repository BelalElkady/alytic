import { createFileRoute } from "@tanstack/react-router";

import { AveragingCalculator } from "@/components/marketing/averaging-calculator";
import { SiteShell } from "@/components/marketing/site-shell";
import { Badge } from "@/components/ui/badge";
import { canonical, siteUrl, siteName } from "@/lib/seo";
import { withBrand } from "@/lib/tenant";

const DESCRIPTION =
  "أدوات مجانية للمستثمر في البورصة المصرية: حاسبة المتوسط لسعر السهم بعد التعزيز أو الشراء على أكتر من مرحلة.";

export const Route = createFileRoute("/free-tools")({
  head: ({ match }) => ({
    meta: [
      { title: `أدوات مجانية — ${siteName(match)}` },
      { name: "description", content: withBrand(DESCRIPTION, siteName(match)) },
      { property: "og:title", content: `أدوات مجانية — ${siteName(match)}` },
      { property: "og:description", content: withBrand(DESCRIPTION, siteName(match)) },
      { property: "og:url", content: `${siteUrl(match)}/free-tools` },
    ],
    links: [canonical(match, "/free-tools")],
  }),
  component: FreeToolsPage,
});

function FreeToolsPage() {
  return (
    <SiteShell>
      <section className="border-b bg-card">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
          <Badge variant="outline">أدوات مجانية</Badge>
          <h1 className="mt-4 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl">
            أدوات مجانية للمستثمر
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            حاسبات بسيطة تساعدك في قراراتك اليومية في البورصة المصرية، من غير تسجيل ومن غير
            اشتراك.
          </p>
        </div>
      </section>

      <AveragingCalculator />
    </SiteShell>
  );
}
