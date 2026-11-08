import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCLI } from "toolcraft/cli";
import type { EvalMatrixOptions, EvalRunResult } from "../types.js";

const mockedRun = vi.hoisted(() => ({
  runMatrix: vi.fn<(opts: EvalMatrixOptions) => AsyncIterable<EvalRunResult>>(),
  runInitCli: vi.fn(),
  runCheckCli: vi.fn(),
  runLintCli: vi.fn(),
  listRuns: vi.fn(),
  loadRunResult: vi.fn(),
  loadLatestMatrix: vi.fn()
}));

vi.mock("../run/matrix.js", () => ({
  runMatrix: mockedRun.runMatrix
}));

vi.mock("./init.js", () => ({
  runInitCli: mockedRun.runInitCli
}));

vi.mock("./check.js", () => ({
  runCheckCli: mockedRun.runCheckCli
}));

vi.mock("./lint.js", () => ({
  runLintCli: mockedRun.runLintCli
}));

vi.mock("../report/load.js", () => ({
  listRuns: mockedRun.listRuns,
  loadRunResult: mockedRun.loadRunResult,
  loadLatestMatrix: mockedRun.loadLatestMatrix
}));

const { evalGroup } = await import("./commands.js");

const fixtureRoot = fileURLToPath(new URL("../__fixtures__/source/example-plan", import.meta.url));
const originalArgv = process.argv;
const originalExitCode = process.exitCode;

beforeEach(() => {
  process.exitCode = undefined;
  vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  mockedRun.runMatrix.mockImplementation(async function* () {});
  mockedRun.runInitCli.mockResolvedValue(0);
  mockedRun.runCheckCli.mockResolvedValue(0);
  mockedRun.runLintCli.mockResolvedValue(0);
  mockedRun.listRuns.mockResolvedValue([]);
  mockedRun.loadLatestMatrix.mockResolvedValue({ matrixId: "matrix", cells: [] });
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  mockedRun.runMatrix.mockReset();
  mockedRun.runInitCli.mockReset();
  mockedRun.runCheckCli.mockReset();
  mockedRun.runLintCli.mockReset();
  mockedRun.listRuns.mockReset();
  mockedRun.loadRunResult.mockReset();
  mockedRun.loadLatestMatrix.mockReset();
});

