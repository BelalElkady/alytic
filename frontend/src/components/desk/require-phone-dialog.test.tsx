import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/store", () => ({
  useDesk: () => ({ user: { email: "g@test.local", phone: null }, updatePhone: vi.fn() }),
}));

import { RequirePhoneDialog } from "@/components/desk/desk-shell";
import { WHATSAPP_NOTICE } from "@/lib/whatsapp";

describe("RequirePhoneDialog", () => {
  it("tells a Google signup about WhatsApp messages before they save a phone", () => {
    render(<RequirePhoneDialog />);
    expect(screen.getByText(WHATSAPP_NOTICE)).toBeTruthy();
  });
});
