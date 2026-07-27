import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { createFsFromVolume, Volume } from "memfs";
import type { FileSystem } from "../../utils/file-system.js";
import { createCliContainer } from "../container.js";

const {
  ingestGaslightMock,
  introMock,
  multiselectMock,
  outroMock,
  runGaslightMock,
  selectMock,
  spawnPrettyMock
} = vi.hoisted(() => ({
  ingestGaslightMock: vi.fn(),
  introMock: vi.fn(),
  multiselectMock: vi.fn(),
  outroMock: vi.fn(),
  runGaslightMock: vi.fn(),
  selectMock: vi.fn(),
  spawnPrettyMock: vi.fn()
}));

vi.mock("../../sdk/gaslight.js", () => ({
  GASLIGHT_CONFIG_EXAMPLE: "prompt: Implement\nfollowups:\n  - Check it",
  ingestGaslight: ingestGaslightMock,
  runGaslight: runGaslightMock
}));

vi.mock("../../sdk/spawn.js", () => ({
  spawn: { pretty: spawnPrettyMock }
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    intro: introMock,
    multiselect: multiselectMock,
    outro: outroMock,
    isCancel: vi.fn(() => false),
    select: selectMock,
    withSpinner: vi.fn(async ({ fn }: { fn: () => Promise<unknown> }) => await fn())
  };
});

const { registerGaslightCommand } = await import("./gaslight.js");
const { SPAWN_MODES } = await import("@poe-code/agent-spawn");

function createProgram(): Command {
  return new Command()
    .exitOverride()
    .name("poe-code")
    .option("-y, --yes")
    .option("--dry-run")
    .option("--verbose");
}

function createContainer(
  prompts = vi.fn().mockResolvedValue({}),
  logger = vi.fn(),
  files: Record<string, string> = {
    "/repo/docs/plans/a.md": "# A",
    "/repo/docs/plans/b.md": "# B"
  }
) {
  const volume = Volume.fromJSON(files);
  return createCliContainer({
    fs: createFsFromVolume(volume).promises as unknown as FileSystem,
    prompts,
    env: { cwd: "/repo", homeDir: "/home/test" },
    logger
  });
}

function withInteractiveStdin<T>(run: () => Promise<T>): Promise<T> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });

  return run().finally(() => {
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });
}

