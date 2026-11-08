import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { RunHandle, Runner, RunSpec } from "@poe-code/process-runner";
import type { EvalDef, ScorerSpec } from "../types.js";
import { RUN_HANDLE_TERMINATION_GRACE_MS } from "./subprocess-termination.js";

const mocks = vi.hoisted(() => ({
  createHostRunner: vi.fn(),
  readFile: vi.fn(),
  realpath: vi.fn(),
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
  readFile: mocks.readFile,
  realpath: mocks.realpath
}));

vi.mock("./vitest-runner.js", () => ({
  runVitest: mocks.runVitest
}));

import { runScorer, ScorerError, ScorerTimeoutError } from "./scorer.js";

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

afterEach(() => {
  vi.useRealTimers();
});

describe("runScorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.realpath.mockImplementation(async (filePath: string) => filePath);
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
      killProcessGroup: true,
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

  it("rejects oracle paths that escape the eval directory", async () => {
    await expect(
      runScorer({
        evalDef: createEvalDef({ oracle: { path: "../outside", solutionDest: "." } }),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).rejects.toThrow("oracle.path must stay within the eval directory.");

    expect(mocks.createHostRunner).not.toHaveBeenCalled();
    expect(mocks.runVitest).not.toHaveBeenCalled();
  });

  it("rejects escaping oracle paths before running the default scorer", async () => {
    await expect(
      runScorer({
        evalDef: createEvalDef({
          scorer: undefined,
          oracle: { path: "../outside", solutionDest: "." }
        }),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).rejects.toThrow("oracle.path must stay within the eval directory.");

    expect(mocks.runVitest).not.toHaveBeenCalled();
  });

  it("rejects custom scorer working directories that escape the clone", async () => {
    await expect(
      runScorer({
        evalDef: createEvalDef({ scorer: createScorerSpec({ cwd: "../outside" }) }),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).rejects.toThrow("scorer.cwd must stay within the clone directory.");

    expect(mocks.createHostRunner).not.toHaveBeenCalled();
  });

  it("rejects custom scorer result paths that escape the clone", async () => {
    await expect(
      runScorer({
        evalDef: createEvalDef({ scorer: createScorerSpec({ resultPath: "../outside.json" }) }),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).rejects.toThrow("scorer.result_path must stay within the clone directory.");

    expect(mocks.createHostRunner).not.toHaveBeenCalled();
  });

  it("rejects symlinked oracle directories that escape the eval directory", async () => {
    mocks.realpath.mockImplementation(async (filePath: string) =>
      filePath === "/work/eval/oracle" ? "/outside/oracle" : filePath
    );

    await expect(
      runScorer({ evalDef: createEvalDef(), evalDir: "/work/eval", cloneDir: "/work/clone" })
    ).rejects.toThrow("oracle.path must stay within the canonical eval directory.");
    expect(mocks.createHostRunner).not.toHaveBeenCalled();
  });

  it("rejects symlinked oracle directories before running the default scorer", async () => {
    mocks.realpath.mockImplementation(async (filePath: string) =>
      filePath === "/work/eval/oracle" ? "/outside/oracle" : filePath
    );

    await expect(
      runScorer({
        evalDef: createEvalDef({ scorer: undefined }),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).rejects.toThrow("oracle.path must stay within the canonical eval directory.");
    expect(mocks.runVitest).not.toHaveBeenCalled();
  });

  it("rejects symlinked custom scorer working directories that escape the clone", async () => {
    mocks.realpath.mockImplementation(async (filePath: string) =>
      filePath === "/work/clone/results" ? "/outside/results" : filePath
    );

    await expect(
      runScorer({
        evalDef: createEvalDef({ scorer: createScorerSpec({ cwd: "results" }) }),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).rejects.toThrow("scorer.cwd must stay within the canonical clone directory.");
    expect(mocks.createHostRunner).not.toHaveBeenCalled();
  });

  it("rejects symlinked custom scorer result files outside the clone", async () => {
    useMemfs({ "/work/clone/score.json": JSON.stringify({ passed: 1, total: 1 }) });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));
    mocks.realpath.mockImplementation(async (filePath: string) =>
      filePath === "/work/clone/score.json" ? "/outside/score.json" : filePath
    );

    await expect(
      runScorer({ evalDef: createEvalDef(), evalDir: "/work/eval", cloneDir: "/work/clone" })
    ).rejects.toThrow("scorer.result_path must stay within the canonical clone directory.");
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

  it("preserves special-key ambient environment variables for custom scorers", async () => {
    useMemfs({ "/work/clone/score.json": JSON.stringify({ passed: 1, total: 1 }) });
    const runner = createRecordingRunner([{ exitCode: 0 }]);
    mocks.createHostRunner.mockReturnValue(runner);
    Object.defineProperty(process.env, "__proto__", {
      value: "visible",
      configurable: true,
      enumerable: true,
      writable: true
    });

    try {
      await runScorer({ evalDef: createEvalDef(), evalDir: "/work/eval", cloneDir: "/work/clone" });
    } finally {
      delete (process.env as Record<string, string | undefined>)["__proto__"];
    }

    expect(Object.hasOwn(runner.specs[0]?.env ?? {}, "__proto__")).toBe(true);
    expect(runner.specs[0]?.env?.["__proto__"]).toBe("visible");
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

  it("does not treat inherited read error codes as missing scorer results", async () => {
    mocks.readFile.mockRejectedValue(new Error("result read denied"));
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        runScorer({
          evalDef: createEvalDef(),
          evalDir: "/work/eval",
          cloneDir: "/work/clone"
        })
      ).rejects.toThrow("Failed to read scorer result /work/clone/score.json: result read denied");
    });
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

  it("escalates a timed-out custom scorer before reporting the timeout", async () => {
    vi.useFakeTimers();
    const runner = createStubbornRunner();
    mocks.createHostRunner.mockReturnValue(runner);

    const result = runScorer({
      evalDef: createEvalDef({
        scorer: createScorerSpec({
          timeoutMs: 25
        })
      }),
      evalDir: "/work/eval",
      cloneDir: "/work/clone"
    });
    const settled = vi.fn();
    void result.then(settled, settled);

    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();

    expect(runner.kills).toEqual(["SIGTERM"]);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RUN_HANDLE_TERMINATION_GRACE_MS);

    await expect(result).rejects.toBeInstanceOf(ScorerTimeoutError);
    expect(runner.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("rejects non-finite custom scorer result numbers", async () => {
    useMemfs({
      "/work/clone/score.json": '{"passed":1e309,"total":1e309,"cases":[{"name":"case","passed":true,"durationMs":1e309}]}'
    });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));

    await expect(
      runScorer({ evalDef: createEvalDef(), evalDir: "/work/eval", cloneDir: "/work/clone" })
    ).rejects.toThrow("Malformed scorer result");
  });

  it("rejects a non-finite custom scorer timeout before execution", async () => {
    await expect(
      runScorer({
        evalDef: createEvalDef({ scorer: createScorerSpec({ timeoutMs: Number.POSITIVE_INFINITY }) }),
        evalDir: "/work/eval",
        cloneDir: "/work/clone"
      })
    ).rejects.toThrow("Scorer timeout must be a finite non-negative number.");

    expect(mocks.createHostRunner).not.toHaveBeenCalled();
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

function createStubbornRunner(): Runner & { specs: RunSpec[]; kills: NodeJS.Signals[] } {
  const specs: RunSpec[] = [];
  const kills: NodeJS.Signals[] = [];

  return {
    name: "stubborn",
    specs,
    kills,
    exec(spec) {
      specs.push(spec);
      let resolveResult: ((result: { exitCode: number }) => void) | undefined;
      const result = new Promise<{ exitCode: number }>((resolve) => {
        resolveResult = resolve;
      });
      return {
        pid: 123,
        stdout: null,
        stderr: null,
        stdin: null,
        result,
        kill(signal) {
          if (typeof signal === "string") {
            kills.push(signal);
          }
          if (signal === "SIGKILL") {
            resolveResult?.({ exitCode: 1 });
          }
        }
      } satisfies RunHandle;
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
