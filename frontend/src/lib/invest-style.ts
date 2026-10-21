import { useEffect, useMemo, useState } from "react";

import { fmt } from "@/lib/format";

export type StyleKey = "trader" | "medium" | "long";

export const STYLE_STORAGE_KEY = "alytic-invest-style";
const STYLE_EVENT = "alytic-invest-style-change";

export const INVEST_STYLES: {
  key: StyleKey;
  label: string;
  horizon: string;
  description: string;
}[] = [
  {
    key: "trader",
    label: "مضارب",
    horizon: "أيام",
    description: "أسلوب المضارب — أفق أيام، خروج سريع وأهداف قريبة.",
  },
  {
    key: "medium",
    label: "متوسط المدى",
    horizon: "أسابيع",
    description: "أسلوب متوسط المدى — أفق أسابيع لشهور.",
  },
  {
    key: "long",
    label: "طويل المدى",
    horizon: "شهور",
    description: "أسلوب طويل المدى — أفق شهور، صبر أكبر وأهداف أوسع.",
  },
];

export type StyleRules = {
  trailing: { trailPct: number; activateAtProfitPct: number };
  takeProfit: {
    partialAtProfitPct: number;
    partialFraction: number;
    limitAbovePricePct: number;
    atTargetFraction: number;
    raiseStopAfterTargetPct: number;
  };
  entry: { minRiskReward: number };
  sizing: { riskPerTradePct: number; maxPositionPct: number };
  nearStopPct: number;
};

export const STYLE_RULES: Record<StyleKey, StyleRules> = {
  trader: {
    trailing: { trailPct: 4, activateAtProfitPct: 4 },
    takeProfit: {
      partialAtProfitPct: 6,
      partialFraction: 0.5,
      limitAbovePricePct: 1,
      atTargetFraction: 0.5,
      raiseStopAfterTargetPct: 4,
    },
    entry: { minRiskReward: 1.5 },
    sizing: { riskPerTradePct: 1, maxPositionPct: 10 },
    nearStopPct: 2,
  },
  medium: {
    trailing: { trailPct: 8, activateAtProfitPct: 12 },
    takeProfit: {
      partialAtProfitPct: 15,
      partialFraction: 0.3,
      limitAbovePricePct: 2,
      atTargetFraction: 1 / 3,
      raiseStopAfterTargetPct: 8,
    },
    entry: { minRiskReward: 1.8 },
    sizing: { riskPerTradePct: 1.5, maxPositionPct: 15 },
    nearStopPct: 3,
  },
  long: {
    trailing: { trailPct: 12, activateAtProfitPct: 20 },
    takeProfit: {
      partialAtProfitPct: 25,
      partialFraction: 0.25,
      limitAbovePricePct: 2,
      atTargetFraction: 0.25,
      raiseStopAfterTargetPct: 12,
    },
    entry: { minRiskReward: 2.2 },
    sizing: { riskPerTradePct: 2, maxPositionPct: 20 },
    nearStopPct: 5,
  },
};

export const isStyleKey = (value: unknown): value is StyleKey =>
  value === "trader" || value === "medium" || value === "long";

/** The style picked by hand on this device, or null in auto mode. */
export function explicitInvestStyle(): StyleKey | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(STYLE_STORAGE_KEY);
  return isStyleKey(saved) ? saved : null;
}

function read(): StyleKey {
  return explicitInvestStyle() ?? "medium";
}

export function setInvestStyle(next: StyleKey) {
  window.localStorage.setItem(STYLE_STORAGE_KEY, next);
  window.dispatchEvent(new CustomEvent(STYLE_EVENT, { detail: next }));
}

/** Drops back to auto mode — the behaviour inferred from trade history decides the style again. */
export function clearInvestStyle() {
  window.localStorage.removeItem(STYLE_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(STYLE_EVENT, { detail: null }));
}

/** True once the user has picked a style by hand — as opposed to it defaulting from behaviour or "medium". */
export function hasExplicitInvestStyle(): boolean {
  return explicitInvestStyle() !== null;
}

