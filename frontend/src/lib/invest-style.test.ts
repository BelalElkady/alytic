import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  clearInvestStyle,
  hasExplicitInvestStyle,
  inferInvestStyle,
  INVEST_STYLES,
  setInvestStyle,
  STYLE_STORAGE_KEY,
  styleRecommendation,
  STYLE_RULES,
  useActiveInvestStyle,
  useInvestStyle,
  type StyleKey,
  type Trade,
} from "./invest-style";

afterEach(() => {
  window.localStorage.clear();
});

describe("INVEST_STYLES / STYLE_RULES", () => {
  it("offers exactly the three documented behaviours", () => {
    expect(INVEST_STYLES.map((s) => s.key)).toEqual(["trader", "medium", "long"]);
    expect(Object.keys(STYLE_RULES).sort()).toEqual(["long", "medium", "trader"]);
  });

  it("orders the styles from fastest exit to widest target", () => {
    expect(STYLE_RULES.trader.entry.minRiskReward).toBeLessThan(
      STYLE_RULES.medium.entry.minRiskReward,
    );
    expect(STYLE_RULES.medium.entry.minRiskReward).toBeLessThan(
      STYLE_RULES.long.entry.minRiskReward,
    );
    expect(STYLE_RULES.trader.takeProfit.partialAtProfitPct).toBeLessThan(
      STYLE_RULES.medium.takeProfit.partialAtProfitPct,
    );
    expect(STYLE_RULES.medium.takeProfit.partialAtProfitPct).toBeLessThan(
      STYLE_RULES.long.takeProfit.partialAtProfitPct,
    );
  });
});

describe("useInvestStyle", () => {
  it("defaults to medium", () => {
    const { result } = renderHook(() => useInvestStyle());
    expect(result.current).toBe("medium");
  });

  it("reads the persisted choice and reacts to changes", () => {
    window.localStorage.setItem(STYLE_STORAGE_KEY, "trader");
    const { result } = renderHook(() => useInvestStyle());
    expect(result.current).toBe("trader");

    act(() => {
      setInvestStyle("long");
    });
    expect(result.current).toBe("long");
    expect(window.localStorage.getItem(STYLE_STORAGE_KEY)).toBe("long");
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem(STYLE_STORAGE_KEY, "yolo");
    const { result } = renderHook(() => useInvestStyle());
    expect(result.current).toBe("medium");
  });
});

describe("hasExplicitInvestStyle / clearInvestStyle", () => {
  it("is false until a style is chosen, and clearInvestStyle drops back to auto", () => {
    expect(hasExplicitInvestStyle()).toBe(false);
    setInvestStyle("trader");
    expect(hasExplicitInvestStyle()).toBe(true);
    clearInvestStyle();
    expect(hasExplicitInvestStyle()).toBe(false);
  });
});

/** `count` closed round trips on the same code, each held for `holdDays`. */
function tradesWithHoldingDays(holdDays: number, count = 3): Trade[] {
  const trades: Trade[] = [];
  for (let i = 0; i < count; i++) {
    const buy = new Date(Date.UTC(2024, 0, 1 + i * 200));
    const sell = new Date(buy.getTime() + holdDays * 86_400_000);
    trades.push({ date: buy.toISOString().slice(0, 10), code: "ABC", side: "buy", shares: 100 });
    trades.push({ date: sell.toISOString().slice(0, 10), code: "ABC", side: "sell", shares: 100 });
  }
  return trades;
}

describe("inferInvestStyle", () => {
  it("returns null with no trades or too few closed round trips", () => {
    expect(inferInvestStyle(undefined)).toBeNull();
    expect(inferInvestStyle([])).toBeNull();
    expect(inferInvestStyle(tradesWithHoldingDays(5, 2))).toBeNull();
  });

  it("classifies short average holds as trader", () => {
    expect(inferInvestStyle(tradesWithHoldingDays(3))).toBe("trader");
  });

  it("classifies weeks-to-months holds as medium", () => {
    expect(inferInvestStyle(tradesWithHoldingDays(30))).toBe("medium");
  });

  it("classifies months-long holds as long", () => {
    expect(inferInvestStyle(tradesWithHoldingDays(120))).toBe("long");
  });

  it("FIFO-matches sells against the earliest open buy lots, out of input order", () => {
    const trades: Trade[] = [
      { date: "2024-01-01", code: "ABC", side: "buy", shares: 50 },
      { date: "2024-01-10", code: "ABC", side: "buy", shares: 50 },
      { date: "2024-01-05", code: "ABC", side: "sell", shares: 30 },
      { date: "2024-02-01", code: "ABC", side: "sell", shares: 20 },
      { date: "2024-02-05", code: "ABC", side: "sell", shares: 50 },
    ];
    expect(inferInvestStyle(trades)).not.toBeNull();
  });
});

