import type {
  BraintrustIntegrationConfig,
  ConfigDocument,
} from "@poe-code/poe-code-config";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBraintrust = vi.hoisted(() => ({
  importCount: 0,
  mode: "healthy" as "healthy" | "missing",
  initLogger: vi.fn(),
  initExperiment: vi.fn(),
  flush: vi.fn(),
  traced: vi.fn(),
  currentSpan: vi.fn(),
}));

vi.mock("braintrust", () => {
  mockBraintrust.importCount += 1;

  if (mockBraintrust.mode === "missing") {
    const err = new Error("Cannot find package 'braintrust'") as Error & {
      code: string;
    };
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }

  return {
    initLogger: mockBraintrust.initLogger,
    initExperiment: mockBraintrust.initExperiment,
    flush: mockBraintrust.flush,
    traced: mockBraintrust.traced,
    currentSpan: mockBraintrust.currentSpan,
  };
});

describe("bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mockBraintrust.importCount = 0;
    mockBraintrust.mode = "healthy";
    mockBraintrust.initLogger.mockReset();
    mockBraintrust.initExperiment.mockReset();
    mockBraintrust.flush.mockReset();
    mockBraintrust.traced.mockReset();
    mockBraintrust.currentSpan.mockReset();
  });

  it("returns null without importing Braintrust when integration is disabled", async () => {
    const { bootstrap } = await import("./index.js");

    await expect(bootstrap(config())).resolves.toBeNull();

    expect(mockBraintrust.importCount).toBe(0);
  });

  it("throws a one-line apiKey message before importing Braintrust", async () => {
    const { bootstrap } = await import("./index.js");

    await expect(
      bootstrap(config({ enabled: true, project: "project" })),
    ).rejects.toThrow("Braintrust integration is enabled but apiKey is missing");
    expect(mockBraintrust.importCount).toBe(0);
  });

  it("throws a one-line apiKey message for empty strings before importing Braintrust", async () => {
    const { bootstrap } = await import("./index.js");

    await expect(
      bootstrap(config({ enabled: true, apiKey: "  ", project: "project" })),
    ).rejects.toThrow("Braintrust integration is enabled but apiKey is missing");
    expect(mockBraintrust.importCount).toBe(0);
  });

  it("throws a one-line project message before importing Braintrust", async () => {
    const { bootstrap } = await import("./index.js");

    await expect(
      bootstrap(config({ enabled: true, apiKey: "key" })),
    ).rejects.toThrow("Braintrust integration is enabled but project is missing");
    expect(mockBraintrust.importCount).toBe(0);
  });

  it("throws a one-line project message for empty strings before importing Braintrust", async () => {
    const { bootstrap } = await import("./index.js");

    await expect(
      bootstrap(config({ enabled: true, apiKey: "key", project: "" })),
    ).rejects.toThrow("Braintrust integration is enabled but project is missing");
    expect(mockBraintrust.importCount).toBe(0);
  });

  it("throws the peer install message when Braintrust is missing", async () => {
    mockBraintrust.mode = "missing";
    const { bootstrap } = await import("./index.js");

    await expect(
      bootstrap(config({
        enabled: true,
        apiKey: "key",
        project: "project",
      })),
    ).rejects.toThrow(
      "Braintrust integration is enabled but the 'braintrust' package is not installed. Run: npm i braintrust",
    );
  });

  it("returns integrations with all callback fields populated when enabled and valid", async () => {
    const { bootstrap } = await import("./index.js");

    const integrations = await bootstrap(config({
      enabled: true,
      apiKey: "key",
      project: "project",
    }));

    expect(integrations).not.toBeNull();
    expect(integrations?.spawnMiddleware).toEqual(expect.any(Function));
    expect(integrations?.pipelineCallbacks).toMatchObject({
      onPlanResolved: expect.any(Function),
      onTaskStart: expect.any(Function),
      onTaskComplete: expect.any(Function),
      onLockStatusChange: expect.any(Function),
    });
    expect(integrations?.experimentCallbacks).toMatchObject({
      onExperimentStart: expect.any(Function),
      onBaselineCollected: expect.any(Function),
      onMetricResult: expect.any(Function),
      onCommit: expect.any(Function),
      onReset: expect.any(Function),
      onExperimentComplete: expect.any(Function),
    });
    expect(integrations?.superintendentCallbacks).toMatchObject({
      onBuilderComplete: expect.any(Function),
      onBuilderFailed: expect.any(Function),
      onInspectorComplete: expect.any(Function),
      onInspectorFailed: expect.any(Function),
      onSuperintendentComplete: expect.any(Function),
      onOwnerComplete: expect.any(Function),
    });
    expect(integrations?.traceRun).toEqual(expect.any(Function));
    expect(integrations?.shutdown).toEqual(expect.any(Function));
    expect(mockBraintrust.importCount).toBe(1);
  });

  it("flushes the shared Braintrust client on shutdown", async () => {
    const logger = {};
    mockBraintrust.initLogger.mockReturnValue(logger);
    mockBraintrust.traced.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );
    mockBraintrust.flush.mockResolvedValue(undefined);
    const { bootstrap } = await import("./index.js");

    const integrations = await bootstrap(config({
      enabled: true,
      apiKey: "key",
      project: "project",
    }));

    await integrations?.traceRun("pipeline", "smoke", async () => "ok");
    await integrations?.shutdown();

    expect(mockBraintrust.initLogger).toHaveBeenCalledWith({
      apiKey: "key",
      apiUrl: undefined,
      projectName: "project",
    });
    expect(mockBraintrust.flush).toHaveBeenCalledWith(logger);
  });
});

function config(
  braintrust?: Partial<BraintrustIntegrationConfig>,
): ConfigDocument {
  return {
    integrations: {
      braintrust,
    },
  } as ConfigDocument;
}
