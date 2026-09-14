import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { NewTradeDialog } from "@/components/desk/new-trade-dialog";
import { EmptyState, Notice, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

type Draft = Record<string, { shares: string; avgCost: string; stop: string; target: string }>;

/** Correct share counts, average cost, stop and target — same endpoints. */
export function ManualEntryDialog() {
  const { manualOpen, setManualOpen, rows, reload, pf } = useDesk();
  const [tradeOpen, setTradeOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manualOpen) return;
    const next: Draft = {};
    const nextSelected: Record<string, boolean> = {};
    for (const row of rows) {
      next[row.code] = {
        shares: String(row.position.shares ?? ""),
        avgCost: String(row.position.avgCost ?? ""),
        stop: String(row.position.stop ?? ""),
        target: row.midTarget?.price != null ? String(row.midTarget.price) : "",
      };
      nextSelected[row.code] = true;
    }
    setDraft(next);
    setSelected(nextSelected);
    setError(null);
  }, [manualOpen, rows]);

  const anyEstimated = rows.some((row) => row.position.sharesEstimated);
  const allSelected = rows.length > 0 && rows.every((row) => selected[row.code]);
  const noneSelected = rows.every((row) => !selected[row.code]);

  const set = (code: string, field: keyof Draft[string], value: string) =>
    setDraft((previous) => {
      const current = previous[code] ?? { shares: "", avgCost: "", stop: "", target: "" };
      return { ...previous, [code]: { ...current, [field]: value } };
    });

  const toggleSelected = (code: string, checked: boolean) =>
    setSelected((previous) => ({ ...previous, [code]: checked }));

  const toggleAll = (checked: boolean) =>
    setSelected(() => {
      const next: Record<string, boolean> = {};
      for (const row of rows) next[row.code] = checked;
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const row of rows) {
        if (!selected[row.code]) continue;
        const entry = draft[row.code];
        if (!entry) continue;
        const sharesChanged = +entry.shares !== row.position.shares;
        const costChanged = +entry.avgCost !== row.position.avgCost;
        if (sharesChanged || costChanged || row.position.sharesEstimated) {
          await post("/api/portfolio/holding", {
            code: row.code,
            shares: +entry.shares,
            avgCost: +entry.avgCost,
          });
        }
        await post("/api/portfolio/levels", {
          code: row.code,
          stop: +entry.stop,
          target: entry.target ? +entry.target : null,
        });
      }
      setManualOpen(false);
      await reload();
      toast.success("تم حفظ التعديلات");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={manualOpen} onOpenChange={setManualOpen}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle className="text-base">إدخال يدوي</DialogTitle>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            الأسعار بتتحدث تلقائيًا من السوق. استعمل ده لو عايز تصحّح عدد الأسهم أو متوسط الشراء، أو
            تعدّل وقف وهدف بنفسك. ولو نفّذت بيع أو شراء، سجّله كصفقة جديدة.
          </p>
          <Button size="sm" className="mt-1 w-fit" onClick={() => setTradeOpen(true)}>
            <Plus className="size-4" />
            إدخال صفقة جديدة
          </Button>
        </DialogHeader>

        {anyEstimated && (
          <Notice tone="warn">
            الأسهم المعلّمة بـ ⚠️ عددها اتحسب تقديريًا من صورة المحفظة (القيمة السوقية ÷ آخر سعر) —
            صححها من هنا.
          </Notice>
        )}

        {rows.length === 0 ? (
          <EmptyState title="مفيش مراكز." hint="سجّل أول صفقة من زرار «إدخال صفقة جديدة»." />
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-[12.5px] font-medium">
              <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(v === true)} />
              تحديد الكل
            </label>

            {rows.map((row) => {
              const entry = draft[row.code];
              if (!entry) return null;
              return (
                <div key={row.code} className="rounded-lg border bg-surface p-3">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                    <Checkbox
                      checked={selected[row.code] ?? false}
                      onCheckedChange={(v) => toggleSelected(row.code, v === true)}
                    />
                    {row.code}
                    {row.position.sharesEstimated && <span title="عدد تقديري">⚠️</span>}
                    <span className="truncate text-[12px] font-normal text-muted-foreground">
                      {row.name}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field
                      label="عدد الأسهم"
                      value={entry.shares}
                      step="1"
                      onChange={(v) => set(row.code, "shares", v)}
                    />
                    <Field
                      label="متوسط الشراء"
                      value={entry.avgCost}
                      step="0.0001"
                      onChange={(v) => set(row.code, "avgCost", v)}
                    />
                    <Field
                      label="وقف"
                      value={entry.stop}
                      step="0.01"
                      onChange={(v) => set(row.code, "stop", v)}
                    />
                    <Field
                      label="هدف"
                      value={entry.target}
                      step="0.01"
                      onChange={(v) => set(row.code, "target", v)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="text-[13px] text-down">{error}</p>}

        {rows.length > 0 && (
          <DialogFooter className="sm:justify-start">
            <Button onClick={save} disabled={busy || noneSelected}>
              {busy && <Spinner />}
              حفظ التعديلات
            </Button>
          </DialogFooter>
        )}

        <TradeLog trades={pf?.trades ?? []} realized={pf?.realizedPnl ?? 0} />
        <NewTradeDialog open={tradeOpen} onOpenChange={setTradeOpen} />
      </DialogContent>
    </Dialog>
  );
}

type Trade = {
  date: string;
  code: string;
  side: string;
  shares: number;
  price: number;
  commission: number;
  realized?: number | null;
};

function TradeLog({ trades, realized }: { trades: Trade[]; realized: number }) {
  if (trades.length === 0) return null;
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-[13px] font-semibold">
        <span className="flex items-center gap-1.5">
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
          سجل الصفقات ({int(trades.length)})
        </span>
        <span className={cn("num text-[12.5px]", tone(realized))}>
          ربح محقق: {signed(realized)} ج
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="scrollbar-slim overflow-x-auto border-t">
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
                <TableCell className="num text-right text-muted-foreground">
                  {fmt(trade.commission)}
                </TableCell>
                <TableCell className={cn("num text-right", tone(trade.realized))}>
                  {trade.realized != null ? signed(trade.realized) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: string;
  step: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      <Input
        className="num h-9"
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
