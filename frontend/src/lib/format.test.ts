import { describe, expect, it } from "vitest";

import { arDay, cairoDay, clamp, fmt, int, isoDay, pct, signed, tone } from "./format";

describe("fmt", () => {
  it("shows up to 3 decimals exactly, without padding", () => {
    expect(fmt(12.3)).toBe("12.3");
    expect(fmt(1.235)).toBe("1.235");
    expect(fmt(1234567.891)).toBe("1,234,567.891");
  });

  it("rounds only long decimals, to 2 places", () => {
    expect(fmt(12.3456)).toBe("12.35");
    expect(fmt(2990 / 12)).toBe("249.17");
    expect(fmt(-1.23456)).toBe("-1.23");
  });

  it("drops floating-point noise", () => {
    expect(fmt(0.1 + 0.2)).toBe("0.3");
  });

  it("renders an em dash for anything that is not a usable number", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(undefined)).toBe("—");
    expect(fmt("")).toBe("—");
    expect(fmt("abc")).toBe("—");
    expect(fmt(NaN)).toBe("—");
  });

  it("accepts numeric strings", () => {
    expect(fmt("42.5")).toBe("42.5");
  });
});

describe("int", () => {
  it("thousands-separates without rounding", () => {
    expect(int(1234.6)).toBe("1,234.6");
    expect(int(1234567)).toBe("1,234,567");
  });

  it("renders an em dash for missing values", () => {
    expect(int(null)).toBe("—");
    expect(int("x")).toBe("—");
  });
});

describe("pct", () => {
  it("signs gains and losses without rounding", () => {
    expect(pct(1.234)).toBe("+1.234%");
    expect(pct(-5)).toBe("-5%");
    expect(pct(0)).toBe("0%");
  });

  it("renders an em dash for missing values", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });
});

describe("signed", () => {
  it("signs without rounding", () => {
    expect(signed(5.5)).toBe("+5.5");
    expect(signed(-2.2)).toBe("-2.2");
    expect(signed(0)).toBe("0");
    expect(signed(3.14159)).toBe("+3.14");
    expect(signed(-12345.5)).toBe("-12,345.5");
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

  it("cairoDay is the Cairo date whatever the machine's timezone", () => {
    // 22:30 UTC is already the next day in Cairo (UTC+2 or +3).
    expect(cairoDay(Date.parse("2026-10-21T22:30:00Z"))).toBe("2026-10-22");
    expect(cairoDay(Date.parse("2026-02-15T10:00:00Z"))).toBe("2026-02-15");
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
