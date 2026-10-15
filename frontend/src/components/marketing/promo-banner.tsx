import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { PLANS } from "@/components/marketing/pricing-plans";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/format";

const DISMISSED_KEY = "promo-trader-yearly-dismissed";

/**
 * The offer strip above the site header: the yearly الحريفة plan against
 * twelve monthly payments. The figures come from PLANS, so the banner can't
 * say anything the pricing page doesn't. Dismissal is a per-browser
 * convenience only — storage can be blocked, in which case it just comes back.
 */
export function PromoBanner() {
  const [dismissed, setDismissed] = useState(true); // hidden until storage has been read: no flash on first paint

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const trader = PLANS.find((plan) => plan.key === "trader");
  if (dismissed || !trader || trader.monthlyPrice === null || trader.yearlyPrice === null) return null;

  // Rounded down to a whole percent, the same way the pricing page labels it, so it never overstates.
  const savingPct = Math.floor((1 - trader.yearlyPrice / (trader.monthlyPrice * 12)) * 100);
  if (savingPct <= 0) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* blocked storage: it simply shows again next visit */
    }
  };

  return (
    <aside
      aria-label="عرض باقة الحريفة"
      className="relative border-b bg-primary text-primary-foreground"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 pe-12">
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-bold leading-snug sm:text-xl">
            اشترك في باقة الحريفة سنويًا ووفّر <span className="num">{fmt(savingPct)}%</span>
          </p>
          <p className="mt-1 text-[13px] opacity-80">
            <span className="num">{fmt(trader.yearlyPrice)}</span> جنيه في السنة بدل{" "}
            <s className="num">{fmt(trader.monthlyPrice * 12)}</s> — لكل مضارب نشط عايز محافظ متعددة
            وحدود أعلى.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          variant="secondary"
          className="shrink-0 bg-primary-foreground text-primary hover:bg-primary-foreground/90"
        >
          <Link to="/subscribe" search={{ tier: "trader", period: "yearly" }}>
            اشترك في الحريفة
          </Link>
        </Button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="إغلاق العرض"
        className="absolute end-3 top-3 rounded-md p-1.5 opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
      >
        <X className="size-4" />
      </button>
    </aside>
  );
}
