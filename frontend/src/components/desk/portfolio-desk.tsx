import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock, MoreHorizontal, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Panel, Spinner, Stat } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { fmt, int, pct, signed, tone } from "@/lib/format";
import { INVEST_STYLES, type StyleKey } from "@/lib/invest-style";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

type Pf = ReturnType<typeof useDesk>["portfolios"][number];

const COLORS = ["bg-primary", "bg-amber-500", "bg-sky-500"];
const round = (n: number) => Math.round(n * 100) / 100;
const styleLabel = (s: string | null) => INVEST_STYLES.find((x) => x.key === s)?.label ?? s ?? "—";
/** A card's own P/L % — the summary carries `value`/`pl` directly, not `cost`, so cost is derived back out. */
const plPctOf = (p: Pf) => {
  const cost = p.value - p.pl;
  return cost ? (p.pl / cost) * 100 : 0;
};

/**
 * `useDesk().portfolios` holds each Portfolio's last-saved snapshot (#101's
 * resolution). The active Portfolio's card instead shows today's live tick,
 * same as the rest of the desk — every other card keeps the snapshot as-is.
 */
function useMergedPortfolios() {
  const { portfolios, totals, rows } = useDesk();
  return portfolios.map((p) =>
    p.active ? { ...p, value: totals.value, pl: totals.pl, cash: totals.cash, positionCount: rows.length } : p,
  );
}

function StyleBadge({ style }: { style: string | null }) {
  return (
    <Badge variant="outline" className="text-[11px] font-medium">
      {styleLabel(style)}
    </Badge>
  );
}

function PlText({ pl, plPct, className }: { pl: number; plPct: number; className?: string }) {
  return (
    <span className={cn("num", tone(pl), className)}>
      {signed(round(pl))} ج ({pct(round(plPct))})
    </span>
  );
}

