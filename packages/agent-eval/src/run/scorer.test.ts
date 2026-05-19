import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { Runner, RunSpec } from "@poe-code/process-runner";
import type { ScorerSpec } from "../types.js";

const mocks = vi.hoisted(() => ({
  createHostRunner: vi.fn(),
  readFile: vi.fn()
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

import { runScorer, ScorerError, ScorerTimeoutError } from "./scorer.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("runScorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the scorer and returns the parsed score", async () => {
    useMemfs({
      "/work/clone/results/score.json": JSON.stringify({ passed: 3, total: 4 })
    });
    const runner = createRecordingRunner([{ exitCode: 0 }]);
    mocks.createHostRunner.mockReturnValue(runner);

    await expect(
      runScorer("/work/clone", "/work/oracle", {
        command: "npm run score",
        cwd: "results",
        resultPath: "results/score.json",
        timeoutMs: 1_000
      })
    ).resolves.toEqual({ passed: 3, total: 4 });

    expect(runner.specs).toHaveLength(1);
    expect(runner.specs[0]).toMatchObject({
      args: ["-c", "npm run score"],
      cwd: path.join("/work/clone", "results"),
      env: expect.objectContaining({
        CLONE_DIR: "/work/clone",
        ORACLE_DIR: "/work/oracle"
      }),
      stderr: "pipe",
      stdout: "pipe"
    });
  });

  it("runs at the clone root when scorer cwd is empty", async () => {
    useMemfs({
      "/work/clone/score.json": JSON.stringify({ passed: 1, total: 2 })
    });
    const runner = createRecordingRunner([{ exitCode: 0 }]);
    mocks.createHostRunner.mockReturnValue(runner);

    await runScorer(
      "/work/clone",
      "/work/oracle",
      createScorerSpec({ cwd: "" })
    );

    expect(runner.specs[0]?.cwd).toBe("/work/clone");
  });

  it("injects absolute clone and oracle dirs", async () => {
    const absoluteCloneDir = path.resolve("relative-clone");
    const absoluteOracleDir = path.resolve("relative-oracle");
    useMemfs({
      [path.join(absoluteCloneDir, "score.json")]: JSON.stringify({ passed: 1, total: 1 })
    });
    const runner = createRecordingRunner([{ exitCode: 0 }]);
    mocks.createHostRunner.mockReturnValue(runner);

    await runScorer("relative-clone", "relative-oracle", createScorerSpec());

    expect(runner.specs[0]?.env).toMatchObject({
      CLONE_DIR: absoluteCloneDir,
      ORACLE_DIR: absoluteOracleDir
    });
  });

  it("returns the score when a non-zero scorer exit still writes a valid result", async () => {
    useMemfs({
      "/work/clone/score.json": JSON.stringify({ passed: 0, total: 3 })
    });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 7 }]));

    await expect(
      runScorer("/work/clone", "/work/oracle", createScorerSpec())
    ).resolves.toEqual({ passed: 0, total: 3 });
  });

  it("throws a scorer error with output when the result file is missing after a non-zero exit", async () => {
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

    const error = await runScorer(
      "/work/clone",
      "/work/oracle",
      createScorerSpec()
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ScorerError);
    expect((error as Error).message).toContain("stdout text");
    expect((error as Error).message).toContain("stderr text");
  });

  it("throws a scorer error when the result JSON is malformed", async () => {
    useMemfs({
      "/work/clone/score.json": "{"
    });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));

    const error = await runScorer(
      "/work/clone",
      "/work/oracle",
      createScorerSpec()
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ScorerError);
    expect((error as Error).message).toContain("Failed to parse scorer result");
  });

  it("throws a scorer error when the parsed result has the wrong shape", async () => {
    useMemfs({
      "/work/clone/score.json": JSON.stringify({ passed: "1", total: 1 })
    });
    mocks.createHostRunner.mockReturnValue(createRecordingRunner([{ exitCode: 0 }]));

    const error = await runScorer(
      "/work/clone",
      "/work/oracle",
      createScorerSpec()
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ScorerError);
    expect((error as Error).message).toContain(
      "expected { passed: number, total: number }"
    );
  });

  it("throws a timeout error when the scorer exceeds the configured timeout", async () => {
    vi.useFakeTimers();
    useMemfs({
      "/work/clone/score.json": JSON.stringify({ passed: 1, total: 1 })
    });
    mocks.createHostRunner.mockReturnValue(
      createRecordingRunner([{ exitCode: 0, exitAfterMs: 1_000 }])
    );

    const result = runScorer("/work/clone", "/work/oracle", {
      ...createScorerSpec(),
      timeoutMs: 25
    });
    const expectation = expect(result).rejects.toBeInstanceOf(ScorerTimeoutError);
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });
});

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
