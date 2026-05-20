import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCLI } from "toolcraft/cli";
import type { EvalMatrixOptions, EvalRunResult } from "../types.js";

const mockedRun = vi.hoisted(() => ({
  runMatrix: vi.fn<(opts: EvalMatrixOptions) => AsyncIterable<EvalRunResult>>(),
  runInitCli: vi.fn(),
  runCheckCli: vi.fn(),
  runLintCli: vi.fn()
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
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  mockedRun.runMatrix.mockReset();
  mockedRun.runInitCli.mockReset();
  mockedRun.runCheckCli.mockReset();
  mockedRun.runLintCli.mockReset();
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

  it("lets runInitCli apply the default init kind when --kind is absent", async () => {
    await runEvalCli(["init", "smoke-task"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runInitCli).toHaveBeenCalledWith({
      name: "smoke-task",
      sourceDir: undefined,
      kind: undefined,
      targetRepo: undefined,
      targetRef: undefined
    });
  });

  it("parses eval check arguments before calling runCheckCli", async () => {
    await runEvalCli(["check", "smoke-task", "-C", "/repo/evals"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runCheckCli).toHaveBeenCalledWith({
      evalId: "smoke-task",
      sourceDir: "/repo/evals"
    });
  });

  it("parses eval lint arguments before calling runLintCli", async () => {
    await runEvalCli(["lint", "smoke-task", "-C", "/repo/evals"]);

    expect(process.exitCode).toBeUndefined();
    expect(mockedRun.runLintCli).toHaveBeenCalledWith({
      evalId: "smoke-task",
      sourceDir: "/repo/evals"
    });
  });
});

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
