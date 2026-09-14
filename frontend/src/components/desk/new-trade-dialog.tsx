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

/** Log an executed buy/sell — shares, average cost and cash update server-side. */
export function NewTradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { reload } = useDesk();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setError(null);
  }, [open]);

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
      onOpenChange(false);
      await reload();
      toast.success("تم تسجيل الصفقة وتحديث المحفظة");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تسجيل الصفقة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="text-base">إدخال صفقة جديدة</DialogTitle>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            أي بيع أو شراء اتنفذ فعليًا. المتوسط والعدد والكاش والتوصيات بتتحدث تلقائيًا.
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

        <DialogFooter className="sm:justify-start">
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner />}
            تسجيل الصفقة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
