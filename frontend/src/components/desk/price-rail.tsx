import { fmt } from "@/lib/format";
import { mergedTargetPrice } from "@/lib/targets";
import { cn } from "@/lib/utils";

type RailProps = {
  price?: number | null | undefined;
  stop?: number | null | undefined;
  cost?: number | null | undefined;
  target?: number | null | undefined;
  longTarget?: number | null | undefined;
  className?: string | undefined;
  compact?: boolean | undefined;
};

type Mark = { value: number; label: string; dot: string; text: string };

/**
 * Price vs stop / cost / targets, on one line.
 * Same four levels the previous rail showed; the labels moved into a legend
 * underneath so nothing overlaps on narrow screens.
 *
 * `stop` is deliberately the only stop shown: it is the one the active
 * style's mechanical rules actually enforce (session-close trailing stop —
 * see config/styles.js), so it is the only stop those rules ever name. A
 * second, wider level (the SMA200-based long-term stop analyze.js also
 * computes) is informational only and never appears here, so the spectrum
 * never shows two competing "the stop" points for one position.
 */
export function PriceRail({
  price,
  stop,
  cost,
  target,
  longTarget,
  className,
  compact = false,
}: RailProps) {
  const lows = [stop, cost, price].filter((v): v is number => v != null);
  const highs = [target, longTarget, price].filter((v): v is number => v != null);
  if (!lows.length || !highs.length || price == null) return null;

  const lo = Math.min(...lows) * 0.96;
  const hi = Math.max(...highs) * 1.04;
  const span = hi - lo || 1;
  const raw = (value: number) => ((value - lo) / span) * 100;

  // Levels a few percent apart (price just above a trailing stop and the
  // cost) land within a few pixels of each other on a phone, so the price dot
  // swallows their ticks. Keep every point at least MIN_GAP apart, in order,
  // and map values piecewise-linearly between those spread-out anchors. The
  // rail is a picture of order and rough distance; exact numbers are in the
  // labels.
  const MIN_GAP = 8;
  const EDGE = 6;
  const values = [...new Set([stop, cost, price, target, longTarget])]
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const pos = values.map(raw);
  for (let i = 0; i < pos.length; i++)
    pos[i] = Math.max(pos[i]!, i === 0 ? EDGE : pos[i - 1]! + MIN_GAP);
  for (let i = pos.length - 1; i >= 0; i--)
    pos[i] = Math.min(pos[i]!, i === pos.length - 1 ? 100 - EDGE : pos[i + 1]! - MIN_GAP);
  const anchors = [
    { v: lo, p: 0 },
    ...values.map((v, i) => ({ v, p: pos[i]! })),
    { v: hi, p: 100 },
  ];
  const at = (value: number) => {
    let p = raw(value);
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]!;
      const b = anchors[i]!;
      if (value <= b.v) {
        p = b.v === a.v ? b.p : a.p + ((value - a.v) / (b.v - a.v)) * (b.p - a.p);
        break;
      }
    }
    return `${Math.min(100, Math.max(0, p)).toFixed(1)}%`;
  };

  const marks: Mark[] = [];
  // Two targets on effectively the same level become one mark, so the rail
  // doesn't show two labels fighting over the same spot.
  const oneTarget = mergedTargetPrice(target, longTarget);
  if (oneTarget != null) {
    marks.push({
      value: oneTarget,
      label: `الهدف ${fmt(oneTarget)}`,
      dot: "bg-up",
      text: "text-up",
    });
  } else {
    if (longTarget != null && (!target || longTarget > target * 1.01))
      marks.push({
        value: longTarget,
        label: `هدف بعيد ${fmt(longTarget)}`,
        dot: "bg-up",
        text: "text-up",
      });
    if (target != null)
      marks.push({
        value: target,
        label: `هدف متوسط ${fmt(target)}`,
        dot: "bg-up",
        text: "text-up",
      });
  }
  if (cost != null)
    marks.push({
      value: cost,
      label: `شراء ${fmt(cost)}`,
      dot: "bg-primary",
      text: "text-primary",
    });
  if (stop != null)
    marks.push({
      value: stop,
      label: `وقف ${fmt(stop)}`,
      dot: "bg-down",
      text: "text-down",
    });

  const gradient =
    cost != null && stop != null && cost > stop
      ? `linear-gradient(to right, var(--down-soft) 0%, var(--down-soft) ${at(stop)}, var(--surface-2) ${at(stop)}, var(--surface-2) ${at(cost)}, var(--up-soft) ${at(cost)}, var(--up-soft) 100%)`
      : `linear-gradient(to right, var(--down-soft) 0%, var(--down-soft) ${at(stop ?? lo)}, var(--up-soft) ${at(stop ?? lo)}, var(--up-soft) 100%)`;

  // When two legend values are visually close — e.g. a trailing stop sitting
  // right under the cost — drop every other one to a second row so the
  // rounded pills don't overlap. The current price has its own tag above the
  // rail, so it never competes with the pills below it.
  const thresholdPct = 14;
  const sorted = marks
    .map((m) => ({ key: m.label, at: parseFloat(at(m.value)) }))
    .sort((a, b) => a.at - b.at);
  const staggerByKey = new Map<string, boolean>();
  let prevFlag = false;
  for (let i = 1; i < sorted.length; i++) {
    const close = Math.abs(sorted[i]!.at - sorted[i - 1]!.at) < thresholdPct;
    const flag = close ? !prevFlag : false;
    staggerByKey.set(sorted[i]!.key, flag);
    prevFlag = flag;
  }
  const staggered = marks.map((m) => staggerByKey.get(m.label) ?? false);
  const needsStagger = staggered.some(Boolean);

  const railLine = (
    <div className={cn("relative", !compact && "pt-10")}>
      <div className="relative">
        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full border"
          style={{ background: gradient }}
          role="img"
          aria-label={`السعر ${fmt(price)} بين وقف ${fmt(stop)} وهدف ${fmt(target)}`}
        >
          {marks.map((mark) => (
            <span
              key={mark.label}
              className={cn("absolute top-0 h-full w-[2px] -translate-x-1/2", mark.dot)}
              style={{ left: at(mark.value) }}
            />
          ))}
        </div>
        {/* Current price: kept outside the clipped bar and drawn last so the
            level ticks never cover it. */}
        <span
          className="pointer-events-none absolute top-1/2 z-10 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: at(price) }}
        />
        <span
          className="pointer-events-none absolute top-1/2 z-10 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-background bg-foreground shadow-md ring-[3px] ring-foreground/25"
          style={{ left: at(price) }}
        />
        {!compact && (
          <div
            className="pointer-events-none absolute bottom-[calc(100%+14px)] z-10 -translate-x-1/2"
            style={{ left: at(price) }}
          >
            <div className="flex min-w-max items-center gap-1 rounded-md bg-foreground px-2 py-0.5 text-[11px] text-background shadow-sm">
              <span className="opacity-75">الآن</span>
              <span className="num font-semibold">{fmt(price)}</span>
            </div>
            <span className="absolute top-full left-1/2 size-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-foreground" />
          </div>
        )}
      </div>
    </div>
  );

  const legendPills = marks.map((mark, i) => {
    const labelText = mark.label.replace(/\s[\d.,]+$/, "");
    return (
      <div
        key={mark.label}
        className={cn(
          "absolute -translate-x-1/2 rounded-full border border-border/60 bg-surface px-3 py-1.5 shadow-sm min-w-max text-center",
          mark.text,
        )}
        style={{ left: at(mark.value), top: staggered[i] ? "3rem" : 0 }}
      >
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-1">
            <span className={cn("size-2 rounded-full", mark.dot)} />
            <span className="text-muted-foreground whitespace-nowrap">{labelText}</span>
          </div>
          <span className="num font-medium leading-none">{fmt(mark.value)}</span>
        </div>
      </div>
    );
  });

  return (
    <div className={cn("space-y-4 px-2", className)}>
      {railLine}
      {!compact && (
        <div className={cn("relative text-[11px]", needsStagger ? "h-[5.75rem]" : "h-11")}>
          {legendPills}
        </div>
      )}
    </div>
  );
}
