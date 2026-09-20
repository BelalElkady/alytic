import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import {
  ShariahBadge,
  StockAnalysisBody,
  useStockAnalysis,
} from "@/components/desk/stock-detail";
import { EmptyState } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { SITE_URL } from "@/lib/seo";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/_app/stock/$code")({
  head: ({ params }) => {
    const title = `${params.code.toUpperCase()} — تحليل السهم — EGXpert`;
    return {
      meta: [
        { title },
        { name: "robots", content: "noindex, nofollow" },
        { property: "og:title", content: title },
        { property: "og:url", content: `${SITE_URL}/stock/${params.code.toUpperCase()}` },
      ],
    };
  },
  component: StockPage,
});

function StockPage() {
  const code = Route.useParams().code.toUpperCase();
  const navigate = useNavigate();
  const { universe } = useDesk();

  // Only codes the engine knows are analysed: the analysis endpoint would
  // otherwise go looking for price history under whatever was typed into the
  // address bar. Until the universe has loaded, nothing is known yet.
  const stock = universe.find((item) => item.code === code);
  const unknown = universe.length > 0 && !stock;
  const { data, error } = useStockAnalysis(stock ? code : null);

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/market" });
  };

  const name = data?.name ?? stock?.ar ?? stock?.en ?? "";

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
        <ArrowRight className="size-4" aria-hidden />
        رجوع
      </Button>

      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold tracking-tight">
              <span dir="ltr">{code}</span>
              {name && <span className="text-muted-foreground"> — </span>}
              {name}
            </h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {[data?.sectorAr, data?.nameEn, data?.asOf ? `إغلاق ${data.asOf}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <ShariahBadge value={data?.shariah} />
        </div>

        <div className="mt-5">
          {unknown ? (
            <EmptyState
              title="السهم ده مش موجود."
              hint="راجع كود السهم، أو ابحث عنه من صفحة «تحليل السوق»."
            />
          ) : (
            <StockAnalysisBody data={data} error={error} full />
          )}
        </div>
      </section>
    </div>
  );
}