/** Reactive read of the chosen behaviour, synced across pages/tabs. */
export function useInvestStyle(): StyleKey {
  const [style, setStyle] = useState<StyleKey>("medium");
  useEffect(() => {
    setStyle(read());
    const sync = () => setStyle(read());
    window.addEventListener(STYLE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(STYLE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return style;
}

export type Trade = {
  date: string;
  code: string;
  side: "buy" | "sell" | "dividend" | "rights_sale";
  shares: number;
};

// Fewer completed round trips than this and there isn't enough history to
// read behaviour from — stick with the manual/default style instead of
// guessing off one or two trades.
export const MIN_CLOSED_TRADES = 3;
const TRADER_MAX_AVG_DAYS = 10;
const MEDIUM_MAX_AVG_DAYS = 60;

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 86_400_000) : 0;
}

/**
 * Classifies trading behaviour from how long positions are actually held —
 * each sell is FIFO-matched against the earliest open buy lots for that
 * code, and the share-weighted average holding period is bucketed against
 * the same horizons INVEST_STYLES describes (days / weeks / months). Returns
 * null when there's fewer than MIN_CLOSED_TRADES closed round trips, so
 * callers can fall back to the manual choice or the "medium" default.
 */
export function inferInvestStyle(trades: Trade[] | null | undefined): StyleKey | null {
  if (!trades?.length) return null;
  const openLots: Record<string, { shares: number; date: string }[]> = {};
  let weightedDays = 0;
  let matchedShares = 0;
  let closedTrips = 0;

  for (const t of [...trades].sort((a, b) => a.date.localeCompare(b.date))) {
    const lots = (openLots[t.code] ??= []);
    if (t.side === "buy") {
      lots.push({ shares: t.shares, date: t.date });
      continue;
    }
    if (t.side !== "sell") continue;
    let remaining = t.shares;
    while (remaining > 0 && lots.length) {
      const lot = lots[0]!;
      const matched = Math.min(remaining, lot.shares);
      weightedDays += daysBetween(lot.date, t.date) * matched;
      matchedShares += matched;
      remaining -= matched;
      lot.shares -= matched;
      if (lot.shares <= 0) lots.shift();
    }
    closedTrips += 1;
  }

  if (closedTrips < MIN_CLOSED_TRADES || matchedShares === 0) return null;
  const avgDays = weightedDays / matchedShares;
  if (avgDays < TRADER_MAX_AVG_DAYS) return "trader";
  if (avgDays < MEDIUM_MAX_AVG_DAYS) return "medium";
  return "long";
}

export type ActiveInvestStyle = {
  /** The style to actually use — the manual pick if there is one, otherwise the inferred (or default) one. */
  style: StyleKey;
  /** True while no manual choice has been made, i.e. `style` is behaviour-derived. */
  auto: boolean;
  /** What behaviour alone would suggest, independent of any manual pick — null with too little trade history. */
  inferred: StyleKey | null;
};

/**
 * The style that should actually drive recommendations: an explicit choice
 * from the settings page always wins, but until one is made this reads the
 * user's own trade history instead of silently defaulting to "medium".
 */
export function useActiveInvestStyle(trades: Trade[] | null | undefined): ActiveInvestStyle {
  const manual = useInvestStyle();
  const [explicit, setExplicit] = useState(hasExplicitInvestStyle());
  useEffect(() => {
    const sync = () => setExplicit(hasExplicitInvestStyle());
    sync();
    window.addEventListener(STYLE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(STYLE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const inferred = useMemo(() => inferInvestStyle(trades), [trades]);
  return { style: explicit ? manual : (inferred ?? manual), auto: !explicit, inferred };
}

export type Recommendation = {
  action: string;
  label: string;
  text: string;
  order: { side: "buy" | "sell"; qty: number; price: number } | null;
};

/**
 * Re-derives the standing recommendation for an open position using the rule
 * numbers of the chosen behaviour. Mirrors the server's severity order; the
 * server's own verdict is used as-is for cases the rules don't parameterise.
 */
export function styleRecommendation(
  row: {
    price?: number;
    midTarget?: { price?: number } | null;
    longTarget?: { price?: number } | null;
    /** Set by the server when the stock isn't trading (suspended) — see tradingHalted in backend/src/data/cache.js. */
    halted?: { since: string } | null;
  },
  position: {
    avgCost?: number;
    shares?: number;
    stop?: number;
    unrealizedPct?: number;
    distanceToStopPct?: number;
    stopBreached?: boolean;
    /** The level the target actually shown now sits at — the new one, once a passed target was replaced. */
    targetLevel?: number | null;
    /** Set while the live price is past the target the analysis first picked; `next` is what replaced it. */
    reachedTarget?: { price: number; next?: number | null } | null;
    trailing?: { active?: boolean } | null;
    partialTaken?: boolean;
    recommendation?: Recommendation | null;
  },
  style: StyleKey,
): Recommendation {
  const fallback: Recommendation = position.recommendation ?? {
    action: "hold",
    label: "احتفاظ",
    text: "التوصية مش متاحة — أعد تشغيل الخادم.",
    order: null,
  };

  // Nothing can be bought or sold until it reopens, so no rule applies.
  if (row.halted) {
    return {
      action: "halted",
      label: "موقوف عن التداول",
      text: `السهم مفيهوش تداول من ${row.halted.since} — غالبًا موقوف. مفيش أمر هيتنفذ دلوقتي، استنى لحد ما التداول يرجع.`,
      order: null,
    };
  }

  const rules = STYLE_RULES[style];
  const price = row.price;
  const shares = position.shares;
  const stop = position.stop;
  const profitPct = position.unrealizedPct;
  // Mirrors the server's governingTarget (analyze.js, driven by
  // config/styles.js OVERRIDES.long) — the long style judges "reached
  // target" by the long-horizon target, every other style by the mid one.
  // Once the price passes a target the server sets a new one and the row's
  // targets move up to it — the level that was passed is still the one this
  // rule judges "reached" by, so it is read from `reachedTarget` first.
  const target =
    position.reachedTarget?.price ??
    (style === "long" ? (row.longTarget?.price ?? row.midTarget?.price) : row.midTarget?.price);
  if (price == null || shares == null || !shares || profitPct == null) return fallback;

  // 1. Stop breached — nothing else matters.
  if (position.stopBreached || (stop != null && price < stop)) return fallback;

  // 2. Mid target reached — scale out by the behaviour's fraction.
  if (target != null && price >= target) {
    const qty = Math.floor(shares * rules.takeProfit.atTargetFraction);
    return {
      action: "take_target",
      label: "جني أرباح",
      text:
        `وصل الهدف ${fmt(target)}. بيع ${qty} سهم وارفع الوقف للباقي لـ ${fmt(
          price * (1 - rules.takeProfit.raiseStopAfterTargetPct / 100),
        )}.` +
        (position.reachedTarget?.next != null ? ` الهدف الجديد للباقي: ${fmt(position.reachedTarget.next)}.` : ""),
      order: { side: "sell", qty, price },
    };
  }

  // 3. Enough profit to bank some, once per position.
  if (profitPct >= rules.takeProfit.partialAtProfitPct && !position.partialTaken) {
    const qty = Math.round(shares * rules.takeProfit.partialFraction);
    const limit = price * (1 + rules.takeProfit.limitAbovePricePct / 100);
    return {
      action: "sell_part",
      label: "بيع جزئي",
      text: `مربح ${fmt(profitPct)}% — أمّن جزء. بيع ${qty} سهم بأمر محدد عند ${fmt(
        limit,
      )} (صلاحية أسبوع). الباقي بوقف متحرك ${rules.trailing.trailPct}%.`,
      order: { side: "sell", qty, price: limit },
    };
  }

  // 4. Close to the stop — a warning, not an action.
  if ((position.distanceToStopPct ?? 99) <= rules.nearStopPct) {
    return {
      action: "hold",
      label: "احتفاظ",
      text: `قريب من الوقف (${fmt(position.distanceToStopPct ?? 0)}% بس). احتفظ، بس إغلاق تحت ${fmt(
        stop ?? 0,
      )} يبقى خروج كامل.`,
      order: null,
    };
  }

  // R7 (trailing its index) needs index history the page doesn't have — the
  // server's verdict stands, like a leader's buy_more.
  if (fallback.action === "buy_more" || fallback.action === "trim_weak") return fallback;

  // 5. Nothing to do.
  const trailNote =
    profitPct >= rules.trailing.activateAtProfitPct
      ? ` الوقف المتحرك مفعّل على مسافة ${rules.trailing.trailPct}%.`
      : "";
  return {
    action: "hold",
    label: "احتفاظ",
    text: `${profitPct >= 0 ? "مربح" : "خاسر"} ${fmt(Math.abs(profitPct))}% وداخل النطاق. الحركة هادية ومش محتاجة أي قرار.${trailNote}`,
    order: null,
  };
}
