import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  ErrorState,
  LoadingBlock,
  Notice,
  Panel,
  Spinner,
} from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, del, post, postRaw } from "@/lib/api";
import { BlogDraftsTab } from "@/components/admin/blog-drafts-tab";
import { NewArticleTab } from "@/components/admin/blog-new-article-tab";
import { PublishedPostsTab } from "@/components/admin/blog-published-tab";
import { PlatformTab } from "@/components/admin/platform-tab";
import { RENEWAL_LABEL, UsersScreen, renewalStatus } from "@/components/admin/users-screen";
import { SupportTab } from "@/components/admin/support-tab";
import { arDay, signed } from "@/lib/format";
import { INVEST_STYLES, MIN_CLOSED_TRADES, type StyleKey } from "@/lib/invest-style";
import { siteUrl, siteName } from "@/lib/seo";
import { useDesk } from "@/lib/store";
import { useTenant } from "@/lib/tenant";
import { cn } from "@/lib/utils";

const baseTitle = (name: string) => `الإدارة — ${name}`;

export const Route = createFileRoute("/_app/admin")({
  head: ({ match }) => ({
    meta: [
      { title: baseTitle(siteName(match)) },
      { name: "description", content: "إدارة قوائم المؤشرات والمستخدمين المسجّلين." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: baseTitle(siteName(match)) },
      { property: "og:url", content: `${siteUrl(match)}/admin` },
    ],
  }),
  component: AdminPage,
});

type Ticker = { code: string; name: string };

type IndexRow = {
  name: string;
  tickers: Ticker[];
  count: number;
  /** "derived" is the read-only ALL row: every tracked stock, index member or not. */
  source: "default" | "upload" | "derived";
  /** ALL row only: how many of its stocks are in none of the index lists. */
  outsideCount?: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

const matchesQuery = (ticker: Ticker, query: string) =>
  ticker.code.includes(query) || ticker.name.toUpperCase().includes(query);

const LABELS: Record<string, string> = {
  EGX30: "EGX30",
  EGX70: "EGX70 EWI",
  EGX33: "EGX33 (شريعة)",
  EGX100: "EGX100",
  ALL: "الكل",
};

/**
 * Polls the same thread list the support tab shows and mirrors its total
 * unread count onto the browser tab title (e.g. "(3) الإدارة — EGXpert") —
 * so a new message is visible from any admin tab, not just while the support
 * tab happens to be open. Cleared back to the plain title once every thread
 * is read (or reads zero) and restored on unmount so it never leaks onto a
 * different page's tab title. Returns the same count, for the badge on the
 * "الدعم" tab.
 */
function useUnreadTitleBadge(enabled: boolean): number {
  const [unread, setUnread] = useState(0);
  const title = baseTitle(useTenant().name);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { threads } = await api("/api/admin/support");
        if (cancelled) return;
        const total = threads.reduce((sum: number, t: { unread: number }) => sum + t.unread, 0);
        setUnread(total);
        document.title = total > 0 ? `(${total}) ${title}` : title;
      } catch {
        // Best-effort badge — a failed poll just leaves the last count showing.
      }
    };
    void poll();
    const timer = setInterval(poll, 20 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.title = title;
    };
  }, [enabled, title]);
  return unread;
}

