import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  CalendarClock,
  CalendarDays,
  Crosshair,
  HelpCircle,
  LineChart,
  LogOut,
  Mail,
  Moon,
  MoreHorizontal,
  PencilLine,
  Radar,
  Settings,
  ShieldCheck,
  Sun,
  Upload,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { SubscribePanel } from "@/components/billing/subscribe-panel";
import { Logo, LogoMark } from "@/components/brand/logo";
import { DetailDialog } from "@/components/desk/detail-dialog";
import { ManualEntryDialog } from "@/components/desk/manual-entry-dialog";
import { MarketDialog } from "@/components/desk/market-dialog";
import { Spinner, Stat } from "@/components/desk/state-blocks";
import { BlogTicker } from "@/components/marketing/blog-ticker";
import { ChatWidget } from "@/components/support/chat-widget";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { arDay, int, signed, tone } from "@/lib/format";
import { INVEST_STYLES, useActiveInvestStyle } from "@/lib/invest-style";
import { useDesk } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/portfolio", label: "الأسهم", icon: Wallet, adminOnly: false },
  { to: "/indices", label: "المؤشرات", icon: Activity, adminOnly: false },
  { to: "/targets", label: "الأهداف", icon: Crosshair, adminOnly: false },
  { to: "/calendar", label: "التقويم", icon: CalendarDays, adminOnly: false },
  { to: "/charts", label: "الرسوم", icon: BarChart3, adminOnly: false },
  { to: "/cash", label: "تحليل الكاش", icon: LineChart, adminOnly: false },
  { to: "/settings", label: "البروفايل والإعدادات", icon: Settings, adminOnly: false },
  { to: "/how-to-use", label: "طريقة الاستخدام", icon: HelpCircle, adminOnly: false },
  { to: "/admin", label: "الإدارة", icon: ShieldCheck, adminOnly: true },
] as const;

