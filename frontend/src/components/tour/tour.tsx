import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TourStep = {
  /**
   * The `data-tour` value of the part this step points at. Left out, the step
   * is a plain box in the middle of the screen (a welcome or a closing note).
   */
  target?: string;
  title: string;
  body: string;
};

type Rect = { top: number; left: number; width: number; height: number };

const PADDING = 6;
const GAP = 12;
const BOX_WIDTH = 340;

/** The first element carrying this `data-tour` value that is actually on screen — the same part can exist twice (desktop and mobile navigation), with one hidden. */
function findTarget(target: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

/**
 * A guided tour: dims the page, outlines one part at a time and explains it
 * in a box with back/next. A step whose part isn't on the page (no open
 * positions yet, a single wallet) is skipped rather than pointed at nothing.
 * The page underneath can't be clicked while it runs.
 */
export function Tour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  // Resolved when the tour opens: which steps have something to point at.
  const [available, setAvailable] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!open) return;
    setAvailable(steps.filter((step) => !step.target || findTarget(step.target)));
    setIndex(0);
  }, [open, steps]);

  const step = available[index];

  const measure = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    const element = step?.target ? findTarget(step.target) : null;
    if (!element) return setRect(null);
    const box = element.getBoundingClientRect();
    setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
  }, [step]);

  // Bring the part into view, then keep the outline on it while the page
  // scrolls or resizes underneath.
  useLayoutEffect(() => {
    if (!open || !step) return;
    const element = step.target ? findTarget(step.target) : null;
    element?.scrollIntoView({ block: "center", inline: "nearest" });
    measure();
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    // Smooth scrolling and late layout settle after the first measure.
    const settle = window.setInterval(measure, 200);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.clearInterval(settle);
    };
  }, [open, step, measure]);

  const last = index >= available.length - 1;
  const next = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "Enter") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, onClose]);

  // On a phone the box docks to the bottom edge (or the top, when the part it
  // describes is down there); on a wider screen it sits beside the part.
  const boxStyle = useMemo(() => {
    if (!viewport.width) return { visibility: "hidden" as const };
    const narrow = viewport.width < 640;
    if (!rect) {
      return narrow
        ? { left: 12, right: 12, top: "50%", transform: "translateY(-50%)" }
        : { left: "50%", top: "50%", width: BOX_WIDTH, transform: "translate(-50%, -50%)" };
    }
    const inLowerHalf = rect.top + rect.height / 2 > viewport.height / 2;
    if (narrow) return inLowerHalf ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - BOX_WIDTH / 2), viewport.width - BOX_WIDTH - 12);
    return inLowerHalf
      ? { left, width: BOX_WIDTH, bottom: viewport.height - rect.top + PADDING + GAP }
      : { left, width: BOX_WIDTH, top: rect.top + rect.height + PADDING + GAP };
  }, [rect, viewport]);

  if (!open || !step || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={step.title} dir="rtl">
      {/* Takes every click, so nothing underneath reacts while the tour runs. */}
      <div className={cn("absolute inset-0", !rect && "bg-black/60")} />
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-all duration-200"
          style={{
            top: rect.top - PADDING,
            left: rect.left - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
            // The dimmed page is this outline's own shadow, so the part itself stays lit.
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
          }}
        />
      )}

      <div className="absolute rounded-2xl border bg-card p-4 text-start shadow-xl" style={boxStyle}>
        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          <span className="num">
            {int(index + 1)} من {int(available.length)}
          </span>
          <button type="button" className="font-medium hover:text-foreground" onClick={onClose}>
            تخطّي
          </button>
        </div>
        <h2 className="mt-2 text-[16px] font-semibold">{step.title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-3 flex items-center gap-1" aria-hidden>
          {available.map((item, i) => (
            <span
              key={item.title}
              className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-primary" : "w-1.5 bg-border")}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" onClick={next} autoFocus>
            {last ? "تمام" : "التالي"}
          </Button>
          {index > 0 && (
            <Button size="sm" variant="outline" onClick={back}>
              رجوع
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
