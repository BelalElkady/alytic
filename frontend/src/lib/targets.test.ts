import { describe, expect, it } from "vitest";

import { mergedTarget, mergedTargetPrice, SAME_TARGET_THRESHOLD_PCT } from "./targets";

describe("mergedTargetPrice", () => {
  it("needs both targets to collapse", () => {
    expect(mergedTargetPrice(null, 100)).toBeNull();
    expect(mergedTargetPrice(100, null)).toBeNull();
    expect(mergedTargetPrice(null, null)).toBeNull();
  });

  it("a long target at or below mid is the same goal on a shorter fuse", () => {
    expect(mergedTargetPrice(100, 90)).toBe(90);
    expect(mergedTargetPrice(100, 100)).toBe(100);
    expect(mergedTargetPrice(100, 50)).toBe(50);
  });

  it("a barely-further long target collapses onto the mid target", () => {
    expect(mergedTargetPrice(100, 107)).toBe(100);
  });

  it("a genuinely further long target keeps both marks", () => {
    expect(mergedTargetPrice(100, 109)).toBeNull();
    expect(mergedTargetPrice(100, 200)).toBeNull();
  });

  it("collapses strictly inside the threshold, never at it", () => {
    const within = 100 * (1 + SAME_TARGET_THRESHOLD_PCT / 100) - 0.01;
    const beyond = 100 * (1 + SAME_TARGET_THRESHOLD_PCT / 100) + 0.01;
    expect(mergedTargetPrice(100, within)).toBe(100);
    expect(mergedTargetPrice(100, beyond)).toBeNull();
  });
});

describe("mergedTarget", () => {
  const mid = { price: 100, basis: "resistance" };
  const longNear = { price: 90, basis: "fib_extension" };
  const longFar = { price: 130, basis: "fib_extension" };

  it("returns the nearer target object whole when they collapse", () => {
    expect(mergedTarget(mid, longNear)).toBe(longNear);
  });

  it("returns the mid target object when the long one is barely past it", () => {
    const longClose = { price: 107, basis: "trend_extrapolation" };
    expect(mergedTarget(mid, longClose)).toBe(mid);
  });

  it("keeps both targets separate when they are far apart", () => {
    expect(mergedTarget(mid, longFar)).toBeNull();
  });

  it("needs both targets present", () => {
    expect(mergedTarget(null, longNear)).toBeNull();
    expect(mergedTarget(mid, undefined)).toBeNull();
    expect(mergedTarget({ price: null }, { price: 100 })).toBeNull();
  });
});
