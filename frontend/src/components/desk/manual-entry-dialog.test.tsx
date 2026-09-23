import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManualEntryDialog } from "./manual-entry-dialog";

const desk = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/store", () => ({ useDesk: () => desk.current }));
vi.mock("@/components/desk/new-trade-dialog", () => ({
  NewTradeDialog: () => null,
  TradeForm: () => null,
}));

const row = (code: string, price: number) => ({
  code,
  name: code,
  price,
  position: { shares: 100, avgCost: 10, stop: 9 },
  midTarget: { price: 12 },
});

const setRows = (rows: unknown[]) => {
  desk.current = {
    manualOpen: true,
    setManualOpen: vi.fn(),
    manualTab: "edit",
    rows,
    reload: vi.fn(),
    pf: { trades: [], realizedPnl: 0 },
  };
};

describe("ManualEntryDialog edit tab", () => {
  beforeEach(() => setRows([row("COMI", 80), row("HRHO", 20)]));

  it("starts with every stock deselected", () => {
    render(<ManualEntryDialog />);
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box.getAttribute("aria-checked")).toBe("false");
    }
    expect(screen.getByRole("button", { name: /حفظ التعديلات/ }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("keeps typed values and the selection across a live price refresh", () => {
    const { rerender } = render(<ManualEntryDialog />);
    const [sharesInput] = screen.getAllByLabelText("عدد الأسهم") as HTMLInputElement[];
    fireEvent.change(sharesInput!, { target: { value: "250" } });

    // A price refresh hands the dialog a brand new rows array.
    setRows([row("COMI", 81), row("HRHO", 21)]);
    rerender(<ManualEntryDialog />);

    const [comiShares, hrhoShares] = screen.getAllByLabelText("عدد الأسهم") as HTMLInputElement[];
    expect(comiShares!.value).toBe("250");
    expect(hrhoShares!.value).toBe("100");
    const [all, comi, hrho] = screen.getAllByRole("checkbox");
    expect(all!.getAttribute("aria-checked")).toBe("false");
    expect(comi!.getAttribute("aria-checked")).toBe("true");
    expect(hrho!.getAttribute("aria-checked")).toBe("false");
  });
});
