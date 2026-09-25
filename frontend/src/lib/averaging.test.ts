import { describe, expect, it } from "vitest";

import { averagingLadder, parseAmount, planAveraging } from "./averaging";

describe("planAveraging", () => {
  it("averages down: 100 shares at 20, target 18, buying at 15", () => {
    const plan = planAveraging({ shares: 100, avgCost: 20, target: 18, price: 15 });
    expect(plan).toMatchObject({ ok: true, buyShares: 67, totalShares: 167 });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.buyCost).toBe(1005);
    // Rounded up to whole shares, so the average lands on or just under the target.
    expect(plan.newAvg).toBeLessThanOrEqual(18);
    expect(plan.newAvg).toBeGreaterThan(17.9);
  });

  it("hits the target exactly when the numbers divide", () => {
    const plan = planAveraging({ shares: 100, avgCost: 20, target: 15, price: 10 });
    expect(plan).toMatchObject({ ok: true, buyShares: 100, newAvg: 15 });
  });

  it("averages up when the target is above the current average", () => {
    const plan = planAveraging({ shares: 100, avgCost: 10, target: 12, price: 14 });
    expect(plan).toMatchObject({ ok: true, buyShares: 100, newAvg: 12 });
  });

  it("refuses a buy price on the wrong side of the target", () => {
    expect(planAveraging({ shares: 100, avgCost: 20, target: 18, price: 18 }).ok).toBe(false);
    expect(planAveraging({ shares: 100, avgCost: 20, target: 18, price: 25 }).ok).toBe(false);
    expect(planAveraging({ shares: 100, avgCost: 10, target: 12, price: 11 }).ok).toBe(false);
  });

  it("refuses missing or non-positive inputs and an unchanged target", () => {
    expect(planAveraging({ shares: 0, avgCost: 20, target: 18, price: 15 }).ok).toBe(false);
    expect(planAveraging({ shares: 100, avgCost: Number.NaN, target: 18, price: 15 }).ok).toBe(
      false,
    );
    expect(planAveraging({ shares: 100, avgCost: 20, target: 20, price: 15 }).ok).toBe(false);
  });

  it("doesn't round floating-point noise up an extra share", () => {
    const plan = planAveraging({ shares: 3, avgCost: 0.3, target: 0.2, price: 0.1 });
    expect(plan).toMatchObject({ ok: true, buyShares: 3 });
  });
});

describe("averagingLadder", () => {
  it("lists prices below the target when averaging down, fewer shares the cheaper", () => {
    const ladder = averagingLadder({ shares: 100, avgCost: 20, target: 18 });
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder.every((row) => row.price < 18)).toBe(true);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]!.plan.buyShares).toBeLessThanOrEqual(ladder[i - 1]!.plan.buyShares);
    }
  });

  it("lists prices above the target when averaging up", () => {
    const ladder = averagingLadder({ shares: 100, avgCost: 10, target: 12 });
    expect(ladder.every((row) => row.price > 12)).toBe(true);
  });

  it("is empty without a usable target", () => {
    expect(averagingLadder({ shares: 100, avgCost: 20, target: 20 })).toEqual([]);
  });
});

describe("parseAmount", () => {
  it("reads Latin and Arabic-Indic digits, separators and the Arabic decimal mark", () => {
    expect(parseAmount("1,250.5")).toBe(1250.5);
    expect(parseAmount("١٢٫٥")).toBe(12.5);
    expect(parseAmount("١٬٠٠٠")).toBe(1000);
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
  });
});
