import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "./client.js";

const mockBraintrust = vi.hoisted(() => ({
  importCount: 0,
  initLogger: vi.fn(),
  initExperiment: vi.fn(),
  flush: vi.fn(),
}));

vi.mock("braintrust", () => {
  mockBraintrust.importCount += 1;

  return {
    initLogger: mockBraintrust.initLogger,
    initExperiment: mockBraintrust.initExperiment,
    flush: mockBraintrust.flush,
  };
});

describe("createClient", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockBraintrust.importCount = 0;
    mockBraintrust.initLogger.mockReset();
    mockBraintrust.initExperiment.mockReset();
    mockBraintrust.flush.mockReset();
  });

  it("loads the Braintrust SDK lazily on first use", async () => {
    mockBraintrust.initLogger.mockReturnValue({ id: "logger" });
    const client = createClient({ apiKey: "key", project: "project" });

    expect(mockBraintrust.importCount).toBe(0);

    await client.getRootLogger();

    expect(mockBraintrust.importCount).toBe(1);
    expect(mockBraintrust.initLogger).toHaveBeenCalledTimes(1);
  });

  it("caches the root logger and experiments by name", async () => {
    const logger = { id: "logger" };
    const experimentA = { id: "experiment-a" };
    const experimentB = { id: "experiment-b" };
    mockBraintrust.initLogger.mockReturnValue(logger);
    mockBraintrust.initExperiment
      .mockReturnValueOnce(experimentA)
      .mockReturnValueOnce(experimentB);
    const client = createClient({
      apiKey: "key",
      apiUrl: "https://api.example.com",
      project: "project",
    });

    await expect(client.getRootLogger()).resolves.toBe(logger);
    await expect(client.getRootLogger()).resolves.toBe(logger);
    await expect(client.getExperiment("a")).resolves.toBe(experimentA);
    await expect(client.getExperiment("a")).resolves.toBe(experimentA);
    await expect(client.getExperiment("b")).resolves.toBe(experimentB);

    expect(mockBraintrust.initLogger).toHaveBeenCalledTimes(1);
    expect(mockBraintrust.initLogger).toHaveBeenCalledWith({
      projectName: "project",
      apiKey: "key",
      apiUrl: "https://api.example.com",
    });
    expect(mockBraintrust.initExperiment).toHaveBeenCalledTimes(2);
    expect(mockBraintrust.initExperiment).toHaveBeenNthCalledWith(1, {
      projectName: "project",
      experimentName: "a",
      apiKey: "key",
      apiUrl: "https://api.example.com",
    });
    expect(mockBraintrust.initExperiment).toHaveBeenNthCalledWith(2, {
      projectName: "project",
      experimentName: "b",
      apiKey: "key",
      apiUrl: "https://api.example.com",
    });
  });

  it("flushes the root logger and cached experiments but resolves on timeout", async () => {
    vi.useFakeTimers();
    const logger = { id: "logger" };
    const experimentA = { id: "experiment-a" };
    const experimentB = { id: "experiment-b" };
    mockBraintrust.initLogger.mockReturnValue(logger);
    mockBraintrust.initExperiment
      .mockReturnValueOnce(experimentA)
      .mockReturnValueOnce(experimentB);
    mockBraintrust.flush.mockReturnValue(new Promise(() => undefined));
    const client = createClient({ apiKey: "key", project: "project" });

    await client.getRootLogger();
    await client.getExperiment("a");
    await client.getExperiment("b");

    const flushed = client.flush(50);
    await vi.advanceTimersByTimeAsync(50);

    await expect(flushed).resolves.toBeUndefined();
    expect(mockBraintrust.flush).toHaveBeenCalledTimes(3);
    expect(mockBraintrust.flush).toHaveBeenNthCalledWith(1, logger);
    expect(mockBraintrust.flush).toHaveBeenNthCalledWith(2, experimentA);
    expect(mockBraintrust.flush).toHaveBeenNthCalledWith(3, experimentB);
  });

  it("records errors without throwing and exposes status", async () => {
    mockBraintrust.initLogger.mockImplementation(() => {
      throw new Error("sdk failed");
    });
    const client = createClient({ apiKey: "key", project: "project" });

    await expect(client.getRootLogger()).resolves.toBeUndefined();
    client.recordError("plain failure", "manual");

    expect(client.status()).toEqual({
      lastError: "manual: plain failure",
      errorCount: 2,
      project: "project",
    });
  });
});
