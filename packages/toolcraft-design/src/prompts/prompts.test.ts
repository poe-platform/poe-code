import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { spinner as primitiveSpinner } from "./primitives/spinner.js";

vi.mock("./primitives/spinner.js", () => ({
  spinner: vi.fn()
}));

vi.mock("./interactive/confirm.js", () => ({
  confirmPrompt: vi.fn()
}));

vi.mock("./primitives/cancel.js", () => ({
  cancel: vi.fn(),
  isCancel: vi.fn()
}));

const spinnerFactory = vi.mocked(primitiveSpinner);

function restoreEnv(name: "FORCE_COLOR" | "NO_COLOR" | "POE_NO_SPINNER", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

// === with-spinner.test.ts ===

describe("withSpinner", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let withSpinner: typeof import("./index.js").withSpinner;
  let resetOutputFormatCache: typeof import("../internal/output-format.js").resetOutputFormatCache;
  let resolveOutputFormat: typeof import("../internal/output-format.js").resolveOutputFormat;
  const originalEnv = process.env.POE_NO_SPINNER;
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    spinnerFactory.mockClear();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.POE_NO_SPINNER;
    ({ resetOutputFormatCache, resolveOutputFormat } = await import("../internal/output-format.js"));
    resetOutputFormatCache();
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true
    });
    ({ withSpinner } = await import("./index.js"));
  });

  afterEach(() => {
    vi.useRealTimers();
    stdoutSpy.mockRestore();
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    restoreEnv("POE_NO_SPINNER", originalEnv);
    resetOutputFormatCache();
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true
    });
  });

  it("starts spinner and stops with elapsed time", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const message = vi.fn();
    spinnerFactory.mockReturnValue({ start, stop, message } as any);

    const result = await withSpinner({
      message: "Loading...",
      fn: async () => "result",
      stopMessage: (r) => r
    });

    expect(result).toBe("result");
    expect(start).toHaveBeenCalledWith("Loading...");
    expect(stop).toHaveBeenCalledWith("result [0s]");
  });

  it("updates message with elapsed seconds", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const message = vi.fn();
    spinnerFactory.mockReturnValue({ start, stop, message } as any);

    let resolve: (value: string) => void;
    const fn = () => new Promise<string>((r) => { resolve = r; });

    const promise = withSpinner({
      message: "Working...",
      fn,
      stopMessage: () => "Done"
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(message).toHaveBeenCalledWith("Working... [1s]");

    await vi.advanceTimersByTimeAsync(1000);
    expect(message).toHaveBeenCalledWith("Working... [2s]");

    resolve!("ok");
    await promise;

    expect(stop).toHaveBeenCalledWith("Done [2s]");
  });

  it("formats minutes when elapsed exceeds 60s", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const message = vi.fn();
    spinnerFactory.mockReturnValue({ start, stop, message } as any);

    let resolve: (value: string) => void;
    const fn = () => new Promise<string>((r) => { resolve = r; });

    const promise = withSpinner({
      message: "Working...",
      fn,
      stopMessage: () => "Done"
    });

    await vi.advanceTimersByTimeAsync(65_000);
    expect(message).toHaveBeenCalledWith("Working... [1m 5s]");

    resolve!("ok");
    await promise;

    expect(stop).toHaveBeenCalledWith("Done [1m 5s]");
  });

  it("clears timer on error", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const message = vi.fn();
    spinnerFactory.mockReturnValue({ start, stop, message } as any);

    await expect(
      withSpinner({
        message: "Failing...",
        fn: async () => { throw new Error("boom"); }
      })
    ).rejects.toThrow("boom");

    expect(stop).toHaveBeenCalledWith("", 1);
  });

  it("renders subtext after stop", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const message = vi.fn();
    spinnerFactory.mockReturnValue({ start, stop, message } as any);

    await withSpinner({
      message: "Working...",
      fn: async () => "response content",
      stopMessage: () => "Model",
      subtext: (r) => r
    });

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("response content");
  });

  it("falls back to plain output without ANSI when POE_NO_SPINNER=1 and NO_COLOR=1", async () => {
    process.env.POE_NO_SPINNER = "1";
    process.env.NO_COLOR = "1";

    const result = await withSpinner({
      message: "Loading...",
      fn: async () => "hello",
      stopMessage: (r) => r,
      subtext: (r) => r
    });

    expect(result).toBe("hello");
    expect(spinnerFactory).not.toHaveBeenCalled();

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("hello");
    expect(output).not.toContain("\x1b[");
  });

  it("falls back to plain output without ANSI when not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
      configurable: true
    });

    const result = await withSpinner({
      message: "Loading...",
      fn: async () => "hello",
      stopMessage: (r) => r
    });

    expect(result).toBe("hello");
    expect(spinnerFactory).not.toHaveBeenCalled();

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("hello");
    expect(output).not.toContain("\x1b[");
  });

  it("uses default stop text when stopMessage is omitted", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const message = vi.fn();
    spinnerFactory.mockReturnValue({ start, stop, message } as any);

    await withSpinner({
      message: "Loading...",
      fn: async () => 42
    });

    expect(stop).toHaveBeenCalledWith(expect.stringContaining("Done ["));
  });

  it("outputs raw subtext without decoration when OUTPUT_FORMAT=json", async () => {
    resetOutputFormatCache();
    resolveOutputFormat({ OUTPUT_FORMAT: "json" });

    const result = await withSpinner({
      message: "Loading...",
      fn: async () => "raw content",
      stopMessage: (r) => r,
      subtext: (r) => r
    });

    expect(result).toBe("raw content");
    expect(spinnerFactory).not.toHaveBeenCalled();

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toBe("raw content\n");
    expect(output).not.toContain("│");
    expect(output).not.toContain("\x1b[");
  });

  it("skips all output when OUTPUT_FORMAT=json and no subtext", async () => {
    resetOutputFormatCache();
    resolveOutputFormat({ OUTPUT_FORMAT: "json" });

    const result = await withSpinner({
      message: "Loading...",
      fn: async () => "value",
      stopMessage: (r) => r
    });

    expect(result).toBe("value");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

// === index.test.ts ===

describe("confirmOrCancel", () => {
  let promptConfirm: Mock;
  let primitiveCancel: Mock;
  let primitiveIsCancel: Mock;
  let confirmOrCancel: typeof import("./index.js").confirmOrCancel;
  let PromptCancelledError: typeof import("./index.js").PromptCancelledError;
  let stdoutSpy2: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    const confirmModule = await import("./interactive/confirm.js");
    const cancelPrimitive = await import("./primitives/cancel.js");
    ({ confirmOrCancel, PromptCancelledError } = await import("./index.js"));
    promptConfirm = vi.mocked(confirmModule.confirmPrompt);
    primitiveCancel = vi.mocked(cancelPrimitive.cancel);
    primitiveIsCancel = vi.mocked(cancelPrimitive.isCancel);
    vi.clearAllMocks();
    primitiveIsCancel.mockReturnValue(false);
    stdoutSpy2 = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy2.mockRestore();
  });

  it("returns true when user confirms", async () => {
    promptConfirm.mockResolvedValueOnce(true as any);

    await expect(
      confirmOrCancel({ message: "Proceed?" })
    ).resolves.toBe(true);
  });

  it("returns false when user declines", async () => {
    promptConfirm.mockResolvedValueOnce(false as any);

    await expect(
      confirmOrCancel({ message: "Proceed?" })
    ).resolves.toBe(false);
  });

  it("throws PromptCancelledError when user cancels", async () => {
    const cancelled = Symbol("cancelled");
    promptConfirm.mockResolvedValueOnce(cancelled as any);
    primitiveIsCancel.mockReturnValue(true);

    await expect(
      confirmOrCancel({ message: "Proceed?" })
    ).rejects.toBeInstanceOf(PromptCancelledError);
    expect(primitiveCancel).toHaveBeenCalledWith("Operation cancelled.");
    expect(stdoutSpy2).not.toHaveBeenCalled();
  });
});
