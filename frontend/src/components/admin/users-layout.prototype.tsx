// PROTOTYPE — throwaway (wayfinder: "Prototype the slim table + detail drawer layout", issue #29).
// Three structurally different layouts of the admin users screen on the existing /admin route, switchable via
// `?variant=A|B|C`: A = slim table + drawer, B = cards that expand in place, C = list + detail split view.
// Glance row and stats strip follow the decisions in #27 and #28. Editors are the real ones: changes are real.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { arDay, int, signed, tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdminUserBehavior, AdminUserRow } from "@/routes/_app.admin";

export const PROTOTYPE_VARIANTS = [
  { key: "A", name: "Slim table + drawer" },
  { key: "B", name: "Cards, expand in place" },
  { key: "C", name: "List + detail split" },
];

type EditorProps = { row: AdminUserRow; onChanged: () => void; readOnly: boolean };

export type PrototypeEditors = {
  Subscription: (p: EditorProps) => ReactNode;
  Credits: (p: EditorProps) => ReactNode;
  Role: (p: EditorProps) => ReactNode;
  Delete: (p: { row: AdminUserRow; onDeleted: () => void }) => ReactNode;
  Behavior: (p: { behavior: AdminUserBehavior }) => ReactNode;
};

export type PrototypeStats = {
  capital: number;
  profit: number;
  styleCounts: Record<"trader" | "medium" | "long", number>;
  styleUnknown: number;
  subTrader: number;
  subMediumLong: number;
};

type Props = {
  variant: string;
  rows: AdminUserRow[];
  totalCount: number;
  stats: PrototypeStats;
  online: { signedIn: number; visitors: number; windowSeconds: number; asOf: string } | null;
  chips: { key: string; label: string; count: number }[];
  activeChip: string;
  onChip: (key: string) => void;
  controls: ReactNode;
  readOnly: boolean;
  onChanged: () => void;
  editors: PrototypeEditors;
  systemUserId: string;
};

// ---------- shared glance atoms (the #27 decision) ----------

const DAY = 86_400_000;
const rtf = new Intl.RelativeTimeFormat("ar-EG-u-nu-latn", { numeric: "auto" });

function ago(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return rtf.format(-Math.max(1, Math.round(diff / 60)), "minute");
  if (diff < 86_400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (diff < 30 * 86_400) return rtf.format(-Math.round(diff / 86_400), "day");
  return rtf.format(-Math.round(diff / (30 * 86_400)), "month");
}

const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);
const TIER_LABEL = { trader: "مضاربة", long: "طويل المدى" } as const;

function renewal(row: AdminUserRow): { text: string; warn: boolean } {
  const sub = row.subscription;
  if (sub?.active) {
    const left = daysUntil(sub.currentPeriodEnd);
    return { text: `مشترك فعال · ${TIER_LABEL[sub.tier]} · ينتهي ${arDay(sub.currentPeriodEnd.slice(0, 10))}`, warn: left <= 7 };
  }
  if (row.trialActive) {
    const left = Math.max(0, daysUntil(row.trialEndsAt));
    return { text: `تجربة · باقي ${left} يوم`, warn: left <= 2 };
  }
  const ends = [row.trialEndsAt, sub?.currentPeriodEnd].filter(Boolean) as string[];
  const last = ends.sort().at(-1);
  const since = last ? Math.max(0, -daysUntil(last)) : null;
  return { text: since != null ? `منتهي منذ ${since} يوم` : "مجاني", warn: true };
}

const grantedCredits = (row: AdminUserRow) => Object.values(row.usage.credits).reduce((a, b) => a + b, 0);
const isOnline = (row: AdminUserRow) => !!row.lastSeenAt && Date.now() - new Date(row.lastSeenAt).getTime() < 3 * 60_000;