export function DeskShell({ children }: { children: ReactNode }) {
  const { user, authChecked } = useDesk();
  const navigate = useNavigate();

  useEffect(() => {
    if (authChecked && !user)
      void navigate({ to: "/login", search: { mode: "login" }, replace: true });
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

  // The trial lapsed with no live plan: the desk itself is what's being sold,
  // so it's replaced by the subscribe instructions rather than rendered empty
  // over an API that would answer 402 anyway. The header stays so the user can
  // still see their status and sign out.
  const locked = user.hasAccess === false;

  return (
    <div className="min-h-screen bg-surface pb-20 md:pb-0">
      <DeskHeader />
      <BlogTicker />
      <RequirePhoneDialog />
      <VerifyEmailBanner />
      <ExpiryBanner />
      {!locked && <HeroBar />}
      <main className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">
        {locked ? <SubscriptionWall /> : children}
      </main>
      <footer className="border-t bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <Logo />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            EGXpert أداة تحليل ومساعدة في القرار — وليست توصية مالية مرخّصة. القرار الأخير مسؤوليتك.
          </p>
          <div className="flex items-center gap-4">
            <Link
              to="/how-to-use"
              className="text-[12.5px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              طريقة الاستخدام
            </Link>
            <Link
              to="/contact"
              className="text-[12.5px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              تواصل معنا
            </Link>
          </div>
        </div>
      </footer>
      <MobileNav />
      <ChatWidget />
      <DetailDialog />
      <MarketDialog />
      <ManualEntryDialog />
    </div>
  );
}

/**
 * The only warning a user gets before access stops — chosen over an email
 * reminder because activation is manual: they need lead time to send the
 * InstaPay transfer and for it to be checked by hand. Shows in the last
 * stretch of a trial or a paid period, and stays put (no dismiss) since
 * missing it means losing access.
 */
const EXPIRY_WARNING_DAYS = 5;
function ExpiryBanner() {
  const { user } = useDesk();
  if (!user || user.hasAccess === false) return null;

  const endsAt = user.subscriptionActive ? user.currentPeriodEnd : user.trialEndsAt;
  if (!endsAt) return null;
  const daysLeft = Math.ceil((new Date(endsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft > EXPIRY_WARNING_DAYS) return null;

  const remaining = daysLeft <= 0 ? "النهارده" : daysLeft === 1 ? "بكرة" : `بعد ${daysLeft} أيام`;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-5">
      <Alert className="flex flex-col gap-2 border-amber-500/40 bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between">
        <AlertDescription className="flex items-center gap-2 text-[13px]">
          <CalendarClock className="size-4 shrink-0" />
          {user.subscriptionActive
            ? `اشتراكك بينتهي ${remaining} (${arDay(endsAt.slice(0, 10))}). جدّده عشان متفقدش الوصول.`
            : `تجربتك المجانية بتنتهي ${remaining}. اشترك عشان تكمل.`}
        </AlertDescription>
        <Button size="sm" asChild>
          <Link to="/subscribe">طريقة الاشتراك</Link>
        </Button>
      </Alert>
    </div>
  );
}

/**
 * Replaces the desk once access lapses — see the `locked` branch in DeskShell.
 * A user who never subscribed is told their trial ended, not that a
 * subscription they never had expired; currentPeriodEnd is what separates the
 * two (it is only ever set by an admin granting a period).
 */
function SubscriptionWall() {
  const { user } = useDesk();
  const expired = Boolean(user?.currentPeriodEnd);

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-[17px] font-semibold">
        {expired ? "اشتراكك انتهى" : "خلصت التجربة المجانية"}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {expired
          ? `اشتراكك انتهى${user?.currentPeriodEnd ? ` يوم ${arDay(user.currentPeriodEnd.slice(0, 10))}` : ""}. `
          : "جرّبت EGXpert ٥ أيام تداول كاملة بكل المزايا. "}
        محفظتك وصفقاتك وكل بياناتك زي ما هي ومحدش هيمسّها — التحليل والأسعار اللحظية بس اللي واقفة
        لحد ما تشترك.
      </p>
      <div className="mt-5">
        <SubscribePanel compact />
      </div>
    </section>
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
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر إرسال رابط التفعيل");
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => void resend()}
          disabled={sending || sent}
        >
          {sending && <Spinner />}
          {sent ? "اتبعت" : "إعادة إرسال الرابط"}
        </Button>
      </Alert>
    </div>
  );
}

/**
 * Registration requires a phone number, but Google sign-in never collects
 * one — so a Google-created account can land here without one. Blocks the
 * desk (no cancel, no outside-click/Escape dismiss — Radix AlertDialog's
 * default) until it's filled in, the same way it would have been required
 * at registration.
 */
function RequirePhoneDialog() {
  const { user, updatePhone } = useDesk();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.phone) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updatePhone(phone);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر حفظ رقم الموبايل");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={() => {}}>
      <AlertDialogContent>
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>محتاجين رقم موبايلك</AlertDialogTitle>
          <AlertDialogDescription className="leading-relaxed">
            حسابك اتعمل بجوجل، ورقم الموبايل مطلوب لإكمال إنشاء الحساب. اكتبه عشان تقدر تكمل لمكتب
            محفظتك.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <div className="space-y-1.5 text-start">
            <Label htmlFor="require-phone">رقم الموبايل</Label>
            <Input
              id="require-phone"
              type="tel"
              dir="ltr"
              placeholder="01xxxxxxxxx"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
              autoComplete="tel"
              autoFocus
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-down-soft px-3 py-2 text-[13px] text-down">
              {error}
            </p>
          )}
          <AlertDialogFooter className="sm:justify-start">
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />}
              حفظ ومتابعة
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Polls EGX's open/closed status (10:00-14:30 Cairo, Sun-Thu, minus holidays). */
function useMarketStatus() {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api<{ open: boolean }>("/market-status")
        .then((data) => {
          if (!cancelled) setOpen(Boolean(data?.open));
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return open;
}

function DeskHeader() {
  const {
    user,
    signOut,
    openMarket,
    setManualOpen,
    reload,
    lastPriceSync,
    priceError,
    pf,
  } = useDesk();
  const { dark, toggle } = useTheme();
  const marketOpen = useMarketStatus();
  const { style: investStyle, auto: investStyleAuto } = useActiveInvestStyle(pf?.trades);
  const investStyleLabel = INVEST_STYLES.find((style) => style.key === investStyle)?.label;
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [uploading, setUploading] = useState(false);

  const today = new Date().toLocaleDateString("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    numberingSystem: "latn",
  });

  // Entitlement fields come from /api/auth/me (server.js's accessInfo) — the
  // trial window is derived from created_at and the plan from the
  // subscriptions row, so neither is stored client-side.
  const trialDaysLeft = typeof user?.trialDaysLeft === "number" ? user.trialDaysLeft : null;
  const trialActive = Boolean(user?.trialActive);
  const subscriptionActive = Boolean(user?.subscriptionActive);
  const periodEnd = user?.currentPeriodEnd ?? null;
  const locked = user?.hasAccess === false;
  // Monthly allowance from GET /api/portfolio (see TIERS in
  // backend/src/billing/plans.js) — the server enforces it; this only
  // explains it and disables the button once it's used up.
  const screenshotsLeft =
    typeof pf?.screenshotImportsLeft === "number" ? pf.screenshotImportsLeft : null;
  const screenshotsPerMonth =
    typeof pf?.screenshotsPerMonth === "number" ? pf.screenshotsPerMonth : null;
  const screenshotsExhausted = screenshotsLeft !== null && screenshotsLeft <= 0;
  const screenshotsHint =
    screenshotsLeft === null
      ? null
      : screenshotsExhausted
        ? "خلصت صور الشهر ده — تتجدد الشهر الجاي"
        : `باقي ${screenshotsLeft}${screenshotsPerMonth && !pf?.credits?.screenshots ? ` من ${screenshotsPerMonth}` : ""} ${screenshotsLeft === 1 ? "صورة" : "صور"} الشهر ده`;

  const marketAnalysisLeft =
    typeof pf?.marketAnalysisLeft === "number" ? pf.marketAnalysisLeft : null;
  const marketAnalysisPerMonth =
    typeof pf?.marketAnalysisPerMonth === "number" ? pf.marketAnalysisPerMonth : null;
  const marketAnalysisExhausted = marketAnalysisLeft !== null && marketAnalysisLeft <= 0;
  const marketAnalysisHint =
    marketAnalysisLeft === null
      ? null
      : marketAnalysisExhausted
        ? "خلصت محاولات تحليل السوق المتاحة الشهر ده — تتجدد الشهر الجاي"
        : `باقي ${marketAnalysisLeft}${marketAnalysisPerMonth && !pf?.credits?.marketAnalysis ? ` من ${marketAnalysisPerMonth}` : ""} ${marketAnalysisLeft === 1 ? "محاولة" : "محاولات"} الشهر ده`;

  const importFiles = async (files: File[], replaceAll: boolean) => {
    setUploading(true);
    let imported = 0;
    try {
      let derived = 0;
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
        toast.success(`تم تحديث ${imported} سهم من ${files.length} صورة`, {
          description: `${scope} ⚠️ ${derived} منهم عدد الأسهم اتحسب تقديريًا — راجعه من «إدخال يدوي».`,
          duration: 12000,
        });
      } else {
        toast.success(`تم تحديث ${imported} سهم من ${files.length} صورة`, { description: scope });
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر قراءة الصور");
      // Earlier images in the batch may already be saved (and counted).
      if (imported) void reload();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Link to="/" aria-label="EGXpert" className="shrink-0">
              <LogoMark className="size-9" />
            </Link>
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

          <div className="order-3 flex w-full flex-wrap items-center gap-1.5 sm:order-2 sm:w-auto">
            {marketOpen !== null && (
              <Badge
                variant="outline"
                className={cn(
                  "whitespace-nowrap",
                  marketOpen ? "border-up/40 text-up" : "text-muted-foreground",
                )}
              >
                {marketOpen ? "السوق مفتوح" : "السوق مغلق"}
              </Badge>
            )}
            {subscriptionActive ? (
              <Link to="/subscribe" aria-label="حالة الاشتراك">
                <Badge variant="secondary" className="whitespace-nowrap">
                  {user?.tier === "trader" ? "الحريفة" : user?.tier === "long" ? "النفس الطويل" : "اشتراك"}
                  {user?.plan?.endsWith("_yearly") ? " · سنوي" : user?.plan?.endsWith("_monthly") ? " · شهري" : ""}
                  {periodEnd ? ` حتى ${arDay(periodEnd.slice(0, 10))}` : ""}
                </Badge>
              </Link>
            ) : (
              trialDaysLeft !== null && (
                <Link to="/subscribe" aria-label="حالة التجربة المجانية">
                  <Badge
                    variant="outline"
                    className={cn("whitespace-nowrap", !trialActive && "border-down/40 text-down")}
                  >
                    {trialActive
                      ? `تجربة مجانية: باقي ${trialDaysLeft} ${trialDaysLeft === 1 ? "يوم تداول" : "أيام تداول"}`
                      : "انتهت التجربة المجانية"}
                  </Badge>
                </Link>
              )
            )}
            {investStyleLabel && (
              <Link to="/settings" aria-label="سلوكك الاستثماري">
                <Badge variant="secondary" className="whitespace-nowrap">
                  سلوكك الاستثماري: {investStyleLabel}
                  {investStyleAuto ? " (تلقائي)" : ""}
                </Badge>
              </Link>
            )}
          </div>

          <div className="order-2 flex shrink-0 items-center gap-1.5 sm:order-3">
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

        <div
          className={cn(
            "flex flex-wrap items-center gap-2",
            // Every action here hits an endpoint the paywall answers with 402.
            locked && "hidden",
          )}
        >
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="relative inline-flex">
                  <Button
                    size="sm"
                    onClick={() => openMarket("market")}
                    disabled={marketAnalysisExhausted}
                    aria-describedby={marketAnalysisHint ? "market-analysis-left-hint" : undefined}
                  >
                    <Radar className="size-4" />
                    تحليل السوق
                    {marketAnalysisHint && (
                      <span id="market-analysis-left-hint" className="sr-only">
                        {marketAnalysisHint}
                      </span>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {marketAnalysisHint && <TooltipContent>{marketAnalysisHint}</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              {/* The wrapper takes the hover: a disabled button gets no pointer events. */}
              <TooltipTrigger asChild>
                <span className="relative inline-flex">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || screenshotsExhausted}
                    aria-describedby={screenshotsHint ? "screenshots-left-hint" : undefined}
                  >
                    {uploading ? <Spinner /> : <Upload className="size-4" />}
                    رفع صور المحفظة
                  </Button>
                  {screenshotsLeft !== null && (
                    <span
                      aria-hidden
                      className={cn(
                        "num pointer-events-none absolute -top-2 -end-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold leading-none ring-2 ring-background",
                        screenshotsExhausted ? "bg-down text-white" : "bg-primary text-primary-foreground",
                      )}
                    >
                      {screenshotsLeft}
                    </span>
                  )}
                  {screenshotsHint && (
                    <span id="screenshots-left-hint" className="sr-only">
                      {screenshotsHint}
                    </span>
                  )}
                </span>
              </TooltipTrigger>
              {screenshotsHint && <TooltipContent>{screenshotsHint}</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
          <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
            <PencilLine className="size-4" />
            إدخال يدوي
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              let files = [...(event.target.files ?? [])];
              if (screenshotsLeft !== null && files.length > screenshotsLeft) {
                toast.warning(
                  `باقي ${screenshotsLeft} ${screenshotsLeft === 1 ? "صورة" : "صور"} بس الشهر ده — هيترفع أول ${screenshotsLeft} بس.`,
                );
                files = files.slice(0, screenshotsLeft);
              }
              if (files.length) setPendingFiles(files);
              else event.target.value = "";
            }}
          />
        </div>

        <DesktopNav />
      </div>

      <AlertDialog
        open={Boolean(pendingFiles)}
        onOpenChange={(open) => !open && setPendingFiles(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>الصور دي بتمثل المحفظة كاملة؟</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              «استبدال المحفظة» يمسح الأسهم اللي مش موجودة في الصور. «إضافة/تحديث» بيحدّث الأسهم
              اللي في الصور بس ويسيب الباقي زي ما هو.
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
  const { user } = useDesk();
  return (
    <nav
      className="scrollbar-slim -mx-1 hidden gap-1 overflow-x-auto px-1 md:flex"
      aria-label="التبويبات"
    >
      {NAV.filter((item) => !item.adminOnly || user?.isAdmin).map(({ to, label, icon: Icon }) => (
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

// Beyond this many destinations, the tab bar can't fit them all as icon
// tabs on a phone screen — the extras collapse behind a trailing "المزيد"
// tab that opens the same sheet the old design used for every destination.
const MAX_MOBILE_TABS = 5;

function MobileNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { user } = useDesk();
  const [open, setOpen] = useState(false);

  const items = NAV.filter((item) => !item.adminOnly || user?.isAdmin);
  const overflow = items.length > MAX_MOBILE_TABS;
  const primary = overflow ? items.slice(0, MAX_MOBILE_TABS - 1) : items;
  const more = overflow ? items.slice(MAX_MOBILE_TABS - 1) : [];
  const activeInMore = more.some((item) => pathname.startsWith(item.to));

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden"
        aria-label="التبويبات"
      >
        <div className="flex justify-between gap-0.5 px-1 py-1.5">
          {primary.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex min-w-16 flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10.5px] font-medium transition-colors",
                  active ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4.5" />
                {label}
              </Link>
            );
          })}
          {overflow && (
            <SheetTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex min-w-16 flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10.5px] font-medium transition-colors",
                  activeInMore ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
              >
                <MoreHorizontal className="size-4.5" />
                المزيد
              </button>
            </SheetTrigger>
          )}
        </div>
      </nav>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>المزيد</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {more.map(({ to, label, icon: Icon }) => {
            const isActive = pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-medium transition-colors",
                  isActive
                    ? "border-transparent bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HeroBar() {
  const { totals, loading } = useDesk();
  // Three columns on phones keeps the five totals to two rows instead of
  // three, with the cash total no longer sitting alone on its own row.
  const size = "text-[15px] sm:text-[17px]";
  return (
    <section className="border-b bg-card">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-3 gap-x-3 gap-y-2.5 px-3 py-3 sm:gap-x-4 sm:gap-y-3 sm:px-5 sm:py-4 md:grid-cols-5">
        {loading && !totals.value ? (
          Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12" />)
        ) : (
          <>
            <Stat label="التكلفة الكلية" value={int(totals.cost)} valueClassName={size} />
            <Stat label="قيمة الأسهم" value={int(totals.value)} valueClassName={size} />
            <Stat
              label="ربح/خسارة من الشراء"
              value={signed(totals.pl)}
              valueClassName={cn(size, tone(totals.pl))}
              sub={<span className={tone(totals.pl)}>{totals.plPct.toFixed(2)}%</span>}
            />
            <Stat
              label="تغيّر اليوم"
              value={totals.hasDay ? signed(totals.day) : "—"}
              valueClassName={cn(size, totals.hasDay && tone(totals.day))}
            />
            <Stat
              label="الكاش"
              value={int(totals.cash)}
              valueClassName={size}
              sub={`إجمالي ${int(totals.value + totals.cash)} ج`}
            />
          </>
        )}
      </div>
    </section>
  );
}