function AllocationBar({ portfolios }: { portfolios: Pf[] }) {
  const total = portfolios.reduce((s, p) => s + p.value + p.cash, 0) || 1;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {portfolios.map((p, i) => (
          <div
            key={p.id}
            className={COLORS[i % COLORS.length]}
            style={{ width: `${((p.value + p.cash) / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        {portfolios.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", COLORS[i % COLORS.length])} />
            {p.name} <span className="num">{int(Math.round(((p.value + p.cash) / total) * 100))}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Sums come straight off the summary's `value`/`pl`/`cash` (no `cost` field
 * exists on it); the overall P/L % derives cost back out of value and pl.
 */
function OverallStats({ portfolios, cap }: { portfolios: Pf[]; cap: number }) {
  const totalValue = portfolios.reduce((s, p) => s + p.value, 0);
  const totalPl = portfolios.reduce((s, p) => s + p.pl, 0);
  const totalCash = portfolios.reduce((s, p) => s + p.cash, 0);
  const totalCost = totalValue - totalPl;
  const totalPlPct = totalCost ? (totalPl / totalCost) * 100 : 0;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="إجمالي القيمة" value={`${fmt(round(totalValue))} ج`} />
      <Stat label="إجمالي الربح / الخسارة" value={<PlText pl={totalPl} plPct={totalPlPct} />} />
      <Stat label="إجمالي الكاش" value={`${fmt(round(totalCash))} ج`} />
      <Stat label="عدد المحافظ" value={`${int(portfolios.length)} / ${int(cap)}`} />
    </div>
  );
}

function ReadOnlyNotice({ active }: { active: Pf }) {
  if (!active.readOnly) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[13px]">
      <Lock className="size-4" />
      المحفظة دي للعرض بس — باقتك الحالية بتسمح بمحفظة واحدة. جدّد الحريفة عشان تتعامل عليها تاني.
      <Button size="sm" variant="outline" className="ms-auto" asChild>
        <Link to="/subscribe">جدّد الحريفة</Link>
      </Button>
    </div>
  );
}

function UpsellDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>لحد ٣ محافظ مع باقة الحريفة</DialogTitle>
        </DialogHeader>
        <p className="text-[14px] leading-7 text-muted-foreground">
          افصل المضاربة عن الاستثمار الطويل: كل محفظة ليها أسلوبها وكاشها وربحها، والتوصيات بتتعمل على
          أسلوب كل محفظة. وكمان نظرة إجمالية على كل فلوسك.
        </p>
        <DialogFooter>
          <Button asChild>
            <Link to="/subscribe">طريقة الاشتراك</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PortfolioDialog({
  open,
  onOpenChange,
  title,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial?: { name: string; style: StyleKey };
  onSave: (name: string, style: StyleKey) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [style, setStyle] = useState<StyleKey>(initial?.style ?? "trader");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-[13px] font-medium">اسم المحفظة</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلًا: مضاربة سريعة" />
          </div>
          <div className="space-y-1.5">
            <div className="text-[13px] font-medium">أسلوب الاستثمار</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {INVEST_STYLES.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setStyle(x.key)}
                  className={cn(
                    "rounded-lg border p-2.5 text-start text-[13px]",
                    style === x.key ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <div className="font-semibold">{x.label}</div>
                  <div className="text-[11.5px] text-muted-foreground">أفق {x.horizon}</div>
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              التوصيات ووقف الخسارة في المحفظة دي هتتعمل على الأسلوب ده.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(name.trim(), style);
                onOpenChange(false);
              } catch (caught) {
                toast.error(caught instanceof Error ? caught.message : "تعذر حفظ المحفظة");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Spinner />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageMenu({ p }: { p: Pf }) {
  const { portfolios, renamePortfolio, deletePortfolio } = useDesk();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const isLast = portfolios.length === 1;
  return (
    <>
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-7" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={p.readOnly} onSelect={() => setEdit(true)}>
            تعديل الاسم والأسلوب
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isLast}
            className="text-down"
            onSelect={() => {
              setTyped("");
              setDel(true);
            }}
          >
            حذف المحفظة
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PortfolioDialog
        open={edit}
        onOpenChange={setEdit}
        title="تعديل المحفظة"
        initial={{ name: p.name, style: (p.style as StyleKey | null) ?? "medium" }}
        onSave={(name, style) => renamePortfolio(p.id, { name, style })}
      />
      <Dialog open={del} onOpenChange={setDel}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>حذف «{p.name}»</DialogTitle>
          </DialogHeader>
          <p className="text-[14px] leading-7 text-muted-foreground">
            هتتمسح كل المراكز والصفقات والكاش اللي في المحفظة دي. اكتب اسم المحفظة للتأكيد.
          </p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={p.name} />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={typed.trim() !== p.name || deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await deletePortfolio(p.id);
                  setDel(false);
                } catch (caught) {
                  toast.error(caught instanceof Error ? caught.message : "تعذر حذف المحفظة");
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? <Spinner /> : null}
              احذف نهائيًا
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddButton({ portfolios, cap }: { portfolios: Pf[]; cap: number }) {
  const { user, createPortfolio } = useDesk();
  const [open, setOpen] = useState(false);
  const [upsellOpen, setUpsellOpen] = useState(false);
  if (portfolios.length >= cap) {
    if (user?.tier !== "trader" && portfolios.length === 1) {
      return (
        <>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setUpsellOpen(true)}>
            <Sparkles className="size-4" />
            عايز أكتر من محفظة؟
          </Button>
          <UpsellDialog open={upsellOpen} onOpenChange={setUpsellOpen} />
        </>
      );
    }
    return null;
  }
  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        محفظة جديدة
      </Button>
      <PortfolioDialog
        open={open}
        onOpenChange={setOpen}
        title="محفظة جديدة"
        onSave={(name, style) => createPortfolio(name, style)}
      />
    </>
  );
}

/** Wraps the existing `/portfolio` page content with the overview panel and the Portfolio cards above it. */
export function PortfolioDesk({ children }: { children: ReactNode }) {
  const { portfolioCap, switchPortfolio, user } = useDesk();
  const portfolios = useMergedPortfolios();
  const active = portfolios.find((p) => p.active) ?? portfolios[0];

  return (
    <div className="space-y-4">
      <Panel title="فلوسك كلها" action={<AddButton portfolios={portfolios} cap={portfolioCap} />}>
        <div className="space-y-5">
          <OverallStats portfolios={portfolios} cap={portfolioCap} />
          <AllocationBar portfolios={portfolios} />
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        {portfolios.map((p, i) => (
          // A <button> can't validly contain ManageMenu's own trigger button
          // (invalid HTML, and this app is server-rendered — the mismatch
          // breaks hydration) — role="button" on a div is this codebase's
          // existing pattern for the same shape (see PositionCard).
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => switchPortfolio(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                switchPortfolio(p.id);
              }
            }}
            className={cn(
              "cursor-pointer rounded-xl border bg-card p-4 text-start transition",
              p.active ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40",
              p.readOnly && "opacity-70",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", COLORS[i % COLORS.length])} />
                <span className="font-semibold">{p.name}</span>
                {p.readOnly && <Lock className="size-3.5" />}
              </div>
              <ManageMenu p={p} />
            </div>
            <div className="mt-1">
              <StyleBadge style={p.style} />
            </div>
            <div className="num mt-3 text-[22px] font-semibold">{fmt(round(p.value + p.cash))} ج</div>
            <PlText pl={p.pl} plPct={plPctOf(p)} className="text-[13px]" />
            <div className="mt-3 flex justify-between text-[11.5px] text-muted-foreground">
              <span>كاش {fmt(round(p.cash))} ج</span>
              <span>{int(p.positionCount)} مراكز</span>
            </div>
          </div>
        ))}
        {user?.tier !== "trader" && portfolios.length === 1 && (
          <div className="flex flex-col items-start justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground">
            افصل المضاربة عن الاستثمار الطويل — لحد ٣ محافظ مع الحريفة.
            <AddButton portfolios={portfolios} cap={portfolioCap} />
          </div>
        )}
      </div>

      {active && <ReadOnlyNotice active={active} />}
      {active && <div className="text-[13px] font-semibold text-muted-foreground">مراكز «{active.name}»</div>}
      {children}
    </div>
  );
}
