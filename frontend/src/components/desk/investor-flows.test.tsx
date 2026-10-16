import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { InvestorFlows, groupLabel, type InvestorFlowsData } from "@/components/desk/investor-flows";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));

afterEach(() => apiMock.mockReset());

const flows = (over: Partial<InvestorFlowsData> = {}): InvestorFlowsData => ({
  sessionDate: "2026-10-11",
  sourceUrl: "https://example.com/wrap",
  fetchedAt: "2026-10-11T13:00:00Z",
  groups: [
    { nationality: "egyptian", type: "all", netEgp: 120e6, sharePct: 70, buyEgp: null, sellEgp: null },
    { nationality: "foreign", type: "all", netEgp: -90e6, sharePct: 10, buyEgp: null, sellEgp: null },
  ],
  ...over,
});

const settle = () => act(async () => {});

describe("InvestorFlows", () => {
  it("renders nothing when flows is null", async () => {
    apiMock.mockResolvedValue({ flows: null });
    const { container } = render(<InvestorFlows />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/indices/investor-flows"));
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the request fails", async () => {
    apiMock.mockRejectedValue(new Error("boom"));
    const { container } = render(<InvestorFlows />);
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows net buy in green and net sell in red", async () => {
    apiMock.mockResolvedValue({ flows: flows() });
    render(<InvestorFlows />);
    expect(await screen.findByText("تعاملات المستثمرين")).toBeInTheDocument();
    expect(screen.getByText("صافي شراء")).toHaveClass("text-up");
    expect(screen.getByText("صافي بيع")).toHaveClass("text-down");
  });

  it("does not show a source link", async () => {
    apiMock.mockResolvedValue({ flows: flows() });
    render(<InvestorFlows />);
    expect(await screen.findByText("تعاملات المستثمرين")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("labels a zero net neutrally, not as a sell", async () => {
    apiMock.mockResolvedValue({
      flows: flows({ groups: [{ nationality: "arab", type: "all", netEgp: 0, sharePct: null, buyEgp: null, sellEgp: null }] }),
    });
    render(<InvestorFlows />);
    expect(await screen.findByText("متعادل")).toBeInTheDocument();
    expect(screen.queryByText("صافي بيع")).not.toBeInTheDocument();
  });

  it("labels groups in Arabic", () => {
    expect(groupLabel("egyptian", "all")).toBe("مصريين");
    expect(groupLabel("all", "institution")).toBe("مؤسسات");
    expect(groupLabel("arab", "individual")).toBe("عرب — أفراد");
  });
});
