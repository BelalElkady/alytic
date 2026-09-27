import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { LivePricesTab, type LivePricesStatus } from "@/components/admin/live-prices-tab";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));

const base: LivePricesStatus = {
  config: {
    requested: true,
    enabled: true,
    hasKey: true,
    clientReady: true,
    allowlist: null,
    monthlyQuota: 1000,
    billingDay: 1,
    ratePerSec: 2,
    compare: false,
  },
  state: "ok",
  sessionOpen: true,
  pausedUntil: null,
  period: {
    start: "2026-09-01",
    resetsOn: "2026-10-01",
    calls: 250,
    quota: 1000,
    stopAt: 950,
    rolledBack: false,
    reason: null,
    since: null,
  },
  counters: {
    oanorCalls: 250,
    oanorCodes: 3000,
    cacheHits: 900,
    fromOanor: 3000,
    fellBack: 12,
    rollbacks: 0,
    breakerOpens: 1,
  },
  events: [],
  gaps: [],
};

afterEach(() => apiMock.mockReset());

describe("LivePricesTab", () => {
  it("tells the admin when the quota ran out and subscribers are on TradingView", async () => {
    apiMock.mockResolvedValue({
      ...base,
      state: "rolled_back",
      period: {
        ...base.period!,
        calls: 950,
        rolledBack: true,
        reason: "count",
        since: "2026-09-20T09:00:00Z",
      },
      events: [{ at: "2026-09-20T09:00:00Z", type: "rollback", message: "وصلنا 950 من 1000 طلب" }],
    } satisfies LivePricesStatus);
    render(<LivePricesTab />);
    expect(await screen.findByText(/الحصة خلصت — المشتركين على TradingView/)).toBeInTheDocument();
    expect(screen.getByText(/وصلنا ٩٥٪ من OANOR_MONTHLY_QUOTA/)).toBeInTheDocument();
    expect(screen.getByText("وصلنا 950 من 1000 طلب")).toBeInTheDocument();
  });

  it("says oanor is off, and why, before it is set up", async () => {
    apiMock.mockResolvedValue({
      ...base,
      config: { ...base.config, enabled: false, clientReady: false },
      state: "off",
      period: null,
    } satisfies LivePricesStatus);
    render(<LivePricesTab />);
    expect(await screen.findByText(/عميل oanor لسه متكتبش/)).toBeInTheDocument();
    expect(screen.queryByText("حصة الفترة دي")).toBeNull();
  });

  it("shows a healthy pool with its quota usage and counters", async () => {
    apiMock.mockResolvedValue(base);
    render(<LivePricesTab />);
    expect(await screen.findByText("المشتركين بياخدوا أسعار oanor.")).toBeInTheDocument();
    expect(screen.getByText("حصة الفترة دي")).toBeInTheDocument();
    expect(screen.getByText("رجعت لـ TradingView")).toBeInTheDocument();
  });
});
