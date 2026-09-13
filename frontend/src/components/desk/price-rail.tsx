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
  // The tactical stop is the one that actually triggers first (computeLongTermStop
  // never sets longStop above it), so it always gets its own mark. The long-term
  // stop only earns a second mark when it sits meaningfully further out — right on
  // top of the tactical stop it would just be a redundant label at the same pixel.
  if (stop != null)
    marks.push({
      value: stop,
      label: `وقف ${fmt(stop)}`,
      dot: "bg-down",
      text: "text-down",
    });
  if (longStop != null && (stop == null || (stop - longStop) / price > 0.005))
    marks.push({
      value: longStop,
      label: `وقف بعيد ${fmt(longStop)}`,
      dot: "bg-down",
      text: "text-down",
    });

  const gradient =
    cost != null && stop != null && cost > stop
      ? `linear-gradient(to right, var(--down-soft) 0%, var(--down-soft) ${at(stop)}, var(--surface-2) ${at(stop)}, var(--surface-2) ${at(cost)}, var(--up-soft) ${at(cost)}, var(--up-soft) 100%)`
      : `linear-gradient(to right, var(--down-soft) 0%, var(--down-soft) ${at(stop ?? lo)}, var(--up-soft) ${at(stop ?? lo)}, var(--up-soft) 100%)`;

  // When two legend values are visually close — including a stop that has
  // trailed up right next to the current price, e.g. a fresh trailing stop
  // sitting a percent below a live position — stagger them vertically so the
  // rounded pills (and the current-price dot) do not overlap. The price has
  // no pill of its own but still needs to take part in the collision check,
  // otherwise a stop pill can land directly under the price dot and become
  // unreadable.
  const thresholdPct = 14;
  const sortedWithPrice = [
    ...marks.map((m) => ({ key: m.label, at: parseFloat(at(m.value)) })),
    { key: "__price__", at: parseFloat(at(price)) },
  ].sort((a, b) => a.at - b.at);
  const staggerByKey = new Map<string, boolean>();
  let prevFlag = false;
  for (let i = 1; i < sortedWithPrice.length; i++) {
    const close = Math.abs(sortedWithPrice[i]!.at - sortedWithPrice[i - 1]!.at) < thresholdPct;
    const flag = close ? !prevFlag : false;
    if (sortedWithPrice[i]!.key !== "__price__") staggerByKey.set(sortedWithPrice[i]!.key, flag);
    prevFlag = flag;
  }
  const staggered = marks.map((m) => staggerByKey.get(m.label) ?? false);
  const needsStagger = staggered.some(Boolean);

  const railLine = (
    <div
      className="relative h-2.5 w-full overflow-hidden rounded-full border"
      style={{ background: gradient }}
      role="img"
      aria-label={`السعر ${fmt(price)} بين وقف ${fmt(stop)} وهدف ${fmt(target)}`}
    >
      <span
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm"
        style={{ left: at(price) }}
      />
      {marks.map((mark) => (
        <span
          key={mark.label}
          className={cn("absolute top-0 h-full w-[2px] -translate-x-1/2", mark.dot)}
          style={{ left: at(mark.value) }}
        />
      ))}
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
            <span
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm"
              style={{ left: at(price) }}
            />
            {marks.map((mark) => (
              <span
                key={`line-${mark.label}`}
                className={cn("absolute top-0 h-full w-[2px] -translate-x-1/2", mark.dot)}
                style={{ left: at(mark.value) }}
              />
            ))}
          </div>
          {legendPills(true)}
        </div>
      ) : (
        <>
          {railLine}
          {!compact && <div className="relative min-h-9 text-[11px]">{legendPills(false)}</div>}
        </>
      )}
    </div>
  );
}