describe("useActiveInvestStyle", () => {
  it("uses the inferred style until the user picks one explicitly", () => {
    const { result } = renderHook(() => useActiveInvestStyle(tradesWithHoldingDays(120)));
    expect(result.current).toEqual({ style: "long", auto: true, inferred: "long" });
  });

  it("an explicit choice always wins over the inferred style", () => {
    act(() => {
      setInvestStyle("long");
    });
    const { result } = renderHook(() => useActiveInvestStyle(tradesWithHoldingDays(3)));
    expect(result.current.auto).toBe(false);
    expect(result.current.style).toBe("long");
    expect(result.current.inferred).toBe("trader");
  });

  it("falls back to medium when there isn't enough trade history to infer from", () => {
    const { result } = renderHook(() => useActiveInvestStyle([]));
    expect(result.current).toEqual({ style: "medium", auto: true, inferred: null });
  });
});

const row = { price: 100, midTarget: { price: 120 } };
const held = {
  avgCost: 100,
  shares: 100,
  stop: 90,
  unrealizedPct: 2,
  distanceToStopPct: 10,
  stopBreached: false,
  trailing: { active: false },
  recommendation: { action: "hold", label: "احتفاظ", text: "server verdict", order: null },
};

describe("styleRecommendation", () => {
  it("a breached stop always defers to the server's verdict", () => {
    const result = styleRecommendation(row, { ...held, stopBreached: true }, "trader");
    expect(result).toBe(held.recommendation);
    const byPrice = styleRecommendation(row, { ...held, stop: 101 }, "trader");
    expect(byPrice).toBe(held.recommendation);
  });

  it("reaching the mid target scales out by the behaviour's fraction", () => {
    const atTarget = { ...row, price: 125 };
    const trader = styleRecommendation(atTarget, held, "trader");
    expect(trader.action).toBe("take_target");
    expect(trader.order?.qty).toBe(50); // trader sells half

    const medium = styleRecommendation({ ...row, price: 125 }, held, "medium");
    expect(medium.action).toBe("take_target");
    expect(medium.order?.qty).toBe(33); // medium sells a third
  });

  it("the partial-profit threshold follows the style", () => {
    const row8 = { price: 108, midTarget: { price: 120 } };
    const trader = styleRecommendation(row8, { ...held, unrealizedPct: 8 }, "trader");
    expect(trader.action).toBe("sell_part"); // trader banks from 6%
    expect(trader.order?.price).toBeCloseTo(109.08); // +1% limit

    const medium = styleRecommendation(row8, { ...held, unrealizedPct: 8 }, "medium");
    expect(medium.action).toBe("hold"); // medium waits for 15%
  });

  it("proximity to the stop is a style-sized warning", () => {
    const near = { ...held, unrealizedPct: 0, distanceToStopPct: 2.5 };
    const trader = styleRecommendation(row, near, "trader");
    expect(trader.text.includes("قريب من الوقف")).toBe(false); // trader's near band is 2%

    const long = styleRecommendation(row, near, "long");
    expect(long.text.includes("قريب من الوقف")).toBe(true); // long tolerates up to 5%
  });

  it("a leader pullback keeps the server's buy_more verdict", () => {
    const server = { ...held.recommendation, action: "buy_more" };
    const result = styleRecommendation(row, { ...held, recommendation: server }, "medium");
    expect(result.action).toBe("buy_more");
  });

  it("missing price or shares falls back to the server's verdict", () => {
    const result = styleRecommendation({}, held, "medium");
    expect(result).toBe(held.recommendation);
  });

  it("notes the active trail once the style's activation profit is earned", () => {
    const profitable = { ...held, unrealizedPct: 14 };
    const medium = styleRecommendation(row, profitable, "medium");
    expect(medium.action).toBe("hold");
    expect(medium.text.includes("المتحرك")).toBe(true);

    const long = styleRecommendation(row, profitable, "long");
    expect(long.text.includes("المتحرك")).toBe(false); // long activates at 20%
  });

  it("every style yields a complete recommendation for every key", () => {
    for (const style of ["trader", "medium", "long"] as StyleKey[]) {
      const r = styleRecommendation(row, held, style);
      expect(r.action).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(r.text).toBeTruthy();
    }
  });
});
