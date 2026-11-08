import { tmpdir } from "node:os";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { RunHandle, Runner, RunSpec } from "@poe-code/process-runner";
import { RUN_HANDLE_TERMINATION_GRACE_MS } from "./subprocess-termination.js";

const mocks = vi.hoisted(() => ({
  createHostRunner: vi.fn(),
  unlinkFailure: undefined as Error | undefined
}));

vi.mock("@poe-code/process-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/process-runner")>();
  return {
    ...actual,
    createHostRunner: mocks.createHostRunner
  };
});

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    unlink: async (filePath: string) => {
      if (mocks.unlinkFailure !== undefined) {
        throw mocks.unlinkFailure;
      }
      return fs.promises.unlink(filePath);
    }
  };
});

const { runVitest, VitestError, VitestTimeoutError } = await import("./vitest-runner.js");

describe("runVitest", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(tmpdir(), { recursive: true });
    vi.clearAllMocks();
    mocks.unlinkFailure = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs vitest and maps passing and failing case results", async () => {
    const runner = createVitestRunner({
      json: {
        testResults: [
          {
            name: "/work/eval/oracle/tests/src/foo.test.ts",
            assertionResults: [
              {
                ancestorTitles: ["math"],
                title: "adds",
                state: "pass",
                duration: 3.5,
                failureMessages: []
              },
              {
                ancestorTitles: ["math"],
                title: "subtracts",
                state: "fail",
                duration: 4,
                failureMessages: ["expected 1 to be 2"]
              }
            ]
          }
        ]
      }
    });
    mocks.createHostRunner.mockReturnValue(runner);

    await expect(
      runVitest({
        testsDir: "/work/eval/oracle/tests",
        cloneDir: "/work/clone",
        oracleDir: "/work/eval/oracle",
        timeoutMs: 1_000
      })
    ).resolves.toEqual({
      passed: 1,
      total: 2,
      cases: [
        {
          name: "src/foo.test.ts > math > adds",
          passed: true,
          durationMs: 3.5
        },
        {
          name: "src/foo.test.ts > math > subtracts",
          passed: false,
          durationMs: 4,
          message: "expected 1 to be 2"
        }
      ]
    });

    expect(runner.specs).toHaveLength(1);
    expect(runner.specs[0]).toMatchObject({
      command: process.execPath,
      args: expect.arrayContaining(["run", "--root", "/work/eval/oracle/tests", "--reporter=json"]),
      cwd: "/work/eval/oracle/tests",
      env: expect.objectContaining({
        CLONE_DIR: "/work/clone",
        ORACLE_DIR: "/work/eval/oracle"
      }),
      killProcessGroup: true,
      stdout: "pipe",
      stderr: "pipe"
    });
  });

  it("preserves special-key ambient environment variables for vitest", async () => {
    const runner = createVitestRunner({
      json: { testResults: [] }
    });
    mocks.createHostRunner.mockReturnValue(runner);
    Object.defineProperty(process.env, "__proto__", {
      value: "visible",
      configurable: true,
      enumerable: true,
      writable: true
    });

    try {
      await runVitest({
        testsDir: "/work/eval/oracle/tests",
        cloneDir: "/work/clone",
        oracleDir: "/work/eval/oracle",
        timeoutMs: 1_000
      });
    } finally {
      delete (process.env as Record<string, string | undefined>)["__proto__"];
    }

    expect(Object.hasOwn(runner.specs[0]?.env ?? {}, "__proto__")).toBe(true);
    expect(runner.specs[0]?.env?.["__proto__"]).toBe("visible");
  });

  it("deletes the temporary reporter file before returning", async () => {
    const runner = createVitestRunner({
      json: {
        testResults: [
          {
            name: "/work/eval/oracle/tests/foo.test.ts",
            assertionResults: [{ title: "passes", status: "passed", duration: 1 }]
          }
        ]
      }
    });
    mocks.createHostRunner.mockReturnValue(runner);

    await runVitest({
      testsDir: "/work/eval/oracle/tests",
      cloneDir: "/work/clone",
      oracleDir: "/work/eval/oracle",
      timeoutMs: 1_000
    });

    await expect(memfs.promises.stat(runner.outputFile!)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("deletes the temporary reporter file when JSON parsing fails", async () => {
    const runner = createVitestRunner({
      rawJson: "{"
    });
    mocks.createHostRunner.mockReturnValue(runner);

    await expect(
      runVitest({
        testsDir: "/work/eval/oracle/tests",
        cloneDir: "/work/clone",
        oracleDir: "/work/eval/oracle",
        timeoutMs: 1_000
      })
    ).rejects.toBeInstanceOf(VitestError);

    await expect(memfs.promises.stat(runner.outputFile!)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects a nonzero vitest process exit even with passing report output", async () => {
    const runner = createVitestRunner({
      exitCode: 1,
      json: {
        testResults: [{
          name: "/work/eval/oracle/tests/foo.test.ts",
          assertionResults: [{ title: "passes", status: "passed", duration: 1 }]
        }]
      }
    });
    mocks.createHostRunner.mockReturnValue(runner);

    await expect(
      runVitest({ testsDir: "/work/eval/oracle/tests", cloneDir: "/work/clone", oracleDir: "/work/eval/oracle", timeoutMs: 1_000 })
    ).rejects.toThrow("Vitest exited with code 1");
  });

  it("returns scores when temporary report cleanup fails", async () => {
    const runner = createVitestRunner({
      json: {
        testResults: [{
          name: "/work/eval/oracle/tests/foo.test.ts",
          assertionResults: [{ title: "passes", status: "passed", duration: 1 }]
        }]
      }
    });
    mocks.createHostRunner.mockReturnValue(runner);
    mocks.unlinkFailure = new Error("report cleanup denied");

    await expect(
      runVitest({ testsDir: "/work/eval/oracle/tests", cloneDir: "/work/clone", oracleDir: "/work/eval/oracle", timeoutMs: 1_000 })
    ).resolves.toMatchObject({ passed: 1, total: 1 });
  });

  it("rejects with VitestTimeoutError when vitest exceeds the timeout", async () => {
    vi.useFakeTimers();
    const runner = createVitestRunner({
      json: {
        testResults: []
      },
      exitAfterMs: 1_000
    });
    mocks.createHostRunner.mockReturnValue(runner);

    const result = runVitest({
      testsDir: "/work/eval/oracle/tests",
      cloneDir: "/work/clone",
      oracleDir: "/work/eval/oracle",
      timeoutMs: 25
    });
    const expectation = expect(result).rejects.toBeInstanceOf(VitestTimeoutError);
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });

  it("escalates a timed-out vitest process before rejecting", async () => {
    vi.useFakeTimers();
    const runner = createStubbornVitestRunner();
    mocks.createHostRunner.mockReturnValue(runner);

    const result = runVitest({
      testsDir: "/work/eval/oracle/tests",
      cloneDir: "/work/clone",
      oracleDir: "/work/eval/oracle",
      timeoutMs: 25
    });
    const settled = vi.fn();
    void result.then(settled, settled);

    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();

    expect(runner.kills).toEqual(["SIGTERM"]);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RUN_HANDLE_TERMINATION_GRACE_MS);

    await expect(result).rejects.toBeInstanceOf(VitestTimeoutError);
    expect(runner.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("rejects a non-finite vitest timeout before execution", async () => {
    mocks.createHostRunner.mockReturnValue(createVitestRunner({ json: { testResults: [] } }));

    await expect(
      runVitest({
        testsDir: "/work/eval/oracle/tests",
        cloneDir: "/work/clone",
        oracleDir: "/work/eval/oracle",
        timeoutMs: Number.POSITIVE_INFINITY
      })
    ).rejects.toThrow("Vitest timeout must be a finite non-negative number.");
  });

  it("rejects non-finite case durations from reporter output", async () => {
    const runner = createVitestRunner({
      rawJson: '{"testResults":[{"name":"/work/eval/oracle/tests/foo.test.ts","assertionResults":[{"title":"passes","status":"passed","duration":1e309}]}]}'
    });
    mocks.createHostRunner.mockReturnValue(runner);

    await expect(
      runVitest({ testsDir: "/work/eval/oracle/tests", cloneDir: "/work/clone", oracleDir: "/work/eval/oracle", timeoutMs: 1_000 })
    ).rejects.toThrow("Malformed vitest JSON output: case duration must be finite");
  });

  it("honors AbortSignal and rejects with the abort reason", async () => {
    const runner = createVitestRunner({
      json: {
        testResults: []
      },
      exitAfterMs: 1_000
    });
    mocks.createHostRunner.mockReturnValue(runner);
    const controller = new AbortController();
    const abortError = new Error("stop vitest");

    const result = runVitest({
      testsDir: "/work/eval/oracle/tests",
      cloneDir: "/work/clone",
      oracleDir: "/work/eval/oracle",
      timeoutMs: 1_000,
      signal: controller.signal
    });
    controller.abort(abortError);

    await expect(result).rejects.toBe(abortError);
  });
});

function createVitestRunner(input: {
  json?: unknown;
  rawJson?: string;
  exitAfterMs?: number;
  exitCode?: number;
}): Runner & { specs: RunSpec[]; outputFile?: string } {
  const mockRunner = createMockRunner([
    {
      exitCode: input.exitCode ?? 0,
      exitAfterMs: input.exitAfterMs
    }
  ]);
  const runner: Runner & { specs: RunSpec[]; outputFile?: string } = {
    name: mockRunner.name,
    specs: [],
    exec(spec) {
      runner.specs.push(spec);
      const outputFile = findOutputFile(spec);
      runner.outputFile = outputFile;

      if (input.exitAfterMs === undefined) {
        memfs.writeFileSync(outputFile, input.rawJson ?? JSON.stringify(input.json));
      }

      return mockRunner.exec(spec);
    }
  };

  return runner;
}

function createStubbornVitestRunner(): Runner & {
  specs: RunSpec[];
  outputFile?: string;
  kills: NodeJS.Signals[];
} {
  const kills: NodeJS.Signals[] = [];
  const runner: Runner & { specs: RunSpec[]; outputFile?: string; kills: NodeJS.Signals[] } = {
    name: "stubborn",
    specs: [],
    kills,
    exec(spec) {
      runner.specs.push(spec);
      runner.outputFile = findOutputFile(spec);
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

  return runner;
}

function findOutputFile(spec: RunSpec): string {
  const outputFileIndex = spec.args?.indexOf("--outputFile") ?? -1;
  if (outputFileIndex < 0) {
    throw new Error("Expected vitest --outputFile arg");
  }

  const outputFile = spec.args?.[outputFileIndex + 1];
  if (outputFile === undefined) {
    throw new Error("Expected vitest output file path");
  }

  return outputFile;
}

const memfs = vol;