describe("gaslight command", () => {
  beforeEach(() => {
    ingestGaslightMock.mockReset().mockResolvedValue({
      outputPath: ".poe-code/codex-gaslight.yaml",
      dataPath: "/tmp/prompts.md",
      promptCount: 3,
      traceCount: 2
    });
    introMock.mockClear();
    outroMock.mockClear();
    runGaslightMock.mockReset().mockResolvedValue({
      rounds: [{ prompt: "x", summary: "done" }],
      plans: [{ planPath: "docs/plans/a.md", rounds: [] }]
    });
    multiselectMock.mockReset();
    selectMock.mockReset();
    spawnPrettyMock.mockReset();
  });

  it("documents the archive default and what the plan argument actually does", () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    const help = (
      program.commands.find((command) => command.name() === "gaslight")?.helpInformation() ?? ""
    ).replace(/\s+/g, " ");

    expect(help).toContain("--no-archive");
    expect(help).toContain("Leave plans in place after gaslight rounds succeed (default)");
    expect(help).not.toContain("Markdown plans to implement sequentially");
    expect(help).toContain("configured prompt (default: Implement)");
  });

  it("does not prompt when plan, agent, and model are provided", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts));

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    expect(prompts).not.toHaveBeenCalled();
    expect(multiselectMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({ planPaths: ["docs/plans/a.md"], agent: "codex", model: "gpt-5" })
    );
  });

  it("forwards an explicit gaslight config path to the runner", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5",
      "--config",
      ".poe-code/codex-gaslight.yaml"
    ]);

    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planPaths: ["docs/plans/a.md"],
        agent: "codex",
        model: "gpt-5",
        configPath: ".poe-code/codex-gaslight.yaml"
      })
    );
  });

  it("forwards archive from the gaslight config scope", async () => {
    const program = createProgram();
    registerGaslightCommand(
      program,
      createContainer(vi.fn(), vi.fn(), {
        "/repo/docs/plans/a.md": "# A",
        "/repo/.poe-code/config.json": `${JSON.stringify({ gaslight: { archive: true } }, null, 2)}\n`
      })
    );

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    expect(runGaslightMock).toHaveBeenCalledWith(expect.objectContaining({ archive: true }));
  });

  it("does not pass the gaslight archive default over gaslight.yaml options", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ archive: expect.any(Boolean) })
    );
  });

  it("lets --no-archive override gaslight archive config", async () => {
    const program = createProgram();
    registerGaslightCommand(
      program,
      createContainer(vi.fn(), vi.fn(), {
        "/repo/docs/plans/a.md": "# A",
        "/repo/.poe-code/config.json": `${JSON.stringify({ gaslight: { archive: true } }, null, 2)}\n`
      })
    );

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5",
      "--no-archive"
    ]);

    expect(runGaslightMock).toHaveBeenCalledWith(expect.objectContaining({ archive: false }));
  });

  it("passes worktree flags through to the SDK runner", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5",
      "--worktree"
    ]);

    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        worktree: true
      })
    );
  });

  it("bounds each gaslight round spawn with --activity-timeout-ms", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--activity-timeout-ms",
      "1500"
    ]);

    const options = runGaslightMock.mock.calls[0]?.[0];
    await options.spawn("codex", { prompt: "Implement docs/plans/a.md" });

    expect(spawnPrettyMock).toHaveBeenCalledWith("codex", {
      prompt: "Implement docs/plans/a.md",
      activityTimeoutMs: 1500
    });
  });

  it("rejects a non-positive --activity-timeout-ms", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "gaslight",
        "docs/plans/a.md",
        "--agent",
        "codex",
        "--activity-timeout-ms",
        "0"
      ])
    ).rejects.toThrow('Invalid --activity-timeout-ms "0". Expected a positive integer.');
  });

  it("bridges --skill and --skills into each gaslight round spawn", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--skill",
      "foo",
      "--skills",
      "bar,claude/baz"
    ]);

    const options = runGaslightMock.mock.calls[0]?.[0];
    await options.spawn("codex", { prompt: "Implement docs/plans/a.md" });

    expect(spawnPrettyMock).toHaveBeenCalledWith("codex", {
      prompt: "Implement docs/plans/a.md",
      skills: ["foo", "bar", "claude/baz"]
    });
  });

  it("forwards an explicit gaslight mode to the runner", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5",
      "--mode",
      "read"
    ]);

    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planPaths: ["docs/plans/a.md"],
        agent: "codex",
        model: "gpt-5",
        mode: "read"
      })
    );
  });

  it("offers exactly the shared spawn permission modes so the sets cannot drift", () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    const gaslight = program.commands.find((command) => command.name() === "gaslight");
    const modeOption = gaslight?.options.find((option) => option.long === "--mode");

    expect(modeOption?.argChoices).toEqual([...SPAWN_MODES]);
  });

  it("forwards multiple gaslight plans to the runner in order", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "docs/plans/b.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planPaths: ["docs/plans/a.md", "docs/plans/b.md"],
        agent: "codex",
        model: "gpt-5"
      })
    );
  });

  it("uses the pretty spawn renderer for gaslight rounds", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    const options = runGaslightMock.mock.calls[0]?.[0];
    expect(options?.spawn).toBeTypeOf("function");
    await options.spawn("codex", { prompt: "Implement docs/plans/a.md" });
    expect(spawnPrettyMock).toHaveBeenCalledWith("codex", {
      prompt: "Implement docs/plans/a.md"
    });
  });

  it("prints the last gaslight thread resume command", async () => {
    runGaslightMock.mockResolvedValue({
      rounds: [{ prompt: "Implement docs/plans/a.md", summary: "done", threadId: "thread_abc123" }],
      plans: [{ planPath: "docs/plans/a.md", rounds: [] }]
    });
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    expect(outroMock).toHaveBeenCalledWith(
      "1 rounds finished\nCompleted plans:\n- docs/plans/a.md\nUsage unavailable\nResume: codex resume -C /repo thread_abc123"
    );
  });

  it("prints the completed plans at the end of the session", async () => {
    runGaslightMock.mockResolvedValue({
      rounds: [
        { prompt: "Implement docs/plans/a.md", summary: "done" },
        { prompt: "Implement docs/plans/b.md", summary: "done" }
      ],
      plans: [
        { planPath: "docs/plans/a.md", rounds: [] },
        {
          planPath: "docs/plans/b.md",
          archivedPath: "docs/plans/archive/b.md",
          rounds: []
        }
      ]
    });
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "docs/plans/b.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    expect(outroMock).toHaveBeenCalledWith(
      [
        "2 plans, 2 rounds finished",
        "Completed plans:",
        "- docs/plans/a.md",
        "- docs/plans/b.md → docs/plans/archive/b.md",
        "Usage unavailable"
      ].join("\n")
    );
  });

  it("prints each gaslight round prompt before spawning", async () => {
    const logger = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(vi.fn(), logger));

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "docs/plans/a.md",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    const options = runGaslightMock.mock.calls[0]?.[0];
    options.onEvent({
      type: "round.started",
      round: 1,
      total: 2,
      prompt: "Implement docs/plans/a.md",
      planPath: "docs/plans/a.md",
      planIndex: 1,
      totalPlans: 1
    });
    options.onEvent({
      type: "round.started",
      round: 2,
      total: 2,
      prompt: "Check it",
      planPath: "docs/plans/a.md",
      planIndex: 1,
      totalPlans: 1
    });

    expect(logger).toHaveBeenCalledWith("Prompt: Implement docs/plans/a.md");
    expect(logger).toHaveBeenCalledWith("Prompt: Check it");
  });

  it("rejects mixing positional plan with --plans", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "gaslight",
        "docs/plans/a.md",
        "--plans",
        "docs/plans/b.md",
        "--agent",
        "codex",
        "--model",
        "gpt-5"
      ])
    ).rejects.toThrow("Use only one plan source");
    expect(runGaslightMock).not.toHaveBeenCalled();
  });

  it("prompts for plan and agent but never model when omitted", async () => {
    multiselectMock.mockResolvedValue(["docs/plans/b.md"]);
    const prompts = vi.fn().mockResolvedValueOnce({ serviceSelection: "codex" });
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts));

    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    try {
      await program.parseAsync(["node", "cli", "gaslight"]);
    } finally {
      if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    }

    expect(multiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select Gaslight plans to run:",
        required: true
      })
    );
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({ planPaths: ["docs/plans/b.md"], agent: "codex" })
    );
    expect(runGaslightMock.mock.calls[0]?.[0]).not.toHaveProperty("model");
  });

  it("passes the configured default agent model through without prompting with --yes", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(
      program,
      createContainer(prompts, vi.fn(), {
        "/repo/docs/plans/a.md": "# A",
        "/repo/.poe-code/config.json": `${JSON.stringify(
          { core: { defaultAgent: "codex:openai/gpt-5.4" } },
          null,
          2
        )}\n`
      })
    );

    await program.parseAsync(["node", "cli", "--yes", "gaslight", "docs/plans/a.md"]);

    expect(prompts).not.toHaveBeenCalled();
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "codex", model: "openai/gpt-5.4" })
    );
  });

  it("uses multiselect-selected plans in order when omitted interactively", async () => {
    multiselectMock.mockResolvedValue(["docs/plans/a.md", "docs/plans/b.md"]);
    const prompts = vi.fn().mockResolvedValueOnce({ serviceSelection: "codex" });
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts));

    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    try {
      await program.parseAsync(["node", "cli", "gaslight"]);
    } finally {
      if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    }

    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planPaths: ["docs/plans/a.md", "docs/plans/b.md"],
        agent: "codex"
      })
    );
  });

  it("defers the mode default to agent-spawn without prompts with --yes", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts));

    await program.parseAsync(["node", "cli", "--yes", "gaslight", "docs/plans/a.md"]);

    expect(prompts).not.toHaveBeenCalled();
    expect(multiselectMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planPaths: ["docs/plans/a.md"],
        agent: "claude-code"
      })
    );
    expect(runGaslightMock.mock.calls[0]?.[0]).not.toHaveProperty("model");
    expect(runGaslightMock.mock.calls[0]?.[0]).not.toHaveProperty("mode");
  });

  it("refuses to autopick a plan with --yes and lists the discovered plans", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await expect(program.parseAsync(["node", "cli", "--yes", "gaslight"])).rejects.toThrow(
      /docs\/plans\/a\.md[\s\S]*docs\/plans\/b\.md/
    );

    expect(multiselectMock).not.toHaveBeenCalled();
    expect(runGaslightMock).not.toHaveBeenCalled();
  });

  it("reports configured and resolved plan directories when the default directory is missing", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts, vi.fn(), {}));

    await expect(program.parseAsync(["node", "cli", "--yes", "gaslight"])).rejects.toThrow(
      [
        "Gaslight couldn't find the plan directory.",
        "",
        "Configured directory: docs/plans",
        "Resolved path: /repo/docs/plans",
        "",
        "To use a different plan directory:",
        "- Project config: poe-code utils config edit --project",
        "  /repo/.poe-code/config.json",
        "- Global config: poe-code utils config edit --global",
        "  /home/test/.poe-code/config.json",
        '- Set JSON: { "plan": { "plan_directory": "~/.poe-code/docs/plans" } }',
        "- One-off: POE_PLAN_DIRECTORY=~/.poe-code/docs/plans poe-code gaslight"
      ].join("\n")
    );
    expect(runGaslightMock).not.toHaveBeenCalled();
  });

  it("reports configured and resolved plan directories when no markdown plans are found", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(
      program,
      createContainer(prompts, vi.fn(), {
        "/repo/docs/plans/readme.txt": "not a plan"
      })
    );

    await expect(program.parseAsync(["node", "cli", "--yes", "gaslight"])).rejects.toThrow(
      [
        "Gaslight found the plan directory, but it has no .md plans.",
        "",
        "Configured directory: docs/plans",
        "Resolved path: /repo/docs/plans",
        "",
        "To use a different plan directory:",
        "- Project config: poe-code utils config edit --project",
        "  /repo/.poe-code/config.json",
        "- Global config: poe-code utils config edit --global",
        "  /home/test/.poe-code/config.json",
        '- Set JSON: { "plan": { "plan_directory": "~/.poe-code/docs/plans" } }',
        "- One-off: POE_PLAN_DIRECTORY=~/.poe-code/docs/plans poe-code gaslight"
      ].join("\n")
    );
    expect(runGaslightMock).not.toHaveBeenCalled();
  });

  it("selects plans from a configured home-relative plan directory", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(
      program,
      createContainer(prompts, vi.fn(), {
        "/repo/.poe-code/config.json": `${JSON.stringify(
          {
            plan: { plan_directory: "~/.poe-code/docs/plans" }
          },
          null,
          2
        )}\n`,
        "/home/test/.poe-code/docs/plans/global.md": "# Global"
      })
    );

    multiselectMock.mockResolvedValue(["~/.poe-code/docs/plans/global.md"]);
    await withInteractiveStdin(() =>
      program.parseAsync(["node", "cli", "gaslight", "--agent", "claude-code"])
    );

    expect(multiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: "~/.poe-code/docs/plans/global.md", value: "~/.poe-code/docs/plans/global.md" }
        ]
      })
    );
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planPaths: ["~/.poe-code/docs/plans/global.md"],
        agent: "claude-code"
      })
    );
  });

  it("uses project plan directory over global plan directory", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(
      program,
      createContainer(prompts, vi.fn(), {
        "/home/test/.poe-code/config.json": `${JSON.stringify(
          {
            plan: { plan_directory: "~/.poe-code/docs/plans" }
          },
          null,
          2
        )}\n`,
        "/repo/.poe-code/config.json": `${JSON.stringify(
          {
            plan: { plan_directory: "project/plans" }
          },
          null,
          2
        )}\n`,
        "/home/test/.poe-code/docs/plans/global.md": "# Global",
        "/repo/project/plans/project.md": "# Project"
      })
    );

    multiselectMock.mockResolvedValue(["project/plans/project.md"]);
    await withInteractiveStdin(() =>
      program.parseAsync(["node", "cli", "gaslight", "--agent", "claude-code"])
    );

    expect(multiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [{ label: "project/plans/project.md", value: "project/plans/project.md" }]
      })
    );
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planPaths: ["project/plans/project.md"],
        agent: "claude-code"
      })
    );
  });

  it("routes install as a subcommand instead of a plan path", async () => {
    const container = createContainer();
    const program = createProgram();
    registerGaslightCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "gaslight", "install", "--local"]);

    expect(runGaslightMock).not.toHaveBeenCalled();
    await expect(container.fs.readFile("/repo/.poe-code/gaslight.yaml", "utf8")).resolves.toContain(
      "prompt: Implement"
    );
  });

  it("scaffolds global config when installing globally", async () => {
    const container = createContainer();
    const program = createProgram();
    registerGaslightCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "gaslight", "install", "--global"]);

    await expect(
      container.fs.readFile("/home/test/.poe-code/gaslight.yaml", "utf8")
    ).resolves.toContain("followups:");
  });

  it("does not replace an existing config without --force", async () => {
    const container = createContainer();
    await container.fs.mkdir("/repo/.poe-code", { recursive: true });
    await container.fs.writeFile("/repo/.poe-code/gaslight.yaml", "prompt: Keep me\n", {
      encoding: "utf8"
    });
    const program = createProgram();
    registerGaslightCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "gaslight", "install", "--local"]);

    await expect(container.fs.readFile("/repo/.poe-code/gaslight.yaml", "utf8")).resolves.toBe(
      "prompt: Keep me\n"
    );
  });

  it("replaces an existing config with --force", async () => {
    const container = createContainer();
    await container.fs.mkdir("/repo/.poe-code", { recursive: true });
    await container.fs.writeFile("/repo/.poe-code/gaslight.yaml", "prompt: Replace me\n", {
      encoding: "utf8"
    });
    const program = createProgram();
    registerGaslightCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "gaslight", "install", "--local", "--force"]);

    await expect(container.fs.readFile("/repo/.poe-code/gaslight.yaml", "utf8")).resolves.toContain(
      "prompt: Implement"
    );
  });

  it("reports a forced overwrite of an existing config and shows the diff", async () => {
    const logger = vi.fn();
    const container = createContainer(vi.fn().mockResolvedValue({}), logger, {
      "/repo/.poe-code/gaslight.yaml": "prompt: Replace me\n"
    });
    const program = createProgram();
    registerGaslightCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "gaslight", "install", "--local", "--force"]);

    const logs = logger.mock.calls.map(([message]) => String(message));
    expect(logs.some((message) => message.includes("Overwrite: /repo/.poe-code/gaslight.yaml"))).toBe(
      true
    );
    expect(logs.some((message) => message.includes("prompt: Replace me"))).toBe(true);
    expect(logs.some((message) => message.includes("Create: /repo/.poe-code/gaslight.yaml"))).toBe(
      false
    );
  });

  it("previews a forced overwrite as an overwrite and leaves the config untouched", async () => {
    const logger = vi.fn();
    const container = createContainer(vi.fn().mockResolvedValue({}), logger, {
      "/repo/.poe-code/gaslight.yaml": "prompt: Replace me\n"
    });
    const program = createProgram();
    registerGaslightCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "--dry-run",
      "gaslight",
      "install",
      "--local",
      "--force"
    ]);

    await expect(container.fs.readFile("/repo/.poe-code/gaslight.yaml", "utf8")).resolves.toBe(
      "prompt: Replace me\n"
    );
    const logs = logger.mock.calls.map(([message]) => String(message));
    expect(
      logs.some((message) => message.includes("Would overwrite: /repo/.poe-code/gaslight.yaml"))
    ).toBe(true);
    expect(logs.some((message) => message.includes("Would create"))).toBe(false);
  });

  it("rejects a symlinked local config directory when installing locally", async () => {
    const container = createContainer();
    await container.fs.mkdir("/outside", { recursive: true });
    await container.fs.symlink("/outside", "/repo/.poe-code");
    const program = createProgram();
    registerGaslightCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--yes", "gaslight", "install", "--local"])
    ).rejects.toThrow("Gaslight config directory cannot be a symbolic link: /repo/.poe-code");

    await expect(container.fs.readFile("/outside/gaslight.yaml", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("runs ingest without prompting when agent is provided", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts));

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "ingest",
      "--agent",
      "codex",
      "--model",
      "gpt-5",
      "--sources",
      "claude,codex",
      "--since",
      "7d",
      "--limit",
      "25",
      "--output",
      ".poe-code/test-gaslight.yaml",
      "--keep-data",
      ".poe-code/prompts.md",
      "--all-workspaces"
    ]);

    expect(prompts).not.toHaveBeenCalled();
    expect(ingestGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisAgent: "codex",
        model: "gpt-5",
        sources: ["claude", "codex"],
        since: "7d",
        limit: 25,
        outputPath: ".poe-code/test-gaslight.yaml",
        keepDataPath: ".poe-code/prompts.md",
        allWorkspaces: true,
        cwd: "/repo",
        homeDir: "/home/test"
      })
    );
  });

  it("previews ingest counts without prompting or writing when --dry-run is passed", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts));

    await program.parseAsync(["node", "cli", "gaslight", "ingest", "--dry-run", "--limit", "25"]);

    expect(prompts).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(ingestGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisAgent: "claude-code",
        dryRun: true,
        limit: 25
      })
    );
  });

  it("reports what ingest would analyse and write on a single dry-run closing line", async () => {
    const logger = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(vi.fn(), logger));

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "ingest",
      "--agent",
      "codex",
      "--dry-run"
    ]);

    expect(outroMock).toHaveBeenCalledWith(
      "Would analyze 3 prompts from 2 traces with codex and write .poe-code/codex-gaslight.yaml"
    );
    expect(outroMock.mock.calls[0]?.[0]).not.toContain("\n");
  });

  it("honours the global --dry-run flag passed before the ingest command", async () => {
    const program = createProgram();
    registerGaslightCommand(program, createContainer());

    await program.parseAsync(["node", "cli", "--dry-run", "gaslight", "ingest", "--agent", "codex"]);

    expect(ingestGaslightMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it("keeps gaslight ingest completion as a single closing line", async () => {
    const logger = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(vi.fn(), logger));

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "ingest",
      "--agent",
      "codex",
      "--model",
      "gpt-5"
    ]);

    expect(outroMock).toHaveBeenCalledWith("Wrote .poe-code/codex-gaslight.yaml");
    expect(outroMock.mock.calls[0]?.[0]).not.toContain("\n");
    expect(logger).not.toHaveBeenCalledWith(expect.stringContaining("Extracted"));
    expect(logger).not.toHaveBeenCalledWith(expect.stringContaining("Analysis input"));
  });

  it("reports kept gaslight ingest data before the closing line", async () => {
    const logger = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(vi.fn(), logger));

    await program.parseAsync([
      "node",
      "cli",
      "gaslight",
      "ingest",
      "--agent",
      "codex",
      "--model",
      "gpt-5",
      "--keep-data",
      ".poe-code/prompts.md"
    ]);

    expect(logger).toHaveBeenCalledWith("Analysis input: /tmp/prompts.md");
    expect(outroMock).toHaveBeenCalledWith("Wrote .poe-code/codex-gaslight.yaml");
  });
});
