import { afterEach, describe, expect, it, vi } from "vitest";

import { getNetworkState, handleConnectivityChange, resetNetworkForTests, startNetworkMonitor, subscribeNetwork } from "./network";

afterEach(() => {
  resetNetworkForTests();
  vi.useRealTimers();
});

describe("network state", () => {
  it("goes OFFLINE immediately and notifies subscribers", async () => {
    const seen: string[] = [];
    subscribeNetwork(() => seen.push(getNetworkState()));
    await handleConnectivityChange(false);
    expect(getNetworkState()).toBe("OFFLINE");
    expect(seen).toEqual(["OFFLINE"]);
  });

  it("passes through RECONNECTING and is ONLINE only once the server answers", async () => {
    let answer!: (ok: boolean) => void;
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await startNetworkMonitor(() => new Promise<boolean>((resolve) => (answer = resolve)));
    expect(getNetworkState()).toBe("OFFLINE");

    const pending = handleConnectivityChange(true);
    expect(getNetworkState()).toBe("RECONNECTING");
    answer(true);
    await pending;
    expect(getNetworkState()).toBe("ONLINE");
  });

  it("keeps retrying instead of claiming ONLINE while the server is unreachable", async () => {
    vi.useFakeTimers();
    let reachable = false;
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await startNetworkMonitor(async () => reachable);

    await handleConnectivityChange(true, 1000);
    expect(getNetworkState()).toBe("RECONNECTING");
    reachable = true;
    await vi.advanceTimersByTimeAsync(1100);
    expect(getNetworkState()).toBe("ONLINE");
  });

  it("follows the browser's online/offline events on the web", async () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await startNetworkMonitor(async () => true);
    window.dispatchEvent(new Event("offline"));
    await Promise.resolve();
    expect(getNetworkState()).toBe("OFFLINE");
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(getNetworkState()).toBe("ONLINE"));
  });
});
