import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioDesk, PortfolioSwitcher } from "./portfolio-desk";

const desk = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/store", () => ({ useDesk: () => desk.current }));
// PortfolioDesk's read-only/upsell CTAs use <Link>, which needs a router
// context this unit test never mounts — stub it to a plain anchor.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const basePortfolio = (overrides: Record<string, unknown>) => ({
  id: 1,
  name: "المحفظة الرئيسية",
  style: "medium",
  value: 10000,
  pl: 500,
  cash: 2000,
  positionCount: 3,
  active: true,
  readOnly: false,
  ...overrides,
});

function setDesk(overrides: Record<string, unknown>) {
  desk.current = {
    portfolios: [basePortfolio({})],
    portfolioCap: 1,
    totals: { value: 10000, cost: 9500, pl: 500, plPct: 5.26, day: 0, cash: 2000, hasDay: false },
    rows: [1, 2, 3],
    user: { tier: "free" },
    switchPortfolio: vi.fn(),
    createPortfolio: vi.fn().mockResolvedValue(undefined),
    renamePortfolio: vi.fn().mockResolvedValue(undefined),
    deletePortfolio: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("PortfolioSwitcher", () => {
  beforeEach(() => setDesk({}));

  it("shows the upsell card, not an add button, for a non-trader User with 1 Portfolio", () => {
    render(<PortfolioSwitcher />);
    expect(screen.getByText(/لحد ٣ محافظ مع الحريفة/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "محفظة جديدة" })).not.toBeInTheDocument();
  });

  it("shows no add affordance for a trader User already at 3 Portfolios", () => {
    setDesk({
      portfolios: [
        basePortfolio({ id: 1 }),
        basePortfolio({ id: 2, active: false }),
        basePortfolio({ id: 3, active: false }),
      ],
      totals: { value: 90000, cost: 89500, pl: 500, plPct: 0.56, day: 0, cash: 2000, hasDay: false },
      portfolioCap: 3,
      user: { tier: "trader" },
    });
    render(<PortfolioSwitcher />);
    expect(screen.queryByRole("button", { name: "محفظة جديدة" })).not.toBeInTheDocument();
    expect(screen.queryByText(/لحد ٣ محافظ/)).not.toBeInTheDocument();
  });

  it("clicking a non-active card switches the active Portfolio", () => {
    setDesk({
      portfolios: [
        basePortfolio({ id: 1 }),
        basePortfolio({ id: 2, name: "الثانية", active: false, readOnly: true }),
      ],
      portfolioCap: 1,
      user: { tier: "free" },
    });
    render(<PortfolioSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /الثانية/ }));
    expect(desk.current.switchPortfolio).toHaveBeenCalledWith(2);
  });

  it("shows the mobile tile's k-abbreviated value/return alongside the desktop pill's share and P/L", () => {
    setDesk({
      portfolios: [
        basePortfolio({ id: 1 }),
        basePortfolio({ id: 2, name: "الثانية", active: false, style: "long", value: 5000, cash: 1000, pl: -250 }),
      ],
      portfolioCap: 3,
      user: { tier: "trader" },
    });
    render(<PortfolioSwitcher />);
    expect(screen.getByRole("group", { name: "المحافظ" })).toHaveClass("overflow-x-auto");
    // Mobile tile: merged live totals (value 10000 + cash 2000 = 12000) abbreviated to "12k".
    expect(screen.getByText("12k")).toBeInTheDocument();
    expect(screen.getByText("6k")).toBeInTheDocument();
    // Desktop pill (sm and up — both variants render; only display toggles responsively):
    // same totals expressed as share of the 18,000 grand total.
    expect(screen.getAllByText(/حصة من الإجمالي/)).toHaveLength(2);
    expect(screen.getByText("+66.67%")).toBeInTheDocument();
    expect(screen.getByText("+33.33%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /المحفظة الرئيسية/ })).toHaveClass("border-up");
    const second = screen.getByRole("button", { name: /الثانية/ });
    expect(second).toHaveTextContent("4.76%"); // mobile tile's unsigned arrow %
    expect(second).toHaveTextContent("-250 ج (-4.76%)"); // desktop pill's inline P/L
  });

  it("marks the third wallet purple and highlights a selected loss in red", () => {
    setDesk({
      portfolios: [
        basePortfolio({ id: 1 }),
        basePortfolio({ id: 2, name: "الثانية", active: false, style: "long" }),
        basePortfolio({ id: 3, name: "الثالثة", active: false, style: "trader" }),
      ],
      totals: { value: 10000, cost: 10200, pl: -200, plPct: -1.96, day: 0, cash: 2000, hasDay: false },
      portfolioCap: 3,
      user: { tier: "trader" },
    });
    render(<PortfolioSwitcher />);
    const activeWallet = screen.getByRole("button", { name: /المحفظة الرئيسية/ });
    const thirdWallet = screen.getByRole("button", { name: /الثالثة/ });
    expect(activeWallet).toHaveClass("border-down");
    expect(thirdWallet.querySelector(".text-purple-500")).toBeInTheDocument();
  });

  it("prevents assigning a trading style already used by another wallet", async () => {
    const user = userEvent.setup();
    setDesk({
      portfolios: [
        basePortfolio({ id: 1 }),
        basePortfolio({ id: 2, name: "الثانية", active: false, style: "long" }),
      ],
      portfolioCap: 3,
      user: { tier: "trader" },
    });
    render(<PortfolioSwitcher />);
    await user.click(screen.getByRole("button", { name: "محفظة جديدة" }));
    expect(screen.getByRole("button", { name: /متوسط المدى/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /طويل المدى/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /مضارب/ })).toBeEnabled();
  });

  it("typing a space into the rename dialog's name field doesn't get swallowed by the card", async () => {
    const user = userEvent.setup();
    render(<PortfolioSwitcher />);
    const card = screen.getByRole("button", { name: /المحفظة الرئيسية/ });
    await user.click(card.querySelector("button")!); // the ⋯ trigger
    await user.click(screen.getByText("تعديل الاسم والأسلوب"));
    const nameInput = screen.getByDisplayValue("المحفظة الرئيسية");
    await user.clear(nameInput);
    await user.type(nameInput, "اسم به مسافة");
    expect(nameInput).toHaveValue("اسم به مسافة");
  });

  it("clicking inside the manage menu's dialogs never switches the active Portfolio", async () => {
    const user = userEvent.setup();
    setDesk({
      portfolios: [
        basePortfolio({ id: 1 }),
        basePortfolio({ id: 2, name: "الثانية", active: false }),
      ],
      portfolioCap: 3,
      user: { tier: "trader" },
    });
    render(<PortfolioSwitcher />);
    const card = screen.getByRole("button", { name: /الثانية/ });
    await user.click(card.querySelector("button")!); // the ⋯ trigger, on the non-active card
    await user.click(screen.getByText("تعديل الاسم والأسلوب"));
    await user.click(screen.getByText("مضارب", { exact: true })); // a style tile inside the portaled dialog
    expect(desk.current.switchPortfolio).not.toHaveBeenCalled();
  });
});

describe("PortfolioDesk", () => {
  beforeEach(() => setDesk({}));

  it("shows the read-only banner for a locked active Portfolio", () => {
    setDesk({ portfolios: [basePortfolio({ readOnly: true })] });
    render(<PortfolioDesk>مراكز</PortfolioDesk>);
    expect(screen.getByText(/للعرض بس/)).toBeInTheDocument();
  });

  it("renders the wrapped children below the overview panel", () => {
    render(<PortfolioDesk>علامة-مميزة-للمحتوى</PortfolioDesk>);
    expect(screen.getByText("علامة-مميزة-للمحتوى")).toBeInTheDocument();
    expect(screen.getByText("إجمالي المحافظ")).toBeInTheDocument();
  });

  it("sums the same live numbers the wallet cards show, not the saved snapshots", () => {
    setDesk({
      portfolios: [
        basePortfolio({ value: 4000, cash: 500, pl: 100 }),
        // Snapshot says 1,000 / +50; its holdings at the live quote say 3,000 / +1,000.
        basePortfolio({
          id: 2,
          name: "الثانية",
          active: false,
          value: 1000,
          pl: 50,
          cash: 0,
          positions: [{ code: "ABUK", shares: 100, avgCost: 20, price: 25 }],
        }),
      ],
      totals: { value: 9000, cost: 8900, pl: 100, plPct: 1.12, day: 0, cash: 6000, hasDay: false },
      quotes: { ABUK: { price: 30 } },
    });
    render(<PortfolioDesk>مراكز</PortfolioDesk>);
    expect(screen.getByText("12,000 ج")).toBeInTheDocument(); // 9,000 live + 3,000
    expect(screen.getByText("+1,100 ج")).toBeInTheDocument(); // +100 live + 1,000
    expect(screen.getByText("6,000 ج")).toBeInTheDocument();
  });
});

describe("a wallet's numbers don't depend on whether it's selected", () => {
  const holdings = [{ code: "ABUK", shares: 100, avgCost: 20, price: 25 }];

  it("values an unselected wallet from its holdings at the shared live quote", () => {
    setDesk({
      portfolios: [
        basePortfolio({ id: 1 }),
        basePortfolio({ id: 2, name: "الثانية", active: false, value: 1000, pl: 50, cash: 0, positions: holdings }),
      ],
      quotes: { ABUK: { price: 30 } },
      portfolioCap: 3,
      user: { tier: "trader" },
    });
    render(<PortfolioSwitcher />);
    expect(screen.getByRole("button", { name: /الثانية/ })).toHaveTextContent("+1,000 ج (+50%)");
  });

  it("falls back to the holding's last close when a stock has no live quote", () => {
    setDesk({
      portfolios: [
        basePortfolio({ id: 1 }),
        basePortfolio({ id: 2, name: "الثانية", active: false, value: 1000, pl: 50, cash: 0, positions: holdings }),
      ],
      quotes: {},
      portfolioCap: 3,
      user: { tier: "trader" },
    });
    render(<PortfolioSwitcher />);
    expect(screen.getByRole("button", { name: /الثانية/ })).toHaveTextContent("+500 ج (+25%)");
  });

  it("values the selected wallet from its holdings while it is still loading, not as zero", () => {
    setDesk({
      portfolios: [basePortfolio({ value: 1000, pl: 50, cash: 0, positions: holdings })],
      pf: null,
      totals: { value: 0, cost: 0, pl: 0, plPct: 0, day: 0, cash: 0, hasDay: false },
      rows: [],
      quotes: { ABUK: { price: 30 } },
    });
    render(<PortfolioSwitcher />);
    expect(screen.getByRole("button", { name: /المحفظة الرئيسية/ })).toHaveTextContent("+1,000 ج (+50%)");
  });
});
