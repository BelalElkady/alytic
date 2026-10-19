import { describe, expect, it } from "vitest";

import { DEFAULT_TENANT, type Tenant } from "./tenant";
import { ogImageUrl } from "./seo";

const matchFor = (tenant: Tenant) => ({ context: { tenant } });

describe("ogImageUrl", () => {
  it("uses the 1200x630 share card on our own site", () => {
    expect(ogImageUrl(matchFor(DEFAULT_TENANT))).toBe("https://egxpert.com/og-default.png");
  });

  it("falls back to the logo for a client site", () => {
    const client: Tenant = {
      ...DEFAULT_TENANT,
      id: "clientx",
      siteUrl: "https://app.clientx.com/",
      brand: { ...DEFAULT_TENANT.brand, logoUrl: "/logo.png" },
    };
    expect(ogImageUrl(matchFor(client))).toBe("https://app.clientx.com/logo.png");
  });
});
