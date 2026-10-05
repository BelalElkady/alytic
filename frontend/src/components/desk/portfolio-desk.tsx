import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Lock, Minus, MoreHorizontal, Plus, Sparkles, Wallet } from "lucide-react";
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
import { compact, exact, fmt, int, pct, signed, tone } from "@/lib/format";
import { INVEST_STYLES, type StyleKey } from "@/lib/invest-style";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

type Pf = ReturnType<typeof useDesk>["portfolios"][number];

/** One color per Portfolio, by its position in `portfolios` — same order everywhere (AllocationBar, the switcher cards, HeroBar's tag), so a Portfolio reads as the same color across the desk. */
export const PORTFOLIO_COLORS = ["bg-primary", "bg-amber-500", "bg-purple-500"];
const COLORS = PORTFOLIO_COLORS;
const LABEL_COLORS = ["text-primary", "text-amber-500", "text-purple-500"];
const ICON_TINTS = ["bg-primary/15", "bg-amber-500/15", "bg-purple-500/15"];
const round = (n: number) => Math.round(n * 100) / 100;
/**
 * Every card is a clickable role="button" div; Radix portals its dropdown
 * and dialog content out of the card's DOM subtree, but React still bubbles
 * their events up the component tree (see the same hazard, same fix, in
 * _app.portfolio.tsx's PositionCard/CorporateActionNotice). Without this, a
 * click on a style tile or a save button also "clicks" the card underneath
 * it, and the card's onKeyDown swallows every Space keystroke meant for an
 * input inside one of these dialogs.
 */
const stopCardBubble = (e: SyntheticEvent) => e.stopPropagation();
const styleLabel = (s: string | null) => INVEST_STYLES.find((x) => x.key === s)?.label ?? s ?? "—";

/**
 * Every Portfolio at today's live prices, so one reads the same whether or
 * not it's the selected one. The selected Portfolio takes the desk's own
 * totals (what HeroBar shows); the others are valued from their holdings at
 * the same shared `quotes` — and so is the selected one while it's still
 * loading after a switch, instead of flashing zeros. A Portfolio that came
 * without holdings keeps its last-saved snapshot.
 */
function useMergedPortfolios() {
  const { portfolios, totals, rows, pf, quotes } = useDesk();
  return portfolios.map((p) => {
    if (p.active && pf !== null) {
      return { ...p, value: totals.value, pl: totals.pl, cash: totals.cash, positionCount: rows.length };
    }
    if (!p.positions) return p;
    // Exactly what the desk counts for a selected Portfolio (store.tsx
    // `totals`): only holdings with a cost basis — the analysis gives no
    // position to one without — at the average cost rounded as the desk
    // shows it. Anything else here would change the number on selection.
    const held = p.positions.filter((x) => x.shares > 0 && x.avgCost > 0);
    const value = held.reduce((sum, x) => sum + round(x.shares * (quotes?.[x.code]?.price ?? x.price)), 0);
    const cost = held.reduce((sum, x) => sum + x.shares * round(x.avgCost), 0);
    return { ...p, value, pl: value - cost, positionCount: held.length };
  });
}

function StyleBadge({ style }: { style: string | null }) {
  return (
    <Badge variant="outline" className="text-[11px] font-medium">
      {styleLabel(style)}
    </Badge>
  );
}

function PlText({
  pl,
  plPct,
  className,
  stacked = false,
}: {
  pl: number;
  plPct: number;
  className?: string;
  /** Puts the percentage on its own smaller line instead of inline — the inline form
   * ("+176,022.39 ج (+16.87%)") is too wide for OverallStats's grid-cols-2 cells on mobile. */
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <span className={cn("num block", tone(pl), className)}>
        <span className="block truncate">{signed(round(pl))} ج</span>
        <span className="block text-[11px] font-normal text-muted-foreground">
          ({pct(round(plPct))})
        </span>
      </span>
    );
  }
  return (
    <span className={cn("num", tone(pl), className)}>
      {signed(round(pl))} ج ({pct(round(plPct))})
    </span>
  );
}

