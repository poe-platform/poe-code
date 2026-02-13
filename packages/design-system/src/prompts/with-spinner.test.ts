import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as clack from "@clack/prompts";
import { withSpinner } from "./index.js";
import { resetOutputFormatCache, resolveOutputFormat } from "../internal/output-format.js";

vi.mock("@clack/prompts", () => ({
  spinner: vi.fn()
}));

const clackSpinner = vi.mocked(clack.spinner);

describe("withSpinner", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env.POE_NO_SPINNER;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.useFakeTimers();
    clackSpinner.mockClear();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.env.POE_NO_SPINNER = undefined;
    resetOutputFormatCache();
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    stdoutSpy.mockRestore();
    process.env.POE_NO_SPINNER = originalEnv;
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
    clackSpinner.mockReturnValue({ start, stop, message } as any);

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
    clackSpinner.mockReturnValue({ start, stop, message } as any);

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
    clackSpinner.mockReturnValue({ start, stop, message } as any);

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
    clackSpinner.mockReturnValue({ start, stop, message } as any);

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
    clackSpinner.mockReturnValue({ start, stop, message } as any);

    await withSpinner({
      message: "Working...",
      fn: async () => "response content",
      stopMessage: () => "Model",
      subtext: (r) => r
    });

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("response content");
  });

  it("falls back to plain output when POE_NO_SPINNER=1", async () => {
    process.env.POE_NO_SPINNER = "1";

    const result = await withSpinner({
      message: "Loading...",
      fn: async () => "hello",
      stopMessage: (r) => r,
      subtext: (r) => r
    });

    expect(result).toBe("hello");
    expect(clackSpinner).not.toHaveBeenCalled();

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("hello");
  });

  it("falls back to plain output when not a TTY", async () => {
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
    expect(clackSpinner).not.toHaveBeenCalled();

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("hello");
  });

  it("uses default stop text when stopMessage is omitted", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const message = vi.fn();
    clackSpinner.mockReturnValue({ start, stop, message } as any);

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
    expect(clackSpinner).not.toHaveBeenCalled();

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
