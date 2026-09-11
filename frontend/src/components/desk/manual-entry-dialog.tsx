import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Notice, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { post } from "@/lib/api";
import { useDesk } from "@/lib/store";

type Draft = Record<string, { shares: string; avgCost: string; stop: string; target: string }>;

/** Correct share counts, average cost, stop and target — same endpoints. */
export function ManualEntryDialog() {
  const { manualOpen, setManualOpen, rows, reload } = useDesk();
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manualOpen) return;
    const next: Draft = {};
    for (const row of rows) {
      next[row.code] = {
        shares: String(row.position.shares ?? ""),
        avgCost: String(row.position.avgCost ?? ""),
        stop: String(row.position.stop ?? ""),
        target: row.midTarget?.price != null ? String(row.midTarget.price) : "",
      };
    }
    setDraft(next);
    setError(null);
  }, [manualOpen, rows]);

  const anyEstimated = rows.some((row) => row.position.sharesEstimated);

  const set = (code: string, field: keyof Draft[string], value: string) =>
    setDraft((previous) => {
      const current = previous[code] ?? { shares: "", avgCost: "", stop: "", target: "" };
      return { ...previous, [code]: { ...current, [field]: value } };
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const row of rows) {
        const entry = draft[row.code];
        if (!entry) continue;
        const sharesChanged = +entry.shares !== row.position.shares;
        const costChanged = +entry.avgCost !== row.position.avgCost;
        if (sharesChanged || costChanged) {
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
            تعدّل وقف وهدف بنفسك.
          </p>
        </DialogHeader>

        {anyEstimated && (
          <Notice tone="warn">
            الأسهم المعلّمة بـ ⚠️ عددها اتحسب تقديريًا من صورة المحفظة (القيمة السوقية ÷ آخر سعر) —
            صححها من هنا.
          </Notice>
        )}

        {rows.length === 0 ? (
          <EmptyState title="مفيش مراكز." hint="سجّل أول صفقة من تبويب الصفقات." />
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const entry = draft[row.code];
              if (!entry) return null;
              return (
                <div key={row.code} className="rounded-lg border bg-surface p-3">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
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
            <Button onClick={save} disabled={busy}>
              {busy && <Spinner />}
              حفظ التعديلات
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
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
