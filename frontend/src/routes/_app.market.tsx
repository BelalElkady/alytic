import { createFileRoute } from "@tanstack/react-router";

import { MarketAnalysis } from "@/components/desk/market-analysis";
import { Panel } from "@/components/desk/state-blocks";
import { siteUrl, siteName } from "@/lib/seo";

export const Route = createFileRoute("/_app/market")({
  head: ({ matches }) => ({
    meta: [
      { title: `تحليل السوق — ${siteName(matches)}` },
      {
        name: "description",
        content: "ترتيب أسهم البورصة المصرية حسب التقييم والفرص القابلة للتنفيذ، مع بحث عن أي سهم وتحليله.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: `تحليل السوق — ${siteName(matches)}` },
      { property: "og:url", content: `${siteUrl(matches)}/market` },
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
