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
  ctaLabel: null,
  ctaUrl: null,
  audiences: [],
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

  it("shows who each announcement targets, and its button", async () => {
    apiMock.mockResolvedValue({
      announcements: [
        row({ id: "all", title: "للكل" }),
        row({ id: "some", title: "لناس معينة", audiences: ["trial_ending", "expired"], ctaLabel: "اشترك", ctaUrl: "/subscribe" }),
      ],
    });
    render(<AnnouncementsTab />);
    await screen.findByText("لناس معينة");
    // The same labels also name the form's checkboxes, so look only at the badges (rows).
    const badge = (text: string) => screen.getAllByText(text).find((el) => el.getAttribute("data-slot") !== "label" && el.tagName !== "LABEL");
    expect(screen.getByText("الكل")).toBeInTheDocument();
    expect(badge("تجربتهم على وشك الانتهاء (يومين أو أقل)")).toBeTruthy();
    expect(badge("اشتراك منتهي")).toBeTruthy();
    expect(screen.getByText("اشترك → /subscribe")).toBeInTheDocument();
  });

  it("creates an announcement with a button and the ticked audiences", async () => {
    apiMock.mockResolvedValue({ announcements: [] });
    postMock.mockResolvedValue({});
    render(<AnnouncementsTab />);
    await screen.findByText("تنبيه جديد");
    const [title, body] = [screen.getAllByRole("textbox")[0], screen.getAllByRole("textbox")[1]];
    fireEvent.change(title, { target: { value: "خصم" } });
    fireEvent.change(body, { target: { value: "عرض" } });
    fireEvent.change(screen.getByLabelText("نص الزرار"), { target: { value: "اشترك دلوقتي" } });
    fireEvent.change(screen.getByLabelText("رابط الزرار"), { target: { value: "/subscribe" } });
    fireEvent.click(screen.getByLabelText("تجربتهم على وشك الانتهاء (يومين أو أقل)"));
    fireEvent.click(screen.getByLabelText("اشتراك منتهي"));
    const [start, end] = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    fireEvent.change(start, { target: { value: "2026-01-01" } });
    fireEvent.change(end, { target: { value: "2026-01-05" } });
    fireEvent.click(screen.getByText("إضافة التنبيه"));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][0]).toBe("/api/admin/announcements");
    expect(postMock.mock.calls[0][1]).toMatchObject({
      ctaLabel: "اشترك دلوقتي",
      ctaUrl: "/subscribe",
      audiences: ["trial_ending", "expired"],
    });
  });

  it("refuses a button link that is neither an in-app path nor https", async () => {
    apiMock.mockResolvedValue({ announcements: [] });
    render(<AnnouncementsTab />);
    await screen.findByText("تنبيه جديد");
    const [title, body] = [screen.getAllByRole("textbox")[0], screen.getAllByRole("textbox")[1]];
    fireEvent.change(title, { target: { value: "خصم" } });
    fireEvent.change(body, { target: { value: "عرض" } });
    fireEvent.change(screen.getByLabelText("نص الزرار"), { target: { value: "اضغط" } });
    fireEvent.change(screen.getByLabelText("رابط الزرار"), { target: { value: "javascript:alert(1)" } });
    const [start, end] = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    fireEvent.change(start, { target: { value: "2026-01-01" } });
    fireEvent.change(end, { target: { value: "2026-01-05" } });
    fireEvent.click(screen.getByText("إضافة التنبيه"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postMock).not.toHaveBeenCalled();
  });
});