function AdminPage() {
  const { user } = useDesk();
  const supportUnread = useUnreadTitleBadge(Boolean(user?.isAdmin));

  // A marketer sees the users table and nothing else, with every control that
  // changes data left out — the backend refuses those calls for them anyway.
  if (!user?.isAdmin && user?.isMarketer) {
    return <UsersTab readOnly />;
  }

  if (!user?.isAdmin) {
    return <ErrorState message="الصفحة دي للمشرفين بس." />;
  }

  // The index lists are market data shared by every white-label site, so
  // only the main site's admins edit them; a client site's admins start on
  // their users. The clients tab is the platform owner's alone.
  const canEditIndices = Boolean(user.canEditIndices);
  const isPlatformAdmin = Boolean(user.isPlatformAdmin);

  return (
    <Tabs defaultValue={canEditIndices ? "indices" : "users"} className="space-y-4">
      {/* mt-3: room for the unread badge that sits on top of the "الدعم" tab. */}
      <TabsList className="mt-3">
        {canEditIndices && <TabsTrigger value="indices">المؤشرات</TabsTrigger>}
        <TabsTrigger value="users">المستخدمين</TabsTrigger>
        <TabsTrigger value="support" className="relative">
          الدعم
          {supportUnread > 0 && (
            <span
              aria-label={`${supportUnread} رسائل غير مقروءة`}
              className="num pointer-events-none absolute -top-3 left-1/2 flex h-[18px] min-w-[18px] -translate-x-1/2 items-center justify-center rounded-full bg-down px-1 text-[10px] font-bold leading-none text-white shadow"
            >
              {supportUnread > 9 ? "9+" : supportUnread}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="blog">المدونة</TabsTrigger>
        {isPlatformAdmin && <TabsTrigger value="platform">العملاء</TabsTrigger>}
      </TabsList>
      {canEditIndices && (
        <TabsContent value="indices">
          <IndicesTab />
        </TabsContent>
      )}
      {isPlatformAdmin && (
        <TabsContent value="platform">
          <PlatformTab />
        </TabsContent>
      )}
      <TabsContent value="users">
        <UsersTab />
      </TabsContent>
      <TabsContent value="support">
        <SupportTab />
      </TabsContent>
      <TabsContent value="blog">
        <Tabs defaultValue="new" className="space-y-4">
          <TabsList>
            <TabsTrigger value="new">مقالة جديدة</TabsTrigger>
            <TabsTrigger value="pending">قيد المراجعة</TabsTrigger>
            <TabsTrigger value="published">المنشور</TabsTrigger>
          </TabsList>
          <TabsContent value="new">
            <NewArticleTab />
          </TabsContent>
          <TabsContent value="pending">
            <BlogDraftsTab />
          </TabsContent>
          <TabsContent value="published">
            <PublishedPostsTab />
          </TabsContent>
        </Tabs>
      </TabsContent>
    </Tabs>
  );
}

function IndicesTab() {
  const [rows, setRows] = useState<IndexRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = () => {
    api("/api/admin/indices")
      .then((result) => {
        setRows(result.indices);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "تعذر تحميل بيانات المؤشرات"),
      );
  };

  useEffect(() => {
    load();
  }, []);

  const query = search.trim().toUpperCase();
  const matches = useMemo(
    () =>
      query && rows ? rows.filter((row) => row.tickers.some((t) => matchesQuery(t, query))) : [],
    [rows, query],
  );
  const indexMatches = matches.filter((row) => row.source !== "derived");

  if (error)
    return (
      <ErrorState
        message={error}
        action={
          <Button variant="outline" size="sm" onClick={load}>
            حاول تاني
          </Button>
        }
      />
    );
  if (!rows) return <LoadingBlock rows={3} />;

  return (
    <div className="space-y-4">
      <Notice tone="info">
        الملف: CSV أو Excel (xls/xlsx) — سطر/صف لكل كود سهم (زي COMI)، أو عمود عنوانه
        Ticker/Code/Symbol/Reuters Code/RIC (بيتجاهل عمود ISIN لو موجود). كود مش موجود أصلًا في
        قاعدة الأسهم بيتضاف تلقائيًا كسهم جديد — لو الملف فيه عمود Company Name/Name بيتاخد منه
        الاسم. رفع ملف جديد بيستبدل القائمة بالكامل (EGX100 بيتحسب تلقائيًا من EGX30 + EGX70 إلا لو
        رُفع ملف مستقل ليه).
      </Notice>

      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="ابحث بكود السهم أو اسم الشركة عشان تعرف موجود في أنهي مؤشر…"
      />
      {query && (
        <Notice tone={indexMatches.length ? "success" : matches.length ? "info" : "warn"}>
          {indexMatches.length
            ? `"${search}" موجود في: ${matches.map((m) => LABELS[m.name] ?? m.name).join("، ")}`
            : matches.length
              ? `"${search}" سهم متابَع بس مش في أي مؤشر — موجود في «الكل» بس.`
              : `"${search}" مش موجود في أي مؤشر ولا في قائمة الأسهم المتابَعة.`}
        </Notice>
      )}

      {rows.map((row) => (
        <IndexPanel key={row.name} row={row} onChanged={load} highlight={query} />
      ))}
    </div>
  );
}

function IndexPanel({
  row,
  onChanged,
  highlight,
}: {
  row: IndexRow;
  onChanged: () => void;
  highlight: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const upload = async (file: File) => {
    setBusy(true);
    setAdded([]);
    try {
      const bytes = await file.arrayBuffer();
      const result = await postRaw(
        `/api/admin/indices/${row.name}`,
        bytes,
        file.type || "application/octet-stream",
      );
      toast.success(`تم حفظ ${result.saved} كود لمؤشر ${LABELS[row.name] ?? row.name}`);
      if (result.added?.length) setAdded(result.added);
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر رفع الملف");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await post(`/api/admin/indices/${row.name}/reset`);
      toast.success(`تم استرجاع القائمة الافتراضية لمؤشر ${LABELS[row.name] ?? row.name}`);
      setAdded([]);
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الاسترجاع");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={LABELS[row.name] ?? row.name}
      description={
        <>
          {row.count} كود ·{" "}
          {row.source === "derived"
            ? `كل الأسهم المتابَعة، منهم ${row.outsideCount ?? 0} مش في أي مؤشر — بتتحدث تلقائيًا`
            : row.source === "upload"
              ? "مرفوع يدويًا"
              : "افتراضي"}
          {row.updatedAt &&
            ` · آخر تحديث ${new Date(row.updatedAt).toLocaleString("ar-EG", { numberingSystem: "latn" })}`}
        </>
      }
      action={
        row.source !== "derived" && (
          <div className="flex items-center gap-2">
            {row.source === "upload" && (
              <Button variant="outline" size="sm" onClick={() => void reset()} disabled={busy}>
                استرجاع الافتراضي
              </Button>
            )}
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy && <Spinner />}
              رفع CSV / Excel
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xls,.xlsx,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </div>
        )
      }
    >
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {row.tickers.map((ticker) => {
          const isMatch = Boolean(highlight) && matchesQuery(ticker, highlight);
          return (
            <div
              key={ticker.code}
              className={cn(
                "flex items-baseline gap-1.5 rounded-md px-2 py-1 text-[12px]",
                isMatch ? "bg-primary/15 ring-1 ring-primary" : "bg-surface",
              )}
            >
              <span className="shrink-0 font-medium">{ticker.code}</span>
              <span className="truncate text-muted-foreground">{ticker.name}</span>
            </div>
          );
        })}
      </div>
      {added.length > 0 && (
        <Notice tone="warn" className="mt-3">
          الأكواد دي كانت جديدة على قاعدة الأسهم المتابَعة واتضافت بدون تصنيف قطاع أو فحص شرعي
          مُتحقَّق منه: {added.join("، ")}
        </Notice>
      )}
    </Panel>
  );
}

type AdminUserPortfolio = {
  cash: number;
  positionsCount: number;
  positionsValue: number;
  watchlistCount: number;
  tradesCount: number;
  realizedPnl: number;
  updatedAt: string | null;
};

/** Cut-down behaviorProfile() (backend/src/scoring/behavior.js) plus the style picked in settings. */
export type AdminUserBehavior = {
  chosenStyle: StyleKey | null;
  inferredStyle: StyleKey | null;
  buys: number;
  sells: number;
  avgHoldDays: number | null;
  winRatePct: number | null;
  tradesLast30d: number;
  lastTradeDate: string | null;
  averagingDownBuys: number;
  avgOpenPositionDays: number | null;
  importedPositions: boolean;
};

type PlanKey = "long_monthly" | "long_yearly" | "trader_monthly" | "trader_yearly" | "custom";
type Tier = "free" | "long" | "trader";

type AdminSubscription = {
  plan: PlanKey;
  tier: Exclude<Tier, "free">;
  currentPeriodEnd: string;
  active: boolean;
  note: string | null;
  updatedAt: string;
};

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isAdmin: boolean;
  isMarketer: boolean;
  emailVerified: boolean;
  googleLinked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Last presence ping from any tab; null until the account is first seen after tracking began. */
  lastSeenAt: string | null;
  /** Null for accounts that predate IP tracking. */
  signupIp: string | null;
  lastLoginIp: string | null;
  trialActive: boolean;
  trialEndsAt: string;
  tier: Tier | null;
  subscription: AdminSubscription | null;
  portfolio: AdminUserPortfolio | null;
  behavior: AdminUserBehavior | null;
  usage: AdminUserUsage;
};

type CreditKind = "cashScans" | "recommendations" | "screenshots" | "marketAnalysis";

/** What's left of each capped allowance (base + credits), and the admin-granted credits within it. */
type AdminUserUsage = {
  cashScansLeft: number;
  screenshotsLeftThisMonth: number;
  recommendationsLeft: number;
  marketAnalysisLeft: number;
  credits: Record<CreditKind, number>;
};

export const STYLE_LABEL: Record<StyleKey, string> = Object.fromEntries(
  INVEST_STYLES.map((s) => [s.key, s.label]),
) as Record<StyleKey, string>;

// Phones are stored compact (see normalizePhone() in backend/src/phone.js), but an Admin
// searching from an InstaPay transfer often types one with spaces, dashes or parens
// (e.g. "010 1234 5678"). Strip those from both sides before matching so the search
// isn't defeated by formatting the stored digits never had.
const stripPhoneFormatting = (value: string) => value.replace(/[\s().-]/g, "");

const matchesUser = (row: AdminUserRow, query: string) =>
  [row.email, row.name, row.signupIp, row.lastLoginIp].some((field) => field?.toLowerCase().includes(query)) ||
  (!!row.phone && stripPhoneFormatting(row.phone.toLowerCase()).includes(stripPhoneFormatting(query)));

type UserSort = "createdAt" | "lastLoginAt" | "lastSeenAt";

const USER_SORTS: { key: UserSort; label: string }[] = [
  { key: "createdAt", label: "آخر تسجيل" },
  { key: "lastLoginAt", label: "آخر دخول" },
  { key: "lastSeenAt", label: "آخر ظهور" },
];

/** Newest first; accounts with no such timestamp (never logged in / seen) sink to the bottom. */
const byRecent = (key: UserSort) => (a: AdminUserRow, b: AdminUserRow) =>
  (b[key] ? Date.parse(b[key]) : -Infinity) - (a[key] ? Date.parse(a[key]) : -Infinity) || 0;

const csvCell = (value: unknown) => {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const CSV_HEADERS = [
  "البريد الإلكتروني",
  "الاسم",
  "الهاتف",
  "IP التسجيل",
  "IP آخر دخول",
  "تاريخ التسجيل",
  "آخر دخول",
  "رأس المال",
  "ربح محقق",
  "عدد الصفقات",
  "عدد المراكز",
  "عدد المتابعة",
  "الأسلوب الاستثماري",
  "حالة الحساب",
  "الباقة",
  "تاريخ انتهاء الاشتراك",
  "بريد مفعّل",
  "مرتبط بجوجل",
  "مشرف",
];

/** Downloads the given rows as a CSV file — Excel-friendly (UTF-8 BOM, CRLF rows). */
function downloadUsersCsv(rows: AdminUserRow[]) {
  const lines = rows.map((row) => {
    const pf = row.portfolio;
    const style = row.behavior?.chosenStyle ?? row.behavior?.inferredStyle ?? null;
    return [
      row.email,
      row.name ?? "",
      row.phone ?? "",
      row.signupIp ?? "",
      row.lastLoginIp ?? "",
      row.createdAt?.slice(0, 10) ?? "",
      row.lastLoginAt ?? "",
      pf ? pf.cash + pf.positionsValue : "",
      pf?.realizedPnl ?? "",
      pf?.tradesCount ?? "",
      pf?.positionsCount ?? "",
      pf?.watchlistCount ?? "",
      style ? STYLE_LABEL[style] : "",
      RENEWAL_LABEL[renewalStatus(row)],
      row.subscription ? PLAN_LABEL[row.subscription.plan] : "",
      row.subscription?.currentPeriodEnd?.slice(0, 10) ?? "",
      row.emailVerified ? "نعم" : "لا",
      row.googleLinked ? "نعم" : "لا",
      row.isAdmin ? "نعم" : "لا",
    ]
      .map(csvCell)
      .join(",");
  });

  const csv = `﻿${[CSV_HEADERS.map(csvCell).join(","), ...lines].join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `alytic-users-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

type OnlineNow = { signedIn: number; visitors: number; windowSeconds: number; asOf: string };

/** Polls who is on the site now. Failures keep the last good numbers rather than blanking the card. */
function useOnlineNow() {
  const [online, setOnline] = useState<OnlineNow | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api<OnlineNow>("/api/admin/online")
        .then((result) => alive && setOnline(result))
        .catch(() => {});
    poll();
    const timer = window.setInterval(poll, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return online;
}

function UsersTab({ readOnly = false }: { readOnly?: boolean }) {
  const online = useOnlineNow();
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<UserSort>("createdAt");

  const load = () => {
    api("/api/admin/users")
      .then((result) => {
        setRows(result.users);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "تعذر تحميل بيانات المستخدمين"),
      );
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    if (!rows) return null;
    let capital = 0;
    let profit = 0;
    const styleCounts: Record<StyleKey, number> = { trader: 0, medium: 0, long: 0 };
    const subByStyle: Record<StyleKey, number> = { trader: 0, medium: 0, long: 0 };
    let styleUnknown = 0;

    for (const row of rows) {
      if (row.portfolio) {
        capital += row.portfolio.cash + row.portfolio.positionsValue;
        profit += row.portfolio.realizedPnl;
      }
      const style = row.behavior?.chosenStyle ?? row.behavior?.inferredStyle ?? null;
      if (style) {
        styleCounts[style] += 1;
        if (row.subscription?.active) subByStyle[style] += 1;
      } else {
        styleUnknown += 1;
      }
    }

    return {
      capital,
      profit,
      styleCounts,
      styleUnknown,
      subTrader: subByStyle.trader,
      subMediumLong: subByStyle.medium + subByStyle.long,
    };
  }, [rows]);

  // Search and sort only: the screen filters by Renewal status itself, so its chips can count every status.
  const query = search.trim().toLowerCase();
  const searched = useMemo(
    () => (rows ?? []).filter((row) => !query || matchesUser(row, query)).sort(byRecent(sortBy)),
    [rows, query, sortBy],
  );

  if (error)
    return (
      <ErrorState
        message={error}
        action={
          <Button variant="outline" size="sm" onClick={load}>
            حاول تاني
          </Button>
        }
      />
    );
  if (!rows || !stats) return <LoadingBlock rows={3} />;

  return (
    <UsersScreen
      rows={searched}
      totalCount={rows.length}
      stats={stats}
      online={online}
      controls={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالهاتف أو الاسم أو البريد…"
            className="sm:max-w-sm sm:flex-1"
          />
          <div className="flex flex-wrap items-center gap-1.5 sm:ms-auto">
            <span className="text-[12px] text-muted-foreground">الترتيب:</span>
            {USER_SORTS.map(({ key, label }) => (
              <Button key={key} size="sm" variant={sortBy === key ? "default" : "outline"} onClick={() => setSortBy(key)}>
                {label}
              </Button>
            ))}
            <Button size="sm" variant="outline" disabled={searched.length === 0} onClick={() => downloadUsersCsv(searched)}>
              <Download className="size-4" />
              تصدير CSV ({searched.length})
            </Button>
          </div>
        </div>
      }
      readOnly={readOnly}
      onChanged={load}
      editors={{
        Subscription: SubscriptionCell,
        Credits: CreditsCell,
        History: GrantHistoryCell,
        Role: RoleCell,
        Delete: DeleteUserButton,
        Behavior: BehaviorCell,
      }}
      systemUserId={SYSTEM_USER_ID}
    />
  );
}

/** The built-in CLI/dev account (local@alytic.local) — not a real user, and the backend refuses to delete it. */
const SYSTEM_USER_ID = "local";

/**
 * What kind of investor this is and why we think so: the style driving their
 * recommendations and where it came from, then the trading numbers behind it.
 */
function BehaviorCell({ behavior: b }: { behavior: AdminUserBehavior }) {
  const style = b.chosenStyle ?? b.inferredStyle;
  const source = b.chosenStyle ? "اختيار يدوي" : b.inferredStyle ? "مستنتج من صفقاته" : null;
  const mismatch = b.chosenStyle && b.inferredStyle && b.chosenStyle !== b.inferredStyle;
  const tradesCount = b.buys + b.sells;

  const unknownReason = !tradesCount
    ? b.importedPositions
      ? "مراكز مستوردة من غير صفقات مسجلة"
      : "مفيش صفقات مسجلة"
    : b.sells < MIN_CLOSED_TRADES
      ? `${b.sells} صفقة بيع بس — محتاج ${MIN_CLOSED_TRADES} على الأقل للاستنتاج`
      : "صفقات البيع مش مقابلها شراء مسجل";

  const facts: string[] = [];
  if (tradesCount) {
    facts.push(`${b.buys} شراء · ${b.sells} بيع`);
    if (b.avgHoldDays != null) facts.push(`متوسط الاحتفاظ ${Math.round(b.avgHoldDays)} يوم`);
    if (b.winRatePct != null) facts.push(`${Math.round(b.winRatePct)}% صفقات رابحة`);
    if (b.averagingDownBuys) facts.push(`متوسّط لتحت ${b.averagingDownBuys} مرة`);
    facts.push(
      b.tradesLast30d
        ? `${b.tradesLast30d} صفقة آخر ٣٠ يوم`
        : `آخر صفقة ${arDay(b.lastTradeDate)}`,
    );
  } else if (b.avgOpenPositionDays != null) {
    facts.push(`مراكزه مفتوحة من ${Math.round(b.avgOpenPositionDays)} يوم في المتوسط`);
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {style ? (
          <span className="font-medium">{STYLE_LABEL[style]}</span>
        ) : (
          <span className="text-muted-foreground">غير محدد</span>
        )}
        {source && (
          <Badge variant="outline" className="text-[11px] font-normal">
            {source}
          </Badge>
        )}
      </div>
      {mismatch && (
        <div className="text-[12px] text-amber-500">
          صفقاته الفعلية أقرب لـ {STYLE_LABEL[b.inferredStyle!]}
        </div>
      )}
      {!style && (
        <div className="text-[12px] text-muted-foreground">
          {unknownReason} — شغال على متوسط المدى افتراضيًا
        </div>
      )}
      {facts.length > 0 && (
        <div className="text-[12px] leading-relaxed text-muted-foreground">{facts.join(" · ")}</div>
      )}
    </div>
  );
}

type UserRole = "user" | "marketer" | "admin";

const ROLE_LABEL: Record<UserRole, string> = {
  user: "مستخدم عادي",
  marketer: "مسوّق",
  admin: "مشرف",
};

// What each role can do, shown in the confirmation for a change that touches admin.
const ROLE_HINT: Record<UserRole, string> = {
  admin: "صلاحيات كاملة: كل تبويبات الإدارة — المستخدمين والاشتراكات والدعم والمدونة.",
  marketer: "بيشوف جدول المستخدمين بس، من غير أي تعديل.",
  user: "حساب عادي من غير أي صلاحيات إدارة.",
};

/**
 * Who a user is to the admin panel: admin, marketer (read-only view of this
 * table) or a regular user. An admin can change anyone's role except their own
 * and the system account's (the backend enforces this too); the marketer view
 * only displays it. Any change that grants or takes away admin asks first.
 */
function RoleCell({
  row,
  onChanged,
  readOnly,
}: {
  row: AdminUserRow;
  onChanged: () => void;
  readOnly: boolean;
}) {
  const { user: me } = useDesk();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<UserRole | null>(null);
  const role: UserRole = row.isAdmin ? "admin" : row.isMarketer ? "marketer" : "user";

  if (readOnly || row.id === SYSTEM_USER_ID || row.id === me?.id) {
    return role === "admin" ? (
      <Badge>{ROLE_LABEL.admin}</Badge>
    ) : (
      <span className="text-[13px]">{ROLE_LABEL[role]}</span>
    );
  }

  const apply = async (next: UserRole) => {
    setBusy(true);
    try {
      await post(`/api/admin/users/${row.id}/role`, { role: next });
      toast.success(`${row.email} دلوقتي ${ROLE_LABEL[next]}`);
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر تغيير الدور");
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const choose = (value: string) => {
    const next = value as UserRole;
    if (next === role) return;
    if (next === "admin" || role === "admin") setPending(next);
    else void apply(next);
  };

  return (
    <>
      <Select value={role} onValueChange={choose} disabled={busy}>
        <SelectTrigger className="h-8 w-[120px] text-[13px]" aria-label={`دور ${row.email}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(ROLE_LABEL) as UserRole[]).map((key) => (
            <SelectItem key={key} value={key}>
              {ROLE_LABEL[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>تغيير دور {row.email}؟</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              من {ROLE_LABEL[role]} إلى {pending ? ROLE_LABEL[pending] : ""}. {pending ? ROLE_HINT[pending] : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (pending) void apply(pending);
              }}
            >
              {busy ? <Spinner /> : "تأكيد"}
            </AlertDialogAction>
            <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Permanent — takes the portfolio, subscription history and support thread with it. */
function DeleteUserButton({ row, onDeleted }: { row: AdminUserRow; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await del(`/api/admin/users/${row.id}`);
      toast.success(`تم حذف ${row.email}`);
      setOpen(false);
      onDeleted();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر حذف المستخدم");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-down"
          aria-label={`حذف ${row.email}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>حذف {row.email}؟</AlertDialogTitle>
          <AlertDialogDescription className="leading-relaxed">
            هيتم مسح الحساب نهائيًا مع المحفظة والصفقات وسجل الاشتراك ورسائل الدعم. مش هينفع
            التراجع بعد الحذف.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-start">
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
            disabled={deleting}
            className="bg-down text-white hover:bg-down/90"
          >
            {deleting ? <Spinner /> : <Trash2 className="size-4" />}
            نعم، احذف
          </AlertDialogAction>
          <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const CREDIT_FIELDS: { kind: CreditKind; label: string; hint: string }[] = [
  { kind: "cashScans", label: "تحليل الكاش", hint: "محاولات زيادة على حد الباقة الشهري" },
  { kind: "recommendations", label: "توصيات الأسهم", hint: "توصيات زيادة على حد الباقة الشهري" },
  { kind: "screenshots", label: "صور المحفظة", hint: "صور زيادة بعد ما يخلص حد الشهر" },
  { kind: "marketAnalysis", label: "تحليل السوق", hint: "محاولات زيادة على حد الباقة الشهري" },
];

const NO_CREDITS: Record<CreditKind, string> = {
  cashScans: "",
  recommendations: "",
  screenshots: "",
  marketAnalysis: "",
};

/** Matches ADDONS in backend/src/billing/plans.js — quick-fill for whichever pack a user paid for over InstaPay. */
const ADDON_PACKS: Record<CreditKind, { count: number; priceEgp: number }[]> = {
  screenshots: [
    { count: 3, priceEgp: 20 },
    { count: 6, priceEgp: 39 },
    { count: 12, priceEgp: 75 },
  ],
  recommendations: [
    { count: 50, priceEgp: 50 },
    { count: 100, priceEgp: 75 },
    { count: 150, priceEgp: 100 },
  ],
  cashScans: [
    { count: 20, priceEgp: 25 },
    { count: 60, priceEgp: 50 },
    { count: 150, priceEgp: 80 },
  ],
  marketAnalysis: [
    { count: 20, priceEgp: 25 },
    { count: 60, priceEgp: 50 },
    { count: 150, priceEgp: 80 },
  ],
};

/**
 * Extra uses on top of the capped allowances (backend creditsOf()). Each
 * credit is spent only after the user's normal allowance for it runs out.
 */
function CreditsCell({
  row,
  onChanged,
  readOnly,
}: {
  row: AdminUserRow;
  onChanged: () => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState(NO_CREDITS);
  const [reference, setReference] = useState("");
  const { cashScansLeft, screenshotsLeftThisMonth, recommendationsLeft, marketAnalysisLeft, credits } = row.usage;

  const deltas = Object.fromEntries(
    CREDIT_FIELDS.map(({ kind }) => [kind, Number(amounts[kind] || 0)]),
  ) as Record<CreditKind, number>;
  const valid = Object.values(deltas).every((value) => Number.isInteger(value));
  const changed = Object.values(deltas).some((value) => value !== 0);

  const save = async () => {
    setBusy(true);
    try {
      await post(`/api/admin/users/${row.id}/credits`, { ...deltas, reference: reference.trim() || undefined });
      toast.success(`تم تحديث رصيد ${row.email}`);
      setOpen(false);
      setAmounts(NO_CREDITS);
      setReference("");
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر تحديث الرصيد");
    } finally {
      setBusy(false);
    }
  };

  const withCredits = (text: string, extra: number) => (extra ? `${text} (+${extra} رصيد)` : text);

  return (
    <div className="space-y-1.5">
      <div className="space-y-0.5 text-[12px] text-muted-foreground">
        <div>تحليل الكاش: {withCredits(`باقي ${cashScansLeft}`, credits.cashScans)}</div>
        <div>توصيات: {withCredits(`باقي ${recommendationsLeft}`, credits.recommendations)}</div>
        <div>
          صور الشهر ده: {withCredits(`باقي ${screenshotsLeftThisMonth}`, credits.screenshots)}
        </div>
        <div>
          تحليل السوق: {withCredits(`باقي ${marketAnalysisLeft}`, credits.marketAnalysis)}
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setAmounts(NO_CREDITS);
            setReference("");
          }
        }}
      >
        {!readOnly && (
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[12px]">
              إضافة رصيد
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle>رصيد {row.email}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              الرصيد بيتخصم بس بعد ما الحد العادي يخلص. اكتب رقم سالب لو عايز تشيل رصيد.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`credit-ref-${row.id}`}>مرجع التحويل (اختياري)</Label>
              <Input
                id={`credit-ref-${row.id}`}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="رقم عملية InstaPay أو ملاحظة"
              />
            </div>
            {CREDIT_FIELDS.map(({ kind, label, hint }) => (
              <div key={kind} className="space-y-1">
                <Label htmlFor={`credit-${kind}-${row.id}`}>
                  {label} <span className="text-muted-foreground">(الحالي: {credits[kind]})</span>
                </Label>
                <Input
                  id={`credit-${kind}-${row.id}`}
                  type="number"
                  step={1}
                  inputMode="numeric"
                  value={amounts[kind]}
                  onChange={(event) => setAmounts((prev) => ({ ...prev, [kind]: event.target.value }))}
                  placeholder="0"
                />
                <p className="text-[11.5px] text-muted-foreground">{hint}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ADDON_PACKS[kind].map((pack) => (
                    <button
                      key={pack.count}
                      type="button"
                      onClick={() => setAmounts((prev) => ({ ...prev, [kind]: String(pack.count) }))}
                      className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      {pack.count} ({pack.priceEgp} ج)
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <Button onClick={() => void save()} disabled={busy || !valid || !changed}>
              {busy && <Spinner />}
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PLAN_LABEL: Record<PlanKey, string> = {
  long_monthly: "النفس الطويل — شهري",
  long_yearly: "النفس الطويل — سنوي",
  trader_monthly: "الحريفة — شهري",
  trader_yearly: "الحريفة — سنوي",
  custom: "مخصص",
};

const GRANT_TIER_LABEL: Record<Exclude<Tier, "free">, string> = {
  long: "النفس الطويل",
  trader: "الحريفة",
};

/**
 * Where a paid account actually gets switched on. Activation is manual by
 * design — the user transfers over InstaPay and an admin records it here —
 * so this is the only path to premium access in the whole product.
 */
function SubscriptionCell({
  row,
  onChanged,
  readOnly,
}: {
  row: AdminUserRow;
  onChanged: () => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [customTier, setCustomTier] = useState<Exclude<Tier, "free">>("long");
  const [reference, setReference] = useState("");
  const subscription = row.subscription;

  const grant = async (plan: PlanKey, tier?: Exclude<Tier, "free">) => {
    setBusy(true);
    try {
      await post(`/api/admin/users/${row.id}/subscription`, {
        plan,
        tier: plan === "custom" ? tier : undefined,
        endsAt: plan === "custom" ? endsAt : undefined,
        reference: reference.trim() || undefined,
      });
      toast.success(`تم تفعيل اشتراك ${row.email}`);
      setOpen(false);
      setReference("");
      setEndsAt("");
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر تفعيل الاشتراك");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await del(`/api/admin/users/${row.id}/subscription`);
      toast.success(`تم إيقاف اشتراك ${row.email}`);
      setOpen(false);
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر إيقاف الاشتراك");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {subscription?.active ? (
        <Badge variant="secondary" className="whitespace-nowrap">
          {PLAN_LABEL[subscription.plan]} · حتى {arDay(subscription.currentPeriodEnd.slice(0, 10))}
        </Badge>
      ) : subscription ? (
        <Badge variant="destructive" className="whitespace-nowrap">
          انتهى {arDay(subscription.currentPeriodEnd.slice(0, 10))}
        </Badge>
      ) : row.trialActive ? (
        <Badge variant="outline" className="whitespace-nowrap">
          تجربة حتى {arDay(row.trialEndsAt.slice(0, 10))}
        </Badge>
      ) : (
        <Badge variant="outline" className="whitespace-nowrap text-muted-foreground">
          مفيش اشتراك
        </Badge>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        {!readOnly && (
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[12px]">
              {subscription?.active ? "تعديل" : "تفعيل"}
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-start">
            <DialogTitle>اشتراك {row.email}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              المدة بتبدأ من نهاية التجربة أو نهاية الاشتراك الحالي — أيهما أبعد — فالتفعيل وسط
              التجربة مش بيضيّع الأيام الباقية.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`ref-${row.id}`}>مرجع التحويل (اختياري)</Label>
              <Input
                id={`ref-${row.id}`}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="رقم عملية InstaPay أو ملاحظة"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void grant("long_monthly")} disabled={busy}>
                {busy && <Spinner />}النفس الطويل · شهر
              </Button>
              <Button onClick={() => void grant("long_yearly")} disabled={busy}>
                {busy && <Spinner />}النفس الطويل · سنة
              </Button>
              <Button onClick={() => void grant("trader_monthly")} disabled={busy}>
                {busy && <Spinner />}الحريفة · شهر
              </Button>
              <Button onClick={() => void grant("trader_yearly")} disabled={busy}>
                {busy && <Spinner />}الحريفة · سنة
              </Button>
            </div>

            <div className="space-y-1.5 border-t pt-4">
              <Label htmlFor={`ends-${row.id}`}>أو تاريخ انتهاء مخصص</Label>
              <div className="flex flex-wrap gap-2">
                <div className="flex overflow-hidden rounded-md border">
                  {(["long", "trader"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCustomTier(t)}
                      className={cn(
                        "px-2.5 text-[12px]",
                        customTier === t ? "bg-primary text-primary-foreground" : "bg-transparent",
                      )}
                    >
                      {GRANT_TIER_LABEL[t]}
                    </button>
                  ))}
                </div>
                <Input
                  id={`ends-${row.id}`}
                  type="date"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => void grant("custom", customTier)}
                  disabled={busy || !endsAt}
                >
                  حفظ
                </Button>
              </div>
            </div>

            {subscription && (
              <div className="border-t pt-4">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void revoke()}
                  disabled={busy}
                >
                  إيقاف الاشتراك فورًا
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SubscriptionGrantEntry = {
  id: string;
  plan: PlanKey;
  action: "grant" | "revoke";
  periodEnd: string | null;
  reference: string | null;
  createdAt: string;
};

type CreditsGrantEntry = {
  id: string;
  deltas: Partial<Record<CreditKind, number>>;
  reference: string | null;
  createdAt: string;
};

const creditsGrantText = (deltas: Partial<Record<CreditKind, number>>) =>
  CREDIT_FIELDS.filter(({ kind }) => deltas[kind]).map(({ kind, label }) => `${label} ${signed(deltas[kind])}`).join("، ");

/**
 * Collapsed history of past Subscription/Credits grants, for checking a
 * disputed or repeated InstaPay payment. Fetched only once expanded — most
 * drawer opens are to act, not to audit, so an open shouldn't cost two
 * extra requests it'll never look at.
 */
function GrantHistoryCell({ row }: { row: AdminUserRow }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [subs, setSubs] = useState<SubscriptionGrantEntry[] | null>(null);
  const [credits, setCredits] = useState<CreditsGrantEntry[] | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && subs === null) {
      setLoading(true);
      try {
        const [subRes, creditRes] = await Promise.all([
          api<{ grants: SubscriptionGrantEntry[] }>(`/api/admin/users/${row.id}/subscription`),
          api<{ grants: CreditsGrantEntry[] }>(`/api/admin/users/${row.id}/credits`),
        ]);
        setSubs(subRes.grants);
        setCredits(creditRes.grants);
      } catch {
        setSubs([]);
        setCredits([]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="border-t pt-3">
      <Button size="sm" variant="ghost" className="h-7 px-1 text-[12px] text-muted-foreground" onClick={() => void toggle()}>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}
        سجل
      </Button>
      {open && (
        <div className="mt-2 space-y-3 text-[12px]">
          {loading && <div className="text-muted-foreground">جارِ التحميل…</div>}
          {!loading && subs && (
            <div className="space-y-1">
              <div className="font-medium text-muted-foreground">الاشتراك</div>
              {subs.length === 0 ? (
                <div className="text-muted-foreground">لا يوجد سجل</div>
              ) : (
                subs.map((g) => (
                  <div key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-2 tabular-nums">
                    <span>
                      {g.action === "revoke" ? `أُوقف: ${PLAN_LABEL[g.plan]}` : `${PLAN_LABEL[g.plan]} · حتى ${arDay(g.periodEnd?.slice(0, 10))}`}
                    </span>
                    <span className="text-muted-foreground">
                      {arDay(g.createdAt.slice(0, 10))}
                      {g.reference ? ` · ${g.reference}` : ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
          {!loading && credits && (
            <div className="space-y-1">
              <div className="font-medium text-muted-foreground">الرصيد</div>
              {credits.length === 0 ? (
                <div className="text-muted-foreground">لا يوجد سجل</div>
              ) : (
                credits.map((g) => (
                  <div key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-2 tabular-nums">
                    <span>{creditsGrantText(g.deltas)}</span>
                    <span className="text-muted-foreground">
                      {arDay(g.createdAt.slice(0, 10))}
                      {g.reference ? ` · ${g.reference}` : ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
