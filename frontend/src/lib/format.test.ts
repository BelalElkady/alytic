import { describe, expect, it } from "vitest";

import { arDay, clamp, fmt, int, isoDay, pct, signed, tone } from "./format";

describe("fmt", () => {
  it("formats numbers with fixed digits", () => {
    expect(fmt(12.3456)).toBe("12.35");
    expect(fmt(12.3, 3)).toBe("12.300");
  });

  it("renders an em dash for anything that is not a usable number", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(undefined)).toBe("—");
    expect(fmt("")).toBe("—");
    expect(fmt("abc")).toBe("—");
    expect(fmt(NaN)).toBe("—");
  });

  it("accepts numeric strings", () => {
    expect(fmt("42.5")).toBe("42.50");
  });
});

describe("int", () => {
  it("rounds and thousands-separates", () => {
    expect(int(1234.6)).toBe("1,235");
    expect(int(1234567)).toBe("1,234,567");
  });

  it("renders an em dash for missing values", () => {
    expect(int(null)).toBe("—");
    expect(int("x")).toBe("—");
  });
});

describe("pct", () => {
  it("signs gains and losses", () => {
    expect(pct(1.234)).toBe("+1.23%");
    expect(pct(-5)).toBe("-5.00%");
    expect(pct(0)).toBe("0.00%");
  });

  it("renders an em dash for missing values", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });
});

describe("signed", () => {
  it("signs with zero digits by default", () => {
    expect(signed(5.5)).toBe("+6");
    expect(signed(-2.2)).toBe("-2");
    expect(signed(0)).toBe("0");
  });

  it("honours explicit digits", () => {
    expect(signed(3.14159, 2)).toBe("+3.14");
  });
});

describe("tone", () => {
  it("classifies gains, losses and neutral values", () => {
    expect(tone(3)).toBe("text-up");
    expect(tone(-0.1)).toBe("text-down");
    expect(tone(0)).toBe("text-muted-foreground");
    expect(tone(null)).toBe("text-muted-foreground");
  });
});

describe("isoDay / arDay", () => {
  it("isoDay gives YYYY-MM-DD", () => {
    expect(isoDay(new Date("2026-02-15T10:00:00Z"))).toBe("2026-02-15");
  });

  it("arDay formats a Cairo-readable date", () => {
    expect(arDay("2026-02-15")).toContain("فبراير");
    expect(arDay(null)).toBe("—");
    expect(arDay("garbage")).toBe("garbage");
  });
});

describe("clamp", () => {
  it("clamps into the range", () => {
    expect(clamp(150)).toBe(100);
    expect(clamp(-5)).toBe(0);
    expect(clamp(42)).toBe(42);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});
