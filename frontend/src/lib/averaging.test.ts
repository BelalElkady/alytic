import { describe, expect, it } from "vitest";

import { averagingLadder, parseAmount, planAveraging } from "./averaging";

describe("planAveraging", () => {
  it("averages down: 100 shares at 20, spending 1000 at 10", () => {
    const plan = planAveraging({ shares: 100, avgCost: 20, amount: 1000, price: 10 });
    expect(plan).toMatchObject({
      ok: true,
      buyShares: 100,
      buyCost: 1000,
      leftover: 0,
      totalShares: 200,
      newAvg: 15,
      avgChange: -5,
    });
  });

  it("averages up when buying above the current average", () => {
    const plan = planAveraging({ shares: 100, avgCost: 10, amount: 1400, price: 14 });
    expect(plan).toMatchObject({ ok: true, buyShares: 100, newAvg: 12, avgChange: 2 });
  });

  it("buys only whole shares the amount covers and reports the leftover", () => {
    const plan = planAveraging({ shares: 100, avgCost: 20, amount: 1000, price: 15 });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.buyShares).toBe(66);
    expect(plan.buyCost).toBe(990);
    expect(plan.leftover).toBe(10);
    expect(plan.newAvg).toBeCloseTo(2990 / 166);
  });

  it("refuses an amount too small for one share", () => {
    expect(planAveraging({ shares: 100, avgCost: 20, amount: 9, price: 10 }).ok).toBe(false);
  });

  it("refuses missing or non-positive inputs", () => {
    expect(planAveraging({ shares: 0, avgCost: 20, amount: 1000, price: 15 }).ok).toBe(false);
    expect(planAveraging({ shares: 100, avgCost: Number.NaN, amount: 1000, price: 15 }).ok).toBe(
      false,
    );
    expect(planAveraging({ shares: 100, avgCost: 20, amount: 0, price: 15 }).ok).toBe(false);
    expect(planAveraging({ shares: 100, avgCost: 20, amount: 1000, price: -1 }).ok).toBe(false);
  });

  it("doesn't round floating-point noise down a share", () => {
    const plan = planAveraging({ shares: 3, avgCost: 0.3, amount: 0.3, price: 0.1 });
    expect(plan).toMatchObject({ ok: true, buyShares: 3 });
  });
});

describe("averagingLadder", () => {
  it("spends the same amount at prices around the entered one", () => {
    const ladder = averagingLadder({ shares: 100, avgCost: 20, amount: 1000, price: 10 });
    expect(ladder.map((row) => row.price)).toEqual([8.5, 9, 9.5, 10.5, 11]);
    // Cheaper fills buy more shares and pull the average further down.
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]!.plan.newAvg).toBeGreaterThan(ladder[i - 1]!.plan.newAvg);
    }
  });

  it("is empty without a usable price", () => {
    expect(averagingLadder({ shares: 100, avgCost: 20, amount: 1000, price: 0 })).toEqual([]);
  });
});

describe("parseAmount", () => {
  it("reads Latin and Arabic-Indic digits, separators and the Arabic decimal mark", () => {
    expect(parseAmount("1,250.5")).toBe(1250.5);
    expect(parseAmount("١٢٫٥")).toBe(12.5);
    expect(parseAmount("١٬٠٠٠")).toBe(1000);
    expect(parseAmount("1,234,567")).toBe(1234567);
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("parseAmount with a comma decimal", () => {
  it("reads a lone comma not followed by three digits as a decimal point", () => {
    expect(parseAmount("74,42")).toBe(74.42);
    expect(parseAmount("8,5")).toBe(8.5);
    expect(parseAmount("0,125")).toBe(0.125);
    expect(parseAmount("1,021")).toBe(1021);
  });

  it("gives a sane plan for the reported case: 1021 shares at 74,42, 1000 spent at 50", () => {
    const plan = planAveraging({
      shares: parseAmount("1021"),
      avgCost: parseAmount("74,42"),
      amount: parseAmount("1000"),
      price: parseAmount("50"),
    });
    expect(plan).toMatchObject({ ok: true, buyShares: 20 });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.newAvg).toBeCloseTo((1021 * 74.42 + 1000) / 1041);
  });
});
