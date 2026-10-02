import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import {
  CLAMP_PCT,
  HeatmapTile,
  changeColor,
  changeInk,
  toTreemapData,
  type HeatmapStock,
} from "@/components/desk/market-heatmap";

const stock = (over: Partial<HeatmapStock>): HeatmapStock => ({
  code: "COMI",
  name: "التجاري الدولي",
  sector: "banks",
  sectorAr: "بنوك",
  marketCapEgp: 400e9,
  turnoverEgp: 300e6,
  price: 75.4,
  changePct: 0.5,
  indices: ["EGX30", "EGX100"],
  ...over,
});

const stocks = [
  stock({}),
  stock({ code: "HDBK", marketCapEgp: 50e9, turnoverEgp: 900e6, indices: ["EGX30", "EGX100"] }),
  stock({
    code: "SWDY",
    sector: "industrials",
    sectorAr: "صناعة",
    marketCapEgp: 200e9,
    turnoverEgp: 150e6,
    changePct: 8.29,
  }),
  stock({
    code: "SMLL",
    sector: "industrials",
    sectorAr: "صناعة",
    marketCapEgp: 1e9,
    turnoverEgp: null,
    indices: ["EGX70", "EGX100"],
  }),
];

describe("changeColor", () => {
  it("is the neutral grey for no change and tints both ways from there", () => {
    expect(changeColor(0)).toBe("var(--muted)");
    expect(changeColor(0.5)).toContain("var(--up)");
    expect(changeColor(-0.5)).toContain("var(--down)");
  });

  it("clamps at ±3%, so a bigger move is no stronger than the clamp", () => {
    expect(CLAMP_PCT).toBe(3);
    expect(changeColor(8.29)).toBe(changeColor(3));
    expect(changeColor(-12)).toBe(changeColor(-3));
    expect(changeColor(3)).toContain("100%");
  });

  it("puts the page background on strong fills and the text colour on weak ones", () => {
    expect(changeInk(3)).toBe("var(--background)");
    expect(changeInk(0.3)).toBe("var(--foreground)");
  });
});

describe("toTreemapData", () => {
  it("groups by sector, biggest sector and biggest stock first", () => {
    const tree = toTreemapData(stocks, "all", "cap");
    expect(tree.map((s) => s.name)).toEqual(["banks", "industrials"]);
    expect(tree[0]!.children.map((c) => c.code)).toEqual(["COMI", "HDBK"]);
    expect(tree[0]!.count).toBe(2);
    expect(tree[0]!.children[0]!.size).toBe(400e9);
    expect(tree[0]!.children.map((c) => c.lead)).toEqual([true, false]);
    expect(tree[0]!.children[1]!.sectorCount).toBe(2);
  });

  it("keeps only the chosen index's members", () => {
    const tree = toTreemapData(stocks, "EGX70", "cap");
    expect(tree.flatMap((s) => s.children.map((c) => c.code))).toEqual(["SMLL"]);
  });

  it("sizes by traded value in that mode and leaves out stocks without one", () => {
    const tree = toTreemapData(stocks, "all", "turnover");
    const codes = tree.flatMap((s) => s.children.map((c) => c.code));
    expect(codes).not.toContain("SMLL");
    expect(tree[0]!.children[0]).toMatchObject({ code: "HDBK", size: 900e6 });
  });
});

describe("HeatmapTile", () => {
  const renderTile = (props: Parameters<typeof HeatmapTile>[0]) =>
    render(
      <svg>
        <HeatmapTile {...props} />
      </svg>,
    );

  it("labels a big stock tile with its code and change and opens it on click", () => {
    const onOpen = vi.fn();
    const { getByText, getByRole } = renderTile({
      depth: 2,
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      code: "SWDY",
      changePct: 8.29,
      onOpen,
    });
    expect(getByText("SWDY")).toBeTruthy();
    expect(getByText("+8.29%")).toBeTruthy();
    fireEvent.click(getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("SWDY");
  });

  it("leaves a tiny tile unlabelled", () => {
    const { queryByText } = renderTile({
      depth: 2,
      x: 0,
      y: 0,
      width: 20,
      height: 14,
      code: "SMLL",
      changePct: 1,
    });
    expect(queryByText("SMLL")).toBeNull();
  });

  it("puts the sector's name on its biggest tile only", () => {
    const lead = renderTile({
      depth: 2,
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      code: "COMI",
      changePct: 0.5,
      lead: true,
      sectorAr: "بنوك",
      sectorCount: 12,
    });
    expect(lead.getByText("بنوك · 12")).toBeTruthy();
    lead.unmount();
    const other = renderTile({
      depth: 2,
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      code: "HDBK",
      changePct: 0.5,
      lead: false,
      sectorAr: "بنوك",
      sectorCount: 12,
    });
    expect(other.queryByText("بنوك · 12")).toBeNull();
  });

  it("draws nothing for a sector node itself", () => {
    const { container } = renderTile({ depth: 1, x: 0, y: 0, width: 300, height: 200 });
    expect(container.querySelector("rect")).toBeNull();
  });
});