describe("agent-eval cli", () => {
  it("requires --agent for eval run", async () => {
    await runEvalCli(["run", "--model", "openai/gpt-5"]);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain('Missing required parameter "agent"');
    expect(mockedRun.runMatrix).not.toHaveBeenCalled();
  });

  it("requires --model for eval run", async () => {
    await runEvalCli(["run", "--agent", "codex"]);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain('Missing required parameter "model"');
    expect(mockedRun.runMatrix).not.toHaveBeenCalled();
  });

  it("parses eval run defaults and flags before calling runMatrix", async () => {
    await runEvalCli([
      "run",
      "--agent",
      "codex,claude-code",
      "--model",
      "openai/gpt-5,anthropic/claude-sonnet-4.5",
      "--no-judge",
      "--no-verify"
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runMatrix).toHaveBeenCalledWith({
      sourceDir: fixtureRoot,
      evalIds: ["task"],
      agents: ["codex", "claude-code"],
      models: ["openai/gpt-5", "anthropic/claude-sonnet-4.5"],
      repeats: 3,
      outDir: path.join(fixtureRoot, "runs"),
      cloneCacheDir: null,
      verifyOracle: false,
      judge: "off"
    });
  });

  it("previews eval run without executing the matrix", async () => {
    await runEvalCli([
      "run",
      "--agent",
      "codex",
      "--model",
      "openai/gpt-5",
      "--eval",
      "task",
      "--dry-run"
    ]);

    expect(mockedRun.runMatrix).not.toHaveBeenCalled();
    expect(output()).toContain("Dry run: would run eval matrix for task with codex on openai/gpt-5.");
  });

  it("uses -C as the eval source directory", async () => {
    await runEvalCli(["run", "-C", fixtureRoot, "--agent", "codex", "--model", "openai/gpt-5"]);

    expect(mockedRun.runMatrix).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: fixtureRoot
      })
    );
  });

  it("passes the --judge agent override through config-derived judge defaults", async () => {
    await runEvalCli([
      "run",
      "--agent",
      "codex",
      "--model",
      "openai/gpt-5",
      "--judge",
      "judge-agent"
    ]);

    expect(mockedRun.runMatrix).toHaveBeenCalledWith(
      expect.objectContaining({
        judge: {
          agent: "judge-agent",
          model: "opus-4.7"
        }
      })
    );
  });

  it("parses eval init defaults and flags before calling runInitCli", async () => {
    await runEvalCli([
      "init",
      "smoke-task",
      "-C",
      "/repo/evals",
      "--kind",
      "experiment",
      "--target-repo",
      "https://example.com/repo.git",
      "--target-ref",
      "main"
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runInitCli).toHaveBeenCalledWith({
      name: "smoke-task",
      sourceDir: "/repo/evals",
      kind: "experiment",
      targetRepo: "https://example.com/repo.git",
      targetRef: "main"
    });
  });

  it("uses the default init kind when --kind is absent", async () => {
    await runEvalCli(["init", "smoke-task"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runInitCli).toHaveBeenCalledWith({
      name: "smoke-task",
      sourceDir: undefined,
      kind: "plan",
      targetRepo: undefined,
      targetRef: undefined
    });
  });

  it("previews eval init without creating the scaffold", async () => {
    await runEvalCli(["init", "smoke-task", "--kind", "plan", "--dry-run"]);

    expect(mockedRun.runInitCli).not.toHaveBeenCalled();
    expect(output()).toContain("Dry run: would create plan eval scaffold smoke-task.");
  });

  it("rejects unsupported init kinds before calling runInitCli", async () => {
    await runEvalCli(["init", "smoke-task", "--kind", "unknown"]);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain('Invalid value for "kind"');
    expect(mockedRun.runInitCli).not.toHaveBeenCalled();
  });

  it("requires a name for eval init", async () => {
    await runEvalCli(["init"]);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain('Missing required parameter "name".');
    expect(mockedRun.runInitCli).not.toHaveBeenCalled();
  });

  it("parses eval check arguments before calling runCheckCli", async () => {
    await runEvalCli(["check", "smoke-task", "-C", "/repo/evals"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runCheckCli).toHaveBeenCalledWith({
      evalId: "smoke-task",
      sourceDir: "/repo/evals"
    });
  });

  it("allows eval check without an eval id", async () => {
    await runEvalCli(["check", "-C", "/repo/evals"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runCheckCli).toHaveBeenCalledWith({
      evalId: undefined,
      sourceDir: "/repo/evals"
    });
  });

  it("previews eval check without executing oracle verification", async () => {
    await runEvalCli(["check", "smoke-task", "--dry-run"]);

    expect(mockedRun.runCheckCli).not.toHaveBeenCalled();
    expect(output()).toContain("Dry run: would verify eval oracle smoke-task.");
  });

  it("parses eval lint arguments before calling runLintCli", async () => {
    await runEvalCli(["lint", "smoke-task", "-C", "/repo/evals"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runLintCli).toHaveBeenCalledWith({
      evalId: "smoke-task",
      sourceDir: "/repo/evals"
    });
  });

  it("allows eval lint without an eval id", async () => {
    await runEvalCli(["lint", "-C", "/repo/evals"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runLintCli).toHaveBeenCalledWith({
      evalId: undefined,
      sourceDir: "/repo/evals"
    });
  });

  it("renders local baseline comparisons for all reported runs", async () => {
    mockedRun.listRuns.mockImplementation(async (outDir: string) =>
      outDir.endsWith("baseline") ? ["baseline-run"] : ["current-run"]
    );
    mockedRun.loadRunResult.mockImplementation(async (runId: string) =>
      reportRun(runId, runId === "baseline-run" ? 1 : 0.5)
    );

    await runEvalCli(["report", "--all-runs", "--out", "current", "--baseline-out", "baseline"]);

    expect(output()).toContain("regressions:1");
    expect(output()).toContain("oracle_correctness:-0.5!");
  });
});

function reportRun(runId: string, correctness: number): EvalRunResult {
  return {
    runId,
    eval: "task",
    agent: "codex",
    model: "gpt-5",
    planKind: "plan",
    verdict: correctness === 1 ? "pass" : "fail",
    correctness,
    iterations: 1,
    durationMs: 100,
    usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.1 },
    tests: { passed: correctness === 1 ? 1 : 0, total: 1, pass_rate: correctness, cases: [] },
    scoring: {
      tests: {
        configured: true,
        required: true,
        configuredWeight: 1,
        effectiveWeight: 1,
        status: "executed"
      },
      judge: {
        configured: false,
        required: false,
        configuredWeight: 0,
        effectiveWeight: 0,
        status: "disabled"
      }
    },
    cheated: false,
    cheatReport: { cheated: false, violations: [] },
    trace: { available: true, eventCount: 1, toolEventCount: 0, errorEventCount: 0 }
  };
}

async function runEvalCli(args: string[]): Promise<void> {
  process.argv = ["node", "poe-code", "eval", ...args];
  await runCLI([evalGroup], {
    rootUsageName: "poe-code eval",
    rootDisplayName: "Poe - eval"
  });
}

function output(): string {
  const stdout = vi
    .mocked(process.stdout.write)
    .mock.calls.map((call) => String(call[0]))
    .join("");
  const stderr = vi
    .mocked(process.stderr.write)
    .mock.calls.map((call) => String(call[0]))
    .join("");
  return `${stdout}${stderr}`;
}
