import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
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
  EmptyState,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, del, post, postRaw } from "@/lib/api";
import { BlogDraftsTab } from "@/components/admin/blog-drafts-tab";
import { PublishedPostsTab } from "@/components/admin/blog-published-tab";
import { SupportTab } from "@/components/admin/support-tab";
import { arDay, int, signed, tone } from "@/lib/format";
import { INVEST_STYLES, inferInvestStyle, type StyleKey, type Trade } from "@/lib/invest-style";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

const BASE_TITLE = "الإدارة — EGXpert";

export const Route = createFileRoute("/_app/admin")({
  head: () => ({
    meta: [
      { title: BASE_TITLE },
      { name: "description", content: "إدارة قوائم المؤشرات والمستخدمين المسجّلين." },
    ],
  }),
  component: AdminPage,
});

type Ticker = { code: string; name: string };

type IndexRow = {
  name: string;
  tickers: Ticker[];
  count: number;
  source: "default" | "upload";
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
};

/**
 * Polls the same thread list the support tab shows and mirrors its total
 * unread count onto the browser tab title (e.g. "(3) الإدارة — EGXpert") —
 * so a new message is visible from any admin tab, not just while the support
 * tab happens to be open. Cleared back to the plain title once every thread
 * is read (or reads zero) and restored on unmount so it never leaks onto a
 * different page's tab title.
 */
function useUnreadTitleBadge(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { threads } = await api("/api/admin/support");
        if (cancelled) return;
        const total = threads.reduce((sum: number, t: { unread: number }) => sum + t.unread, 0);
        document.title = total > 0 ? `(${total}) ${BASE_TITLE}` : BASE_TITLE;
      } catch {
        // Best-effort badge — a failed poll just leaves the last count showing.
      }
    };
    void poll();
    const timer = setInterval(poll, 20 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.title = BASE_TITLE;
    };
  }, [enabled]);
}

function AdminPage() {
  const { user } = useDesk();
  useUnreadTitleBadge(Boolean(user?.isAdmin));

  if (!user?.isAdmin) {
    return <ErrorState message="الصفحة دي للمشرفين بس." />;
  }

  return (
    <Tabs defaultValue="indices" className="space-y-4">
      <TabsList>
        <TabsTrigger value="indices">المؤشرات</TabsTrigger>
        <TabsTrigger value="users">المستخدمين</TabsTrigger>
        <TabsTrigger value="support">الدعم</TabsTrigger>
        <TabsTrigger value="blog">المدونة</TabsTrigger>
      </TabsList>
      <TabsContent value="indices">
        <IndicesTab />
      </TabsContent>
      <TabsContent value="users">
        <UsersTab />
      </TabsContent>
      <TabsContent value="support">
        <SupportTab />
      </TabsContent>
      <TabsContent value="blog">
        <Tabs defaultValue="pending" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pending">قيد المراجعة</TabsTrigger>
            <TabsTrigger value="published">المنشور</TabsTrigger>
          </TabsList>
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
        <Notice tone={matches.length ? "success" : "warn"}>
          {matches.length
            ? `"${search}" موجود في: ${matches.map((m) => LABELS[m.name] ?? m.name).join("، ")}`
            : `"${search}" مش موجود في أي مؤشر من اللي هنا.`}
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
          {row.count} كود · {row.source === "upload" ? "مرفوع يدويًا" : "افتراضي"}
          {row.updatedAt && ` · آخر تحديث ${new Date(row.updatedAt).toLocaleString("ar-EG")}`}
        </>
      }
      action={
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
  trades: Trade[];
};

type AdminSubscription = {
  plan: "monthly" | "yearly" | "custom";
  currentPeriodEnd: string;
  active: boolean;
  note: string | null;
  updatedAt: string;
};

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isAdmin: boolean;
  emailVerified: boolean;
  googleLinked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  trialActive: boolean;
  trialEndsAt: string;
  subscription: AdminSubscription | null;
  portfolio: AdminUserPortfolio | null;
};

const STYLE_LABEL: Record<StyleKey, string> = Object.fromEntries(
  INVEST_STYLES.map((s) => [s.key, s.label]),
) as Record<StyleKey, string>;

const matchesUser = (row: AdminUserRow, query: string) =>
  [row.email, row.name, row.phone].some((field) => field?.toLowerCase().includes(query));

