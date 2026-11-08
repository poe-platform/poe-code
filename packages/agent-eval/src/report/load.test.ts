import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedCell, EvalRunResult } from "../types.js";

const mocks = vi.hoisted(() => ({
  failedReaddirTarget: undefined as string | undefined
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    readdir: async (
      targetPath: Parameters<typeof fs.promises.readdir>[0],
      options?: Parameters<typeof fs.promises.readdir>[1]
    ) => {
      if (String(targetPath) === mocks.failedReaddirTarget) {
        throw new Error("readdir denied");
      }

      return fs.promises.readdir(targetPath, options);
    }
  };
});

const { listRuns, loadLatestMatrix, loadRunResult } = await import("./load.js");

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("report loaders", () => {
  beforeEach(() => {
    vol.reset();
    mocks.failedReaddirTarget = undefined;
  });

  it("loads a run result by id from the runs directory", async () => {
    const result = runResult({ runId: "run-direct" });
    vol.fromJSON({
      "/runs/run-direct/result.json": JSON.stringify(result)
    });

    await expect(loadRunResult("run-direct", "/runs")).resolves.toEqual({
      ...result,
      trace: { available: false }
    });
  });

  it("rejects a result whose embedded run id disagrees with its directory", async () => {
    vol.fromJSON({
      "/runs/run-direct/result.json": JSON.stringify(runResult({ runId: "other-run" }))
    });

    await expect(loadRunResult("run-direct", "/runs")).rejects.toThrow(
      'Run result "run-direct" embeds mismatched runId "other-run"'
    );
  });

  it("enriches loaded results with normalized trace availability", async () => {
    const result = runResult({ runId: "run-traced" });
    vol.fromJSON({
      "/runs/run-traced/result.json": JSON.stringify(result),
      "/runs/run-traced/trace.json": JSON.stringify({
        events: [
          {
            type: "tool",
            sequence: 1,
            phase: "complete",
            operation: "read",
            name: "read",
            paths: []
          },
          { type: "error", sequence: 2, message: "failed" }
        ],
        usage: {}
      })
    });

    await expect(loadRunResult("run-traced", "/runs")).resolves.toMatchObject({
      trace: { available: true, eventCount: 2, toolEventCount: 1, errorEventCount: 1 }
    });
  });

  it("rejects impossible numeric result fields before aggregation", async () => {
    vol.fromJSON({
      "/runs/run-bad/result.json": JSON.stringify(
        runResult({
          runId: "run-bad",
          iterations: -2,
          durationMs: -100,
          usage: { inputTokens: -5, outputTokens: 1.5, cachedTokens: -3, costUsd: -0.25 },
          tests: { passed: 3, total: 2, pass_rate: 1.5 },
          correctness: 2,
          scoring: {
            tests: {
              configured: true,
              required: true,
              configuredWeight: -1,
              effectiveWeight: 2,
              status: "executed"
            },
            judge: {
              configured: false,
              required: false,
              configuredWeight: 0,
              effectiveWeight: 0,
              status: "disabled"
            }
          }
        })
      )
    });

    await expect(loadRunResult("run-bad", "/runs")).rejects.toThrow(
      "Invalid result.json in /runs/run-bad/result.json (iterations):"
    );
  });

  it("rejects trace files whose events field is not an array", async () => {
    vol.fromJSON({
      "/runs/run-trace/result.json": JSON.stringify(runResult({ runId: "run-trace" })),
      "/runs/run-trace/trace.json": JSON.stringify({ events: { length: 99 }, usage: {} })
    });

    await expect(loadRunResult("run-trace", "/runs")).rejects.toThrow(
      "Invalid trace.json in /runs/run-trace/trace.json (events):"
    );
  });

  it("loads a nested matrix run result by id", async () => {
    const result = runResult({ runId: "run-nested" });
    vol.fromJSON({
      "/runs/2026-05-18T10-00-00Z/run-nested/result.json": JSON.stringify(result)
    });

    await expect(loadRunResult("run-nested", "/runs")).resolves.toEqual({
      ...result,
      trace: { available: false }
    });
  });

  it("rejects run ids that escape the runs directory", async () => {
    const result = runResult({ runId: "outside" });
    vol.fromJSON({
      "/outside/result.json": JSON.stringify(result)
    });

    await expect(loadRunResult("../outside", "/runs")).rejects.toThrow(
      'Invalid run id "../outside"'
    );
  });

  it("rejects a run directory symlinked outside the output root", async () => {
    vol.fromJSON({
      "/runs/.keep": "",
      "/outside/result.json": JSON.stringify(runResult({ runId: "run-safe" }))
    });
    const { fs } = await import("memfs");
    await fs.promises.symlink("/outside", "/runs/run-safe");

    await expect(loadRunResult("run-safe", "/runs")).rejects.toThrow(
      "run result must stay within the canonical output directory."
    );
  });

  it("rejects result and trace files symlinked outside the output root", async () => {
    vol.fromJSON({
      "/runs/run-safe/.keep": "",
      "/outside/result.json": JSON.stringify(runResult({ runId: "run-safe" })),
      "/outside/trace.json": JSON.stringify({ events: [], usage: {} })
    });
    const { fs } = await import("memfs");
    await fs.promises.symlink("/outside/result.json", "/runs/run-safe/result.json");
    await fs.promises.symlink("/outside/trace.json", "/runs/run-safe/trace.json");

    await expect(loadRunResult("run-safe", "/runs")).rejects.toThrow(
      "run result must stay within the canonical output directory."
    );
  });

  it("lists run ids without treating matrix directories as runs", async () => {
    vol.fromJSON({
      "/runs/run-direct/result.json": JSON.stringify(runResult({ runId: "run-direct" })),
      "/runs/2026-05-18T10-00-00Z/run-nested/result.json": JSON.stringify(
        runResult({ runId: "run-nested" })
      ),
      "/runs/2026-05-18T10-00-00Z/aggregate-task-codex-gpt-5.json": JSON.stringify(
        aggregateCell({ eval: "task" })
      )
    });

    await expect(listRuns("/runs")).resolves.toEqual(["run-direct", "run-nested"]);
  });

  it("loads the newest matrix directory with aggregate files", async () => {
    const oldCell = aggregateCell({ eval: "old-task" });
    const newestFirst = aggregateCell({ eval: "new-task-a" });
    const newestSecond = aggregateCell({ eval: "new-task-b" });
    vol.fromJSON({
      "/runs/run-direct/result.json": JSON.stringify(runResult({ runId: "run-direct" })),
      "/runs/2026-05-17T10-00-00Z/aggregate-old-task-codex-gpt-5.json": JSON.stringify(oldCell),
      "/runs/2026-05-18T10-00-00Z/not-aggregate.json": "{}",
      "/runs/2026-05-19T10-00-00Z/aggregate-new-task-b-codex-gpt-5.json":
        JSON.stringify(newestSecond),
      "/runs/2026-05-19T10-00-00Z/aggregate-new-task-a-codex-gpt-5.json":
        JSON.stringify(newestFirst)
    });

    await expect(loadLatestMatrix("/runs")).resolves.toEqual({
      matrixId: "2026-05-19T10-00-00Z",
      cells: [newestFirst, newestSecond]
    });
  });

  it("rebuilds matrix evidence from previously recorded run artifacts", async () => {
    const cell = aggregateCell({ eval: "task" });
    vol.fromJSON({
      "/runs/2026-05-19T10-00-00Z/aggregate-task-codex-gpt-5.json": JSON.stringify({
        ...cell,
        runIds: ["run-1", "run-2"]
      }),
      "/runs/2026-05-19T10-00-00Z/run-1/result.json": JSON.stringify(
        runResult({
          runId: "run-1",
          metrics: [metricResult(1, true)],
          cheatReport: { cheated: false, violations: [] }
        })
      ),
      "/runs/2026-05-19T10-00-00Z/run-1/trace.json": JSON.stringify({ events: [], usage: {} }),
      "/runs/2026-05-19T10-00-00Z/run-2/result.json": JSON.stringify(
        runResult({
          runId: "run-2",
          metrics: [metricResult(0, false)],
          error: "failed"
        })
      )
    });

    const matrix = await loadLatestMatrix("/runs");
    expect(matrix.cells[0]).toMatchObject({
      metrics: { task_completion: { score: { mean: 0.5 }, passed: 1, failed: 1 } },
      integrity: { tracesAvailable: 1, executionErrors: 1 }
    });
  });

  it("rejects aggregate run references that belong to another cell", async () => {
    const cell = aggregateCell({ eval: "expected-task" });
    vol.fromJSON({
      "/runs/2026-05-19T10-00-00Z/aggregate-expected-task-codex-gpt-5.json": JSON.stringify({
        ...cell,
        runIds: ["other-run"]
      }),
      "/runs/2026-05-19T10-00-00Z/other-run/result.json": JSON.stringify(
        runResult({ runId: "other-run", eval: "other-task" })
      )
    });

    await expect(loadLatestMatrix("/runs")).rejects.toThrow(
      'Aggregate cell references run "other-run" from a different cell'
    );
  });

  it("ignores aggregate files outside timestamp-prefixed matrix directories", async () => {
    const timestampedCell = aggregateCell({ eval: "timestamped-task" });
    vol.fromJSON({
      "/runs/manual/aggregate-manual-task-codex-gpt-5.json": JSON.stringify(
        aggregateCell({ eval: "manual-task" })
      ),
      "/runs/2026-05-18T10-00-00Z/aggregate-timestamped-task-codex-gpt-5.json":
        JSON.stringify(timestampedCell)
    });

    await expect(loadLatestMatrix("/runs")).resolves.toEqual({
      matrixId: "2026-05-18T10-00-00Z",
      cells: [timestampedCell]
    });
  });

  it("throws a clear error when the runs directory is missing", async () => {
    await expect(listRuns("/missing")).rejects.toThrow("Runs directory not found: /missing");
    await expect(loadLatestMatrix("/missing")).rejects.toThrow(
      "Runs directory not found: /missing"
    );
  });

  it("does not treat inherited readdir error codes as missing runs directories", async () => {
    mocks.failedReaddirTarget = "/runs";

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(listRuns("/runs")).rejects.toThrow("readdir denied");
    });
  });

  it("throws a clear error when no matrix aggregate exists", async () => {
    vol.fromJSON({
      "/runs/run-direct/result.json": JSON.stringify(runResult({ runId: "run-direct" })),
      "/runs/2026-05-18T10-00-00Z/notes.json": "{}"
    });

    await expect(loadLatestMatrix("/runs")).rejects.toThrow(
      "No matrix aggregate files found under /runs"
    );
  });

  it("reports invalid aggregate JSON with the file path", async () => {
    vol.fromJSON({
      "/runs/2026-05-18T10-00-00Z/aggregate-task-codex-gpt-5.json": "{"
    });

    await expect(loadLatestMatrix("/runs")).rejects.toThrow(
      "Invalid JSON in /runs/2026-05-18T10-00-00Z/aggregate-task-codex-gpt-5.json"
    );
  });
});

