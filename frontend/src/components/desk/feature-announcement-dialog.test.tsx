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

  it("renders the button as a link, opening external links in a new tab, and dismisses on click", async () => {
    apiMock.mockResolvedValue({
      announcement: { id: "a2", title: "عرض", body: "نص", imageUrls: [], videoUrl: null, cta: { label: "شوف العرض", url: "https://example.com/offer" } },
    });
    postMock.mockResolvedValue({ ok: true });
    render(<FeatureAnnouncementDialog />);

    const link = await screen.findByRole("link", { name: "شوف العرض" });
    expect(link).toHaveAttribute("href", "https://example.com/offer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(link);
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/api/announcements/a2/dismiss"));
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("sends an in-app button through the router instead of reloading the page", async () => {
    apiMock.mockResolvedValue({
      announcement: { id: "a3", title: "جدّد", body: "نص", imageUrls: [], videoUrl: null, cta: { label: "جدّد اشتراكك", url: "/subscribe" } },
    });
    postMock.mockResolvedValue({ ok: true });
    const onNavigate = vi.fn();
    render(<FeatureAnnouncementDialog onNavigate={onNavigate} />);

    const link = await screen.findByRole("link", { name: "جدّد اشتراكك" });
    expect(link).not.toHaveAttribute("target");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("/subscribe");
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/api/announcements/a3/dismiss"));
  });
});
