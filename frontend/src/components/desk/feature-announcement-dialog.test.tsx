import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { FeatureAnnouncementDialog } from "@/components/desk/feature-announcement-dialog";

const apiMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, post: postMock }));

afterEach(() => { apiMock.mockReset(); postMock.mockReset(); });

describe("FeatureAnnouncementDialog", () => {
  it("renders nothing when there is no active announcement", async () => {
    apiMock.mockResolvedValue({ announcement: null });
    render(<FeatureAnnouncementDialog />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/announcements/active"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the announcement and dismisses it exactly once on close", async () => {
    apiMock.mockResolvedValue({
      announcement: { id: "a1", title: "ميزة جديدة", body: "شرح الميزة\n\nفقرة تانية", imageUrls: ["https://example.com/a.png"], videoUrl: null },
    });
    postMock.mockResolvedValue({ ok: true });
    render(<FeatureAnnouncementDialog />);

    expect(await screen.findByText("ميزة جديدة")).toBeInTheDocument();
    expect(screen.getByText("شرح الميزة")).toBeInTheDocument();
    expect(screen.getByText("فقرة تانية")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.com/a.png");

    fireEvent.click(screen.getByText("تمام"));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/api/announcements/a1/dismiss"));
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
