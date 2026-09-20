import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { StockAnalysisBody, useStockAnalysis } from "@/components/desk/stock-detail";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDesk } from "@/lib/store";

/**
 * Per-stock analysis in a popup — the compact view. The arrow opens the same
 * stock on its own page (routes/_app.stock.$code.tsx) with every number laid out.
 */
export function DetailDialog() {
  const { detailCode, openDetail, openMarket } = useDesk();
  const { data, error } = useStockAnalysis(detailCode);

  return (
    <Dialog open={Boolean(detailCode)} onOpenChange={(open) => !open && openDetail(null)}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle className="text-base">
            {data ? `${data.code} — ${data.name}` : (detailCode ?? "")}
          </DialogTitle>
          {data && (
            <p className="text-[12.5px] text-muted-foreground">
              {data.sectorAr ?? ""} · إغلاق {data.asOf}
            </p>
          )}
          {detailCode && (
            <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
              {/* The popups live in the desk shell, which stays mounted across
                  pages — so they are closed here or they would sit over the page. */}
              <Link
                to="/stock/$code"
                params={{ code: detailCode }}
                onClick={() => {
                  openDetail(null);
                  openMarket(null);
                }}
              >
                صفحة السهم الكاملة
                <ArrowLeft className="size-4" aria-hidden />
              </Link>
            </Button>
          )}
        </DialogHeader>

        <StockAnalysisBody data={data} error={error} />
      </DialogContent>
    </Dialog>
  );
}
