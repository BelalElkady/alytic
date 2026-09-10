import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  Crosshair,
  LineChart,
  LogOut,
  Mail,
  Moon,
  PencilLine,
  Radar,
  RefreshCw,
  Settings,
  Sun,
  Upload,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { LogoMark } from "@/components/brand/logo";
import { DetailDialog } from "@/components/desk/detail-dialog";
import { ManualEntryDialog } from "@/components/desk/manual-entry-dialog";
import { MarketDialog } from "@/components/desk/market-dialog";
import { Spinner, Stat } from "@/components/desk/state-blocks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, post } from "@/lib/api";
import { int, signed, tone } from "@/lib/format";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/portfolio", label: "الأسهم", icon: Wallet },
  { to: "/targets", label: "الأهداف", icon: Crosshair },
  { to: "/calendar", label: "التقويم", icon: CalendarDays },
  { to: "/charts", label: "الرسوم", icon: BarChart3 },
  { to: "/cash", label: "الكاش", icon: LineChart },
  { to: "/trades", label: "الصفقات", icon: RefreshCw },
  { to: "/settings", label: "الإعدادات", icon: Settings },
] as const;

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("alytic-theme");
    const isDark = saved === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);
  const toggle = () => {
    setDark((previous) => {
      const next = !previous;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("alytic-theme", next ? "dark" : "light");
      return next;
    });
  };
  return { dark, toggle };
}

