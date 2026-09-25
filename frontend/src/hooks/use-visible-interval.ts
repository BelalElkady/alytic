import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `ms` while the tab is visible, and once right away
 * when a hidden tab comes back into view so it catches up on what it skipped.
 * Hidden tabs skip their ticks: every poll is a backend request that reads
 * Supabase at least once (the session lookup alone), and a forgotten
 * background tab polling around the clock is what pushed the project past its
 * log-ingestion quota. Doesn't fire on mount — callers do their own first
 * load. Always calls the latest `callback`, so it needn't be memoised.
 */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true) {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (!document.hidden) latest.current();
    };
    const timer = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, enabled]);
}
