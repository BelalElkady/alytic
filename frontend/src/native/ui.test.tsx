import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { handleConnectivityChange, resetNetworkForTests, startNetworkMonitor } from "./network";
import { ConnectionBanner } from "./ui";

afterEach(() => resetNetworkForTests());

describe("ConnectionBanner", () => {
  it("is invisible while online, then says the data may be old when offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await startNetworkMonitor(async () => true);
    render(<ConnectionBanner />);
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      await handleConnectivityChange(false);
    });
    expect(screen.getByRole("status")).toHaveTextContent("غير متصل");
    expect(screen.getByRole("status")).toHaveTextContent("قديمة");
  });

  it("shows a reconnecting message until the server answers", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    let answer!: (ok: boolean) => void;
    await startNetworkMonitor(() => new Promise<boolean>((resolve) => (answer = resolve)));
    render(<ConnectionBanner />);
    await act(async () => {
      void handleConnectivityChange(true);
    });
    expect(screen.getByRole("status")).toHaveTextContent("بنعيد الاتصال");
    await act(async () => answer(true));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
