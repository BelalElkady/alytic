import { MarketAnalysis } from "@/components/desk/market-analysis";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDesk } from "@/lib/store";

/**
 * The cash-allocation plan, opened from the cash page. Market analysis has its
 * own page (routes/_app.market.tsx); this is the same scan, narrowed to the
 * plan's picks. The body only mounts while open, so each opening scans afresh.
 */
export function CashDialog() {
  const { marketFocus, openMarket } = useDesk();
  return (
    <Dialog open={marketFocus === "cash"} onOpenChange={(open) => !open && openMarket(null)}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-start">
          <DialogTitle className="text-base">أفضل توزيع للكاش</DialogTitle>
        </DialogHeader>
        <MarketAnalysis focus="cash" />
      </DialogContent>
    </Dialog>
  );
}
