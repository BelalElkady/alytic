import { useEffect, useState } from "react";

export type StyleKey = "trader" | "medium" | "long";

export const STYLE_STORAGE_KEY = "alytic-invest-style";
const STYLE_EVENT = "alytic-invest-style-change";

export const INVEST_STYLES: { key: StyleKey; label: string; horizon: string; description: string }[] = [
  { key: "trader", label: "مضارب", horizon: "أيام", description: "أسلوب المضارب — أفق أيام، خروج سريع وأهداف قريبة." },
  { key: "medium", label: "متوسط المدى", horizon: "أسابيع", description: "أسلوب متوسط المدى — أفق أسابيع لشهور." },
  { key: "long", label: "طويل المدى", horizon: "شهور", description: "أسلوب طويل المدى — أفق شهور، صبر أكبر وأهداف أوسع." },
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

function read(): StyleKey {
  if (typeof window === "undefined") return "medium";
  const saved = window.localStorage.getItem(STYLE_STORAGE_KEY);
  return saved === "trader" || saved === "medium" || saved === "long" ? saved : "medium";
}

export function setInvestStyle(next: StyleKey) {
  window.localStorage.setItem(STYLE_STORAGE_KEY, next);
  window.dispatchEvent(new CustomEvent(STYLE_EVENT, { detail: next }));
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

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  row: { price?: number; midTarget?: { price?: number } | null },
  position: {
    avgCost?: number;
    shares?: number;
    stop?: number;
    unrealizedPct?: number;
    distanceToStopPct?: number;
    stopBreached?: boolean;
    trailing?: { active?: boolean } | null;
    recommendation?: Recommendation | null;
  },
  style: StyleKey,
): Recommendation {
  const fallback: Recommendation =
    position.recommendation ?? {
      action: "hold",
      label: "احتفاظ",
      text: "التوصية مش متاحة — أعد تشغيل الخادم.",
      order: null,
    };

  const rules = STYLE_RULES[style];
  const price = row.price;
  const shares = position.shares;
  const stop = position.stop;
  const profitPct = position.unrealizedPct;
  const target = row.midTarget?.price;
  if (price == null || shares == null || !shares || profitPct == null) return fallback;

  // 1. Stop breached — nothing else matters.
  if (position.stopBreached || (stop != null && price < stop)) return fallback;

  // 2. Mid target reached — scale out by the behaviour's fraction.
  if (target != null && price >= target) {
    const qty = Math.floor(shares * rules.takeProfit.atTargetFraction);
    return {
      action: "take_target",
      label: "جني أرباح",
      text: `وصل الهدف ${r2(target)}. بيع ${qty} سهم وارفع الوقف للباقي لـ ${r2(
        price * (1 - rules.takeProfit.raiseStopAfterTargetPct / 100),
      )}.`,
      order: { side: "sell", qty, price: r2(price) },
    };
  }

  // 3. Enough profit to bank some, and the trail hasn't taken over yet.
  if (profitPct >= rules.takeProfit.partialAtProfitPct && !position.trailing?.active) {
    const qty = Math.round(shares * rules.takeProfit.partialFraction);
    const limit = price * (1 + rules.takeProfit.limitAbovePricePct / 100);
    return {
      action: "sell_part",
      label: "بيع جزئي",
      text: `مربح ${r2(profitPct)}% — أمّن جزء. بيع ${qty} سهم بأمر محدد عند ${r2(
        limit,
      )} (صلاحية أسبوع). الباقي بوقف متحرك ${rules.trailing.trailPct}%.`,
      order: { side: "sell", qty, price: r2(limit) },
    };
  }

  // 4. Close to the stop — a warning, not an action.
  if ((position.distanceToStopPct ?? 99) <= rules.nearStopPct) {
    return {
      action: "hold",
      label: "احتفاظ",
      text: `قريب من الوقف (${r2(position.distanceToStopPct ?? 0)}% بس). احتفظ، بس إغلاق تحت ${r2(
        stop ?? 0,
      )} يبقى خروج كامل.`,
      order: null,
    };
  }

  if (fallback.action === "buy_more") return fallback;

  // 5. Nothing to do.
  const trailNote =
    profitPct >= rules.trailing.activateAtProfitPct
      ? ` الوقف المتحرك مفعّل على مسافة ${rules.trailing.trailPct}%.`
      : "";
  return {
    action: "hold",
    label: "احتفاظ",
    text: `${profitPct >= 0 ? "مربح" : "خاسر"} ${r2(Math.abs(profitPct))}% وداخل النطاق. الحركة هادية ومش محتاجة أي قرار.${trailNote}`,
    order: null,
  };
}
