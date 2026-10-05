import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("./api", () => ({
    api: mocks.api,
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue({}),
    ApiError: class extends Error {
        status: number;
        constructor(message: string, status: number) {
            super(message);
            this.status = status;
        }
    },
}));

import { DeskProvider, useDesk } from "./store";

let desk: ReturnType<typeof useDesk> | undefined;

function CaptureDesk() {
    desk = useDesk();
    return null;
}

const savedPortfolios = [
    { id: 1, name: "الأولى", style: "medium", value: 1000, pl: 100, cash: 200, positionCount: 1, active: true, readOnly: false },
    { id: 2, name: "الثانية", style: "long", value: 2000, pl: 200, cash: 300, positionCount: 2, active: false, readOnly: false },
];

describe("DeskProvider portfolio summary refresh", () => {
    beforeEach(() => {
        localStorage.clear();
        desk = undefined;
        mocks.api.mockReset();
        mocks.api.mockImplementation(async (path: string) => {
            if (path === "/api/auth/me") return { user: { email: "desk@test.local", hasAccess: true, tier: "trader" } };
            if (path === "/api/universe") return { stocks: [], aiAvailable: false };
            if (path === "/api/indices") return { indices: {} };
            if (path === "/api/portfolio") return { positions: {}, cash: 1000, settings: { investStyle: "medium" }, trades: [] };
            if (path === "/api/portfolios") return { portfolios: savedPortfolios, activePortfolioId: 1, cap: 3 };
            if (path === "/api/log") return { log: {} };
            throw new Error(`Unexpected API request: ${path}`);
        });
    });

    it("does not reload all-wallet percentages when switching, but does on full reload", async () => {
        render(
            <DeskProvider>
                <CaptureDesk />
            </DeskProvider>,
        );
        await waitFor(() => expect(desk?.portfolios).toHaveLength(2));
        mocks.api.mockClear();

        await act(async () => {
            desk?.switchPortfolio(2, "long");
        });
        await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/portfolio"));
        expect(mocks.api).not.toHaveBeenCalledWith("/api/portfolios");
        expect(desk?.portfolios.map((portfolio) => portfolio.value)).toEqual([1000, 2000]);
        expect(desk?.portfolios.map((portfolio) => portfolio.active)).toEqual([false, true]);

        await act(async () => {
            await desk?.reload();
        });
        expect(mocks.api).toHaveBeenCalledWith("/api/portfolios");

        mocks.api.mockClear();
        await act(async () => {
            await desk?.reloadPortfolio();
        });
        expect(mocks.api).toHaveBeenCalledWith("/api/portfolios");
    });
});