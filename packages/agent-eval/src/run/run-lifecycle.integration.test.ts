import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import {
  copyFixtureClone,
  createRunOutDir,
  nestedAcpEvents,
  registerRunIntegrationCleanup,
  sourceFixture
} from "./run.integration-helper.js";

const mockedAgentSpawn = vi.hoisted(() => ({
  spawnMock: undefined as ReturnType<typeof createSpawnMock> | undefined,
  spawnStreaming: vi.fn()
}));
const mockedEvaluation = vi.hoisted(() => ({
  runScorer: vi.fn(),
  judgeRun: vi.fn()
}));
const mockedRegistry = vi.hoisted(() => ({
  wallClockMs: undefined as number | undefined,
  weights: undefined as { tests: number; judge: number } | undefined
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  const spawnMock = createSpawnMock();
  mockedAgentSpawn.spawnMock = spawnMock;
  return {
    ...actual,
    ...spawnMock.factory(),
    spawnStreaming: mockedAgentSpawn.spawnStreaming
  };
});

vi.mock("./clone.js", () => ({
  cloneTarget: vi.fn(async (input: { dest: string }) => {
    await copyFixtureClone(input.dest);
    return { resolvedSha: "fixture-sha" };
  })
}));

vi.mock("./scorer.js", () => ({ runScorer: mockedEvaluation.runScorer }));
vi.mock("./judge.js", () => ({ judgeRun: mockedEvaluation.judgeRun }));
vi.mock("../source/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../source/registry.js")>();
  return {
    ...actual,
    loadEval: async (...input: Parameters<typeof actual.loadEval>) => {
      const evalDef = await actual.loadEval(...input);
      return {
        ...evalDef,
        ...(mockedRegistry.wallClockMs === undefined
          ? {}
          : { budget: { ...evalDef.budget, wallClockMs: mockedRegistry.wallClockMs } }),
        ...(mockedRegistry.weights === undefined ? {} : { weights: mockedRegistry.weights })
      };
    }
  };
});

const { runEval } = await import("./run.js");

registerRunIntegrationCleanup();

