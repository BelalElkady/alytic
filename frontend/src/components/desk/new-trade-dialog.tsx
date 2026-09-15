import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/desk/state-blocks";
import { StockPicker } from "@/components/desk/stock-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { post } from "@/lib/api";
import { useDesk } from "@/lib/store";

const EMPTY = { code: "", side: "buy", shares: "", price: "", date: "" };

/** A row of the trade log, with its position in the log — what the edit endpoints address it by. */
export type LoggedTrade = {
  index: number;
  date: string;
  code: string;
  side: string;
  shares: number;
  price: number;
};

/**
 * Log an executed buy/sell — shares, average cost and cash update server-side.
 * Given `trade`, corrects or deletes that logged trade instead.
 */
export function NewTradeDialog({
  open,
  onOpenChange,
  trade = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade?: LoggedTrade | null;
}) {
  const { reload } = useDesk();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      trade
        ? {
            code: trade.code,
            side: trade.side,
            shares: String(trade.shares),
            price: String(trade.price),
            date: trade.date,
          }
        : EMPTY,
    );
    setError(null);
    setDeleteArmed(false);
  }, [open, trade]);

  // Echoed back so the server can tell the log hasn't shifted under this row.
  const original = trade && {
    date: trade.date,
    code: trade.code,
    side: trade.side,
    shares: trade.shares,
    price: trade.price,
  };

  const remove = async () => {
    if (!trade) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(`/api/portfolio/trades/${trade.index}/delete`, { original });
      onOpenChange(false);
      await reload();
      toast.success("تم حذف الصفقة وتحديث المحفظة");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر حذف الصفقة");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!form.code) {
      setError("اختار سهم من القائمة الأول.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        code: form.code,
        side: form.side,
        shares: +form.shares,
        price: +form.price,
        date: form.date || undefined,
      };
      if (trade) await post(`/api/portfolio/trades/${trade.index}`, { ...body, original });
      else await post("/api/portfolio/trade", body);
      onOpenChange(false);
      await reload();
      toast.success(trade ? "تم تعديل الصفقة وتحديث المحفظة" : "تم تسجيل الصفقة وتحديث المحفظة");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : trade
            ? "تعذر تعديل الصفقة"
            : "تعذر تسجيل الصفقة",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="text-base">
            {trade ? "تعديل الصفقة" : "إدخال صفقة جديدة"}
          </DialogTitle>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {trade
              ? "صحّح أي بيانات اتسجلت غلط. العدد والمتوسط والكاش والربح المحقق بيتعاد حسابهم تلقائيًا."
              : "أي بيع أو شراء اتنفذ فعليًا. المتوسط والعدد والكاش والتوصيات بتتحدث تلقائيًا."}
          </p>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>السهم</Label>
            <StockPicker
              value={form.code}
              onChange={(code) => setForm((previous) => ({ ...previous, code }))}
              className="sm:w-full"
              modal
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
            <Label htmlFor="t-date">التاريخ</Label>
            <Input
              id="t-date"
              className="num"
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, date: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-shares">العدد</Label>
            <Input
              id="t-shares"
              className="num"
              type="number"
              value={form.shares}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, shares: event.target.value }))
              }
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
              onChange={(event) =>
                setForm((previous) => ({ ...previous, price: event.target.value }))
              }
            />
          </div>
        </div>

        {error && <p className="text-[13px] text-down">{error}</p>}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner />}
            {trade ? "حفظ التعديل" : "تسجيل الصفقة"}
          </Button>
          {trade && (
            <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
              <Trash2 className="size-4" />
              {deleteArmed ? "اضغط تاني لتأكيد الحذف" : "حذف الصفقة"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
