import { createContext, useContext } from "react";

import type { User } from "@/lib/store";

export type LockKind = "page" | "panel";

/** A page or panel the signed-in account's tier is locked out of; `upgradeTo` is the cheapest tier that opens it. */
export type FeatureLock = { upgradeTo: string | null };

/** Arabic names of the lockable pages, as the nav shows them. */
export const PAGE_LABELS: Record<string, string> = {
  market: "السوق",
  indices: "المؤشرات",
  targets: "الأهداف",
  calendar: "التقويم",
  charts: "الرسوم",
  cash: "تحليل الكاش",
  stock: "صفحة السهم",
};

/** The page key a desk URL belongs to ("/stock/COMI" is the "stock" page), or null for pages that can't be locked. */
export function pageKeyForPath(pathname: string): string | null {
  const first = pathname.split("/").filter(Boolean)[0];
  return first && ["market", "indices", "targets", "calendar", "charts", "cash", "stock"].includes(first)
    ? first
    : null;
}

export function lockFor(
  user: Pick<User, "locked" | "unlockWith"> | null | undefined,
  kind: LockKind,
  key: string | null,
): FeatureLock | null {
  if (!key) return null;
  const group = kind === "page" ? "pages" : "panels";
  if (!user?.locked?.[group]?.includes(key)) return null;
  return { upgradeTo: user.unlockWith?.[group]?.[key]?.name ?? null };
}

/**
 * The signed-in user as far as locks go. DeskProvider fills it; it lives here,
 * not in the store, so a panel that checks its lock doesn't pull the whole desk
 * store in — and renders as unlocked on its own (tests, previews).
 */
// eslint-disable-next-line react-refresh/only-export-components
export const FeatureLockContext = createContext<Pick<User, "locked" | "unlockWith"> | null>(null);

/** Whether the current account's tier locks this page or panel. Null when it doesn't, and outside the desk. */
export function useFeatureLock(kind: LockKind, key: string | null): FeatureLock | null {
  return lockFor(useContext(FeatureLockContext), kind, key);
}