describe("runEval lifecycle evidence", () => {
  beforeEach(() => {
    mockedAgentSpawn.spawnStreaming.mockReset().mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });
    mockedEvaluation.runScorer.mockReset().mockResolvedValue({ passed: 1, total: 1, cases: [] });
    mockedEvaluation.judgeRun.mockReset().mockResolvedValue({ completeness: 5, mean: 5 });
    mockedRegistry.wallClockMs = undefined;
    mockedRegistry.weights = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes raw and normalized trace evidence before invoking the judge", async () => {
    const outDir = await createRunOutDir();
    mockedEvaluation.judgeRun.mockImplementationOnce(async (input: { traceJsonPath: string }) => {
      const runDir = path.dirname(input.traceJsonPath);
      await expect(readFile(path.join(runDir, "events.jsonl"), "utf8")).resolves.toBe("");
      await expect(readFile(input.traceJsonPath, "utf8")).resolves.toContain('"events": []');
      return { completeness: 5, mean: 5 };
    });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });

    expect(result.verdict).toBe("pass");
    expect(mockedEvaluation.judgeRun).toHaveBeenCalledWith(
      expect.objectContaining({ traceJsonPath: expect.stringMatching(/trace\.json$/) })
    );
  });

  it("freezes execution budget before scorer and judge durations", async () => {
    vi.useFakeTimers();
    const outDir = await createRunOutDir();
    mockedEvaluation.runScorer.mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
      return { passed: 1, total: 1, cases: [] };
    });
    mockedEvaluation.judgeRun.mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
      return { completeness: 5, mean: 5 };
    });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });

    expect(result.verdict).toBe("pass");
  });

  it("aborts dispatch on a wall-clock budget trip and skips judging", async () => {
    const outDir = await createRunOutDir();
    mockedRegistry.wallClockMs = 10;
    mockedRegistry.weights = { tests: 0.7, judge: 0.3 };
    mockedAgentSpawn.spawnStreaming.mockImplementationOnce((input: { signal?: AbortSignal }) => ({
      events: (async function* () {})(),
      done: new Promise((_, reject) => {
        input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })
    }));

    const run = runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });
    const result = await run;

    expect(result).toMatchObject({ verdict: "budget_exceeded", correctness: 1 });
    expect(result.scoring.tests).toMatchObject({ effectiveWeight: 1, status: "executed" });
    expect(result.scoring.judge).toMatchObject({ status: "skipped", reason: "budget_exceeded" });
    expect(mockedEvaluation.judgeRun).not.toHaveBeenCalled();
  });

  it("reports a dispatch failure as error even when one oracle assertion passes", async () => {
    const outDir = await createRunOutDir();
    mockedAgentSpawn.spawnStreaming.mockReturnValueOnce({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "dispatch exploded", exitCode: 1 })
    });
    mockedEvaluation.runScorer.mockResolvedValueOnce({ passed: 1, total: 2, cases: [] });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });

    expect(result).toMatchObject({ verdict: "error", error: "dispatch exploded" });
    expect(result.scoring.tests.status).toBe("executed");
    expect(result.scoring.judge).toMatchObject({ status: "skipped", reason: "execution_error" });
    expect(mockedEvaluation.judgeRun).not.toHaveBeenCalled();
  });

  it("normalizes active score weights when judging is disabled", async () => {
    const outDir = await createRunOutDir();
    mockedRegistry.weights = { tests: 0.7, judge: 0.3 };

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    expect(result).toMatchObject({ verdict: "pass", correctness: 1 });
    expect(result.scoring).toEqual({
      tests: {
        configured: true,
        required: true,
        configuredWeight: 0.7,
        effectiveWeight: 1,
        status: "executed"
      },
      judge: {
        configured: true,
        required: false,
        configuredWeight: 0.3,
        effectiveWeight: 0,
        status: "disabled",
        reason: "disabled"
      }
    });
  });

  it("fails a completed execution when a required oracle assertion fails", async () => {
    const outDir = await createRunOutDir();
    mockedEvaluation.runScorer.mockResolvedValueOnce({ passed: 1, total: 2, cases: [] });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    expect(result).toMatchObject({ verdict: "fail", correctness: 0.5 });
    expect(result.scoring.tests.status).toBe("executed");
  });

  it("skips judging after cheating is detected", async () => {
    const outDir = await createRunOutDir();
    mockedAgentSpawn.spawnStreaming.mockReturnValueOnce({
      events: nestedAcpEvents("/private/agent-eval-cheat.txt"),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });

    expect(result.verdict).toBe("cheated");
    expect(result.scoring.judge).toMatchObject({ status: "skipped", reason: "cheated" });
    expect(mockedEvaluation.judgeRun).not.toHaveBeenCalled();
  });

  it("persists evidence and an error result when scorer evaluation fails", async () => {
    const outDir = await createRunOutDir();
    mockedEvaluation.runScorer.mockRejectedValueOnce(new Error("scorer exploded"));

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    expect(result).toMatchObject({ verdict: "error", error: "scorer exploded" });
    expect(result.scoring.tests).toMatchObject({ status: "failed", reason: "scorer exploded" });
    expect(result.scoring.judge).toMatchObject({ status: "disabled" });
    const [runId] = await readdir(outDir);
    await expect(readFile(path.join(outDir, runId, "events.jsonl"), "utf8")).resolves.toBe("");
    await expect(readFile(path.join(outDir, runId, "trace.json"), "utf8")).resolves.toContain(
      '"events": []'
    );
    expect(JSON.parse(await readFile(path.join(outDir, runId, "result.json"), "utf8"))).toEqual(
      result
    );
  });

  it("keeps a required metric execution error visible in scoring metadata", async () => {
    const outDir = await createRunOutDir();
    mockedRegistry.weights = { tests: 0.7, judge: 0.3 };
    mockedEvaluation.runScorer.mockRejectedValueOnce(new Error("metric execution failed"));

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });

    expect(result).toMatchObject({
      verdict: "error",
      correctness: 0,
      error: "metric execution failed"
    });
    expect(result.scoring.tests).toMatchObject({
      status: "failed",
      configuredWeight: 0.7,
      effectiveWeight: 1,
      reason: "metric execution failed"
    });
    expect(result.scoring.judge).toMatchObject({
      status: "skipped",
      reason: "required_component_failed"
    });
  });

  it("persists evidence and an error result when judge evaluation fails", async () => {
    const outDir = await createRunOutDir();
    mockedRegistry.weights = { tests: 0.7, judge: 0.3 };
    mockedEvaluation.judgeRun.mockRejectedValueOnce(new Error("judge exploded"));

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });

    expect(result).toMatchObject({ verdict: "error", correctness: 0.7, error: "judge exploded" });
    expect(result.scoring.judge).toMatchObject({
      effectiveWeight: 0.3,
      status: "failed",
      reason: "judge exploded"
    });
    const [runId] = await readdir(outDir);
    expect(JSON.parse(await readFile(path.join(outDir, runId, "result.json"), "utf8"))).toEqual(
      result
    );
    await expect(readFile(path.join(outDir, runId, "trace.json"), "utf8")).resolves.toBeTruthy();
  });

  it("persists an error result when final artifact writing fails", async () => {
    const outDir = await createRunOutDir();
    mockedEvaluation.judgeRun.mockImplementationOnce(async (input: { traceJsonPath: string }) => {
      await mkdir(path.join(path.dirname(input.traceJsonPath), "judge.json"));
      return { completeness: 5, mean: 5 };
    });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });

    expect(result).toMatchObject({
      verdict: "error",
      error: expect.stringContaining("Artifact write failed")
    });
    const [runId] = await readdir(outDir);
    expect(JSON.parse(await readFile(path.join(outDir, runId, "result.json"), "utf8"))).toEqual(
      result
    );
    await expect(readFile(path.join(outDir, runId, "trace.json"), "utf8")).resolves.toBeTruthy();
  });

  it("returns an artifact error when result persistence is blocked after evidence exists", async () => {
    const outDir = await createRunOutDir();
    mockedEvaluation.judgeRun.mockImplementationOnce(async (input: { traceJsonPath: string }) => {
      await mkdir(path.join(path.dirname(input.traceJsonPath), "result.json"));
      return { completeness: 5, mean: 5 };
    });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      verifyOracle: false
    });

    expect(result).toMatchObject({
      verdict: "error",
      error: expect.stringContaining("Artifact write failed")
    });
    const [runId] = await readdir(outDir);
    await expect(readFile(path.join(outDir, runId, "trace.json"), "utf8")).resolves.toBeTruthy();
    await expect(readFile(path.join(outDir, runId, "events.jsonl"), "utf8")).resolves.toBe("");
  });
});