/** `phoneClassName` lets a layout with its own phone column hide the phone line here (e.g. "sm:hidden"). */
function Identity({ row, systemUserId, phoneClassName }: { row: AdminUserRow; systemUserId: string; phoneClassName?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold">{row.name || row.email}</div>
      <div dir="ltr" className={cn("num text-end text-[13px]", phoneClassName)}>
        {row.phone || "—"}
      </div>
      {row.name && <div className="truncate text-[12px] text-muted-foreground">{row.email}</div>}
      <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
        {row.isAdmin && <Badge>مشرف</Badge>}
        {row.isMarketer && <Badge variant="secondary">مسوّق</Badge>}
        {!row.emailVerified && <Badge variant="destructive">بريد غير مفعّل</Badge>}
        {row.id === systemUserId && <Badge variant="outline">حساب النظام</Badge>}
      </div>
    </div>
  );
}

function Renewal({ row }: { row: AdminUserRow }) {
  const r = renewal(row);
  const credits = grantedCredits(row);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn("tabular-nums", row.subscription?.active ? "text-up font-medium" : r.warn && "text-warn font-medium")}>
        {r.text}
      </span>
      {credits > 0 && (
        <Badge variant="outline" className="tabular-nums">
          +{credits} رصيد
        </Badge>
      )}
    </div>
  );
}

function Activity({ row }: { row: AdminUserRow }) {
  return (
    <div className="tabular-nums text-[13px]">
      <div className="flex items-center gap-1.5">
        {isOnline(row) && <span className="size-1.5 rounded-full bg-up" aria-label="متصل الآن" />}
        {row.lastSeenAt ? `ظهر ${ago(row.lastSeenAt)}` : row.lastLoginAt ? `دخل ${ago(row.lastLoginAt)}` : "لم يظهر"}
      </div>
      <div className="text-[11.5px] text-muted-foreground">سجّل {arDay(row.createdAt?.slice(0, 10))}</div>
    </div>
  );
}

// ---------- shared detail body (grouping is still fog on the map; kept identical across variants) ----------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b pb-4 last:border-b-0">
      <h3 className="text-[12px] font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const fullTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ar-EG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", numberingSystem: "latn" })
    : "—";

function Detail({ row, p }: { row: AdminUserRow; p: Props }) {
  const { editors: E, readOnly, onChanged, systemUserId } = p;
  const pf = row.portfolio;
  return (
    <div className="space-y-4 text-sm">
      <Section title="الاشتراك والرصيد">
        <Renewal row={row} />
        <div className="grid gap-3 sm:grid-cols-2">
          <E.Subscription row={row} onChanged={onChanged} readOnly={readOnly} />
          <E.Credits row={row} onChanged={onChanged} readOnly={readOnly} />
        </div>
      </Section>
      <Section title="التواصل">
        <dl className="tabular-nums grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-muted-foreground">البريد</dt>
          <dd className="truncate">{row.email}</dd>
          <dt className="text-muted-foreground">الهاتف</dt>
          <dd dir="ltr" className="text-end">{row.phone || "—"}</dd>
          <dt className="text-muted-foreground">التسجيل</dt>
          <dd>{fullTime(row.createdAt)}</dd>
          <dt className="text-muted-foreground">آخر دخول</dt>
          <dd>{fullTime(row.lastLoginAt)}</dd>
          <dt className="text-muted-foreground">آخر ظهور</dt>
          <dd>{fullTime(row.lastSeenAt)}</dd>
          <dt className="text-muted-foreground">IP</dt>
          <dd dir="ltr" className="text-end text-[12px]">
            {row.signupIp ? `reg ${row.signupIp}` : "—"}
            {row.lastLoginIp && row.lastLoginIp !== row.signupIp ? ` · login ${row.lastLoginIp}` : ""}
          </dd>
        </dl>
      </Section>
      <Section title="الاستثمار">
        {pf ? (
          <div className="tabular-nums grid grid-cols-3 gap-2 text-[13px]">
            <div>
              <div className="text-muted-foreground">رأس المال</div>
              {int(pf.cash + pf.positionsValue)} ج
            </div>
            <div>
              <div className="text-muted-foreground">ربح محقق</div>
              <span className={tone(pf.realizedPnl)}>{signed(pf.realizedPnl)}</span>
            </div>
            <div>
              <div className="text-muted-foreground">النشاط</div>
              {pf.tradesCount} صفقة · {pf.positionsCount} مركز
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground">لا توجد محفظة</div>
        )}
        {row.behavior && <E.Behavior behavior={row.behavior} />}
      </Section>
      <Section title="الحساب">
        <div className="flex flex-wrap items-center gap-2">
          <E.Role row={row} onChanged={onChanged} readOnly={readOnly} />
          {row.googleLinked && <Badge variant="secondary">Google</Badge>}
          {!readOnly && !row.isAdmin && row.id !== systemUserId && (
            <span className="ms-auto">
              <E.Delete row={row} onDeleted={onChanged} />
            </span>
          )}
        </div>
      </Section>
    </div>
  );
}

