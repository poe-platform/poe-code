import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCLI } from "toolcraft/cli";
import type { EvalMatrixOptions, EvalRunResult } from "../types.js";

const mockedRun = vi.hoisted(() => ({
  runMatrix: vi.fn<(opts: EvalMatrixOptions) => AsyncIterable<EvalRunResult>>()
}));

vi.mock("../run/matrix.js", () => ({
  runMatrix: mockedRun.runMatrix
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
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  mockedRun.runMatrix.mockReset();
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
    await runEvalCli([
      "run",
      "-C",
      fixtureRoot,
      "--agent",
      "codex",
      "--model",
      "openai/gpt-5"
    ]);

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
