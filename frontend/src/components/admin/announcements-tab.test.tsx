import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AnnouncementsTab, type Announcement } from "@/components/admin/announcements-tab";

const apiMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const delMock = vi.hoisted(() => vi.fn());
const postRawMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, post: postMock, del: delMock, postRaw: postRawMock }));

const row = (overrides: Partial<Announcement>): Announcement => ({
  id: "a1",
  title: "ميزة",
  body: "شرح",
  imageUrls: [],
  videoUrl: null,
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2026-01-02T00:00:00Z",
  createdAt: "2025-12-31T00:00:00Z",
  ...overrides,
});

beforeEach(() => vi.setSystemTime(new Date("2026-01-01T12:00:00Z")));
afterEach(() => { apiMock.mockReset(); postMock.mockReset(); delMock.mockReset(); postRawMock.mockReset(); vi.useRealTimers(); });

describe("AnnouncementsTab", () => {
  it("labels each row upcoming, active or ended based on its date range", async () => {
    apiMock.mockResolvedValue({
      announcements: [
        row({ id: "upcoming", startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-02T00:00:00Z" }),
        row({ id: "active", startsAt: "2025-12-31T00:00:00Z", endsAt: "2026-01-02T00:00:00Z" }),
        row({ id: "ended", startsAt: "2025-01-01T00:00:00Z", endsAt: "2025-01-02T00:00:00Z" }),
      ],
    });
    render(<AnnouncementsTab />);
    expect(await screen.findByText("قادم")).toBeInTheDocument();
    expect(screen.getByText("نشط")).toBeInTheDocument();
    expect(screen.getByText("انتهى")).toBeInTheDocument();
  });

  it("deletes an announcement after confirming", async () => {
    apiMock.mockResolvedValue({ announcements: [row({})] });
    delMock.mockResolvedValue({ ok: true });
    render(<AnnouncementsTab />);
    await screen.findByText("ميزة");
    fireEvent.click(screen.getByLabelText("حذف ميزة"));
    fireEvent.click(screen.getByText("نعم، احذف"));
    await waitFor(() => expect(delMock).toHaveBeenCalledWith("/api/admin/announcements/a1"));
  });
});
