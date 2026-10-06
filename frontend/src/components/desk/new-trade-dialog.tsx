import { Trash2 } from "lucide-react";
import { useId, useState } from "react";
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
import { fmt } from "@/lib/format";
import { useDesk } from "@/lib/store";

const EMPTY = { code: "", side: "buy", shares: "", price: "", fees: "", date: "" };

/** A row of the trade log, with its position in the log — what the edit endpoints address it by. */
export type LoggedTrade = {
  index: number;
  date: string;
  code: string;
  side: string;
  shares: number;
  price: number;
  commission?: number;
};

/**
 * The trade fields and their save button. Without `trade` it logs a new
 * executed buy/sell — shares, average cost and cash update server-side — a
 * dividend received, or a subscription right sold on the market (shares/rights
 * entitled × cash per share or per right, added to cash and realised profit
 * without touching the position). Given `trade`, it corrects or deletes that
 * logged trade instead. `onDone` fires after a successful save or delete
 * (before the desk reloads).
 */
export function TradeForm({
  trade = null,
  onDone,
}: {
  trade?: LoggedTrade | null;
  onDone: () => void;
}) {
  const { reload } = useDesk();
  const id = useId();
  const [form, setForm] = useState(
    trade
      ? {
          code: trade.code,
          side: trade.side,
          shares: String(trade.shares),
          price: String(trade.price),
          fees: trade.commission ? String(trade.commission) : "",
          date: trade.date,
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const dividend = form.side === "dividend";
  const rightsSale = form.side === "rights_sale";
  const dividendTotal = +form.shares * +form.price;

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
      onDone();
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
        // Optional: left blank, the trade pays no fees.
        fees: dividend || form.fees === "" ? 0 : +form.fees,
        date: form.date || undefined,
      };
      if (trade) await post(`/api/portfolio/trades/${trade.index}`, { ...body, original });
      else await post("/api/portfolio/trade", body);
      onDone();
      await reload();
      toast.success(
        trade
          ? "تم تعديل الصفقة وتحديث المحفظة"
          : dividend
            ? "تم تسجيل التوزيعات وإضافتها للكاش"
            : rightsSale
              ? "تم تسجيل بيع حق الاكتتاب وإضافته للكاش"
              : "تم تسجيل الصفقة وتحديث المحفظة",
      );
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
    <>
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
              <SelectItem value="dividend">توزيعات أرباح</SelectItem>
              <SelectItem value="rights_sale">بيع حق الاكتتاب</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-date`}>التاريخ</Label>
          <Input
            id={`${id}-date`}
            dir="rtl"
            type="date"
            value={form.date}
            onChange={(event) => setForm((previous) => ({ ...previous, date: event.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-shares`}>
            {dividend ? "عدد الأسهم المستحقة" : rightsSale ? "عدد الحقوق المباعة" : "العدد"}
          </Label>
          <Input
            id={`${id}-shares`}
            className="num"
            type="number"
            value={form.shares}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, shares: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-price`}>
            {dividend ? "التوزيع للسهم (ج)" : rightsSale ? "سعر بيع الحق (ج)" : "سعر التنفيذ"}
          </Label>
          <Input
            id={`${id}-price`}
            className="num"
            type="number"
            step="0.01"
            value={form.price}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, price: event.target.value }))
            }
          />
        </div>
        {!dividend && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-fees`}>
              العمولة (ج) <span className="text-muted-foreground">— اختياري</span>
            </Label>
            <Input
              id={`${id}-fees`}
              className="num"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={form.fees}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, fees: event.target.value }))
              }
            />
            <p className="text-[12px] text-muted-foreground">
              عمولة السمسرة اللي دفعتها على الصفقة. لو سبتها فاضية هتتحسب صفر.
            </p>
          </div>
        )}
      </div>

      {dividend && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          صافي التوزيع النقدي اللي وصلك. بيتضاف للكاش والربح المحقق من غير ما يغيّر عدد الأسهم أو
          المتوسط.
          {dividendTotal > 0 && (
            <span className="mt-1 block">
              الإجمالي:{" "}
              <span className="num font-medium text-foreground">{fmt(dividendTotal)} ج</span>
            </span>
          )}
        </p>
      )}

      {rightsSale && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          قيمة بيع حقوق الاكتتاب اللي متنازلتش عنها، بعد خصم العمولة. بتتضاف للكاش والربح المحقق من
          غير ما تغيّر عدد الأسهم أو المتوسط.
        </p>
      )}

      {error && <p className="text-[13px] text-down">{error}</p>}

      <DialogFooter className="gap-2 sm:justify-start">
        <Button onClick={() => void submit()} disabled={busy}>
          {busy && <Spinner />}
          {trade ? "حفظ التعديل" : dividend ? "تسجيل التوزيعات" : "تسجيل الصفقة"}
        </Button>
        {trade && (
          <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
            <Trash2 className="size-4" />
            {deleteArmed ? "اضغط تاني لتأكيد الحذف" : "حذف الصفقة"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/** Corrects or deletes a logged trade in its own dialog — opened from the trade log. */
export function NewTradeDialog({
  open,
  onOpenChange,
  trade = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade?: LoggedTrade | null;
}) {
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
        {/* Keyed on the trade so switching rows starts from that row's values. The dialog's content unmounts on close, so a reopen starts fresh too. */}
        <TradeForm
          key={trade ? `${trade.index}-${trade.date}-${trade.code}` : "new"}
          trade={trade}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
