import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { Runner, RunSpec } from "@poe-code/process-runner";
import type { EvalDef, EvalSource } from "../types.js";

const mocks = vi.hoisted(() => ({
  createHostRunner: vi.fn(),
  loadEval: vi.fn()
}));

vi.mock("@poe-code/process-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/process-runner")>();
  return {
    ...actual,
    createHostRunner: mocks.createHostRunner
  };
});

vi.mock("../source/registry.js", () => ({
  loadEval: mocks.loadEval
}));

import { verifyOracle } from "./oracle.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyOracle", () => {
  const source: EvalSource = { rootDir: "/repo/evals" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when no verify block is configured", async () => {
    mocks.loadEval.mockResolvedValue(createEval());
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));

    await expect(verifyOracle(source, "smoke")).resolves.toEqual({
      passed: true,
      output: "no verify command configured"
    });
    expect(mocks.loadEval).toHaveBeenCalledWith(source, "smoke");
    expect(mocks.createHostRunner).not.toHaveBeenCalled();
  });

  it("passes and captures output when the verify command succeeds", async () => {
    mocks.loadEval.mockResolvedValue(
      createEval({ verify: { command: "npm run verify", timeoutMs: 500 } })
    );
    const runner = createRecordingRunner([
      {
        exitCode: 0,
        stdout: ["ok\n"],
        stderr: ["warn\n"]
      }
    ]);
    mocks.createHostRunner.mockReturnValue(runner);

    await expect(verifyOracle(source, "smoke")).resolves.toEqual({
      passed: true,
      output: "ok\nwarn\n"
    });
    expect(runner.specs).toHaveLength(1);
    expect(runner.specs[0]).toMatchObject({
      args: ["-c", "npm run verify"],
      cwd: "/repo/evals/smoke/oracle",
      env: expect.objectContaining({
        ORACLE_DIR: "/repo/evals/smoke/oracle"
      }),
      stderr: "pipe",
      stdout: "pipe"
    });
  });

  it("fails and captures output when the verify command exits non-zero", async () => {
    mocks.loadEval.mockResolvedValue(
      createEval({ verify: { command: "npm run verify", timeoutMs: 500 } })
    );
    mocks.createHostRunner.mockReturnValue(
      createRecordingRunner([
        {
          exitCode: 7,
          stdout: ["before failure\n"],
          stderr: ["failed\n"]
        }
      ])
    );

    await expect(verifyOracle(source, "smoke")).resolves.toEqual({
      passed: false,
      output: "before failure\nfailed\n"
    });
  });

  it("fails with a timeout note when the verify command times out", async () => {
    vi.useFakeTimers();
    mocks.loadEval.mockResolvedValue(
      createEval({ verify: { command: "npm run verify", timeoutMs: 25 } })
    );
    mocks.createHostRunner.mockReturnValue(
      createRecordingRunner([{ exitCode: 0, exitAfterMs: 1_000 }])
    );

    const result = verifyOracle(source, "smoke");
    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toEqual({
      passed: false,
      output: "verification timed out after 25ms"
    });
  });

  it("uses an absolute oracle directory for relative source roots", async () => {
    mocks.loadEval.mockResolvedValue(
      createEval({
        rootDir: path.resolve("evals/smoke"),
        verify: { command: "npm run verify", timeoutMs: 500 }
      })
    );
    const runner = createRecordingRunner([{ exitCode: 0 }]);
    mocks.createHostRunner.mockReturnValue(runner);

    await verifyOracle({ rootDir: "evals" }, "smoke");

    expect(runner.specs[0]?.cwd).toBe(path.resolve("evals/smoke/oracle"));
    expect(runner.specs[0]?.env).toMatchObject({
      ORACLE_DIR: path.resolve("evals/smoke/oracle")
    });
  });
});

function createEval(overrides: Partial<EvalDef> = {}): EvalDef {
  return {
    id: "smoke",
    title: "Smoke eval",
    rootDir: "/repo/evals/smoke",
    target: {
      repo: "https://example.com/repo.git",
      ref: "main",
      planDest: "docs/plans/eval-task.md"
    },
    scorer: {
      command: "npm test",
      cwd: "",
      resultPath: "score.json",
      timeoutMs: 1_000
    },
    oracle: {
      path: "oracle"
    },
    budget: {
      maxIterations: 10,
      maxTokens: 1_000,
      wallClockMs: 60_000
    },
    judge: {
      agent: "codex",
      model: "gpt-5",
      rubric: ["completeness"]
    },
    weights: {
      tests: 0.7,
      judge: 0.3
    },
    plan: {
      path: "/repo/evals/smoke/plan.md",
      kind: "plan",
      body: "Run the task.",
      frontmatter: { kind: "plan" }
    },
    ...overrides
  };
}

function createRecordingRunner(
  behaviors: Parameters<typeof createMockRunner>[0]
): Runner & { specs: RunSpec[] } {
  const runner = createMockRunner(behaviors);
  const specs: RunSpec[] = [];

  return {
    name: runner.name,
    specs,
    exec(spec) {
      specs.push(spec);
      return runner.exec(spec);
    }
  };
}
