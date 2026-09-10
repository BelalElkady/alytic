import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  Panel,
  Spinner,
  Stat,
} from "@/components/desk/state-blocks";

describe("state blocks", () => {
  it("Panel renders its header and body", () => {
    render(
      <Panel
        title="سجّل صفقة"
        description="أي بيع أو شراء اتنفذ فعليًا"
        action={<span>عنوان جانبي</span>}
      >
        <p>المحتوى</p>
      </Panel>,
    );
    expect(screen.getByText("سجّل صفقة")).toBeInTheDocument();
    expect(screen.getByText("أي بيع أو شراء اتنفذ فعليًا")).toBeInTheDocument();
    expect(screen.getByText("عنوان جانبي")).toBeInTheDocument();
    expect(screen.getByText("المحتوى")).toBeInTheDocument();
  });

  it("Panel skips the header entirely when nothing is set", () => {
    const { container } = render(<Panel>بس محتوى</Panel>);
    expect(container.querySelector("[data-slot='card-header']")).toBeNull();
    expect(screen.getByText("بس محتوى")).toBeInTheDocument();
  });

  it("EmptyState shows the title and hint", () => {
    render(<EmptyState title="لا توجد صفقات مسجلة بعد" hint="سجّل أول صفقة من الأعلى." />);
    expect(screen.getByText("لا توجد صفقات مسجلة بعد")).toBeInTheDocument();
    expect(screen.getByText("سجّل أول صفقة من الأعلى.")).toBeInTheDocument();
  });

  it("ErrorState announces the failure", () => {
    render(<ErrorState message="تعذر الحفظ" />);
    expect(screen.getByText("تعذر الحفظ")).toBeInTheDocument();
  });

  it("Notice switches its tone classes", () => {
    const { container, rerender } = render(<Notice tone="warn">تحذير</Notice>);
    expect(container.firstElementChild?.className).toContain("bg-warn-soft");
    rerender(<Notice tone="danger">خطر</Notice>);
    expect(container.firstElementChild?.className).toContain("bg-down-soft");
  });

  it("LoadingBlock sets busy/live attributes", () => {
    const { container } = render(<LoadingBlock rows={4} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.getAttribute("aria-live")).toBe("polite");
    expect(root.children.length).toBe(4);
  });

  it("Stat pairs a label with a value and tone", () => {
    render(<Stat label="الكاش" value="1,000" valueClassName="text-up" sub="إجمالي 5,000 ج" />);
    expect(screen.getByText("الكاش")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("1,000").className).toContain("text-up");
    expect(screen.getByText("إجمالي 5,000 ج")).toBeInTheDocument();
  });

  it("Spinner renders an svg icon", () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
