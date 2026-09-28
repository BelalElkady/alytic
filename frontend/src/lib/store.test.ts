import { describe, expect, it } from "vitest";

import { applyQuote } from "./store";

const held = {
  code: "DSCW",
  price: 1.75,
  changePct: 1,
  halted: null,
  position: {
    shares: 100,
    avgCost: 2,
    stop: 1.62,
    stopAtClose: 1.62,
    closePrice: 1.73,
    targetLevel: 1.83,
  },
};

describe("applyQuote", () => {
  it("prices the row and its position at the shared quote", () => {
    const row = applyQuote(held, { price: 1.72, changePct: -0.58, time: 1, halted: null });
    expect(row.price).toBe(1.72);
    expect(row.changePct).toBe(-0.58);
    expect(row.position.marketValue).toBeCloseTo(172);
    expect(row.position.unrealizedPct).toBeCloseTo(-14);
    expect(row.position.stopBreached).toBe(false);
  });

  it("leaves the row alone without a usable quote", () => {
    expect(applyQuote(held, undefined)).toBe(held);
    expect(applyQuote(held, { price: 0 })).toBe(held);
  });

  it("keeps the row's change when the quote has none", () => {
    expect(applyQuote(held, { price: 1.72 }).changePct).toBe(1);
  });
});
