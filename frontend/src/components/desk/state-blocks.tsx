import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Standard card wrapper: one title, one supporting line, one body. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      {(title || action) && (
        <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b bg-surface px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <CardTitle className="text-[15px] font-semibold tracking-tight">{title}</CardTitle>
            {description && (
              <CardDescription className="mt-1 text-[12.5px] leading-relaxed">
                {description}
              </CardDescription>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </CardHeader>
      )}
      <CardContent className={cn("px-4 py-4 sm:px-5", bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-surface px-6 py-10 text-center">
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-down/40 bg-down-soft px-6 py-8 text-center">
      <AlertTriangle className="size-5 text-down" />
      <p className="text-sm font-medium text-down">{message}</p>
      {action}
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

/** Inline notice used for stop/target alerts and explanatory warnings. */
export function Notice({
  tone: variant = "info",
  children,
  className,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-border bg-surface text-foreground",
    warn: "border-warn/40 bg-warn-soft text-foreground",
    danger: "border-down/40 bg-down-soft text-foreground",
    success: "border-up/40 bg-up-soft text-foreground",
  } as const;
  const dots = {
    info: "bg-muted-foreground",
    warn: "bg-warn",
    danger: "bg-down",
    success: "bg-up",
  } as const;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed",
        tones[variant],
        className,
      )}
    >
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dots[variant])} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Compact label/value stat used across the hero and cards. */
export function Stat({
  label,
  value,
  sub,
  valueClassName,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 text-start", className)}>
      <div className="truncate text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "num mt-0.5 text-right text-[17px] font-semibold tracking-tight",
          valueClassName,
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="num mt-0.5 text-right text-[11.5px] text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}
