import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetTrackersForTests } from "@/lib/consent";
import { DEFAULT_TENANT } from "@/lib/tenant";

import { ConsentBanner } from "./consent-banner";

let tenant = DEFAULT_TENANT;
vi.mock("@/lib/tenant", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant")>()),
  useTenant: () => tenant,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const trackerScripts = () =>
  Array.from(document.head.querySelectorAll("script")).filter(
    (s) => s.src.includes("googletagmanager") || s.text.includes("fbq("),
  );

describe("ConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = "";
    resetTrackersForTests();
    tenant = DEFAULT_TENANT;
  });

  it("asks first and loads nothing until the visitor agrees", () => {
    render(<ConsentBanner />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(trackerScripts()).toHaveLength(0);

    fireEvent.click(screen.getByText("موافق"));
    expect(trackerScripts().length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("egx-tracking-consent")).toBe("granted");
  });

  it("stays off after a refusal and does not ask again", () => {
    const { unmount } = render(<ConsentBanner />);
    fireEvent.click(screen.getByText("لا، شكرًا"));
    expect(trackerScripts()).toHaveLength(0);
    unmount();

    render(<ConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trackerScripts()).toHaveLength(0);
  });

  it("loads trackers straight away for a visitor who already agreed", () => {
    localStorage.setItem("egx-tracking-consent", "granted");
    render(<ConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trackerScripts().length).toBeGreaterThan(0);
  });

  it("does not ask on a site with nothing to track", () => {
    tenant = { ...DEFAULT_TENANT, id: "client", brand: { ...DEFAULT_TENANT.brand, analytics: {} } };
    render(<ConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
