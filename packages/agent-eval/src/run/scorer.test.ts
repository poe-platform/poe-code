import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { Runner, RunSpec } from "@poe-code/process-runner";
import type { EvalDef, ScorerSpec } from "../types.js";

const mocks = vi.hoisted(() => ({
  createHostRunner: vi.fn(),
  readFile: vi.fn(),
  runVitest: vi.fn()
}));

vi.mock("@poe-code/process-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/process-runner")>();
  return {
    ...actual,
    createHostRunner: mocks.createHostRunner
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile
}));

vi.mock("./vitest-runner.js", () => ({
  runVitest: mocks.runVitest
}));

import { runScorer, ScorerError, ScorerTimeoutError } from "./scorer.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("runScorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches to the default vitest scorer when scorer is absent", async () => {
    const evalDef = createEvalDef({ scorer: undefined });
    mocks.runVitest.mockResolvedValue({ passed: 1, total: 1, cases: [] });

    await expect(
      runScorer({
        evalDef,
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).resolves.toEqual({ passed: 1, total: 1, cases: [] });

    expect(mocks.runVitest).toHaveBeenCalledWith({
      testsDir: "/work/eval/oracle/tests",
      cloneDir: "/work/clone",
      oracleDir: "/work/eval/oracle",
      timeoutMs: 180_000,
      signal: undefined
    });
    expect(mocks.createHostRunner).not.toHaveBeenCalled();
  });

  it("runs the custom scorer and returns legacy results with empty cases", async () => {
    useMemfs({
      "/work/clone/results/score.json": JSON.stringify({ passed: 3, total: 4 })
    });
    const runner = createRecordingRunner([{ exitCode: 0 }]);
    mocks.createHostRunner.mockReturnValue(runner);

    await expect(
      runScorer({
        evalDef: createEvalDef({
          scorer: createScorerSpec({
            command: "npm run score",
            cwd: "results",
            resultPath: "results/score.json",
            timeoutMs: 1_000
          })
        }),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).resolves.toEqual({ passed: 3, total: 4, cases: [] });

    expect(mocks.runVitest).not.toHaveBeenCalled();
    expect(runner.specs).toHaveLength(1);
    expect(runner.specs[0]).toMatchObject({
      args: ["-c", "npm run score"],
      cwd: path.join("/work/clone", "results"),
      env: expect.objectContaining({
        CLONE_DIR: "/work/clone",
        ORACLE_DIR: "/work/eval/oracle"
      }),
      stderr: "pipe",
      stdout: "pipe"
    });
  });

  it("returns custom scorer cases when the result includes them", async () => {
    useMemfs({
      "/work/clone/score.json": JSON.stringify({
        passed: 1,
        total: 2,
        cases: [
          { name: "case one", passed: true, durationMs: 3 },
          { name: "case two", passed: false, durationMs: 4, message: "failed" }
        ]
      })
    });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));

    await expect(
      runScorer({
        evalDef: createEvalDef(),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).resolves.toEqual({
      passed: 1,
      total: 2,
      cases: [
        { name: "case one", passed: true, durationMs: 3 },
        { name: "case two", passed: false, durationMs: 4, message: "failed" }
      ]
    });
  });

  it("runs at the clone root when custom scorer cwd is empty", async () => {
    useMemfs({
      "/work/clone/score.json": JSON.stringify({ passed: 1, total: 2 })
    });
    const runner = createRecordingRunner([{ exitCode: 0 }]);
    mocks.createHostRunner.mockReturnValue(runner);

    await runScorer({
      evalDef: createEvalDef({ scorer: createScorerSpec({ cwd: "" }) }),
      evalDir: "/work/eval",
      cloneDir: "/work/clone"
    });

    expect(runner.specs[0]?.cwd).toBe("/work/clone");
  });

  it("injects absolute clone and oracle dirs for custom scorers", async () => {
    const absoluteCloneDir = path.resolve("relative-clone");
    const absoluteEvalDir = path.resolve("relative-eval");
    useMemfs({
      [path.join(absoluteCloneDir, "score.json")]: JSON.stringify({ passed: 1, total: 1 })
    });
    const runner = createRecordingRunner([{ exitCode: 0 }]);
    mocks.createHostRunner.mockReturnValue(runner);

    await runScorer({
      evalDef: createEvalDef(),
      evalDir: "relative-eval",
      cloneDir: "relative-clone"
    });

    expect(runner.specs[0]?.env).toMatchObject({
      CLONE_DIR: absoluteCloneDir,
      ORACLE_DIR: path.join(absoluteEvalDir, "oracle")
    });
  });

  it("returns the score when a non-zero custom scorer exit still writes a valid result", async () => {
    useMemfs({
      "/work/clone/score.json": JSON.stringify({ passed: 0, total: 3 })
    });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 7 }]));

    await expect(
      runScorer({
        evalDef: createEvalDef(),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).resolves.toEqual({ passed: 0, total: 3, cases: [] });
  });

  it("throws a scorer error with output when the custom result file is missing after a non-zero exit", async () => {
    useMemfs({
      "/work/clone": null
    });
    mocks.createHostRunner.mockReturnValue(
      createRecordingRunner([
        {
          exitCode: 2,
          stdout: ["stdout text\n"],
          stderr: ["stderr text\n"]
        }
      ])
    );

    const error = await runScorer({
      evalDef: createEvalDef(),
      evalDir: "/work/eval",
      cloneDir: "/work/clone"
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ScorerError);
    expect((error as Error).message).toContain("stdout text");
    expect((error as Error).message).toContain("stderr text");
  });

  it("throws a scorer error when the custom result JSON is malformed", async () => {
    useMemfs({
      "/work/clone/score.json": "{"
    });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));

    const error = await runScorer({
      evalDef: createEvalDef(),
      evalDir: "/work/eval",
      cloneDir: "/work/clone"
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ScorerError);
    expect((error as Error).message).toContain("Failed to parse scorer result");
  });

  it("throws a scorer error when the parsed custom result has the wrong shape", async () => {
    useMemfs({
      "/work/clone/score.json": JSON.stringify({ passed: "1", total: 1 })
    });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));

    const error = await runScorer({
      evalDef: createEvalDef(),
      evalDir: "/work/eval",
      cloneDir: "/work/clone"
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ScorerError);
    expect((error as Error).message).toContain("expected { passed: number, total: number }");
  });

  it("throws a timeout error when the custom scorer exceeds the configured timeout", async () => {
    vi.useFakeTimers();
    useMemfs({
      "/work/clone/score.json": JSON.stringify({ passed: 1, total: 1 })
    });
    mocks.createHostRunner.mockReturnValue(
      createRecordingRunner([{ exitCode: 0, exitAfterMs: 1_000 }])
    );

    const result = runScorer({
      evalDef: createEvalDef({
        scorer: createScorerSpec({
          timeoutMs: 25
        })
      }),
      evalDir: "/work/eval",
      cloneDir: "/work/clone"
    });
    const expectation = expect(result).rejects.toBeInstanceOf(ScorerTimeoutError);
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });
});

function createEvalDef(overrides: Partial<EvalDef> = {}): EvalDef {
  return {
    id: "task",
    title: "Task",
    rootDir: "/work/eval",
    target: {
      repo: "https://example.com/repo.git",
      ref: "main",
      planDest: "docs/plans/task.md"
    },
    scorer: createScorerSpec(),
    oracle: {
      path: "oracle",
      solutionDest: "."
    },
    budget: {
      maxIterations: 10,
      maxTokens: 1000,
      wallClockMs: 60_000
    },
    judge: {
      agent: "codex",
      model: "gpt-5",
      rubric: ["completeness"]
    },
    weights: {
      tests: 1,
      judge: 0
    },
    plan: {
      path: "/work/eval/plan.md",
      kind: "plan",
      body: "Do it.",
      frontmatter: {}
    },
    ...overrides
  };
}

function createScorerSpec(overrides: Partial<ScorerSpec> = {}): ScorerSpec {
  return {
    command: "npm run score",
    cwd: "",
    resultPath: "score.json",
    timeoutMs: 1_000,
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

function useMemfs(files: Record<string, string | null>): void {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises;
  mocks.readFile.mockImplementation((filePath: string, encoding: BufferEncoding) =>
    fs.readFile(filePath, encoding)
  );
}
