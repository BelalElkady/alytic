// PROTOTYPE — throwaway. Answers "Multi-Portfolio desk: switcher, per-Portfolio
// dashboard and overall stats" (wayfinder map #98, ticket #102).
// Three structurally different variants on the existing /portfolio route,
// switchable via ?variant=A|B|C, plus ?tier=long to see the downgrade/upsell
// states. Portfolio 1 is the real one (live totals); 2 and 3 are stubs. Nothing
// is persisted, nothing hits the backend. Delete once a variant wins.
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Lock, MoreHorizontal, Plus, Sparkles } from "lucide-react";

import { Panel, Stat } from "@/components/desk/state-blocks";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { fmt, int, pct, signed, tone } from "@/lib/format";
import { INVEST_STYLES, useActiveInvestStyle, type StyleKey } from "@/lib/invest-style";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tier = "trader" | "long";
type Pf = {
  id: string;
  name: string;
  style: StyleKey;
  value: number;
  cost: number;
  cash: number;
  positions: number;
  real?: boolean;
};

const VARIANTS = [
  { key: "A", name: "تابات" },
  { key: "B", name: "لوحة المحافظ أولًا" },
  { key: "C", name: "قائمة منسدلة + شريط إجمالي" },
] as const;

const CAP: Record<Tier, number> = { trader: 3, long: 1 };
const COLORS = ["bg-primary", "bg-amber-500", "bg-sky-500"];
const styleLabel = (s: StyleKey) => INVEST_STYLES.find((x) => x.key === s)?.label ?? s;
const plOf = (p: Pf) => p.value - p.cost;
const plPctOf = (p: Pf) => (p.cost ? ((p.value - p.cost) / p.cost) * 100 : 0);
const round = (n: number) => Math.round(n * 100) / 100;

function useSearch() {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const navigate = useNavigate();
  const set = (patch: Record<string, unknown>) =>
    void navigate({ to: "/portfolio", search: { ...search, ...patch } as never, replace: true });
  return { search, set };
}

export function usePrototypeVariant() {
  const { search } = useSearch();
  const v = String(search.variant ?? "");
  return import.meta.env.DEV && VARIANTS.some((x) => x.key === v) ? v : null;
}

// ---------------------------------------------------------------- state

