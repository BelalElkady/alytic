import { describe, expect, it } from "vitest";

import { consumeLastCapturedError, describeError } from "./error-capture";

describe("describeError", () => {
  it("keeps the message and the stack of a plain error", () => {
    const err = new Error("boom");
    const text = describeError(err);
    expect(text.includes("boom")).toBe(true);
    expect(text.includes("at ")).toBe(true); // stack frames survive
  });

  it("walks the cause chain", () => {
    const root = new Error("disk full");
    const err = new Error("save failed", { cause: root });
    const text = describeError(err);
    expect(text.includes("save failed")).toBe(true);
    expect(text.includes("caused by:")).toBe(true);
    expect(text.includes("disk full")).toBe(true);
  });

  it("stops before unbounded cause loops", () => {
    const err: Error & { cause?: unknown } = new Error("loop");
    err.cause = err;
    // The depth limit (5) bounds the walk; each hop still carries the stack.
    const text = describeError(err);
    expect(text.length).toBeLessThan(8000);
    expect(text.split("caused by:").length - 1).toBe(4); // depth 0 + 4 hops
  });

  it("serialises non-Error values readably", () => {
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError({ code: 7 })).toContain('"code":7');
  });

  it("appends an HTTP status when the error carries one", () => {
    const err = Object.assign(new Error("too many"), { status: 429 });
    expect(describeError(err)).toContain("(status 429)");
  });
});

describe("console.error capture", () => {
  it("records the original error object for server.ts to recover", () => {
    expect(consumeLastCapturedError()).toBeUndefined();
    const err = new Error("captured-by-console");
    console.error(err);
    expect(consumeLastCapturedError()).toBe(err);
    expect(consumeLastCapturedError()).toBeUndefined(); // consumed once
  });

  it("leaves non-error console.error arguments untouched", () => {
    const spy = vi.spyOn(console, "error");
    console.error("hello", 42);
    expect(spy).toHaveBeenCalledWith("hello", 42);
    spy.mockRestore();
  });
});
