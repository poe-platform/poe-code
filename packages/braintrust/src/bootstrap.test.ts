import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraintrustOptions } from "./index.js";

const mockBraintrust = vi.hoisted(() => ({
  importCount: 0,
  initLogger: vi.fn(),
  initExperiment: vi.fn(),
  flush: vi.fn(),
  traced: vi.fn(),
  currentSpan: vi.fn()
}));

vi.mock("braintrust", () => {
  mockBraintrust.importCount += 1;

  return {
    initLogger: mockBraintrust.initLogger,
    initExperiment: mockBraintrust.initExperiment,
    flush: mockBraintrust.flush,
    traced: mockBraintrust.traced,
    currentSpan: mockBraintrust.currentSpan
  };
});

describe("bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mockBraintrust.importCount = 0;
    mockBraintrust.initLogger.mockReset();
    mockBraintrust.initExperiment.mockReset();
    mockBraintrust.flush.mockReset();
    mockBraintrust.traced.mockReset();
    mockBraintrust.currentSpan.mockReset();
  });

  it("returns null when integration is disabled", async () => {
    const { bootstrap } = await import("./index.js");

    expect(bootstrap(config())).toBeNull();
  });

  it("throws a one-line apiKey message", async () => {
    const { bootstrap } = await import("./index.js");

    expect(() => bootstrap(config({ enabled: true, project: "project" }))).toThrow(
      "Braintrust integration is enabled but apiKey is missing"
    );
  });

  it("throws a one-line apiKey message for empty strings", async () => {
    const { bootstrap } = await import("./index.js");

    expect(() => bootstrap(config({ enabled: true, apiKey: "  ", project: "project" }))).toThrow(
      "Braintrust integration is enabled but apiKey is missing"
    );
  });

  it("throws a one-line project message", async () => {
    const { bootstrap } = await import("./index.js");

    expect(() => bootstrap(config({ enabled: true, apiKey: "key" }))).toThrow(
      "Braintrust integration is enabled but project is missing"
    );
  });

  it("throws a one-line project message for empty strings", async () => {
    const { bootstrap } = await import("./index.js");

    expect(() => bootstrap(config({ enabled: true, apiKey: "key", project: "" }))).toThrow(
      "Braintrust integration is enabled but project is missing"
    );
  });

  it("returns integrations with all callback fields populated when enabled and valid", async () => {
    const { bootstrap } = await import("./index.js");

    const integrations = bootstrap(
      config({
        enabled: true,
        apiKey: "key",
        project: "project"
      })
    );

    expect(integrations).not.toBeNull();
    expect(integrations?.spawnMiddleware).toEqual(expect.any(Function));
    expect(integrations?.pipelineCallbacks).toMatchObject({
      onPlanResolved: expect.any(Function),
      onTaskStart: expect.any(Function),
      onTaskComplete: expect.any(Function)
    });
    expect(integrations?.experimentCallbacks).toMatchObject({
      onExperimentStart: expect.any(Function),
      onBaselineCollected: expect.any(Function),
      onMetricResult: expect.any(Function),
      onCommit: expect.any(Function),
      onReset: expect.any(Function),
      onExperimentComplete: expect.any(Function)
    });
    expect(integrations?.superintendentCallbacks).toMatchObject({
      runRole: expect.any(Function)
    });
    expect(integrations?.traceRun).toEqual(expect.any(Function));
    expect(integrations?.shutdown).toEqual(expect.any(Function));
  });

  it("flushes the shared Braintrust client on shutdown", async () => {
    const logger = {};
    mockBraintrust.initLogger.mockReturnValue(logger);
    mockBraintrust.traced.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    mockBraintrust.flush.mockResolvedValue(undefined);
    const { bootstrap } = await import("./index.js");

    const integrations = bootstrap(
      config({
        enabled: true,
        apiKey: "key",
        project: "project"
      })
    );

    await integrations?.traceRun("pipeline", "smoke", async () => "ok");
    await integrations?.shutdown();

    expect(mockBraintrust.initLogger).toHaveBeenCalledWith({
      apiKey: "key",
      apiUrl: undefined,
      projectName: "project"
    });
    expect(mockBraintrust.flush).toHaveBeenCalledWith(logger);
  });

  it("uses trimmed required config strings", async () => {
    mockBraintrust.initLogger.mockReturnValue({});
    mockBraintrust.traced.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    const { bootstrap } = await import("./index.js");

    const integrations = bootstrap(
      config({
        enabled: true,
        apiKey: "  key  ",
        project: "  project  "
      })
    );

    expect(integrations?.status()).toMatchObject({ project: "project" });
    await integrations?.traceRun("pipeline", "smoke", async () => "ok");

    expect(mockBraintrust.initLogger).toHaveBeenCalledWith({
      apiKey: "key",
      apiUrl: undefined,
      projectName: "project"
    });
  });
});

function config(braintrust?: Partial<BraintrustOptions>): BraintrustOptions | undefined {
  return braintrust;
}