function usePrototypeState() {
  const { totals, rows, pf } = useDesk();
  const { style } = useActiveInvestStyle(pf?.trades);
  const { search, set } = useSearch();
  const tier: Tier = search.tier === "long" ? "long" : "trader";

  const [stubs, setStubs] = useState<Pf[]>([
    { id: "p2", name: "مضاربة سريعة", style: "trader", value: 48200, cost: 45000, cash: 6100, positions: 3 },
    { id: "p3", name: "استثمار العيال", style: "long", value: 91500, cost: 97000, cash: 12000, positions: 5 },
  ]);
  const [mainMeta, setMainMeta] = useState<{ name: string; style: StyleKey | null }>({
    name: "المحفظة الرئيسية",
    style: null,
  });
  const [activeId, setActiveId] = useState<string>("p1");

  const main: Pf = {
    id: "p1",
    name: mainMeta.name,
    style: mainMeta.style ?? style,
    value: totals.value,
    cost: totals.cost,
    cash: totals.cash,
    positions: rows.length,
    real: true,
  };
  const portfolios = [main, ...stubs];
  const cap = CAP[tier];
  // Downgrade rule (settled): extras beyond the cap stay visible but read-only.
  const readOnly = (p: Pf) => portfolios.indexOf(p) >= cap;
  const active = portfolios.find((p) => p.id === activeId) ?? main;

  const overall = useMemo(() => {
    const value = portfolios.reduce((s, p) => s + p.value, 0);
    const cost = portfolios.reduce((s, p) => s + p.cost, 0);
    const cash = portfolios.reduce((s, p) => s + p.cash, 0);
    return { value, cost, cash, pl: value - cost, plPct: cost ? ((value - cost) / cost) * 100 : 0 };
  }, [portfolios]);

  const update = (id: string, patch: Partial<Pf>) => {
    if (id === "p1") setMainMeta((m) => ({ name: patch.name ?? m.name, style: patch.style ?? m.style }));
    else setStubs((s) => s.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const create = (name: string, s: StyleKey) => {
    const id = `p${Date.now()}`;
    setStubs((xs) => [...xs, { id, name, style: s, value: 0, cost: 0, cash: 0, positions: 0 }]);
    setActiveId(id);
  };
  const remove = (id: string) => {
    setStubs((xs) => xs.filter((p) => p.id !== id));
    if (activeId === id) setActiveId("p1");
  };

  return {
    tier,
    setTier: (t: Tier) => set({ tier: t === "long" ? "long" : undefined }),
    portfolios,
    cap,
    canAdd: portfolios.length < cap,
    readOnly,
    active,
    setActiveId,
    overall,
    update,
    create,
    remove,
  };
}
type S = ReturnType<typeof usePrototypeState>;

// ---------------------------------------------------------------- shared bits

function StyleBadge({ style }: { style: StyleKey }) {
  return (
    <Badge variant="outline" className="text-[11px] font-medium">
      {styleLabel(style)}
    </Badge>
  );
}

function PlText({ p, className }: { p: { pl: number; plPct: number }; className?: string }) {
  return (
    <span className={cn("num", tone(p.pl), className)}>
      {signed(round(p.pl))} ج ({pct(round(p.plPct))})
    </span>
  );
}

function AllocationBar({ s }: { s: S }) {
  const total = s.overall.value + s.overall.cash || 1;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {s.portfolios.map((p, i) => (
          <div
            key={p.id}
            className={COLORS[i % COLORS.length]}
            style={{ width: `${((p.value + p.cash) / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        {s.portfolios.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", COLORS[i % COLORS.length])} />
            {p.name} <span className="num">{int(Math.round(((p.value + p.cash) / total) * 100))}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function OverallStats({ s }: { s: S }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="إجمالي القيمة" value={`${fmt(round(s.overall.value))} ج`} />
      <Stat
        label="إجمالي الربح / الخسارة"
        value={<PlText p={s.overall} />}
      />
      <Stat label="إجمالي الكاش" value={`${fmt(round(s.overall.cash))} ج`} />
      <Stat label="عدد المحافظ" value={`${int(s.portfolios.length)} / ${int(s.cap)}`} />
    </div>
  );
}

function PortfolioStats({ p }: { p: Pf }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="قيمة المراكز" value={`${fmt(round(p.value))} ج`} />
      <Stat label="الربح / الخسارة" value={<PlText p={{ pl: plOf(p), plPct: plPctOf(p) }} />} />
      <Stat label="الكاش" value={`${fmt(round(p.cash))} ج`} />
      <Stat label="المراكز" value={int(p.positions)} />
    </div>
  );
}

function ReadOnlyNotice({ s }: { s: S }) {
  if (!s.readOnly(s.active)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[13px]">
      <Lock className="size-4" />
      المحفظة دي للعرض بس — باقتك الحالية بتسمح بمحفظة واحدة. جدّد الحريفة عشان تتعامل عليها تاني.
      <Button size="sm" variant="outline" className="ms-auto">
        جدّد الحريفة
      </Button>
    </div>
  );
}

function AddButton({ s, compact }: { s: S; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!s.canAdd && s.tier !== "trader") {
    return (
      <>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
          <Sparkles className="size-4" />
          {compact ? "محافظ أكتر" : "عايز أكتر من محفظة؟"}
        </Button>
        <UpsellDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }
  if (!s.canAdd) return null;
  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {compact ? "" : "محفظة جديدة"}
      </Button>
      <PortfolioDialog
        open={open}
        onOpenChange={setOpen}
        title="محفظة جديدة"
        onSave={(name, style) => s.create(name, style)}
      />
    </>
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
          <Button>اشترك في الحريفة</Button>
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
  onSave: (name: string, style: StyleKey) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [style, setStyle] = useState<StyleKey>(initial?.style ?? "trader");
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
            disabled={!name.trim()}
            onClick={() => {
              onSave(name.trim(), style);
              onOpenChange(false);
            }}
          >
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageMenu({ s, p }: { s: S; p: Pf }) {
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState("");
  const isLast = s.portfolios.length === 1;
  return (
    <>
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-7" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={s.readOnly(p)} onSelect={() => setEdit(true)}>
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
        initial={{ name: p.name, style: p.style }}
        onSave={(name, style) => s.update(p.id, { name, style })}
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
              disabled={typed.trim() !== p.name}
              onClick={() => {
                s.remove(p.id);
                setDel(false);
              }}
            >
              احذف نهائيًا
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The active Portfolio's positions: the real page for Portfolio 1, a placeholder for stubs. */
function Body({ s, children }: { s: S; children: ReactNode }) {
  if (s.active.real) return <>{children}</>;
  return (
    <Panel title={`مراكز «${s.active.name}»`}>
      <div className="py-10 text-center text-[13px] text-muted-foreground">
        (بروتوتايب) هنا هتظهر مراكز المحفظة دي بنفس كروت الصفحة الحالية — {int(s.active.positions)} مراكز،
        توصياتها على أسلوب «{styleLabel(s.active.style)}».
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- variant A: tabs

function VariantA({ s, children }: { s: S; children: ReactNode }) {
  const [tab, setTab] = useState<"all" | "one">("one");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          <div className="font-semibold">كل المحافظ</div>
          <PlText p={s.overall} className="text-[11.5px]" />
        </TabButton>
        {s.portfolios.map((p) => (
          <TabButton
            key={p.id}
            active={tab === "one" && s.active.id === p.id}
            onClick={() => {
              s.setActiveId(p.id);
              setTab("one");
            }}
          >
            <div className="flex items-center gap-1.5 font-semibold">
              {s.readOnly(p) && <Lock className="size-3.5" />}
              {p.name}
            </div>
            <div className="flex items-center gap-2 text-[11.5px]">
              <span className="text-muted-foreground">{styleLabel(p.style)}</span>
              <PlText p={{ pl: plOf(p), plPct: plPctOf(p) }} />
            </div>
          </TabButton>
        ))}
        <div className="px-2">
          <AddButton s={s} compact />
        </div>
      </div>

      {tab === "all" ? (
        <Panel title="نظرة إجمالية على كل المحافظ">
          <div className="space-y-5">
            <OverallStats s={s} />
            <AllocationBar s={s} />
          </div>
        </Panel>
      ) : (
        <>
          <ReadOnlyNotice s={s} />
          <Panel
            title={
              <span className="flex items-center gap-2">
                {s.active.name} <StyleBadge style={s.active.style} />
              </span>
            }
            action={<ManageMenu s={s} p={s.active} />}
          >
            <PortfolioStats p={s.active} />
          </Panel>
          <Body s={s}>{children}</Body>
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px shrink-0 border-b-2 px-4 py-2.5 text-start text-[13.5px]",
        active ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- variant B: dashboard of cards first

function VariantB({ s, children }: { s: S; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <Panel title="فلوسك كلها" action={<AddButton s={s} />}>
        <div className="space-y-5">
          <OverallStats s={s} />
          <AllocationBar s={s} />
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        {s.portfolios.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => s.setActiveId(p.id)}
            className={cn(
              "rounded-xl border bg-card p-4 text-start transition",
              s.active.id === p.id ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40",
              s.readOnly(p) && "opacity-70",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", COLORS[i % COLORS.length])} />
                <span className="font-semibold">{p.name}</span>
                {s.readOnly(p) && <Lock className="size-3.5" />}
              </div>
              <ManageMenu s={s} p={p} />
            </div>
            <div className="mt-1">
              <StyleBadge style={p.style} />
            </div>
            <div className="num mt-3 text-[22px] font-semibold">{fmt(round(p.value + p.cash))} ج</div>
            <PlText p={{ pl: plOf(p), plPct: plPctOf(p) }} className="text-[13px]" />
            <div className="mt-3 flex justify-between text-[11.5px] text-muted-foreground">
              <span>كاش {fmt(round(p.cash))} ج</span>
              <span>{int(p.positions)} مراكز</span>
            </div>
          </button>
        ))}
        {s.tier !== "trader" && s.portfolios.length === 1 && (
          <div className="flex flex-col items-start justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground">
            افصل المضاربة عن الاستثمار الطويل — لحد ٣ محافظ مع الحريفة.
            <AddButton s={s} />
          </div>
        )}
      </div>

      <ReadOnlyNotice s={s} />
      <div className="text-[13px] font-semibold text-muted-foreground">مراكز «{s.active.name}»</div>
      <Body s={s}>{children}</Body>
    </div>
  );
}

// ---------------------------------------------------------------- variant C: compact dropdown + overall strip

function VariantC({ s, children }: { s: S; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-auto gap-3 py-1.5">
              <div className="text-start">
                <div className="text-[11px] text-muted-foreground">المحفظة</div>
                <div className="flex items-center gap-1.5 font-semibold">
                  {s.readOnly(s.active) && <Lock className="size-3.5" />}
                  {s.active.name}
                </div>
              </div>
              <StyleBadge style={s.active.style} />
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>محافظك ({int(s.portfolios.length)} من {int(s.cap)})</DropdownMenuLabel>
            {s.portfolios.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => s.setActiveId(p.id)} className="flex justify-between">
                <span className="flex items-center gap-1.5">
                  {s.readOnly(p) && <Lock className="size-3.5" />}
                  {p.name}
                  <span className="text-[11px] text-muted-foreground">· {styleLabel(p.style)}</span>
                </span>
                <PlText p={{ pl: plOf(p), plPct: plPctOf(p) }} className="text-[11.5px]" />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <div className="p-1">
              <AddButton s={s} />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <ManageMenu s={s} p={s.active} />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px]"
      >
        <span className="font-semibold">إجمالي {int(s.portfolios.length)} محافظ</span>
        <span className="num">{fmt(round(s.overall.value + s.overall.cash))} ج</span>
        <PlText p={s.overall} />
        <span className="text-muted-foreground">كاش {fmt(round(s.overall.cash))} ج</span>
        <ChevronDown className={cn("ms-auto size-4 transition", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <Panel>
          <div className="space-y-5">
            <OverallStats s={s} />
            <AllocationBar s={s} />
          </div>
        </Panel>
      )}

      <ReadOnlyNotice s={s} />
      <Panel>
        <PortfolioStats p={s.active} />
      </Panel>
      <Body s={s}>{children}</Body>
    </div>
  );
}

// ---------------------------------------------------------------- host + floating switcher

export function PortfoliosPrototype({ variant, children }: { variant: string; children: ReactNode }) {
  const s = usePrototypeState();
  return (
    <>
      {variant === "A" && <VariantA s={s}>{children}</VariantA>}
      {variant === "B" && <VariantB s={s}>{children}</VariantB>}
      {variant === "C" && <VariantC s={s}>{children}</VariantC>}
      <PrototypeSwitcher current={variant} s={s} />
    </>
  );
}

function PrototypeSwitcher({ current, s }: { current: string; s: S }) {
  const { set } = useSearch();
  const i = VARIANTS.findIndex((v) => v.key === current);
  const go = (d: number) => set({ variant: VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length]!.key });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(1);
      if (e.key === "ArrowRight") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      dir="ltr"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-3 py-1.5 text-[12px] text-white shadow-xl"
    >
      <button type="button" onClick={() => go(-1)} className="rounded-full p-1 hover:bg-white/15">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-44 text-center font-mono">
        {current} ({VARIANTS[i]?.name})
      </span>
      <button type="button" onClick={() => go(1)} className="rounded-full p-1 hover:bg-white/15">
        <ChevronRight className="size-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-white/30" />
      <button
        type="button"
        onClick={() => s.setTier(s.tier === "trader" ? "long" : "trader")}
        className="rounded-full px-2 py-0.5 hover:bg-white/15"
      >
        tier: {s.tier === "trader" ? "الحريفة" : "النفس الطويل (downgraded)"}
      </button>
    </div>
  );
}
