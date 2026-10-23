// The admin users screen: a stats strip whose Renewal status chips double as the filter, then a slim table
// (Identity · phone · Renewal · activity · capital · style · follow-up) where a row opens a drawer (bottom
// sheet on phone) with everything else, including every editor. The two follow-up boxes (WhatsApp, email) are
// the admin's own checklist and get their own filter chips. Designed on map #26 (decisions in #27, #28, #29, #40).
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { arDay, exact, int, signed, tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STYLE_LABEL, walletCapital, type AdminUserBehavior, type AdminUserRow } from "@/routes/_app.admin";
import { STATUS_LABEL, STEP_TITLE } from "@/components/admin/whatsapp-tab";

type EditorProps = { row: AdminUserRow; onChanged: () => void; readOnly: boolean };

export type UsersScreenEditors = {
  Subscription: (p: EditorProps) => ReactNode;
  Credits: (p: EditorProps) => ReactNode;
  /** Collapsed disclosure of past Subscription/Credits grants — for checking a disputed or repeated payment. */
  History: (p: { row: AdminUserRow }) => ReactNode;
  Role: (p: EditorProps) => ReactNode;
  Suspend: (p: EditorProps) => ReactNode;
  Delete: (p: { row: AdminUserRow; onDeleted: () => void }) => ReactNode;
  /** Confirms and deletes every row it is given (already limited to deletable accounts); `onDone` clears the selection and reloads. */
  BulkDelete: (p: { rows: AdminUserRow[]; onDone: () => void }) => ReactNode;
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
  /** Every loaded user, ignoring search: ticked rows are looked up here so a selection survives a new search. */
  everyRow: AdminUserRow[];
  stats: UsersScreenStats;
  online: { signedIn: number; visitors: number; windowSeconds: number; asOf: string } | null;
  controls: ReactNode;
  readOnly: boolean;
  onChanged: () => void;
  /** Ticks or clears one follow-up box; resolves once saved (or once the failure has been shown). */
  onFollowUp: (row: AdminUserRow, channel: FollowUpChannel, done: boolean) => Promise<void>;
  /** Downloads the given rows (the Admin's ticked selection) as a file. */
  onExport: (rows: AdminUserRow[]) => void;
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
        {row.isSuspended && (
          <Badge variant="destructive" title={row.suspensionMessage || undefined}>
            معلّق
          </Badge>
        )}
        {!row.emailVerified && <Badge variant="destructive">بريد غير مفعّل</Badge>}
        {row.id === systemUserId && <Badge variant="outline">حساب النظام</Badge>}
        {row.sameNetworkAccounts.length > 0 && (
          <Badge
            variant="outline"
            className="border-warn/50 text-warn"
            title={`نفس IP زي: ${row.sameNetworkAccounts.map((other) => other.email).join("، ")}`}
          >
            ⚠️ نفس الشبكة مع {row.sameNetworkAccounts.length} {row.sameNetworkAccounts.length === 1 ? "حساب" : "حسابات"}
          </Badge>
        )}
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

function Capital({ row }: { row: AdminUserRow }) {
  const pf = row.portfolio;
  const extra = row.portfolios.length - 1;
  return (
    <div className="flex items-center gap-1.5">
      <span className="num text-[13px]">{pf ? `${int(walletCapital(pf))} ج` : "—"}</span>
      {extra > 0 && (
        <Badge variant="outline" className="tabular-nums text-[11px]" title={`فيه ${extra} محفظة تانية (الأرقام هنا للمحفظة الرئيسية بس)`}>
          +{extra} محفظة
        </Badge>
      )}
    </div>
  );
}

function Style({ row }: { row: AdminUserRow }) {
  const style = row.behavior?.chosenStyle ?? row.behavior?.inferredStyle ?? null;
  return style ? (
    <span className="text-[13px] font-medium">{STYLE_LABEL[style]}</span>
  ) : (
    <span className="text-[13px] text-muted-foreground">غير محدد</span>
  );
}

// ---------- WhatsApp lifecycle ----------

const offerDate = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", timeZone: "Africa/Cairo" });

/** The discount this user was offered on WhatsApp and can still claim — what the Admin accepts at Activation. */
function WhatsappOffer({ row }: { row: AdminUserRow }) {
  const offer = row.whatsapp?.offer;
  if (!offer) return null;
  return (
    <Badge variant="outline" className="border-up/50 text-up">
      عرض ساري: خصم {offer.discountPct}٪ لحد {offerDate.format(new Date(offer.expiresAt))}
    </Badge>
  );
}

function WhatsappLast({ row }: { row: AdminUserRow }) {
  if (!row.whatsapp) return null;
  return (
    <p className="text-[12px] text-muted-foreground">
      آخر رسالة: {STEP_TITLE[row.whatsapp.lastStep] ?? row.whatsapp.lastStep} · {STATUS_LABEL[row.whatsapp.lastStatus] ?? row.whatsapp.lastStatus}
    </p>
  );
}

// ---------- follow-up ----------

export type FollowUpChannel = "whatsapp" | "email";

const CHANNEL_LABEL: Record<FollowUpChannel, string> = { whatsapp: "واتساب", email: "إيميل" };
const followedAt = (row: AdminUserRow, channel: FollowUpChannel) =>
  channel === "whatsapp" ? row.followUp.whatsappAt : row.followUp.emailAt;

type FollowUpFilter = "all" | "none" | "any" | "whatsapp_done" | "whatsapp_pending" | "email_done" | "email_pending";

const FOLLOW_UP_CHIPS: { key: FollowUpFilter; label: string; match: (row: AdminUserRow) => boolean }[] = [
  { key: "all", label: "الكل", match: () => true },
  { key: "none", label: "لم يُتابَع بعد", match: (r) => !r.followUp.whatsappAt && !r.followUp.emailAt },
  { key: "any", label: "تمت متابعته", match: (r) => !!r.followUp.whatsappAt || !!r.followUp.emailAt },
  { key: "whatsapp_pending", label: "ناقص واتساب", match: (r) => !r.followUp.whatsappAt },
  { key: "whatsapp_done", label: "تم على واتساب", match: (r) => !!r.followUp.whatsappAt },
  { key: "email_pending", label: "ناقص إيميل", match: (r) => !r.followUp.emailAt },
  { key: "email_done", label: "تم على الإيميل", match: (r) => !!r.followUp.emailAt },
];

/**
 * One follow-up box. Shows the new state while the save is in flight so a
 * click feels instant; the cell swallows the click so ticking doesn't open the drawer.
 */
function FollowUpBox({ row, channel, p }: { row: AdminUserRow; channel: FollowUpChannel; p: Props }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const at = followedAt(row, channel);
  const checked = pending ?? !!at;
  const toggle = async (next: boolean) => {
    setPending(next);
    try {
      await p.onFollowUp(row, channel, next);
    } finally {
      setPending(null);
    }
  };
  return (
    <div
      className="flex items-center justify-center"
      onClick={(event) => event.stopPropagation()}
      title={at ? `${CHANNEL_LABEL[channel]} · ${fullTime(at)}` : `لم تتم المتابعة على ${CHANNEL_LABEL[channel]}`}
    >
      <Checkbox
        checked={checked}
        disabled={pending !== null}
        onCheckedChange={(value) => void toggle(value === true)}
        aria-label={`متابعة ${row.name || row.email} على ${CHANNEL_LABEL[channel]}`}
        className="size-5"
      />
    </div>
  );
}

function FollowUpChips({
  rows,
  filter,
  onFilter,
}: {
  rows: AdminUserRow[];
  filter: FollowUpFilter;
  onFilter: (key: FollowUpFilter) => void;
}) {
  return (
    <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 whitespace-nowrap">
      <span className="shrink-0 text-[12px] text-muted-foreground">المتابعة:</span>
      {FOLLOW_UP_CHIPS.map((c) => (
        <Button
          key={c.key}
          size="sm"
          variant={filter === c.key ? "default" : "outline"}
          className="tabular-nums shrink-0 rounded-full"
          onClick={() => onFilter(c.key)}
        >
          {c.label} <span className="font-semibold">{int(rows.filter(c.match).length)}</span>
        </Button>
      ))}
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

/**
 * The other accounts this one shares a signup or last-login IP with — the
 * sign of one person running two accounts (a second free trial, say). Each
 * opens that account's drawer so the two can be compared.
 */
function SameNetworkWarning({ row, onOpen }: { row: AdminUserRow; onOpen: (id: string) => void }) {
  if (row.sameNetworkAccounts.length === 0) return null;
  return (
    <div className="rounded-lg border border-warn/50 bg-warn-soft p-3 text-[13px] leading-relaxed">
      <div className="font-semibold text-warn">⚠️ ممكن يكون نفس الشخص بأكتر من حساب</div>
      <p className="mt-1 text-muted-foreground">
        الحساب ده سجّل أو دخل من نفس عنوان IP زي:
      </p>
      <ul className="mt-1.5 space-y-1">
        {row.sameNetworkAccounts.map((other) => (
          <li key={other.id} className="flex flex-wrap items-baseline gap-x-2">
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => onOpen(other.id)}>
              {other.name || other.email}
            </button>
            {other.name && <span className="text-[12px] text-muted-foreground">{other.email}</span>}
            <span dir="ltr" className="num text-[12px] text-muted-foreground">
              {other.ips.join(", ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        ده مؤشر مش دليل: ناس في نفس البيت أو الشغل أو على نفس شبكة الموبايل ممكن يطلعوا بنفس الـ IP.
      </p>
    </div>
  );
}

function Detail({ row, p, onOpen }: { row: AdminUserRow; p: Props; onOpen: (id: string) => void }) {
  const { editors: E, readOnly, onChanged, systemUserId } = p;
  return (
    <div className="space-y-4 text-sm">
      {row.isSuspended && (
        <div className="rounded-lg border border-down/40 bg-down-soft px-3 py-2 text-[13px]">
          <div className="font-semibold">الحساب معلّق — محجوب عن استخدام الأداة.</div>
          {row.suspensionMessage && (
            <div className="mt-1 text-muted-foreground">الرسالة المعروضة له: «{row.suspensionMessage}»</div>
          )}
        </div>
      )}
      <SameNetworkWarning row={row} onOpen={onOpen} />
      <Section title="الاشتراك والرصيد">
        <Renewal row={row} />
        <WhatsappOffer row={row} />
        <div className="grid gap-3 sm:grid-cols-2">
          <E.Subscription row={row} onChanged={onChanged} readOnly={readOnly} />
          <E.Credits row={row} onChanged={onChanged} readOnly={readOnly} />
        </div>
        <E.History row={row} />
      </Section>
      <Section title="التواصل">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {(["whatsapp", "email"] as const).map((channel) => (
            <label key={channel} className="flex items-center gap-2">
              <FollowUpBox row={row} channel={channel} p={p} />
              تمت المتابعة على {CHANNEL_LABEL[channel]}
              {followedAt(row, channel) && (
                <span className="text-[12px] text-muted-foreground">({fullTime(followedAt(row, channel))})</span>
              )}
            </label>
          ))}
        </div>
        <WhatsappLast row={row} />
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
        {row.portfolios.length > 0 ? (
          <div className="space-y-3">
            {row.portfolios.map((p) => (
              <div key={p.id}>
                {row.portfolios.length > 1 && (
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium">
                    {p.name}
                    {p.style && (
                      <Badge variant="outline" className="text-[11px]">
                        {STYLE_LABEL[p.style]}
                      </Badge>
                    )}
                  </div>
                )}
                <div className="tabular-nums grid grid-cols-3 gap-2 text-[13px]">
                  <div>
                    <div className="text-muted-foreground">رأس المال</div>
                    {int(walletCapital(p))} ج
                  </div>
                  <div>
                    <div className="text-muted-foreground">ربح محقق</div>
                    <span className={tone(p.realizedPnl)}>{signed(p.realizedPnl)}</span>
                  </div>
                  <div>
                    <div className="text-muted-foreground">النشاط</div>
                    {p.tradesCount} صفقة · {p.positionsCount} مركز
                  </div>
                </div>
              </div>
            ))}
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
            <E.Suspend row={row} onChanged={onChanged} readOnly={readOnly} />
          )}
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
          title={online ? `آخر ${exact(online.windowSeconds / 60)} دقايق · زوّار غير مسجّلين: ${online.visitors} (تُصفَّر مع إعادة تشغيل السيرفر)` : undefined}
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

/**
 * Slim table — 8 columns on desktop, 6 on phone (phone and activity stay
 * desktop-only; capital, style and the two follow-up boxes show on both), scrolling sideways on a
 * narrow screen instead of squeezing the columns — a row opens the drawer, a
 * bottom sheet on phone. The drawer looks its row up in `allRows`, not the Renewal-filtered
 * `p.rows`: an action that changes the selected row's status (e.g.
 * Activating a user while the "تجربة" chip is selected) must not make the
 * row — and the drawer confirming it worked — vanish out from under the Admin.
 */
function UsersTable({
  p,
  allRows,
  checked,
  onCheck,
  onCheckAll,
}: {
  p: Props;
  allRows: AdminUserRow[];
  checked: Set<string>;
  onCheck: (id: string, on: boolean) => void;
  onCheckAll: (on: boolean) => void;
}) {
  const phone = useIsPhone();
  const checkedVisible = p.rows.filter((r) => checked.has(r.id)).length;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = allRows.find((r) => r.id === selectedId) ?? null;
  return (
    <>
      <div className="scrollbar-slim overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-muted/40 text-[12px] text-muted-foreground">
            <tr>
              <th className="w-10 p-3">
                <Checkbox
                  checked={checkedVisible === 0 ? false : checkedVisible === p.rows.length ? true : "indeterminate"}
                  onCheckedChange={(value) => onCheckAll(value === true)}
                  aria-label="تحديد كل المستخدمين المعروضين"
                  className="size-5"
                />
              </th>
              <th className="p-3 text-start font-medium">المستخدم</th>
              <th className="hidden p-3 text-start font-medium sm:table-cell">الهاتف</th>
              <th className="p-3 text-start font-medium">الاشتراك</th>
              <th className="hidden p-3 text-start font-medium sm:table-cell">النشاط</th>
              <th className="p-3 text-start font-medium">رأس المال</th>
              <th className="p-3 text-start font-medium">الأسلوب</th>
              <th className="p-3 text-center font-medium">واتساب</th>
              <th className="p-3 text-center font-medium">إيميل</th>
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
                <td className="p-3" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={checked.has(row.id)}
                    onCheckedChange={(value) => onCheck(row.id, value === true)}
                    aria-label={`تحديد ${row.name || row.email}`}
                    className="size-5"
                  />
                </td>
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
                <td className="p-3">
                  <Capital row={row} />
                </td>
                <td className="p-3">
                  <Style row={row} />
                </td>
                <td className="p-3">
                  <FollowUpBox row={row} channel="whatsapp" p={p} />
                </td>
                <td className="p-3">
                  <FollowUpBox row={row} channel="email" p={p} />
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
              <Detail row={selected} p={p} onOpen={setSelectedId} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function UsersScreen(props: Props) {
  const [chip, setChip] = useState<"all" | RenewalStatus>("all");
  const [followUp, setFollowUp] = useState<FollowUpFilter>("all");
  const [sameNetworkOnly, setSameNetworkOnly] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const counts = { all: props.rows.length, active: 0, expired: 0, trial: 0, never: 0 };
  for (const row of props.rows) counts[renewalStatus(row)] += 1;
  // The follow-up chips count within the selected Renewal status, so "ناقص واتساب" under
  // "تجربة" reads as "trial users still to message".
  const byRenewal = chip === "all" ? props.rows : props.rows.filter((row) => renewalStatus(row) === chip);
  const followUpMatch = FOLLOW_UP_CHIPS.find((c) => c.key === followUp)!.match;
  const sameNetworkCount = props.rows.filter((row) => row.sameNetworkAccounts.length > 0).length;
  const p = {
    ...props,
    rows: byRenewal.filter((row) => followUpMatch(row) && (!sameNetworkOnly || row.sameNetworkAccounts.length > 0)),
  };
  // Only ticked users still in the list count (a deleted or reloaded-away row drops out); ticks survive searching and filtering.
  const selectedRows = props.everyRow.filter((row) => checked.has(row.id));
  // Same guard as the drawer's delete button and the backend: never an Admin or the system account.
  const deletableRows = selectedRows.filter((row) => !row.isAdmin && row.id !== props.systemUserId);
  const onCheck = (id: string, on: boolean) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const onCheckAll = (on: boolean) =>
    setChecked((cur) => {
      const next = new Set(cur);
      for (const row of p.rows) {
        if (on) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  return (
    <div className="space-y-4">
      <StatsStrip p={p} counts={counts} chip={chip} onChip={setChip} />
      <FollowUpChips rows={byRenewal} filter={followUp} onFilter={setFollowUp} />
      {p.controls}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span>
          {p.rows.length} من {p.totalCount} مستخدم
        </span>
        {sameNetworkCount > 0 && (
          <Button
            size="sm"
            variant={sameNetworkOnly ? "default" : "outline"}
            className={cn("tabular-nums rounded-full", !sameNetworkOnly && "border-warn/50 text-warn")}
            onClick={() => setSameNetworkOnly((on) => !on)}
          >
            ⚠️ حسابات على نفس الشبكة <span className="font-semibold">{sameNetworkCount}</span>
          </Button>
        )}
      </div>
      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[13px]">
          <span className="tabular-nums font-medium">تم تحديد {int(selectedRows.length)}</span>
          <Button size="sm" variant="outline" onClick={() => props.onExport(selectedRows)}>
            <Download className="size-4" />
            تصدير المحدد
          </Button>
          {!props.readOnly && deletableRows.length > 0 && (
            <props.editors.BulkDelete rows={deletableRows} onDone={() => { setChecked(new Set()); props.onChanged(); }} />
          )}
          {!props.readOnly && deletableRows.length < selectedRows.length && (
            <span className="text-[12px] text-muted-foreground">
              ({int(selectedRows.length - deletableRows.length)} حساب مشرف/نظام مش هيتحذف)
            </span>
          )}
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setChecked(new Set())}>
            إلغاء التحديد
          </Button>
        </div>
      )}
      {p.rows.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          لا يوجد مستخدمون مطابقون — جرّب كلمة بحث أو فلتر مختلف.
        </div>
      ) : (
        <UsersTable p={p} allRows={props.rows} checked={checked} onCheck={onCheck} onCheckAll={onCheckAll} />
      )}
    </div>
  );
}
