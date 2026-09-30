import { describe, expect, it } from "vitest";

import { resolveDeepLink } from "./deep-links";

describe("deep links", () => {
  it("opens a stock from the website's /stocks/ URL", () => {
    expect(resolveDeepLink("https://egxpert.com/stocks/SWDY")).toEqual({ to: "/stock/SWDY" });
    expect(resolveDeepLink("https://egxpert.com/stock/swdy")).toEqual({ to: "/stock/SWDY" });
  });

  it.each([
    ["https://egxpert.com/portfolio", "/portfolio"],
    ["https://egxpert.com/alerts", "/targets"],
    ["https://egxpert.com/", "/portfolio"],
    ["https://egxpert.com/settings", "/settings"],
  ])("maps %s to %s", (url, to) => {
    expect(resolveDeepLink(url)).toEqual({ to });
  });

  it("supports the egxpert:// fallback scheme", () => {
    expect(resolveDeepLink("egxpert://stock/SWDY")).toEqual({ to: "/stock/SWDY" });
    expect(resolveDeepLink("egxpert:///portfolio")).toEqual({ to: "/portfolio" });
  });

  it("accepts a bare in-app path (push payloads)", () => {
    expect(resolveDeepLink("/stock/COMI")).toEqual({ to: "/stock/COMI" });
  });

  it("carries a one-time token to reset-password / verify-email", () => {
    expect(resolveDeepLink("https://egxpert.com/reset-password?token=abcdef123456")).toEqual({
      to: "/reset-password",
      search: { token: "abcdef123456" },
    });
    expect(resolveDeepLink("https://egxpert.com/reset-password?token=<script>")).toEqual({ to: "/reset-password" });
  });

  it("refuses foreign hosts, unknown paths, odd schemes and malformed stock codes", () => {
    expect(resolveDeepLink("https://evil.example/stocks/SWDY")).toBeNull();
    expect(resolveDeepLink("https://egxpert.com.evil.example/portfolio")).toBeNull();
    expect(resolveDeepLink("https://egxpert.com/admin")).toBeNull();
    expect(resolveDeepLink("javascript:alert(1)")).toBeNull();
    expect(resolveDeepLink("http://egxpert.com/portfolio")).toBeNull();
    expect(resolveDeepLink("https://egxpert.com/stocks/../../etc")).toBeNull();
    expect(resolveDeepLink("https://egxpert.com/stocks/A B")).toBeNull();
    expect(resolveDeepLink("//evil.example/portfolio")).toBeNull();
    expect(resolveDeepLink("")).toBeNull();
    expect(resolveDeepLink(null)).toBeNull();
  });
});