/** A wallet tile's headline return: an up/down arrow plus the unsigned P/L% — the arrow already carries the sign. */
function WalletPl({ pl, plPct }: { pl: number; plPct: number }) {
  const Icon = pl > 0 ? ArrowUp : pl < 0 ? ArrowDown : Minus;
  return (
    <span className={cn("flex items-center gap-0.5 text-[12.5px] font-bold", tone(pl))}>
      <Icon className="size-3" />
      {exact(Math.abs(round(plPct)))}%
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
            style={{ width: `${Math.max(0, ((p.value + p.cash) / total) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {portfolios.map((p, i) => (
          <span
            key={p.id}
            className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px]"
          >
            <span className={cn("size-2.5 shrink-0 rounded-full", COLORS[i % COLORS.length])} />
            <span className="text-muted-foreground">{p.name}</span>
            <span
              className={cn(
                "num rounded-sm bg-card px-1.5 py-0.5 text-[13px] font-bold",
                LABEL_COLORS[i % LABEL_COLORS.length],
              )}
            >
              {int(Math.round(((p.value + p.cash) / total) * 100))}%
            </span>
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
      <Stat
        label="إجمالي الربح / الخسارة"
        value={<PlText pl={totalPl} plPct={totalPlPct} stacked />}
      />
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

function UpsellDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>لحد ٣ محافظ مع باقة الحريفة</DialogTitle>
        </DialogHeader>
        <p className="text-[14px] leading-7 text-muted-foreground">
          افصل المضاربة عن الاستثمار الطويل: كل محفظة ليها أسلوبها وكاشها وربحها، والتوصيات بتتعمل
          على أسلوب كل محفظة. وكمان نظرة إجمالية على كل فلوسك.
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
  portfolios,
  portfolioId,
  defaultStyle = "trader",
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial?: { name: string; style: StyleKey };
  portfolios: Pf[];
  portfolioId?: number;
  defaultStyle?: StyleKey;
  onSave: (name: string, style: StyleKey) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [style, setStyle] = useState<StyleKey>(initial?.style ?? defaultStyle);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setStyle(initial?.style ?? defaultStyle);
  }, [defaultStyle, initial?.name, initial?.style, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" onClick={stopCardBubble} onKeyDown={stopCardBubble}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-[13px] font-medium">اسم المحفظة</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلًا: مضاربة سريعة"
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-[13px] font-medium">أسلوب الاستثمار</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {INVEST_STYLES.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  disabled={x.key !== style && portfolios.some(
                    (portfolio) => portfolio.id !== portfolioId && portfolio.style === x.key,
                  )}
                  onClick={() => setStyle(x.key)}
                  className={cn(
                    "rounded-lg border p-2.5 text-start text-[13px]",
                    style === x.key ? "border-primary bg-primary/5" : "border-border",
                    x.key !== style && portfolios.some(
                      (portfolio) => portfolio.id !== portfolioId && portfolio.style === x.key,
                    ) && "cursor-not-allowed opacity-45",
                  )}
                >
                  <div className="font-semibold">{x.label}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {x.key !== style && portfolios.some(
                      (portfolio) => portfolio.id !== portfolioId && portfolio.style === x.key,
                    ) ? "مستخدم في محفظة أخرى" : `أفق ${x.horizon}`}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              لكل محفظة أسلوب تداول مختلف، والتوصيات ووقف الخسارة بتتحدد على أساسه.
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
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={stopCardBubble}
            onKeyDown={stopCardBubble}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stopCardBubble} onKeyDown={stopCardBubble}>
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
        portfolios={portfolios}
        portfolioId={p.id}
        onSave={(name, style) => renamePortfolio(p.id, { name, style })}
      />
      <Dialog open={del} onOpenChange={setDel}>
        <DialogContent dir="rtl" onClick={stopCardBubble} onKeyDown={stopCardBubble}>
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
  const defaultStyle = INVEST_STYLES.find(
    (candidate) => !portfolios.some((portfolio) => portfolio.style === candidate.key),
  )?.key ?? "trader";
  if (portfolios.length >= cap) {
    if (user?.tier !== "trader" && portfolios.length === 1) {
      return (
        <div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border px-3.5 py-2.5">
          <span className="text-[11.5px] text-muted-foreground">
            افصل المضاربة عن الاستثمار الطويل — لحد ٣ محافظ مع الحريفة.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setUpsellOpen(true)}
          >
            <Sparkles className="size-4" />
            عايز أكتر من محفظة؟
          </Button>
          <UpsellDialog open={upsellOpen} onOpenChange={setUpsellOpen} />
        </div>
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
        portfolios={portfolios}
        defaultStyle={defaultStyle}
        onSave={(name, style) => createPortfolio(name, style)}
      />
    </>
  );
}

/**
 * The Portfolio switcher: a compact row, not a dashboard. On mobile each
 * entry is an icon/big-number tile (name, style, k-abbreviated total,
 * up/down P/L% — a glance, not a dashboard); at `sm` and up it's the older
 * wider pill (dot, name, style badge, share of total, inline P/L). Both
 * variants render for every Portfolio and the unused one is hidden via
 * Tailwind's responsive display classes — not swapped at runtime — so this
 * stays one static-markup component. The rest (cash, position count, day
 * change) only shows for whichever one is active, in HeroBar's tag
 * (desk-shell.tsx) — this renders in the shell, above HeroBar, on every page,
 * not just `/portfolio`. A <button> can't validly contain ManageMenu's own
 * trigger button (invalid HTML, and this app is server-rendered — the
 * mismatch breaks hydration) — role="button" on a div is this codebase's
 * existing pattern for the same shape (see PositionCard).
 */
export function PortfolioSwitcher() {
  const { portfolioCap, switchPortfolio } = useDesk();
  const portfolios = useMergedPortfolios();
  const total = portfolios.reduce((sum, portfolio) => sum + portfolio.value + portfolio.cash, 0) || 1;

  return (
    <div
      role="group"
      aria-label="المحافظ"
      aria-roledescription="شريط تمرير أفقي"
      className="-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-2 sm:mx-0 sm:flex-wrap sm:gap-2.5 sm:overflow-visible sm:px-0 sm:pb-0"
    >
      {portfolios.map((p, i) => (
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
            "relative flex w-[108px] shrink-0 snap-start cursor-pointer rounded-2xl border bg-card p-3 text-start transition sm:w-auto sm:items-center sm:gap-2.5 sm:rounded-xl sm:px-3.5 sm:py-2.5",
            p.active
              ? p.pl > 0
                ? "border-up ring-2 ring-up/45 sm:bg-up-soft"
                : p.pl < 0
                  ? "border-down ring-2 ring-down/45 sm:bg-down-soft"
                  : "border-primary ring-2 ring-primary/30 sm:bg-primary/5"
              : "border-border hover:border-primary/40",
            p.readOnly && "opacity-70",
          )}
        >
          {/* Mobile tile — hidden at sm and up. */}
          <div className="flex w-full flex-col items-start gap-1.5 sm:hidden">
            <div className="absolute end-1.5 top-1.5">
              <ManageMenu p={p} />
            </div>
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full",
                ICON_TINTS[i % ICON_TINTS.length],
              )}
            >
              <Wallet className={cn("size-4", LABEL_COLORS[i % LABEL_COLORS.length])} />
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[11.5px] font-semibold text-muted-foreground">
              <span className="truncate">{p.name}</span>
              {p.readOnly && <Lock className="size-3 shrink-0" />}
            </span>
            <span className="truncate text-[10px] text-muted-foreground">{styleLabel(p.style)}</span>
            <span className="num truncate text-[18px] font-bold leading-tight tracking-tight">
              {compact(round(p.value + p.cash))}
              <span className="text-[11px] font-medium text-muted-foreground"> ج</span>
            </span>
            <WalletPl pl={p.pl} plPct={p.value - p.pl ? (p.pl / (p.value - p.pl)) * 100 : 0} />
          </div>

          {/* Desktop pill (the original style) — hidden below sm. */}
          <div className="hidden sm:flex sm:w-full sm:items-center sm:gap-2.5">
            <ManageMenu p={p} />
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full",
                ICON_TINTS[i % ICON_TINTS.length],
              )}
            >
              <Wallet className={cn("size-4", LABEL_COLORS[i % LABEL_COLORS.length])} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="truncate">{p.name}</span>
                {p.readOnly && <Lock className="size-3.5" />}
              </span>
              <StyleBadge style={p.style} />
              <span className="text-[10.5px] text-muted-foreground">
                حصة من الإجمالي{" "}
                <span className="num font-semibold text-foreground">
                  {pct(round(((p.value + p.cash) / total) * 100))}
                </span>
              </span>
              <PlText
                pl={p.pl}
                plPct={p.value - p.pl ? (p.pl / (p.value - p.pl)) * 100 : 0}
                className="text-[10.5px]"
              />
            </div>
          </div>
        </div>
      ))}
      <AddButton portfolios={portfolios} cap={portfolioCap} />
    </div>
  );
}

/** Wraps the existing `/portfolio` page content with the overview panel (the switcher itself now lives in the shell, above HeroBar). */
export function PortfolioDesk({ children }: { children: ReactNode }) {
  const { portfolioCap } = useDesk();
  const portfolios = useMergedPortfolios();
  const active = portfolios.find((p) => p.active) ?? portfolios[0];

  return (
    <div className="space-y-4">
      {/* A single wallet has nothing to total or allocate across — the panel would just repeat its own card. */}
      {portfolios.length > 1 && (
        <Panel title="إجمالي المحافظ">
          <div className="space-y-5">
            <OverallStats portfolios={portfolios} cap={portfolioCap} />
            <AllocationBar portfolios={portfolios} />
          </div>
        </Panel>
      )}

      {active && <ReadOnlyNotice active={active} />}
      {active && (
        <div className="text-[13px] font-semibold text-muted-foreground">مراكز «{active.name}»</div>
      )}
      {children}
    </div>
  );
}