function UsersTab() {
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (rows ? (query ? rows.filter((row) => matchesUser(row, query)) : rows) : []),
    [rows, query],
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
  if (!rows) return <LoadingBlock rows={3} />;

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="ابحث بالبريد الإلكتروني أو الاسم أو رقم الهاتف…"
      />
      <Panel
        title="المستخدمون المسجّلون"
        description={`${filtered.length} من ${rows.length} مستخدم`}
        bodyClassName="px-0 py-0 sm:px-0"
      >
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا يوجد مستخدمون مطابقون" hint="جرّب كلمة بحث مختلفة." />
          </div>
        ) : (
          <div className="scrollbar-slim overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">المستخدم</TableHead>
                  <TableHead className="text-start">الهاتف</TableHead>
                  <TableHead className="text-start">تاريخ التسجيل</TableHead>
                  <TableHead className="text-start">آخر دخول</TableHead>
                  <TableHead className="text-start">رأس المال</TableHead>
                  <TableHead className="text-start">ربح محقق</TableHead>
                  <TableHead className="text-start">النشاط الاستثماري</TableHead>
                  <TableHead className="text-start">الأسلوب</TableHead>
                  <TableHead className="text-start">الاشتراك</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead>
                    <span className="sr-only">حذف</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <UserRow key={row.id} row={row} onChanged={load} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function UserRow({ row, onChanged }: { row: AdminUserRow; onChanged: () => void }) {
  const pf = row.portfolio;
  const inferredStyle = pf ? inferInvestStyle(pf.trades) : null;
  const capital = pf ? pf.cash + pf.positionsValue : null;

  return (
    <TableRow>
      <TableCell>
        <div className="min-w-0">
          <div className="truncate font-medium">{row.email}</div>
          {row.name && <div className="truncate text-[12px] text-muted-foreground">{row.name}</div>}
        </div>
      </TableCell>
      <TableCell className="num text-right">{row.phone || "—"}</TableCell>
      <TableCell className="num text-right">{arDay(row.createdAt?.slice(0, 10))}</TableCell>
      <TableCell className="num text-right">
        {row.lastLoginAt
          ? new Date(row.lastLoginAt).toLocaleString("ar-EG", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
      </TableCell>
      <TableCell className="num text-right">
        {capital != null ? `${int(capital)} ج` : "—"}
      </TableCell>
      <TableCell
        className={cn("num text-right", pf ? tone(pf.realizedPnl) : "text-muted-foreground")}
      >
        {pf ? signed(pf.realizedPnl) : "—"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {pf
          ? `${pf.tradesCount} صفقة · ${pf.positionsCount} مركز · ${pf.watchlistCount} متابعة`
          : "لا توجد محفظة"}
      </TableCell>
      <TableCell>{inferredStyle ? STYLE_LABEL[inferredStyle] : "—"}</TableCell>
      <TableCell>
        <SubscriptionCell row={row} onChanged={onChanged} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {row.isAdmin && <Badge>مشرف</Badge>}
          {!row.emailVerified && <Badge variant="destructive">بريد غير مفعّل</Badge>}
          {row.googleLinked && <Badge variant="secondary">Google</Badge>}
        </div>
      </TableCell>
      <TableCell>{!row.isAdmin && <DeleteUserButton row={row} onDeleted={onChanged} />}</TableCell>
    </TableRow>
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

const PLAN_LABEL: Record<AdminSubscription["plan"], string> = {
  monthly: "شهري",
  yearly: "سنوي",
  custom: "مخصص",
};

/**
 * Where a paid account actually gets switched on. Activation is manual by
 * design — the user transfers over InstaPay and an admin records it here —
 * so this is the only path to premium access in the whole product.
 */
function SubscriptionCell({ row, onChanged }: { row: AdminUserRow; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [reference, setReference] = useState("");
  const subscription = row.subscription;

  const grant = async (plan: "monthly" | "yearly" | "custom") => {
    setBusy(true);
    try {
      await post(`/api/admin/users/${row.id}/subscription`, {
        plan,
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
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[12px]">
            {subscription?.active ? "تعديل" : "تفعيل"}
          </Button>
        </DialogTrigger>
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
              <Button onClick={() => void grant("monthly")} disabled={busy}>
                {busy && <Spinner />}+ شهر
              </Button>
              <Button onClick={() => void grant("yearly")} disabled={busy}>
                {busy && <Spinner />}+ سنة
              </Button>
            </div>

            <div className="space-y-1.5 border-t pt-4">
              <Label htmlFor={`ends-${row.id}`}>أو تاريخ انتهاء مخصص</Label>
              <div className="flex gap-2">
                <Input
                  id={`ends-${row.id}`}
                  type="date"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => void grant("custom")}
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
