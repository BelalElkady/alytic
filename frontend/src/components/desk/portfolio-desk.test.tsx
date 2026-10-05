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

  it("shows wallet share and return percentages in the horizontal wallet row", () => {
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
    expect(screen.getAllByText(/حصة من الإجمالي/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /المحفظة الرئيسية/ })).toHaveClass("border-up");
    expect(screen.getByRole("button", { name: /الثانية/ })).toHaveTextContent("-250 ج (-4.76%)");
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
    expect(thirdWallet.querySelector(".bg-purple-500")).toBeInTheDocument();
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
});
