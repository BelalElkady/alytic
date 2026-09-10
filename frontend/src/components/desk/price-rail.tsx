import { fmt } from "@/lib/format";
import { mergedTargetPrice } from "@/lib/targets";
import { cn } from "@/lib/utils";

type RailProps = {
  price?: number | null | undefined;
  stop?: number | null | undefined;
  cost?: number | null | undefined;
  target?: number | null | undefined;
  longStop?: number | null | undefined;
  longTarget?: number | null | undefined;
  className?: string | undefined;
  compact?: boolean | undefined;
};

type Mark = { value: number; label: string; dot: string; text: string };

/**
 * Price vs stop / cost / targets, on one line.
 * Same four levels the previous rail showed; the labels moved into a legend
 * underneath so nothing overlaps on narrow screens.
 */
export function PriceRail({
  price,
  stop,
  cost,
  target,
  longStop,
  longTarget,
  className,
  compact = false,
}: RailProps) {
  const lows = [stop, cost, price, longStop].filter((v): v is number => v != null);
  const highs = [target, longTarget, price].filter((v): v is number => v != null);
  if (!lows.length || !highs.length || price == null) return null;

  const lo = Math.min(...lows) * 0.96;
  const hi = Math.max(...highs) * 1.04;
  const span = hi - lo || 1;
  const at = (value: number) => `${(((value - lo) / span) * 100).toFixed(1)}%`;

  const marks: Mark[] = [];
  // Two targets on effectively the same level become one mark, so the rail
  // doesn't show two labels fighting over the same spot.
  const oneTarget = mergedTargetPrice(target, longTarget);
  if (oneTarget != null) {
    marks.push({ value: oneTarget, label: `الهدف ${fmt(oneTarget)}`, dot: "bg-up", text: "text-up" });
  } else {
    if (longTarget != null && (!target || longTarget > target * 1.01))
      marks.push({
        value: longTarget,
        label: `هدف بعيد ${fmt(longTarget)}`,
        dot: "bg-up",
        text: "text-up",
      });
    if (target != null)
      marks.push({ value: target, label: `هدف متوسط ${fmt(target)}`, dot: "bg-up", text: "text-up" });
  }
  if (cost != null)
    marks.push({
      value: cost,
      label: `شراء ${fmt(cost)}`,
      dot: "bg-primary",
      text: "text-primary",
    });
  if (longStop != null)
    marks.push({
      value: longStop,
      label: `وقف الخسارة ${fmt(longStop)}`,
      dot: "bg-down",
      text: "text-down",
    });

  const gradient =
    cost != null && stop != null && cost > stop
      ? `linear-gradient(to right, var(--down-soft) 0%, var(--down-soft) ${at(stop)}, var(--surface-2) ${at(stop)}, var(--surface-2) ${at(cost)}, var(--up-soft) ${at(cost)}, var(--up-soft) 100%)`
      : `linear-gradient(to right, var(--down-soft) 0%, var(--down-soft) ${at(stop ?? lo)}, var(--up-soft) ${at(stop ?? lo)}, var(--up-soft) 100%)`;

  // When two legend values are visually close, stagger them vertically so
  // the rounded pills do not overlap.
  const positions = marks.map((m) => parseFloat(at(m.value)));
  const thresholdPct = 14;
  const staggered = new Array<boolean>(marks.length).fill(false);
  for (let i = 1; i < positions.length; i++) {
    if (Math.abs(positions[i]! - positions[i - 1]!) < thresholdPct) {
      staggered[i] = !staggered[i - 1]!;
    }
  }
  const needsStagger = staggered.some(Boolean);

  const railLine = (
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
      <span
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm"
        style={{ left: at(price) }}
      />
    </div>
  );

  const legendPills = (aboveBelow: boolean) =>
    marks.map((mark, i) => {
      const labelText = mark.label.replace(/\s[\d.,]+$/, "");
      const stagger = staggered[i];
      return (
        <div
          key={mark.label}
          className={cn(
            "absolute -translate-x-1/2 rounded-full border border-border/60 bg-surface px-3 py-1.5 shadow-sm min-w-max text-center",
            mark.text,
          )}
          style={{
            left: at(mark.value),
            ...(aboveBelow && stagger
              ? { bottom: "calc(50% + 8px)" }
              : aboveBelow
                ? { top: "calc(50% + 8px)" }
                : { top: 0 }),
          }}
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
    <div className={cn("space-y-2 px-2", className)}>
      {needsStagger && !compact ? (
        <div className="relative h-20 text-[11px]">
          <div
            className="absolute top-1/2 left-0 right-0 h-2.5 -translate-y-1/2 overflow-hidden rounded-full border"
            style={{ background: gradient }}
            role="img"
            aria-label={`السعر ${fmt(price)} بين وقف ${fmt(stop)} وهدف ${fmt(target)}`}
          >
            {marks.map((mark) => (
              <span
                key={`line-${mark.label}`}
                className={cn("absolute top-0 h-full w-[2px] -translate-x-1/2", mark.dot)}
                style={{ left: at(mark.value) }}
              />
            ))}
            <span
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm"
              style={{ left: at(price) }}
            />
          </div>
          {legendPills(true)}
        </div>
      ) : (
        <>
          {railLine}
          {!compact && (
            <div className="relative min-h-9 text-[11px]">{legendPills(false)}</div>
          )}
        </>
      )}
    </div>
  );
}
