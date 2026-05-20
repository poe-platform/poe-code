import { tmpdir } from "node:os";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { Runner, RunSpec } from "@poe-code/process-runner";

const mocks = vi.hoisted(() => ({
  createHostRunner: vi.fn()
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
  return fs.promises;
});

const { runVitest, VitestError, VitestTimeoutError } = await import("./vitest-runner.js");

describe("runVitest", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(tmpdir(), { recursive: true });
    vi.clearAllMocks();
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
      stdout: "pipe",
      stderr: "pipe"
    });
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
}): Runner & { specs: RunSpec[]; outputFile?: string } {
  const mockRunner = createMockRunner([
    {
      exitCode: 0,
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