export function DeskShell({ children }: { children: ReactNode }) {
  const { user, authChecked } = useDesk();
  const navigate = useNavigate();

  useEffect(() => {
    if (authChecked && !user) void navigate({ to: "/login", search: { mode: "login" }, replace: true });
  }, [authChecked, user, navigate]);

  if (!authChecked || !user) {
    return (
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-8">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    );
  }


  return (
    <div className="min-h-screen bg-surface pb-20 md:pb-0">
      <DeskHeader />
      <VerifyEmailBanner />
      <HeroBar />
      <main className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">{children}</main>
      <MobileNav />
      <DetailDialog />
      <MarketDialog />
      <ManualEntryDialog />
    </div>
  );
}

function VerifyEmailBanner() {
  const { user, resendVerification } = useDesk();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || user.emailVerified) return null;

  const resend = async () => {
    setSending(true);
    try {
      await resendVerification(user.email);
      setSent(true);
      toast.success("اتبعت رابط تفعيل جديد على بريدك");
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر إرسال رابط التفعيل");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-5">
      <Alert className="flex flex-col gap-2 border-amber-500/40 bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between">
        <AlertDescription className="flex items-center gap-2 text-[13px]">
          <Mail className="size-4 shrink-0" />
          لسه ما فعّلتش بريدك الإلكتروني ({user.email}). راجع صندوق الوارد وافتح رابط التفعيل.
        </AlertDescription>
        <Button size="sm" variant="outline" onClick={() => void resend()} disabled={sending || sent}>
          {sending && <Spinner />}
          {sent ? "اتبعت" : "إعادة إرسال الرابط"}
        </Button>
      </Alert>
    </div>
  );
}

function DeskHeader() {
  const { user, signOut, openMarket, setManualOpen, reload, reloadLog, lastPriceSync, priceError } =
    useDesk();
  const { dark, toggle } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);

  const today = new Date().toLocaleDateString("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const importFiles = async (files: File[], replaceAll: boolean) => {
    setUploading(true);
    try {
      let derived = 0;
      let imported = 0;
      for (const [index, file] of files.entries()) {
        const mode = replaceAll && index === 0 ? "replace=1" : "merge=1";
        const result = await api(`/api/portfolio/import-screenshot?${mode}`, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        } as RequestInit);
        derived += result.derivedPositions ?? 0;
        imported += result.positions ?? 0;
      }
      await reload();
      const scope = replaceAll
        ? "استُبدلت المحفظة بالكامل."
        : "اتضاف/اتحدّث الأسهم دي بس — باقي المحفظة زي ما هو.";
      if (derived) {
        toast.warning(`تم تحديث ${imported} سهم من ${files.length} صورة`, {
          description: `${scope} ⚠️ ${derived} منهم عدد الأسهم اتحسب تقديريًا — راجعه من «إدخال يدوي».`,
          duration: 12000,
        });
      } else {
        toast.success(`تم تحديث ${imported} سهم من ${files.length} صورة`, { description: scope });
      }
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر قراءة الصور");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveSnapshot = async () => {
    setSnapshotting(true);
    try {
      const result = await post("/api/snapshot");
      await reloadLog();
      toast.success(`تم حفظ إغلاق ${result.saved}`);
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر حفظ الإغلاق");
    } finally {
      setSnapshotting(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:px-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <LogoMark className="size-9 shrink-0" />
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold tracking-tight">
                <span dir="ltr">EGXpert</span>
              </h1>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {today} ·{" "}
                <span className={priceError ? "text-down" : undefined}>
                  {priceError
                    ? "تعذر تحديث الأسعار"
                    : lastPriceSync
                      ? `تحديث الأسعار ${lastPriceSync}`
                      : "بيتابع الأسعار"}
                </span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <span className="hidden max-w-32 truncate text-[12.5px] text-muted-foreground sm:inline">
              {user?.name || user?.email}
            </span>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="تبديل الوضع الليلي">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="خروج">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>

        <div className="scrollbar-slim -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5">
          <Button size="sm" onClick={() => openMarket("market")}>
            <Radar className="size-4" />
            تحليل السوق
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : <Upload className="size-4" />}
            رفع صور المحفظة
          </Button>
          <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
            <PencilLine className="size-4" />
            إدخال يدوي
          </Button>
          <Button size="sm" variant="outline" onClick={() => void saveSnapshot()} disabled={snapshotting}>
            {snapshotting ? <Spinner /> : <CalendarDays className="size-4" />}
            سجّل إغلاق اليوم
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length) setPendingFiles(files);
            }}
          />
        </div>

        <DesktopNav />
      </div>

      <AlertDialog open={Boolean(pendingFiles)} onOpenChange={(open) => !open && setPendingFiles(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>الصور دي بتمثل المحفظة كاملة؟</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              «استبدال المحفظة» يمسح الأسهم اللي مش موجودة في الصور. «إضافة/تحديث» بيحدّث الأسهم اللي
              في الصور بس ويسيب الباقي زي ما هو.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              onClick={() => {
                const files = pendingFiles ?? [];
                setPendingFiles(null);
                void importFiles(files, false);
              }}
            >
              إضافة/تحديث
            </AlertDialogAction>
            <Button
              variant="destructive"
              onClick={() => {
                const files = pendingFiles ?? [];
                setPendingFiles(null);
                void importFiles(files, true);
              }}
            >
              استبدال المحفظة بالكامل
            </Button>
            <AlertDialogCancel
              onClick={() => {
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              إلغاء
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

function DesktopNav() {
  return (
    <nav className="scrollbar-slim -mx-1 hidden gap-1 overflow-x-auto px-1 md:flex" aria-label="التبويبات">
      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function MobileNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden"
      aria-label="التبويبات"
    >
      <div className="scrollbar-slim flex justify-between gap-0.5 overflow-x-auto px-1 py-1.5">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex min-w-16 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10.5px] font-medium transition-colors",
                active ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4.5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function HeroBar() {
  const { totals, loading } = useDesk();
  return (
    <section className="border-b bg-card">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-4 gap-y-3 px-3 py-4 sm:px-5 md:grid-cols-5">
        {loading && !totals.value ? (
          Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12" />)
        ) : (
          <>
            <Stat label="التكلفة الكلية" value={int(totals.cost)} />
            <Stat label="قيمة الأسهم" value={int(totals.value)} />
            <Stat
              label="ربح/خسارة من الشراء"
              value={signed(totals.pl)}
              valueClassName={tone(totals.pl)}
              sub={<span className={tone(totals.pl)}>{totals.plPct.toFixed(2)}%</span>}
            />
            <Stat
              label="تغيّر اليوم"
              value={totals.hasDay ? signed(totals.day) : "—"}
              valueClassName={totals.hasDay ? tone(totals.day) : ""}
            />
            <Stat
              label="الكاش"
              value={int(totals.cash)}
              sub={`إجمالي ${int(totals.value + totals.cash)} ج`}
            />
          </>
        )}
      </div>
    </section>
  );
}
