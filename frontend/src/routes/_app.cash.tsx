import { createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StockPicker } from "@/components/desk/stock-picker";
import { EmptyState, Notice, Panel, Spinner, Stat } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, post } from "@/lib/api";
import { fmt, int, pct, tone } from "@/lib/format";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/_app/cash")({
  head: () => ({
    meta: [
      { title: "الكاش والأسهم المفضلة — EGXpert" },
      {
        name: "description",
        content: "إدارة الكاش المتاح ونسبته من رأس المال، ومتابعة سعر وتغيّر الأسهم المفضلة عندك.",
      },
      { property: "og:title", content: "الكاش والأسهم المفضلة — EGXpert" },
      {
        property: "og:description",
        content: "إدارة الكاش المتاح ونسبته من رأس المال، ومتابعة سعر وتغيّر الأسهم المفضلة عندك.",
      },
    ],
  }),
  component: CashPage,
});

type FavoriteRow = {
  code: string;
  name?: string;
  sector?: string;
  price?: number;
  changePct?: number | null;
  score?: number;
  signal?: { ar?: string };
};

function CashPage() {
  const { pf, totals, reloadPortfolio, openMarket } = useDesk();
  const [cash, setCash] = useState("");
  const [savingCash, setSavingCash] = useState(false);
  const [watchCode, setWatchCode] = useState("");
  const [watchNote, setWatchNote] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [addingWatch, setAddingWatch] = useState(false);
  const [favRows, setFavRows] = useState<Record<string, FavoriteRow>>({});
  const [favLoading, setFavLoading] = useState(false);

  useEffect(() => {
    setCash(String(pf?.cash ?? 0));
  }, [pf?.cash]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the portfolio watchlist shape
  const watchlist: [string, any][] = Object.entries(pf?.watchlist ?? {});
  const watchCodes = watchlist
    .map(([code]) => code)
    .sort()
    .join(",");

  // Re-fetches price/score/signal for every favorite whenever the set changes —
  // this is what makes the list "monitor" a stock rather than just remember it.
  useEffect(() => {
    if (!watchCodes) {
      setFavRows({});
      return;
    }
    let cancelled = false;
    setFavLoading(true);
    api(`/api/scan?codes=${watchCodes}`)
      .then((result) => {
        if (cancelled) return;
        const byCode: Record<string, FavoriteRow> = {};
        for (const row of result?.results ?? []) byCode[row.code] = row;
        setFavRows(byCode);
      })
      .catch(() => {})
      .finally(() => !cancelled && setFavLoading(false));
    return () => {
      cancelled = true;
    };
  }, [watchCodes]);

  const share = totals.value + totals.cash ? (totals.cash / (totals.value + totals.cash)) * 100 : 0;
  const advice =
    totals.cash <= 0
      ? "مفيش كاش متاح حاليًا. أي شراء جديد لازم يجي من بيع جزئي لسهم مربح — ما تشتريش بالدين."
      : share < 10
        ? `الكاش ${fmt(share, 0)}% بس من المحفظة — قليل. احتفظ به كاحتياطي، وما تدخلش صفقة جديدة إلا على فرصة واضحة من أسهمك المفضلة أو تحليل السوق.`
        : share < 30
          ? `الكاش ${fmt(share, 0)}% — نسبة صحية. وزّعه: ثلث على أوامر محددة، وثلث ينتظر تصحيح المؤشر، وثلث يفضل نقدي.`
          : `الكاش ${fmt(share, 0)}% — عالي. ابدأ نشر تدريجي على 3 أسابيع بأوامر محددة. الباقي صندوق نقدي — مش فلوس نايمة، ده عائد + ذخيرة.`;

  const saveCash = async () => {
    setSavingCash(true);
    try {
      await post("/api/portfolio/cash", { cash: +cash });
      await reloadPortfolio();
      toast.success("تم تحديث الكاش");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر تحديث الكاش");
    } finally {
      setSavingCash(false);
    }
  };

  const addWatch = async () => {
    if (!watchCode) {
      setWatchError("اختار سهم من القائمة الأول.");
      return;
    }
    setAddingWatch(true);
    setWatchError(null);
    try {
      await post("/api/portfolio/watchlist", { code: watchCode, note: watchNote || null });
      await reloadPortfolio();
      setWatchCode("");
      setWatchNote("");
      toast.success("تمت الإضافة للأسهم المفضلة");
    } catch (caught) {
      setWatchError(caught instanceof Error ? caught.message : "تعذر الإضافة");
    } finally {
      setAddingWatch(false);
    }
  };

  const removeWatch = async (code: string) => {
    try {
      await post("/api/portfolio/watchlist", { code, remove: true });
      await reloadPortfolio();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحذف");
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="الكاش المتاح"
        description="حدّثه لما تحوّل فلوس أو تسحب. البيع والشراء من تبويب الصفقات بيعدّلوه أوتوماتيك."
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="cash-in">المبلغ</Label>
            <Input
              id="cash-in"
              className="num"
              type="number"
              value={cash}
              onChange={(event) => setCash(event.target.value)}
            />
          </div>
          <Button onClick={() => void saveCash()} disabled={savingCash}>
            {savingCash && <Spinner />}
            حفظ
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border bg-surface p-3 sm:grid-cols-4">
          <Stat label="نسبة الكاش من الإجمالي" value={`${fmt(share, 1)}%`} />
          <Stat label="التكلفة الكلية" value={int(totals.cost)} />
          <Stat label="قيمة الأسهم" value={int(totals.value)} />
          <Stat label="إجمالي رأس المال" value={int(totals.value + totals.cash)} />
        </div>

        <Notice className="mt-4">{advice}</Notice>

        <Button variant="outline" className="mt-4" onClick={() => openMarket("cash")}>
          حلل استخدام الكاش
        </Button>
      </Panel>

      <Panel
        title="الأسهم المفضلة"
        description="اختار الأسهم اللي يهمك سعرها، والصفحة تتابع سعرها وتغيّرها اليومي وتقييمها أولًا بأول — من غير خطة شراء."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label>السهم</Label>
            <StockPicker value={watchCode} onChange={setWatchCode} className="sm:w-full" />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="watch-note">ملاحظة (اختياري)</Label>
            <Input
              id="watch-note"
              value={watchNote}
              onChange={(event) => setWatchNote(event.target.value)}
              placeholder="مثلاً: استنى تصحيح لمستوى الدعم"
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full sm:w-auto"
              onClick={() => void addWatch()}
              disabled={addingWatch}
            >
              {addingWatch && <Spinner />}
              إضافة
            </Button>
          </div>
        </div>

        {watchError && <p className="mt-2 text-[13px] text-down">{watchError}</p>}

        <div className="mt-4">
          {watchlist.length === 0 ? (
            <EmptyState
              title="مفيش أسهم مفضلة لسه"
              hint="ضيف سهم وهيظهر هنا مع سعره وتغيّره اليومي."
            />
          ) : (
            <div className="scrollbar-slim overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">الاسم</TableHead>
                    <TableHead className="text-start">السعر</TableHead>
                    <TableHead className="text-start">التغير اليومي</TableHead>
                    <TableHead className="text-start">التقييم</TableHead>
                    <TableHead className="text-start">الإشارة</TableHead>
                    <TableHead className="text-start">ملاحظة</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {watchlist.map(([code, item]) => {
                    const row = favRows[code];
                    return (
                      <TableRow key={code}>
                        <TableCell className="font-medium">{code}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row
                            ? `${row.name ?? "—"} · ${row.sector ?? "—"}`
                            : favLoading
                              ? "…"
                              : "—"}
                        </TableCell>
                        <TableCell className="num text-right">
                          {row ? fmt(row.price) : "—"}
                        </TableCell>
                        <TableCell className={`num text-right ${tone(row?.changePct)}`}>
                          {row?.changePct != null ? pct(row.changePct, 1) : "—"}
                        </TableCell>
                        <TableCell className="num text-right">{row?.score ?? "—"}</TableCell>
                        <TableCell className="text-right">{row?.signal?.ar ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{item.note || "—"}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`حذف ${code}`}
                            onClick={() => void removeWatch(code)}
                          >
                            <Trash2 className="size-4 text-down" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