function runResult(
  overrides: Partial<Omit<EvalRunResult, "tests">> & {
    tests?: Partial<EvalRunResult["tests"]>;
  } = {}
): EvalRunResult {
  const { tests, ...rest } = overrides;
  return {
    runId: "run-1",
    eval: "task",
    agent: "codex",
    model: "gpt-5",
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 3,
    durationMs: 1500,
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 100,
      costUsd: 0.2
    },
    tests: {
      passed: 2,
      total: 2,
      pass_rate: 1,
      cases: [],
      ...tests
    },
    scoring: {
      tests: {
        configured: true,
        required: true,
        configuredWeight: 1,
        effectiveWeight: 1,
        status: "executed"
      },
      judge: {
        configured: true,
        required: false,
        configuredWeight: 0,
        effectiveWeight: 0,
        status: "disabled",
        reason: "disabled"
      }
    },
    cheated: false,
    cheatReport: {
      cheated: false,
      violations: []
    },
    ...rest
  };
}

function aggregateCell(overrides: Partial<AggregatedCell["cell"]> = {}): AggregatedCell {
  return {
    cell: {
      eval: "task",
      planKind: "plan",
      agent: "codex",
      model: "gpt-5",
      ...overrides
    },
    repeats: 2,
    runIds: ["run-1", "run-2"],
    cheated_any: false,
    verdicts: { pass: 2, fail: 0, error: 0, cheated: 0, budget_exceeded: 0 },
    iterations: {
      mean: 3,
      min: 2,
      max: 4
    },
    durationMs: {
      mean: 1500,
      min: 1000,
      max: 2000
    },
    usage: {
      inputTokens: {
        mean: 1000,
        min: 800,
        max: 1200
      },
      outputTokens: {
        mean: 500,
        min: 400,
        max: 600
      },
      cachedTokens: {
        mean: 100,
        min: 80,
        max: 120
      },
      costUsd: {
        mean: 0.2,
        min: 0.1,
        max: 0.3
      }
    },
    tests: {
      passRateMean: 1,
      passRateMin: 1,
      passRateMax: 1
    },
    correctness: {
      mean: 1,
      min: 1,
      max: 1
    },
    scoring: {
      tests: { configured: 2, executed: 2, skipped: 0, failed: 0, disabled: 0 },
      judge: { configured: 2, executed: 2, skipped: 0, failed: 0, disabled: 0 }
    },
    judge: {
      mean: {
        mean: 4,
        min: 3,
        max: 5
      }
    }
  };
}

function metricResult(score: number, passed: boolean) {
  return {
    id: "task_completion" as const,
    enabled: true,
    required: true,
    weight: 1,
    score,
    threshold: 0.8,
    passed,
    status: "executed" as const,
    reason: "recorded"
  };
}
