import { useNavigate } from "@tanstack/react-router";
import { BellRing, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

import { track } from "./analytics";
import { resolveDeepLink } from "./deep-links";
import { startNetworkMonitor, useNetworkState } from "./network";
import { isNative } from "./platform";
import {
  dismissSoftPrompt,
  enablePush,
  getPushPermission,
  initPush,
  shouldShowSoftPrompt,
  type PushPermission,
} from "./push";
import { initNativeShell, onAppResume } from "./lifecycle";
import { haptic } from "./haptics";

/**
 * Mounted once under the router. Does nothing in a browser; in the app it
 * configures the shell (status bar, splash, keyboard), watches connectivity,
 * routes incoming deep links and notification taps, and wires push.
 */
export function NativeBootstrap() {
  const navigate = useNavigate();
  const { user, reload } = useDesk();
  const go = useCallback(
    (target: { to: string; search?: Record<string, string> }) =>
      void navigate({ to: target.to as never, ...(target.search ? { search: target.search as never } : {}) }),
    [navigate],
  );

  useEffect(() => {
    if (!isNative()) return;
    void startNetworkMonitor(async () => {
      const { api } = await import("@/lib/api");
      await api("/api/health");
      return true;
    });
    const stopShell = initNativeShell(go);
    track("app_open");
    return stopShell;
  }, [go]);

  // Returning from the background after a while: refresh what goes stale (prices, portfolio).
  useEffect(() => {
    if (!isNative() || !user) return;
    return onAppResume((awayMs) => {
      if (awayMs > 60_000) void reload().catch(() => {});
    });
  }, [user, reload]);

  useEffect(() => {
    if (!isNative() || !user) return;
    void initPush({
      navigate: go,
      onForeground: ({ title, body, target }) =>
        toast(title ?? "EGXpert", {
          ...(body ? { description: body } : {}),
          ...(target ? { action: { label: "فتح", onClick: () => go(target) } } : {}),
        }),
    });
  }, [user, go]);

  return null;
}

/** "You are offline" strip. Shown in the app and the browser alike; says plainly that prices may be old. */
export function ConnectionBanner() {
  const state = useNetworkState();
  if (state === "ONLINE") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 px-3 pb-1.5 text-[12.5px] font-medium",
        "pt-[calc(env(safe-area-inset-top)+0.375rem)]",
        state === "OFFLINE" ? "bg-destructive text-destructive-foreground" : "bg-warn text-foreground",
      )}
    >
      {state === "OFFLINE" ? <CloudOff className="size-4" aria-hidden /> : <Loader2 className="size-4 animate-spin" aria-hidden />}
      {state === "OFFLINE"
        ? "أنت غير متصل بالإنترنت. بتشوف آخر بيانات متاحة — الأسعار ممكن تكون قديمة."
        : "بنعيد الاتصال… الأسعار هتتحدّث أول ما الاتصال يرجع."}
    </div>
  );
}

/** Wraps the page: native pull-down gesture that calls onRefresh (touch only, only at the top of the page). */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const THRESHOLD = 70;

  const onTouchStart = (event: React.TouchEvent) => {
    startY.current = window.scrollY <= 0 ? (event.touches[0]?.clientY ?? null) : null;
  };
  const onTouchMove = (event: React.TouchEvent) => {
    if (startY.current == null || busy) return;
    const delta = (event.touches[0]?.clientY ?? 0) - startY.current;
    setPull(delta > 0 ? Math.min(delta * 0.5, THRESHOLD + 20) : 0);
  };
  const onTouchEnd = async () => {
    const shouldRefresh = pull >= THRESHOLD && !busy;
    startY.current = null;
    setPull(0);
    if (!shouldRefresh) return;
    setBusy(true);
    void haptic("light");
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={() => void onTouchEnd()}>
      <div
        className="flex items-center justify-center overflow-hidden text-muted-foreground transition-[height]"
        style={{ height: busy ? 36 : pull }}
        aria-hidden={!busy && pull === 0}
      >
        <RefreshCw className={cn("size-4", busy && "animate-spin")} />
      </div>
      {children}
    </div>
  );
}

/** Settings panel body: turns price alerts on, explains why, and reflects the OS permission. */
export function PushAlertsControl() {
  const [permission, setPermission] = useState<PushPermission>("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushPermission().then(setPermission);
  }, []);

  if (!isNative() || permission === "unsupported") return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      setPermission(await enablePush());
      void haptic("success");
    } catch {
      toast.error("مقدرناش نفعّل التنبيهات دلوقتي. اتأكد من الاتصال وجرّب تاني.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        هنبعتلك تنبيه لما سهم في محفظتك يوصل للهدف أو يكسر الوقف، وبرضه لو فيه حدث مهم على سهم بتتابعه. تقدر توقفها في أي وقت من إعدادات الموبايل.
      </p>
      {permission === "granted" ? (
        <p className="text-[13px] font-medium text-up">التنبيهات شغّالة على الجهاز ده.</p>
      ) : permission === "denied" ? (
        <p className="text-[13px] text-muted-foreground">
          التنبيهات مقفولة من إعدادات الموبايل. افتح إعدادات التطبيق وفعّل الإشعارات.
        </p>
      ) : (
        <Button onClick={() => void turnOn()} disabled={busy} className="min-h-11">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" aria-hidden />}
          فعّل تنبيهات الأسعار
        </Button>
      )}
    </div>
  );
}

/** One-time nudge after sign-in, before any system dialog, so the eventual OS prompt has context. */
export function PushSoftPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isNative() || !shouldShowSoftPrompt()) return;
    void getPushPermission().then((permission) => setShow(permission === "prompt"));
  }, []);
  if (!show) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 text-[13px]">
      <BellRing className="size-5 shrink-0 text-primary" aria-hidden />
      <p className="flex-1 leading-relaxed">عايز تنبيه لما سهم يوصل للهدف أو الوقف؟</p>
      <Button
        size="sm"
        className="min-h-11"
        onClick={() => {
          dismissSoftPrompt();
          setShow(false);
          void enablePush().catch(() => {});
        }}
      >
        تفعيل
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="min-h-11"
        onClick={() => {
          dismissSoftPrompt();
          setShow(false);
        }}
      >
        مش دلوقتي
      </Button>
    </div>
  );
}

export { resolveDeepLink };
