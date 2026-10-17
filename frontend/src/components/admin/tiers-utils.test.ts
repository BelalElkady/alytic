import { describe, expect, it } from "vitest";

import {
  applyEdit,
  capWarnings,
  clearOverride,
  getOverride,
  resolve,
  setOverride,
  tidyLayer,
  type TierSettings,
} from "@/components/admin/tiers-utils";

const tier = (cap: number, name: string): TierSettings => ({
  caps: { screenshots: cap, recommendations: cap, cashScans: cap, marketAnalysis: cap },
  portfolios: 1,
  locked: { pages: [], panels: [] },
  card: { name, note: "", bullets: [] },
});
const defaults = { free: tier(2, "مجانية"), long: tier(10, "طويل"), trader: tier(20, "حريفة") };

describe("resolve", () => {
  it("merges caps field by field and replaces lock lists and bullets whole", () => {
    const merged = resolve(
      defaults,
      { long: { caps: { cashScans: 12 }, locked: { pages: ["charts", "cash"] }, card: { bullets: ["أ", "ب"] } } },
      { long: { caps: { screenshots: 7 }, locked: { pages: ["charts"] }, card: { bullets: ["ج"] } } },
    );
    expect(merged.long.caps).toMatchObject({ cashScans: 12, screenshots: 7, recommendations: 10 });
    expect(merged.long.locked.pages).toEqual(["charts"]);
    expect(merged.long.card.bullets).toEqual(["ج"]);
    expect(merged.trader).toEqual(defaults.trader);
    expect(defaults.long.caps.cashScans).toBe(10);
  });
});

describe("overrides", () => {
  it("sets a nested field without touching the original layer", () => {
    const layer = {};
    const next = setOverride(layer, "long", ["caps", "cashScans"], 5);
    expect(getOverride(next, "long", ["caps", "cashScans"])).toBe(5);
    expect(layer).toEqual({});
  });

  it("clearing the last field removes the empty group and tier too", () => {
    const layer = setOverride({}, "long", ["caps", "cashScans"], 5);
    expect(clearOverride(layer, "long", ["caps", "cashScans"])).toEqual({});
  });

  it("an edit equal to what would be inherited removes the override instead of storing it", () => {
    const layer = setOverride({}, "long", ["portfolios"], 2);
    expect(applyEdit(layer, "long", ["portfolios"], 1, 1)).toEqual({});
    expect(applyEdit({}, "long", ["portfolios"], 2, 1)).toEqual({ long: { portfolios: 2 } });
  });
});

describe("tidyLayer and capWarnings", () => {
  it("drops blank bullet lines and trims the rest", () => {
    const tidy = tidyLayer({ long: { card: { bullets: ["  دعم ", "", "   ", "مزايا"] } } });
    expect(tidy.long?.card?.bullets).toEqual(["دعم", "مزايا"]);
  });

  it("warns when a paid tier gives less than the free trial", () => {
    const low = resolve(defaults, { long: { caps: { cashScans: 1 } } });
    expect(capWarnings(low)).toEqual(["طويل: تحليل الكاش أقل من الباقة المجانية"]);
    expect(capWarnings(resolve(defaults))).toEqual([]);
  });
});
