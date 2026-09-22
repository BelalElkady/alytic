// The admin users screen: a stats strip whose Renewal status chips double as the filter, then a slim table
// (Identity · phone · Renewal · activity) where a row opens a drawer (bottom sheet on phone) with everything else,
// including every editor. Designed on map #26 (decisions in #27, #28, #29).
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { arDay, int, signed, tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdminUserBehavior, AdminUserRow } from "@/routes/_app.admin";

type EditorProps = { row: AdminUserRow; onChanged: () => void; readOnly: boolean };

export type UsersScreenEditors = {
  Subscription: (p: EditorProps) => ReactNode;
  Credits: (p: EditorProps) => ReactNode;
  Role: (p: EditorProps) => ReactNode;
  Delete: (p: { row: AdminUserRow; onDeleted: () => void }) => ReactNode;
  Behavior: (p: { behavior: AdminUserBehavior }) => ReactNode;
};

export type UsersScreenStats = {
  capital: number;
  profit: number;
  styleCounts: Record<"trader" | "medium" | "long", number>;
  styleUnknown: number;
  subTrader: number;
  subMediumLong: number;
};

type Props = {
  /** Searched and sorted, but not filtered by Renewal status: this screen owns that filter. */
  rows: AdminUserRow[];
  totalCount: number;
  stats: UsersScreenStats;
  online: { signedIn: number; visitors: number; windowSeconds: number; asOf: string } | null;
  controls: ReactNode;
  readOnly: boolean;
  onChanged: () => void;
  editors: UsersScreenEditors;
  systemUserId: string;
};

// ---------- glance row ----------

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

/** Renewal status, split four ways: a paid Subscription that ran out (Expired) is told apart from never having paid. */
export type RenewalStatus = "active" | "expired" | "trial" | "never";

export const RENEWAL_LABEL: Record<RenewalStatus, string> = {
  active: "مشترك فعال",
  expired: "اشتراك منتهي",
  trial: "تجربة",
  never: "لم يشترك",
};

const RENEWAL_CHIPS: { key: "all" | RenewalStatus; label: string }[] = [
  { key: "all", label: "الكل" },
  ...(Object.keys(RENEWAL_LABEL) as RenewalStatus[]).map((key) => ({ key, label: RENEWAL_LABEL[key] })),
];

export const renewalStatus = (row: AdminUserRow): RenewalStatus =>
  row.subscription?.active ? "active" : row.subscription ? "expired" : row.trialActive ? "trial" : "never";

const daysSince = (iso: string) => Math.max(0, -daysUntil(iso));

function renewal(row: AdminUserRow): { text: string; className?: string } {
  const sub = row.subscription;
  switch (renewalStatus(row)) {
    case "active":
      return { text: `مشترك فعال · ${TIER_LABEL[sub!.tier]} · ينتهي ${arDay(sub!.currentPeriodEnd.slice(0, 10))}`, className: "text-up font-medium" };
    case "expired":
      return { text: `اشتراك منتهي منذ ${daysSince(sub!.currentPeriodEnd)} يوم · كان ${TIER_LABEL[sub!.tier]}`, className: "text-down font-medium" };
    case "trial": {
      const left = Math.max(0, daysUntil(row.trialEndsAt));
      return { text: `تجربة · باقي ${left} يوم`, className: left <= 2 ? "text-warn font-medium" : undefined };
    }
    case "never":
      return { text: `لم يشترك · التجربة انتهت منذ ${daysSince(row.trialEndsAt)} يوم`, className: "text-muted-foreground" };
  }
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
      <span className={cn("tabular-nums", r.className)}>
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

// ---------- drawer ----------

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

// ---------- stats strip ----------

const MORE_KEY = "admin.users.moreStats";

function StatsStrip({
  p,
  counts,
  chip,
  onChip,
}: {
  p: Props;
  counts: Record<"all" | RenewalStatus, number>;
  chip: "all" | RenewalStatus;
  onChip: (key: "all" | RenewalStatus) => void;
}) {
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
        {RENEWAL_CHIPS.map((c) => (
          <Button
            key={c.key}
            size="sm"
            variant={chip === c.key ? "default" : "outline"}
            className={cn(
              "tabular-nums shrink-0 rounded-full",
              chip !== c.key && c.key === "active" && "border-up text-up",
              chip !== c.key && c.key === "expired" && "border-down text-down",
            )}
            onClick={() => onChip(c.key)}
          >
            {c.label} <span className="font-semibold">{int(counts[c.key])}</span>
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

// ---------- table ----------

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

const ROW_TINT: Record<RenewalStatus, string> = {
  active: "bg-up-soft hover:bg-up-soft/70",
  expired: "bg-down-soft hover:bg-down-soft/70",
  trial: "hover:bg-muted/40",
  never: "hover:bg-muted/40",
};

/** Slim 4-column table (2 on phone); a row opens the drawer, a bottom sheet on phone. */
function UsersTable({ p }: { p: Props }) {
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
                  // Subscribed in green, Expired in red; the selected row still wins so the drawer's row is findable.
                  ROW_TINT[renewalStatus(row)],
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

export function UsersScreen(props: Props) {
  const [chip, setChip] = useState<"all" | RenewalStatus>("all");
  const counts = { all: props.rows.length, active: 0, expired: 0, trial: 0, never: 0 };
  for (const row of props.rows) counts[renewalStatus(row)] += 1;
  const p = { ...props, rows: chip === "all" ? props.rows : props.rows.filter((row) => renewalStatus(row) === chip) };
  return (
    <div className="space-y-4">
      <StatsStrip p={p} counts={counts} chip={chip} onChip={setChip} />
      {p.controls}
      <div className="text-[12px] text-muted-foreground">
        {p.rows.length} من {p.totalCount} مستخدم
      </div>
      {p.rows.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          لا يوجد مستخدمون مطابقون — جرّب كلمة بحث أو فلتر مختلف.
        </div>
      ) : (
        <UsersTable p={p} />
      )}
    </div>
  );
}
