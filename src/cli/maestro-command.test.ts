import { afterEach, describe, expect, it, vi } from "vitest";
import { CommanderError } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";

const runMaestroMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-maestro", () => ({
  runMaestro: runMaestroMock
}));

import { createProgram } from "./program.js";

function createMemFs(homeDir: string): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("maestro command", () => {
  const homeDir = "/home/test";

  afterEach(() => {
    runMaestroMock.mockReset();
  });

  function createTestProgram() {
    runMaestroMock.mockResolvedValue(async () => undefined);
    return createProgram({
      fs: createMemFs(homeDir),
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });
  }

  it("passes parsed args to runMaestro", async () => {
    const program = createTestProgram();

    await program.parseAsync([
      "node",
      "cli",
      "maestro",
      "custom/WORKFLOW.md",
      "-c",
      "3",
      "--poll-interval-ms",
      "1500",
      "--list",
      "backlog",
      "--dry-run",
      "--yes",
      "--log-level",
      "debug"
    ]);

    expect(runMaestroMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowPath: "custom/WORKFLOW.md",
      maxConcurrent: 3,
      pollIntervalMs: 1500,
      list: "backlog",
      dryRun: true,
      yes: true,
      logLevel: "debug"
    }));
  });

  it("uses command defaults when optional args are omitted", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "maestro"]);

    expect(runMaestroMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowPath: "./WORKFLOW.md",
      maxConcurrent: undefined,
      pollIntervalMs: undefined,
      list: undefined,
      dryRun: undefined,
      yes: undefined,
      logLevel: "info"
    }));
  });

  it("honors global yes and dry-run flags before the command", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "--yes", "--dry-run", "maestro"]);

    expect(runMaestroMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowPath: "./WORKFLOW.md",
      maxConcurrent: undefined,
      pollIntervalMs: undefined,
      list: undefined,
      dryRun: true,
      yes: true,
      logLevel: "info"
    }));
  });

  it.each([
    ["--max-concurrent", "0"],
    ["--max-concurrent", "1.5"],
    ["--max-concurrent", "abc"],
    ["--poll-interval-ms", "0"],
    ["--poll-interval-ms", "1.5"],
    ["--poll-interval-ms", "abc"]
  ])("rejects invalid positive integer option %s %s", async (flag, value) => {
    const program = createTestProgram();

    await expect(program.parseAsync(["node", "cli", "maestro", flag, value])).rejects.toMatchObject(
      {
        exitCode: 1,
        code: "commander.invalidArgument"
      }
    );
    expect(runMaestroMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported log level", async () => {
    const program = createTestProgram();

    await expect(
      program.parseAsync(["node", "cli", "maestro", "--log-level", "verbose"])
    ).rejects.toBeInstanceOf(CommanderError);
    expect(runMaestroMock).not.toHaveBeenCalled();
  });
});
