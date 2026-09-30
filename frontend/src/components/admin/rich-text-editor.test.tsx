import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "@/components/admin/rich-text-editor";

describe("RichTextEditor", () => {
  it("renders the toolbar and loads the initial HTML, including tables", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        initialHtml="<h2>عنوان</h2><table><tbody><tr><th>a</th></tr></tbody></table>"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("نص المقالة")).toBeTruthy());
    expect(screen.getByLabelText("حجم الخط")).toBeTruthy();
    expect(screen.getByLabelText("نوع النص")).toBeTruthy();
    expect(screen.getByTitle("إدراج جدول")).toBeTruthy();
    expect(document.querySelector(".blog-html h2")?.textContent).toBe("عنوان");
    expect(document.querySelector(".blog-html table")).toBeTruthy();
  });
});
