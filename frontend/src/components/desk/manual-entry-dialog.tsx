import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { NewTradeDialog, TradeForm, type LoggedTrade } from "@/components/desk/new-trade-dialog";
import { EmptyState, Notice, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/**
 * Three tabs: "تعديل" corrects what's already there (share counts, average cost,
 * stop and target), "صفقة جديدة" logs a new executed trade, and "سجل الصفقات"
 * lists every executed trade (where a wrongly logged one is corrected).
 */
export function ManualEntryDialog() {
  const { manualOpen, setManualOpen, manualTab, rows, reload, pf } = useDesk();
  const [tab, setTab] = useState<"edit" | "new" | "trades">("edit");
  // Bumped after a trade is logged so the new-trade form comes back empty for the next one.
  const [newTradeKey, setNewTradeKey] = useState(0);
  const [tradeOpen, setTradeOpen] = useState(false);
  // The logged trade being corrected in its own dialog (opened from the trade log).
  const [editingTrade, setEditingTrade] = useState<LoggedTrade | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopen on the tab that was asked for ("edit" for the header button, "new"
  // for the log-a-trade reminder) — kept apart from the effect below, which
  // reruns whenever the rows reload and must not bounce the user off "new".
  // manualTab is set in the same batch as manualOpen (see openManual), so this
  // reads the fresh value and needs no dependency on it: a later change to it
  // while the dialog is open must not switch tabs under the user.
  useEffect(() => {
    if (!manualOpen) return;
    setTab(manualTab);
    // Each opening starts from the saved values with nothing ticked.
    setDraft({});
    setSelected({});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualOpen]);

  // rows is replaced on every live price refresh. Reseeding everything from it
  // used to wipe what the user was typing and re-tick every row, so a ticked
  // row (one the user chose or edited) keeps its draft; the rest follow the
  // latest saved values, e.g. after a trade is logged from the other tab.
  useEffect(() => {
    if (!manualOpen) return;
    const seed = (row: (typeof rows)[number]) => ({
      shares: String(row.position.shares ?? ""),
      avgCost: String(row.position.avgCost ?? ""),
      stop: String(row.position.stop ?? ""),
      target: row.midTarget?.price != null ? String(row.midTarget.price) : "",
    });
    setDraft((previous) => {
      const next: Draft = {};
      for (const row of rows) {
        const kept = selectedRef.current[row.code] ? previous[row.code] : undefined;
        next[row.code] = kept ?? seed(row);
      }
      return next;
    });
  }, [manualOpen, rows]);

  const anyEstimated = rows.some((row) => row.position.sharesEstimated);
  const allSelected = rows.length > 0 && rows.every((row) => selected[row.code]);
  const noneSelected = rows.every((row) => !selected[row.code]);

  // Editing a row ticks it, so the change is saved without a separate click.
  const set = (code: string, field: keyof Draft[string], value: string) => {
    setDraft((previous) => {
      const current = previous[code] ?? { shares: "", avgCost: "", stop: "", target: "" };
      return { ...previous, [code]: { ...current, [field]: value } };
    });
    setSelected((previous) => ({ ...previous, [code]: true }));
  };

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
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as "edit" | "new" | "trades")}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="edit">تعديل</TabsTrigger>
            <TabsTrigger value="new">صفقة جديدة</TabsTrigger>
            <TabsTrigger value="trades">سجل الصفقات</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="mt-4 space-y-4">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              الأسعار بتتحدث تلقائيًا من السوق. استعمل ده لو عايز تصحّح عدد الأسهم أو متوسط الشراء،
              أو تعدّل وقف وهدف بنفسك. ولو نفّذت بيع أو شراء جديد، سجّله من تبويب «صفقة جديدة»،
              ولتصحيح صفقة اتسجلت غلط افتح تبويب «سجل الصفقات».
            </p>

            {anyEstimated && (
              <Notice tone="warn">
                الأسهم المعلّمة بـ ⚠️ عددها اتحسب تقديريًا من صورة المحفظة (القيمة السوقية ÷ آخر سعر) —
                صححها من هنا.
              </Notice>
            )}

            {rows.length === 0 ? (
              <EmptyState title="مفيش مراكز." hint="سجّل أول صفقة من تبويب «صفقة جديدة»." />
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
          </TabsContent>

          <TabsContent value="new" className="mt-4 space-y-4">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              أي بيع أو شراء اتنفذ فعليًا، أو توزيعات أرباح نقدية وصلتك. المتوسط والعدد والكاش
              والتوصيات بتتحدث تلقائيًا.
            </p>
            <TradeForm key={newTradeKey} onDone={() => setNewTradeKey((key) => key + 1)} />
          </TabsContent>

          <TabsContent value="trades" className="mt-4 space-y-4">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              كل الصفقات اللي اتنفذت، الأحدث أول. اضغط على القلم لتصحيح صفقة اتسجلت غلط.
            </p>
            <TradeLog
              trades={pf?.trades ?? []}
              realized={pf?.realizedPnl ?? 0}
              onEdit={(trade) => {
                setEditingTrade(trade);
                setTradeOpen(true);
              }}
            />
          </TabsContent>
        </Tabs>

        <NewTradeDialog open={tradeOpen} onOpenChange={setTradeOpen} trade={editingTrade} />
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

const SIDE: Record<string, { label: string; className: string }> = {
  buy: { label: "شراء", className: "text-up" },
  sell: { label: "بيع", className: "text-down" },
  dividend: { label: "توزيعات", className: "text-primary" },
};

function TradeLog({
  trades,
  realized,
  onEdit,
}: {
  trades: Trade[];
  realized: number;
  onEdit: (trade: LoggedTrade) => void;
}) {
  if (trades.length === 0) {
    return <EmptyState title="مفيش صفقات متسجلة لسه." hint="سجّل أول صفقة من تبويب «صفقة جديدة»." />;
  }
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-surface px-3 py-2.5 text-[13px] font-semibold">
        <span>عدد الصفقات: {int(trades.length)}</span>
        <span className={cn("num text-[12.5px]", tone(realized))}>
          ربح محقق: {signed(realized)} ج
        </span>
      </div>
      <div className="scrollbar-slim overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">التاريخ</TableHead>
              <TableHead className="text-start">الكود</TableHead>
              <TableHead className="text-start">النوع</TableHead>
              <TableHead className="text-start">العدد</TableHead>
              <TableHead className="text-start">السعر</TableHead>
              <TableHead className="text-start">مصاريف</TableHead>
              <TableHead className="text-start">محقق</TableHead>
              <TableHead>
                <span className="sr-only">تعديل</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...trades].reverse().map((trade, reversedIndex) => {
              // Newest first on screen; the edit endpoints address the log's own order.
              const index = trades.length - 1 - reversedIndex;
              return (
                <TableRow key={`${trade.date}-${trade.code}-${index}`}>
                  <TableCell className="num text-right">{trade.date}</TableCell>
                  <TableCell className="font-medium">{trade.code}</TableCell>
                  <TableCell className={SIDE[trade.side]?.className}>
                    {SIDE[trade.side]?.label ?? trade.side}
                  </TableCell>
                  <TableCell className="num text-right">{int(trade.shares)}</TableCell>
                  <TableCell className="num text-right">{fmt(trade.price)}</TableCell>
                  <TableCell className="num text-right text-muted-foreground">
                    {fmt(trade.commission)}
                  </TableCell>
                  <TableCell className={cn("num text-right", tone(trade.realized))}>
                    {trade.realized != null ? signed(trade.realized) : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      aria-label={`تعديل صفقة ${trade.code} بتاريخ ${trade.date}`}
                      onClick={() => onEdit({ ...trade, index })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
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
