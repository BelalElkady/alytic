import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { StockPicker } from "@/components/desk/stock-picker";
import { EmptyState, Panel, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { post } from "@/lib/api";
import { fmt, int, signed, tone } from "@/lib/format";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/trades")({
  head: () => ({
    meta: [
      { title: "الصفقات — EGXpert" },
      {
        name: "description",
        content: "تسجيل عمليات الشراء والبيع المنفذة ومتابعة الربح المحقق وسجل الصفقات كامل.",
      },
      { property: "og:title", content: "الصفقات — EGXpert" },
      {
        property: "og:description",
        content: "تسجيل عمليات الشراء والبيع المنفذة ومتابعة الربح المحقق وسجل الصفقات كامل.",
      },
    ],
  }),
  component: TradesPage,
});

function TradesPage() {
  const { pf, reload } = useDesk();
  const [form, setForm] = useState({ code: "", side: "buy", shares: "", price: "", date: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trades: any[] = pf?.trades ?? [];
  const realized = pf?.realizedPnl ?? 0;

  const submit = async () => {
    if (!form.code) {
      setError("اختار سهم من القائمة الأول.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post("/api/portfolio/trade", {
        code: form.code,
        side: form.side,
        shares: +form.shares,
        price: +form.price,
        date: form.date || undefined,
      });
      await reload();
      setForm({ code: "", side: "buy", shares: "", price: "", date: "" });
      toast.success("تم تسجيل الصفقة وتحديث المحفظة");
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر تسجيل الصفقة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="سجّل صفقة"
        description="أي بيع أو شراء اتنفذ فعليًا. المتوسط والعدد والكاش والتوصيات بتتحدث تلقائيًا."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label>السهم</Label>
            <StockPicker
              value={form.code}
              onChange={(code) => setForm((previous) => ({ ...previous, code }))}
              className="sm:w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label>النوع</Label>
            <Select
              value={form.side}
              onValueChange={(side) => setForm((previous) => ({ ...previous, side }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">شراء</SelectItem>
                <SelectItem value="sell">بيع</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-shares">العدد</Label>
            <Input
              id="t-shares"
              className="num"
              type="number"
              value={form.shares}
              onChange={(event) => setForm((previous) => ({ ...previous, shares: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-price">سعر التنفيذ</Label>
            <Input
              id="t-price"
              className="num"
              type="number"
              step="0.01"
              value={form.price}
              onChange={(event) => setForm((previous) => ({ ...previous, price: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-date">التاريخ</Label>
            <Input
              id="t-date"
              className="num"
              type="date"
              value={form.date}
              onChange={(event) => setForm((previous) => ({ ...previous, date: event.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full sm:w-auto" onClick={() => void submit()} disabled={busy}>
              {busy && <Spinner />}
              تسجيل
            </Button>
          </div>
        </div>
        {error && <p className="mt-2 text-[13px] text-down">{error}</p>}
      </Panel>

      <Panel
        title="سجل الصفقات"
        action={
          <span className={cn("num text-[13px] font-semibold", tone(realized))}>
            ربح محقق: {signed(realized)} ج
          </span>
        }
        bodyClassName="px-0 py-0 sm:px-0"
      >
        {trades.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد صفقات مسجلة بعد" hint="سجّل أول صفقة من الأعلى." />
          </div>
        ) : (
          <div className="scrollbar-slim overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">الكود</TableHead>
                  <TableHead className="text-start">النوع</TableHead>
                  <TableHead className="text-start">العدد</TableHead>
                  <TableHead className="text-start">السعر</TableHead>
                  <TableHead className="text-start">عمولة</TableHead>
                  <TableHead className="text-start">محقق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...trades].reverse().map((trade, index) => (
                  <TableRow key={`${trade.date}-${trade.code}-${index}`}>
                    <TableCell className="num text-right">{trade.date}</TableCell>
                    <TableCell className="font-medium">{trade.code}</TableCell>
                    <TableCell className={trade.side === "buy" ? "text-up" : "text-down"}>
                      {trade.side === "buy" ? "شراء" : "بيع"}
                    </TableCell>
                    <TableCell className="num text-right">{int(trade.shares)}</TableCell>
                    <TableCell className="num text-right">{fmt(trade.price)}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">{fmt(trade.commission)}</TableCell>
                    <TableCell className={cn("num text-right", tone(trade.realized))}>
                      {trade.realized != null ? signed(trade.realized) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}