// ---------- shared stats strip (the #28 decision) ----------

const MORE_KEY = "prototype.admin.moreStats";

function StatsStrip({ p }: { p: Props }) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    try {
      setMore(localStorage.getItem(MORE_KEY) === "1");
    } catch {}
  }, []);
  const toggle = () => {
    setMore((m) => {
      try {
        localStorage.setItem(MORE_KEY, m ? "0" : "1");
      } catch {}
      return !m;
    });
  };
  const { online, stats: s } = p;
  const figures = [
    { label: "إجمالي رأس مال المحافظ", value: `${int(s.capital)} ج` },
    { label: "إجمالي الأرباح المحققة", value: signed(s.profit), cls: tone(s.profit) },
    { label: "مضاربة", value: int(s.styleCounts.trader) },
    { label: "متوسط المدى", value: int(s.styleCounts.medium) },
    { label: "طويل المدى", value: int(s.styleCounts.long) },
    { label: "غير محدد الأسلوب", value: int(s.styleUnknown) },
    { label: "مشترك فعال — مضاربة", value: int(s.subTrader) },
    { label: "مشترك فعال — متوسط/طويل", value: int(s.subMediumLong) },
  ];
  return (
    <div className="space-y-2">
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 whitespace-nowrap">
        <span
          className="tabular-nums inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px]"
          title={online ? `آخر ${Math.round(online.windowSeconds / 60)} دقايق · زوّار غير مسجّلين: ${online.visitors} (تُصفَّر مع إعادة تشغيل السيرفر)` : undefined}
        >
          <span className="size-1.5 rounded-full bg-up" />
          متصلون الآن {online ? int(online.signedIn + online.visitors) : "…"}
          <span className="text-muted-foreground">({online ? int(online.signedIn) : "…"} مسجّلين)</span>
        </span>
        {p.chips.map((c) => (
          <Button
            key={c.key}
            size="sm"
            variant={p.activeChip === c.key ? "default" : "outline"}
            className="tabular-nums shrink-0 rounded-full"
            onClick={() => p.onChip(c.key)}
          >
            {c.label} <span className="font-semibold">{int(c.count)}</span>
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="shrink-0" onClick={toggle}>
          {more ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}
          إحصائيات أكثر
        </Button>
      </div>
      {more && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="bg-surface p-3">
              <div className="text-[11.5px] text-muted-foreground">{f.label}</div>
              <div className={cn("num mt-1 text-[16px] font-semibold", f.cls)}>{f.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- variants ----------

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

/** A — the leading idea: slim 3-column table (2 on phone), row opens a side drawer (bottom sheet on phone). */
function VariantA({ p }: { p: Props }) {
  const phone = useIsPhone();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = p.rows.find((r) => r.id === selectedId) ?? null;
  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[12px] text-muted-foreground">
            <tr>
              <th className="p-3 text-start font-medium">المستخدم</th>
              <th className="hidden p-3 text-start font-medium sm:table-cell">الهاتف</th>
              <th className="p-3 text-start font-medium">الاشتراك</th>
              <th className="hidden p-3 text-start font-medium sm:table-cell">النشاط</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                className={cn(
                  "cursor-pointer border-t align-top",
                  // Subscribed Users stand out in green; the selected row still wins so the drawer's row is findable.
                  row.subscription?.active ? "bg-up-soft hover:bg-up-soft/70" : "hover:bg-muted/40",
                  selectedId === row.id && "bg-muted/60",
                )}
              >
                <td className="max-w-[260px] p-3">
                  <Identity row={row} systemUserId={p.systemUserId} phoneClassName="sm:hidden" />
                </td>
                <td className="hidden p-3 sm:table-cell">
                  <span dir="ltr" className="num text-[13px]">{row.phone || "—"}</span>
                </td>
                <td className="p-3">
                  <Renewal row={row} />
                </td>
                <td className="hidden p-3 sm:table-cell">
                  <Activity row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent
          side={phone ? "bottom" : "left"}
          className={cn("overflow-y-auto", phone ? "max-h-[85vh] rounded-t-2xl" : "w-full sm:max-w-lg")}
        >
          {selected && (
            <>
              <SheetHeader className="mb-4 text-start">
                <SheetTitle>{selected.name || selected.email}</SheetTitle>
              </SheetHeader>
              <Detail row={selected} p={p} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** B — no table at all: a card per User; tapping a card expands it in place to the full-width detail. */
function VariantB({ p }: { p: Props }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {p.rows.map((row) => {
        const open = openId === row.id;
        return (
          <div
            key={row.id}
            className={cn("rounded-xl border bg-surface p-4 shadow-sm", open && "sm:col-span-2 xl:col-span-3 ring-2 ring-primary/40")}
          >
            <button type="button" className="flex w-full items-start gap-3 text-start" onClick={() => setOpenId(open ? null : row.id)}>
              <div className="min-w-0 flex-1 space-y-2">
                <Identity row={row} systemUserId={p.systemUserId} />
                <Renewal row={row} />
                <Activity row={row} />
              </div>
              {open ? <X className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
            </button>
            {open && (
              <div className="mt-4 border-t pt-4">
                <Detail row={row} p={p} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** C — mail-client style: a narrow list always beside a persistent detail pane; on phone the detail replaces the list. */
function VariantC({ p }: { p: Props }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phoneDetail, setPhoneDetail] = useState(false);
  const selected = p.rows.find((r) => r.id === selectedId) ?? p.rows[0] ?? null;
  return (
    <div className="overflow-hidden rounded-lg border lg:grid lg:h-[75vh] lg:grid-cols-[380px_1fr]">
      <ul className={cn("divide-y overflow-y-auto lg:border-e", phoneDetail && "hidden lg:block")}>
        {p.rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedId(row.id);
                setPhoneDetail(true);
              }}
              className={cn(
                "flex w-full items-start gap-2 p-3 text-start text-sm hover:bg-muted/40",
                selected?.id === row.id && "lg:bg-muted/70",
              )}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <Identity row={row} systemUserId={p.systemUserId} />
                <Renewal row={row} />
              </div>
              {isOnline(row) && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-up" />}
            </button>
          </li>
        ))}
      </ul>
      <div className={cn("overflow-y-auto p-4", !phoneDetail && "hidden lg:block")}>
        <Button size="sm" variant="ghost" className="mb-2 lg:hidden" onClick={() => setPhoneDetail(false)}>
          <ChevronRight className="size-4" /> رجوع للقائمة
        </Button>
        {selected ? (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <Identity row={selected} systemUserId={p.systemUserId} />
              <Activity row={selected} />
            </div>
            <Detail row={selected} p={p} />
          </>
        ) : (
          <div className="text-muted-foreground">اختر مستخدمًا</div>
        )}
      </div>
    </div>
  );
}

export function UsersLayoutPrototype(p: Props) {
  return (
    <div className="space-y-4">
      <StatsStrip p={p} />
      {p.controls}
      <div className="text-[12px] text-muted-foreground">
        {p.rows.length} من {p.totalCount} مستخدم
      </div>
      {p.variant === "B" ? <VariantB p={p} /> : p.variant === "C" ? <VariantC p={p} /> : <VariantA p={p} />}
    </div>
  );
}
