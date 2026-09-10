/**
 * When the two computed targets are really one target.
 *
 * The engine derives them from different models: the mid-horizon target is
 * anchored to nearby structure (a resistance cluster, a measured move), the
 * long-horizon one to a Fibonacci extension or a decayed trend projection.
 * They are genuinely two computations — but when they land on effectively the
 * same level, presenting them as two separate targets is noise: reaching one
 * is reaching the other.
 *
 * The two directions are treated differently on purpose:
 *   - Long at or below mid always collapses, however far apart the two are.
 *     A "long-term" target that's nearer than the "medium-term" one isn't a
 *     second, more ambitious goal — it's the same goal on a shorter fuse, and
 *     showing it as a separate further-out target would say the opposite of
 *     what the numbers mean.
 *   - Long above mid only collapses within a threshold — there it *is* a
 *     more ambitious goal, just not one worth a second row when it's barely
 *     past the first.
 *
 * This is presentation only. Nothing here recomputes or overrides a number;
 * both targets stay in the payload exactly as the engine produced them.
 */
export const SAME_TARGET_THRESHOLD_PCT = 8;

/** The fields either target carries that the UI actually reads. */
export type Target =
  | {
      price?: number | null;
      upsidePct?: number | null;
      basis?: string;
      horizon?: { ar?: string };
      /** Mid-horizon targets only — the long one carries no reward ratio. */
      riskReward?: number | null;
      /** Long-horizon targets only, when the engine declined to project one. */
      note?: string;
      caveat?: string;
    }
  | null
  | undefined;

/**
 * The single target to show as «الهدف», or null when the two are far enough
 * apart (and long is genuinely the further-out one) to stay separate.
 *
 * When they collapse, the *nearer* of the two wins: that is the level price
 * actually reaches first, so the displayed upside is never overstated. The
 * chosen object is returned whole, so its price, basis and horizon stay
 * internally consistent with each other.
 */
export function mergedTarget(mid: Target, long: Target): Target {
  if (mergedTargetPrice(mid?.price, long?.price) == null) return null;
  return (long?.price as number) <= (mid?.price as number) ? long : mid;
}

/**
 * Price-level form of {@link mergedTarget}, for callers holding only the two
 * numbers (the price rail). Returns the single price to draw, or null when
 * both marks should stay.
 */
export function mergedTargetPrice(mid?: number | null, long?: number | null): number | null {
  if (!mid || !long) return null;
  if (long <= mid) return long;
  if ((long - mid) / mid > SAME_TARGET_THRESHOLD_PCT / 100) return null;
  return mid;
}
