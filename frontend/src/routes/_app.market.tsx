import { createFileRoute } from "@tanstack/react-router";

import { MarketAnalysis } from "@/components/desk/market-analysis";
import { Panel } from "@/components/desk/state-blocks";
import { SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/_app/market")({
  head: () => ({
    meta: [
      { title: "تحليل السوق — EGXpert" },
      {
        name: "description",
        content: "ترتيب أسهم البورصة المصرية حسب التقييم والفرص القابلة للتنفيذ، مع بحث عن أي سهم وتحليله.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "تحليل السوق — EGXpert" },
      { property: "og:url", content: `${SITE_URL}/market` },
    ],
  }),
  component: MarketPage,
});

function MarketPage() {
  return (
    <Panel title="تحليل السوق">
      <MarketAnalysis focus="market" />
    </Panel>
  );
}
