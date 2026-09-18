import { describe, expect, it } from "vitest";

import { pageItems } from "./pagination";

describe("pageItems", () => {
  it("lists every page when there are only a few", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 3)).toEqual([1, 2, 3]);
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses the far pages into gaps around the current one", () => {
    expect(pageItems(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
  });

  it("keeps the start and the end tight against the ends", () => {
    expect(pageItems(1, 12)).toEqual([1, 2, "gap", 12]);
    expect(pageItems(12, 12)).toEqual([1, "gap", 11, 12]);
    expect(pageItems(2, 12)).toEqual([1, 2, 3, "gap", 12]);
  });

  it("shows a single hidden page instead of a gap that takes the same room", () => {
    // 1 _ 3 4 5 → page 2 would be the only thing hidden, so it is shown.
    expect(pageItems(4, 9)).toEqual([1, 2, 3, 4, 5, "gap", 9]);
  });

  it("returns nothing when there are no pages", () => {
    expect(pageItems(1, 0)).toEqual([]);
  });
});
