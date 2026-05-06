import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "../client.js";
import { logSuperintendentRole } from "../row-builder.js";
import { createSuperintendentCallbacks, type LoopCallbacks } from "./superintendent.js";

const mockBraintrust = vi.hoisted(() => ({
  currentSpan: vi.fn(),
}));

vi.mock("braintrust", () => ({
  currentSpan: mockBraintrust.currentSpan,
}));

vi.mock("../row-builder.js", () => ({
  logSuperintendentRole: vi.fn(),
}));

const mockLogSuperintendentRole = vi.mocked(logSuperintendentRole);

describe("createSuperintendentCallbacks", () => {
  beforeEach(() => {
    mockBraintrust.currentSpan.mockReset();
    mockLogSuperintendentRole.mockReset();
  });

  it("wires every complete callback to log the matching superintendent role", async () => {
    const client = createMockClient();
    const callbacks = createSuperintendentCallbacks(client);
    const builderResult = { output: "built" };
    const inspectorResult = { output: "inspected" };
    const superintendentResult = { output: "coordinated" };
    const ownerResult = { output: "approved" };

    callbacks.onBuilderComplete(builderResult as never);
    callbacks.onInspectorComplete(inspectorResult as never);
    callbacks.onSuperintendentComplete?.(superintendentResult as never);
    callbacks.onOwnerComplete?.(ownerResult as never);

    await vi.waitFor(() => {
      expect(mockLogSuperintendentRole).toHaveBeenCalledTimes(4);
    });
    expect(mockLogSuperintendentRole).toHaveBeenNthCalledWith(1, client, "builder", builderResult);
    expect(mockLogSuperintendentRole).toHaveBeenNthCalledWith(2, client, "inspector", inspectorResult);
    expect(mockLogSuperintendentRole).toHaveBeenNthCalledWith(3, client, "superintendent", superintendentResult);
    expect(mockLogSuperintendentRole).toHaveBeenNthCalledWith(4, client, "owner", ownerResult);
  });

  it("logs builder failures as failed Braintrust spans", async () => {
    const failureSpan = createMockSpan();
    mockBraintrust.currentSpan.mockReturnValue({
      startSpan: vi.fn(() => failureSpan),
    });
    const client = createMockClient();
    const callbacks = createSuperintendentCallbacks(client);
    const error = new Error("builder failed");

    callbacks.onBuilderFailed(error);

    await vi.waitFor(() => {
      expect(failureSpan.log).toHaveBeenCalledWith({
        metadata: {
          role: "builder",
          error: "builder failed",
        },
        scores: {
          passed: 0,
        },
      });
    });
    expect(failureSpan.end).toHaveBeenCalledTimes(1);
  });

  it("logs inspector failures as failed Braintrust spans with the inspector name", async () => {
    const failureSpan = createMockSpan();
    mockBraintrust.currentSpan.mockReturnValue({
      startSpan: vi.fn(() => failureSpan),
    });
    const client = createMockClient();
    const callbacks = createSuperintendentCallbacks(client);
    const error = new Error("inspector failed");

    callbacks.onInspectorFailed("docs", error);

    await vi.waitFor(() => {
      expect(failureSpan.log).toHaveBeenCalledWith({
        metadata: {
          role: "inspector",
          name: "docs",
          error: "inspector failed",
        },
        scores: {
          passed: 0,
        },
      });
    });
    expect(failureSpan.end).toHaveBeenCalledTimes(1);
  });
});

function createMockSpan() {
  return {
    startSpan: vi.fn(),
    log: vi.fn(),
    end: vi.fn(),
  };
}

function createMockClient(): BraintrustClient {
  return {
    getSdk: vi.fn(),
    getRootLogger: vi.fn(),
    getExperiment: vi.fn(),
    flush: vi.fn(),
    recordError: vi.fn(),
    status: vi.fn(() => ({
      lastError: null,
      errorCount: 0,
      project: "project",
    })),
  };
}

type ignoredLoopCallbacks = LoopCallbacks;
