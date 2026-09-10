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
import { post } from "@/lib/api";
import { fmt, int } from "@/lib/format";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/_app/cash")({
  head: () => ({
    meta: [
      { title: "الكاش وقائمة المراقبة — EGXpert" },
      {
        name: "description",
        content: "إدارة الكاش المتاح، نسبته من رأس المال، وأوامر شراء محددة على مستويات دعم.",
      },
      { property: "og:title", content: "الكاش وقائمة المراقبة — EGXpert" },
      {
        property: "og:description",
        content: "إدارة الكاش المتاح، نسبته من رأس المال، وأوامر شراء محددة على مستويات دعم.",
      },
    ],
  }),
  component: CashPage,
});

function CashPage() {
  const { pf, totals, reloadPortfolio, openMarket } = useDesk();
  const [cash, setCash] = useState("");
  const [savingCash, setSavingCash] = useState(false);
  const [watch, setWatch] = useState({ code: "", entry: "", stop: "", target: "", qty: "" });
  const [watchError, setWatchError] = useState<string | null>(null);
  const [addingWatch, setAddingWatch] = useState(false);

  useEffect(() => {
    setCash(String(pf?.cash ?? 0));
  }, [pf?.cash]);

  const share = totals.value + totals.cash ? (totals.cash / (totals.value + totals.cash)) * 100 : 0;
  const advice =
    totals.cash <= 0
      ? "مفيش كاش متاح حاليًا. أي شراء جديد لازم يجي من بيع جزئي لسهم مربح — ما تشتريش بالدين."
      : share < 10
        ? `الكاش ${fmt(share, 0)}% بس من المحفظة — قليل. احتفظ به كاحتياطي، وما تدخلش صفقة جديدة إلا لو اتنفذ أمر من قائمة المراقبة عند سعره المحدد.`
        : share < 30
          ? `الكاش ${fmt(share, 0)}% — نسبة صحية. وزّعه: ثلث على أوامر محددة، وثلث ينتظر تصحيح المؤشر، وثلث يفضل نقدي.`
          : `الكاش ${fmt(share, 0)}% — عالي. ابدأ نشر تدريجي على 3 أسابيع بأوامر محددة. الباقي صندوق نقدي — مش فلوس نايمة، ده عائد + ذخيرة.`;

  const watchlist: [string, any][] = Object.entries(pf?.watchlist ?? {});

  const saveCash = async () => {
    setSavingCash(true);
    try {
      await post("/api/portfolio/cash", { cash: +cash });
      await reloadPortfolio();
      toast.success("تم تحديث الكاش");
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر تحديث الكاش");
    } finally {
      setSavingCash(false);
    }
  };

  const addWatch = async () => {
    if (!watch.code) {
      setWatchError("اختار سهم من القائمة الأول.");
      return;
    }
    setAddingWatch(true);
    setWatchError(null);
    try {
      await post("/api/portfolio/watchlist", {
        code: watch.code,
        entry: +watch.entry,
        stop: +watch.stop,
        target: +watch.target,
        qty: +watch.qty,
      });
      await reloadPortfolio();
      setWatch({ code: "", entry: "", stop: "", target: "", qty: "" });
      toast.success("تمت الإضافة لقائمة المراقبة");
    } catch (caught: any) {
      setWatchError(caught?.message ?? "تعذر الإضافة");
    } finally {
      setAddingWatch(false);
    }
  };

  const removeWatch = async (code: string) => {
    try {
      await post("/api/portfolio/watchlist", { code, remove: true });
      await reloadPortfolio();
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر الحذف");
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
        title="قائمة المراقبة — أسهم مقترحة للكاش"
        description="أوامر شراء محددة على مستويات دعم، مش بسعر السوق. لو اتنفذ أمر، سجّله في الصفقات وهيتحوّل لمركز."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label>السهم</Label>
            <StockPicker
              value={watch.code}
              onChange={(code) => setWatch((previous) => ({ ...previous, code }))}
              className="sm:w-full"
            />
          </div>
          <NumberField label="سعر الدخول" value={watch.entry} onChange={(v) => setWatch((p) => ({ ...p, entry: v }))} />
          <NumberField label="الوقف" value={watch.stop} onChange={(v) => setWatch((p) => ({ ...p, stop: v }))} />
          <NumberField label="الهدف" value={watch.target} onChange={(v) => setWatch((p) => ({ ...p, target: v }))} />
          <NumberField label="العدد" value={watch.qty} step="1" onChange={(v) => setWatch((p) => ({ ...p, qty: v }))} />
          <div className="flex items-end">
            <Button className="w-full sm:w-auto" onClick={() => void addWatch()} disabled={addingWatch}>
              {addingWatch && <Spinner />}
              إضافة
            </Button>
          </div>
        </div>

        {watchError && <p className="mt-2 text-[13px] text-down">{watchError}</p>}

        <div className="mt-4">
          {watchlist.length === 0 ? (
            <EmptyState title="قائمة المراقبة فاضية" hint="ضيف سهم بأمر محدد وهيظهر هنا." />
          ) : (
            <div className="scrollbar-slim overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">سعر الدخول</TableHead>
                    <TableHead className="text-start">الوقف</TableHead>
                    <TableHead className="text-start">الهدف</TableHead>
                    <TableHead className="text-start">العدد</TableHead>
                    <TableHead className="text-start">التكلفة</TableHead>
                    <TableHead className="text-start">مخاطرة</TableHead>
                    <TableHead className="text-start">عائد 1:</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {watchlist.map(([code, item]) => {
                    const risk = item.entry && item.stop ? ((item.entry - item.stop) / item.entry) * 100 : null;
                    const rr =
                      item.entry && item.stop && item.target
                        ? (item.target - item.entry) / (item.entry - item.stop)
                        : null;
                    return (
                      <TableRow key={code}>
                        <TableCell className="font-medium">{code}</TableCell>
                        <TableCell className="num text-right">{fmt(item.entry)}</TableCell>
                        <TableCell className="num text-right text-down">{fmt(item.stop)}</TableCell>
                        <TableCell className="num text-right text-up">{fmt(item.target)}</TableCell>
                        <TableCell className="num text-right">{int(item.qty)}</TableCell>
                        <TableCell className="num text-right">
                          {item.entry && item.qty ? int(item.entry * item.qty) : "—"}
                        </TableCell>
                        <TableCell className="num text-right">{risk != null ? `${fmt(risk, 1)}%` : "—"}</TableCell>
                        <TableCell className="num text-right">{rr != null ? fmt(rr, 1) : "—"}</TableCell>
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

function NumberField({
  label,
  value,
  onChange,
  step = "0.01",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        className="num"
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
