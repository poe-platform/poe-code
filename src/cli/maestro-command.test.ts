import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";

const runMaestroMock = vi.hoisted(() => vi.fn());
const runMaestroTickMock = vi.hoisted(() => vi.fn());
const runMaestroTuiMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/maestro", () => ({
  runMaestro: runMaestroMock,
  runMaestroTick: runMaestroTickMock
}));

vi.mock("@poe-code/maestro-tui", () => ({
  runMaestroTui: runMaestroTuiMock
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
    runMaestroTickMock.mockReset();
    runMaestroTuiMock.mockReset();
  });

  function createTestProgram() {
    runMaestroMock.mockResolvedValue(async () => undefined);
    runMaestroTickMock.mockResolvedValue(undefined);
    runMaestroTuiMock.mockResolvedValue(undefined);
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

    expect(runMaestroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowPath: "custom/WORKFLOW.md",
        maxConcurrent: 3,
        pollIntervalMs: 1500,
        list: "backlog",
        dryRun: true,
        yes: true,
        logLevel: "debug"
      })
    );
  });

  it("passes --name through maestro run", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "maestro", "run", "--name", "bugs"]);

    expect(runMaestroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "bugs"
      })
    );
  });

  it("uses command defaults when optional args are omitted", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "maestro"]);

    expect(runMaestroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowPath: "./WORKFLOW.md",
        maxConcurrent: undefined,
        pollIntervalMs: undefined,
        list: undefined,
        dryRun: undefined,
        yes: undefined,
        logLevel: "info"
      })
    );
  });

  it("honors global yes and dry-run flags before the command", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "--yes", "--dry-run", "maestro"]);

    expect(runMaestroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowPath: "./WORKFLOW.md",
        maxConcurrent: undefined,
        pollIntervalMs: undefined,
        list: undefined,
        dryRun: true,
        yes: true,
        logLevel: "info"
      })
    );
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

    await expect(program.parseAsync(["node", "cli", "maestro", flag, value])).rejects.toThrow(
      `Invalid ${flag} "${value}". Expected a positive integer.`
    );
    expect(runMaestroMock).not.toHaveBeenCalled();
  });

  it("accepts --config as an alias for the workflow path argument", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "maestro", "--config", "custom/WORKFLOW.md"]);

    expect(runMaestroMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowPath: "custom/WORKFLOW.md" })
    );
  });

  it.each([
    ["dry-run", "--dry-run"],
    ["yes", "--yes"],
    ["log-level", "--log-level"]
  ])("rejects positional %s that names an option with a hint", async (positional, flag) => {
    const program = createTestProgram();

    await expect(
      program.parseAsync(["node", "cli", "maestro", positional])
    ).rejects.toThrow(`Did you mean \`${flag}\`?`);
    expect(runMaestroMock).not.toHaveBeenCalled();
  });

  it("registers tui as a maestro subcommand", () => {
    const program = createTestProgram();

    const maestroCommand = program.commands.find((command) => command.name() === "maestro");
    const tuiCommand = maestroCommand?.commands.find((command) => command.name() === "tui");

    expect(tuiCommand?.description()).toBe("Open the Maestro interactive task explorer.");
  });

  it("registers tick as a maestro subcommand", () => {
    const program = createTestProgram();

    const maestroCommand = program.commands.find((command) => command.name() === "maestro");
    const tickCommand = maestroCommand?.commands.find((command) => command.name() === "tick");

    expect(tickCommand?.description()).toBe("Emit one Maestro tick event for an external trigger.");
  });

  it("runs maestro tick and writes emitted events as NDJSON", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = createTestProgram();
    runMaestroTickMock.mockImplementation(async (options) => {
      options.onEvent({ type: "tick_started", at: "2026-01-01T00:00:00.000Z" });
    });

    try {
      await program.parseAsync([
        "node",
        "cli",
        "maestro",
        "tick",
        "--task",
        "maestro/one",
        "--transition",
        "queued:agent-running",
        "--list",
        "maestro",
        "--config",
        "custom/WORKFLOW.md"
      ]);

      expect(runMaestroTickMock).toHaveBeenCalledWith(
        expect.objectContaining({
          task: "maestro/one",
          transition: "queued:agent-running",
          list: "maestro",
          configPath: "custom/WORKFLOW.md"
        })
      );
      expect(stdout).toHaveBeenCalledWith(
        `${JSON.stringify({ type: "tick_started", at: "2026-01-01T00:00:00.000Z" })}\n`
      );
    } finally {
      stdout.mockRestore();
    }

    expect(runMaestroMock).not.toHaveBeenCalled();
    expect(runMaestroTuiMock).not.toHaveBeenCalled();
  });

  it("passes --name through maestro tick", async () => {
    const program = createTestProgram();

    await program.parseAsync([
      "node",
      "cli",
      "maestro",
      "tick",
      "--task",
      "maestro/one",
      "--transition",
      "queued:agent-running",
      "--name",
      "bugs"
    ]);

    expect(runMaestroTickMock).toHaveBeenCalledWith(expect.objectContaining({ name: "bugs" }));
  });

  it("forwards parent --list to maestro tick when tick --list is omitted", async () => {
    const program = createTestProgram();

    await program.parseAsync([
      "node",
      "cli",
      "maestro",
      "--list",
      "backlog",
      "tick",
      "--task",
      "maestro/one",
      "--transition",
      "queued:agent-running"
    ]);

    expect(runMaestroTickMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "maestro/one",
        transition: "queued:agent-running",
        list: "backlog"
      })
    );
    expect(runMaestroMock).not.toHaveBeenCalled();
    expect(runMaestroTuiMock).not.toHaveBeenCalled();
  });

  it("forwards root dry-run to maestro tick", async () => {
    const program = createTestProgram();

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "maestro",
      "tick",
      "--task",
      "maestro/one",
      "--transition",
      "*:queued"
    ]);

    expect(runMaestroTickMock).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
  });

  it("requires task and transition for maestro tick", async () => {
    const program = createTestProgram();

    await expect(program.parseAsync(["node", "cli", "maestro", "tick"])).rejects.toThrow(
      /--task <qualifiedId>[\s\S]*--transition <fromState:toState>/
    );
    expect(runMaestroTickMock).not.toHaveBeenCalled();
  });

  it("opens the Maestro TUI with --workflow forwarded as workflowPath", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "maestro", "tui", "--workflow", "custom/WORKFLOW.md"]);

    expect(runMaestroTuiMock).toHaveBeenCalledWith({
      workflowPath: "custom/WORKFLOW.md"
    });
    expect(runMaestroMock).not.toHaveBeenCalled();
  });

  it("opens the Maestro TUI with --config forwarded as workflowPath", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "maestro", "tui", "--config", "custom/WORKFLOW.md"]);

    expect(runMaestroTuiMock).toHaveBeenCalledWith({
      workflowPath: "custom/WORKFLOW.md"
    });
  });

  it("treats --workflow as an alias of --config for the Maestro TUI", async () => {
    const program = createTestProgram();

    await program.parseAsync([
      "node",
      "cli",
      "maestro",
      "tui",
      "--config",
      "custom/WORKFLOW.md",
      "--workflow",
      "other/WORKFLOW.md"
    ]);

    expect(runMaestroTuiMock).toHaveBeenCalledWith({ workflowPath: "custom/WORKFLOW.md" });
  });

  it("documents --workflow as an alias instead of duplicating the --config description", () => {
    const program = createTestProgram();

    const tuiCommand = program.commands
      .find((command) => command.name() === "maestro")
      ?.commands.find((command) => command.name() === "tui");
    const descriptionOf = (long: string) =>
      tuiCommand?.options.find((option) => option.long === long)?.description;

    expect(descriptionOf("--config")).toBe("Path to WORKFLOW.md");
    expect(descriptionOf("--workflow")).toBe("Alias for --config");
  });

  it("passes --name through maestro tui", async () => {
    const program = createTestProgram();

    await program.parseAsync(["node", "cli", "maestro", "tui", "--name", "bugs"]);

    expect(runMaestroTuiMock).toHaveBeenCalledWith({ name: "bugs" });
  });

  it("opens the Maestro TUI without prompting when --workflow is omitted", async () => {
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs: createMemFs(homeDir),
      prompts,
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "maestro", "tui"]);

    expect(runMaestroTuiMock).toHaveBeenCalledWith({});
    expect(prompts).not.toHaveBeenCalled();
    expect(runMaestroMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported Maestro TUI flags", async () => {
    const program = createTestProgram();

    await expect(
      program.parseAsync(["node", "cli", "maestro", "tui", "--list", "backlog"])
    ).rejects.toThrow("`poe-code maestro tui` only accepts --config, --workflow, or --name.");
    expect(runMaestroTuiMock).not.toHaveBeenCalled();
  });

  it.each(["--dry-run", "--yes", "--verbose"])(
    "rejects global %s when passed before the Maestro TUI command",
    async (flag) => {
      const program = createTestProgram();

      await expect(program.parseAsync(["node", "cli", flag, "maestro", "tui"])).rejects.toThrow(
        "`poe-code maestro tui` only accepts --config, --workflow, or --name."
      );
      expect(runMaestroTuiMock).not.toHaveBeenCalled();
    }
  );

  it.each(["--dry-run", "--yes", "--verbose"])(
    "rejects global %s when passed after the Maestro TUI command",
    async (flag) => {
      const program = createTestProgram();

      await expect(program.parseAsync(["node", "cli", "maestro", "tui", flag])).rejects.toThrow(
        "`poe-code maestro tui` only accepts --config, --workflow, or --name."
      );
      expect(runMaestroTuiMock).not.toHaveBeenCalled();
    }
  );

  it("rejects an unsupported log level", async () => {
    const program = createTestProgram();

    await expect(
      program.parseAsync(["node", "cli", "maestro", "--log-level", "verbose"])
    ).rejects.toThrow(/Allowed choices are trace, debug, info, warn, error/);
    expect(runMaestroMock).not.toHaveBeenCalled();
  });
});
