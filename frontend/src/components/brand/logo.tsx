import { cn } from "@/lib/utils";

/** EGXpert brand mark: a rising candlestick chart inside a rounded shield. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" role="img" aria-label="EGXpert" className={cn("size-9", className)}>
      <defs>
        <linearGradient id="egx-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--info)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#egx-mark)" />
      <g stroke="var(--primary-foreground)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M11 27.5V21" />
        <path d="M20 27.5V16" />
        <path d="M29 27.5V11.5" />
      </g>
      <path
        d="M9.5 15.5 16 19l5-6 6.5 3"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className, tagline = true }: { className?: string; tagline?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="size-9 shrink-0" />
      <span className="min-w-0 leading-tight">
        <span className="block text-[16px] font-bold tracking-tight" dir="ltr">
          EGX<span className="text-primary">pert</span>
        </span>
        {tagline && (
          <span className="block truncate text-[11px] text-muted-foreground">
            خبير البورصة المصرية
          </span>
        )}
      </span>
    </span>
  );
}
