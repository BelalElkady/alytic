import { beforeEach, describe, expect, it } from "vitest";

import {
  loadTrackers,
  readConsent,
  resetTrackersForTests,
  saveConsent,
  validGaId,
} from "./consent";

const scripts = () => Array.from(document.head.querySelectorAll("script"));

describe("consent", () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = "";
    resetTrackersForTests();
  });

  it("has no answer until the visitor chooses", () => {
    expect(readConsent()).toBeNull();
    saveConsent("denied");
    expect(readConsent()).toBe("denied");
    saveConsent("granted");
    expect(readConsent()).toBe("granted");
  });

  it("ignores a stored value it does not recognise", () => {
    localStorage.setItem("egx-tracking-consent", "maybe");
    expect(readConsent()).toBeNull();
  });

  it("only accepts a well-formed GA id", () => {
    expect(validGaId("G-789W810GMB")).toBe("G-789W810GMB");
    expect(validGaId("G-1');alert(1);//")).toBeUndefined();
    expect(validGaId(undefined)).toBeUndefined();
  });

  it("injects GA and the Meta Pixel for our own site, and only once", () => {
    loadTrackers({ gaId: "G-789W810GMB", pixel: true });
    loadTrackers({ gaId: "G-789W810GMB", pixel: true });
    // The pixel snippet appends fbevents.js itself, so count by kind, not in total.
    const all = scripts();
    expect(all.filter((s) => s.src.includes("googletagmanager.com/gtag/js")).length).toBe(1);
    expect(all.filter((s) => s.text.includes("fbq('init'")).length).toBe(1);
  });

  it("never loads the Meta Pixel for a client site, and drops a bad GA id", () => {
    loadTrackers({ gaId: "not-an-id", pixel: false });
    expect(scripts()).toHaveLength(0);
  });
});
