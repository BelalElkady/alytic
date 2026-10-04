import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioDesk } from "./portfolio-desk";

const desk = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/store", () => ({ useDesk: () => desk.current }));
// PortfolioDesk's read-only/upsell CTAs use <Link>, which needs a router
// context this unit test never mounts — stub it to a plain anchor.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const basePortfolio = (overrides: Record<string, unknown>) => ({
  id: 1, name: "المحفظة الرئيسية", style: "medium", value: 10000, pl: 500, cash: 2000,
  positionCount: 3, active: true, readOnly: false, ...overrides,
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

describe("PortfolioDesk", () => {
  beforeEach(() => setDesk({}));

  it("shows the upsell card, not an add button, for a non-trader User with 1 Portfolio", () => {
    render(<PortfolioDesk>مراكز</PortfolioDesk>);
    expect(screen.getByText(/لحد ٣ محافظ مع الحريفة/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "محفظة جديدة" })).not.toBeInTheDocument();
  });

  it("shows no add affordance for a trader User already at 3 Portfolios", () => {
    setDesk({
      portfolios: [basePortfolio({ id: 1 }), basePortfolio({ id: 2, active: false }), basePortfolio({ id: 3, active: false })],
      portfolioCap: 3,
      user: { tier: "trader" },
    });
    render(<PortfolioDesk>مراكز</PortfolioDesk>);
    expect(screen.queryByRole("button", { name: "محفظة جديدة" })).not.toBeInTheDocument();
    expect(screen.queryByText(/لحد ٣ محافظ/)).not.toBeInTheDocument();
  });

  it("clicking a non-active card switches the active Portfolio", () => {
    setDesk({
      portfolios: [basePortfolio({ id: 1 }), basePortfolio({ id: 2, name: "الثانية", active: false, readOnly: true })],
      portfolioCap: 1,
      user: { tier: "free" },
    });
    render(<PortfolioDesk>مراكز</PortfolioDesk>);
    // "الثانية" also appears in the allocation bar's legend — scope to the card itself.
    fireEvent.click(screen.getByRole("button", { name: /الثانية/ }));
    expect(desk.current.switchPortfolio).toHaveBeenCalledWith(2);
  });

  it("shows the read-only banner for a locked active Portfolio", () => {
    setDesk({ portfolios: [basePortfolio({ readOnly: true })] });
    render(<PortfolioDesk>مراكز</PortfolioDesk>);
    expect(screen.getByText(/للعرض بس/)).toBeInTheDocument();
  });

  it("renders the wrapped children below the cards", () => {
    render(<PortfolioDesk>علامة-مميزة-للمحتوى</PortfolioDesk>);
    expect(screen.getByText("علامة-مميزة-للمحتوى")).toBeInTheDocument();
  });
});
