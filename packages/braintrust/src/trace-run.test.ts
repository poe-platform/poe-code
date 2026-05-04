import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "./client.js";
import { makeTraceRun } from "./trace-run.js";

const mockBraintrust = vi.hoisted(() => ({
  importCount: 0,
  initLogger: vi.fn(),
  initExperiment: vi.fn(),
  flush: vi.fn(),
  traced: vi.fn(),
  currentSpan: vi.fn(),
}));

vi.mock("braintrust", () => {
  mockBraintrust.importCount += 1;

  return {
    initLogger: mockBraintrust.initLogger,
    initExperiment: mockBraintrust.initExperiment,
    flush: mockBraintrust.flush,
    get traced() {
      return mockBraintrust.traced;
    },
    currentSpan: mockBraintrust.currentSpan,
  };
});

describe("makeTraceRun", () => {
  beforeEach(() => {
    mockBraintrust.importCount = 0;
    mockBraintrust.initLogger.mockReset();
    mockBraintrust.initExperiment.mockReset();
    mockBraintrust.flush.mockReset();
    mockBraintrust.traced.mockReset();
    mockBraintrust.currentSpan.mockReset();
  });

  it("runs the callback inside a named task span with the surface tag", async () => {
    mockBraintrust.initLogger.mockReturnValue({ id: "logger" });
    mockBraintrust.traced.mockImplementation(
      async (fn: () => Promise<string>) => fn(),
    );
    const client = createClient({ apiKey: "key", project: "project" });
    const traceRun = makeTraceRun(client);
    const fn = vi.fn(async () => "done");

    await expect(traceRun("spawn", "worker", fn)).resolves.toBe("done");

    expect(mockBraintrust.importCount).toBe(1);
    expect(mockBraintrust.initLogger).toHaveBeenCalledTimes(1);
    expect(mockBraintrust.traced).toHaveBeenCalledTimes(1);
    expect(mockBraintrust.traced).toHaveBeenCalledWith(expect.any(Function), {
      name: "spawn:worker",
      type: "task",
      event: {
        tags: ["surface:spawn"],
      },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the callback and records setup errors", async () => {
    mockBraintrust.initLogger.mockReturnValue({ id: "logger" });
    mockBraintrust.traced.mockImplementation(() => {
      throw new Error("trace init failed");
    });
    const client = createClient({ apiKey: "key", project: "project" });
    const traceRun = makeTraceRun(client);
    const fn = vi.fn(async () => "fallback");

    await expect(traceRun("pipeline", "orchestrate", fn)).resolves.toBe(
      "fallback",
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(client.status()).toEqual({
      project: "project",
      errorCount: 1,
      lastError: "trace pipeline:orchestrate: trace init failed",
    });
  });

  it("does not fallback when the traced callback fails", async () => {
    mockBraintrust.initLogger.mockReturnValue({ id: "logger" });
    mockBraintrust.traced.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );
    const client = createClient({ apiKey: "key", project: "project" });
    const traceRun = makeTraceRun(client);
    const fn = vi.fn(async () => {
      throw new Error("task failed");
    });

    await expect(traceRun("experiment", "trial", fn)).rejects.toThrow(
      "task failed",
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(client.status()).toEqual({
      project: "project",
      errorCount: 0,
      lastError: null,
    });
  });
});
