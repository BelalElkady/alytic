import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { WhatsappTab, type WhatsappStepsResponse } from "@/components/admin/whatsapp-tab";

const mocks = vi.hoisted(() => ({ api: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api, put: mocks.put }));

const offer = { discountPct: 20, validDays: 3, plan: "long_yearly" };
const counts = { sent: 4, delivered: 3, read: 2, failed: 1 };
const step = (key: string, params: Record<string, unknown> = {}) => ({
  key,
  enabled: false,
  templateName: key,
  templateLang: "ar",
  params,
  counts,
});

const response: WhatsappStepsResponse = {
  steps: [
    step("trial_welcome"),
    step("trial_stoploss"),
    step("trial_ending", offer),
    step("trial_ended", offer),
    step("paid_welcome"),
    step("survey"),
    step("renewal", { ...offer, validDays: 7, whatsNew: "" }),
  ],
  surveyAnswers: [{ text: "السعر", count: 5 }],
  liveSending: false,
  plans: { long_yearly: { label: "النفس الطويل", priceEgp: 2990 } },
};

afterEach(() => {
  mocks.api.mockReset();
  mocks.put.mockReset();
});

const card = (title: string) => screen.getByRole("region", { name: title });

describe("WhatsappTab", () => {
  it("shows a card per step and the test-mode banner", async () => {
    mocks.api.mockResolvedValue(response);
    render(<WhatsappTab />);
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(7));
    expect(screen.getByText("وضع التجربة: الرسايل بتروح للأرقام المسموح بيها بس.")).toBeTruthy();
    expect(within(card("استبيان")).getByText(/السعر: 5/)).toBeTruthy();
  });

  it("saves an edited discount", async () => {
    mocks.api.mockResolvedValue(response);
    mocks.put.mockResolvedValue({ step: { ...response.steps[2], params: { ...offer, discountPct: 30 } } });
    render(<WhatsappTab />);
    const ending = await waitFor(() => card("قرب نهاية التجربة"));
    fireEvent.change(within(ending).getByLabelText("نسبة الخصم ٪"), { target: { value: "30" } });
    fireEvent.click(within(ending).getByRole("button", { name: "حفظ" }));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith("/api/admin/whatsapp/steps/trial_ending", {
        enabled: false,
        templateName: "trial_ending",
        params: { ...offer, discountPct: 30 },
      }),
    );
  });

  it("previews the message with sample values", async () => {
    mocks.api.mockResolvedValue(response);
    render(<WhatsappTab />);
    const ending = await waitFor(() => card("قرب نهاية التجربة"));
    const preview = within(ending).getByTestId("whatsapp-preview").textContent ?? "";
    expect(preview).toContain("أحمد");
    expect(preview).toContain("بخصم 20٪");
    expect(preview).toContain("2392");
    expect(preview).not.toContain("{{");
  });
});
