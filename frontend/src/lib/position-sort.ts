import { useEffect, useState } from "react";
import type { Portfolio, Row } from "@/lib/store";

/** How the portfolio page orders its Positions. "added" is Order added (see CONTEXT.md). */
export type PositionSortKey = "added" | "profitPct" | "profitEgp" | "marketValue" | "changePct" | "score";
/** "natural" is each option's own default: arrival order for "added", highest first for the rest. */
export type PositionSortDirection = "natural" | "reversed";
export type PositionSort = { key: PositionSortKey; direction: PositionSortDirection };

export const POSITION_SORT_OPTIONS: { key: PositionSortKey; label: string }[] = [
  { key: "added", label: "ترتيب الإضافة" },
  { key: "profitPct", label: "الربح %" },
  { key: "profitEgp", label: "الربح (ج.م)" },
  { key: "marketValue", label: "القيمة السوقية" },
  { key: "changePct", label: "تغير اليوم %" },
  { key: "score", label: "التقييم الفني" },
];

const DEFAULT_SORT: PositionSort = { key: "added", direction: "natural" };
const STORAGE_KEY = "alytic-positions-sort";

const numberOrNull = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

const VALUE_OF: Record<Exclude<PositionSortKey, "added">, (row: Row) => number | null> = {
  profitPct: (row) => numberOrNull(row.position?.unrealizedPct),
  profitEgp: (row) => numberOrNull(row.position?.unrealizedEgp),
  marketValue: (row) => numberOrNull(row.position?.marketValue),
  changePct: (row) => numberOrNull(row.changePct),
  score: (row) => numberOrNull(row.score),
};

/**
 * Orders rows by the chosen sort. Order added reads the stored addedOrder; a
 * position the server hasn't stamped yet falls back to the day it was opened,
 * then its code. Rows with no value for a value sort go last in either
 * direction, in Order added among themselves.
 */
export function sortPositions(rows: Row[], pf: Portfolio, sort: PositionSort): Row[] {
  const held = pf?.positions ?? {};
  const byAdded = (a: Row, b: Row) => {
    const pa = held[a.code] ?? {};
    const pb = held[b.code] ?? {};
    const oa = numberOrNull(pa.addedOrder);
    const ob = numberOrNull(pb.addedOrder);
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    if ((oa == null) !== (ob == null)) return oa == null ? 1 : -1;
    return String(pa.openedAt ?? "").localeCompare(String(pb.openedAt ?? "")) || a.code.localeCompare(b.code);
  };
  const sign = sort.direction === "reversed" ? -1 : 1;

  if (sort.key === "added") return [...rows].sort((a, b) => sign * byAdded(a, b));

  const valueOf = VALUE_OF[sort.key];
  return [...rows].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va == null || vb == null) return va == null && vb == null ? byAdded(a, b) : va == null ? 1 : -1;
    return sign * (vb - va) || byAdded(a, b);
  });
}

function readSort(): PositionSort {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      POSITION_SORT_OPTIONS.some((option) => option.key === saved?.key) &&
      (saved.direction === "natural" || saved.direction === "reversed")
    ) {
      return { key: saved.key, direction: saved.direction };
    }
  } catch {
    // Unreadable or blocked storage: the default below.
  }
  return DEFAULT_SORT;
}

/** The chosen sort, remembered per device. */
export function usePositionSort() {
  const [sort, setSortState] = useState<PositionSort>(DEFAULT_SORT);
  useEffect(() => setSortState(readSort()), []);
  const setSort = (next: PositionSort) => {
    setSortState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not remembered on this device; the page still sorts.
    }
  };
  return { sort, setSort };
}
