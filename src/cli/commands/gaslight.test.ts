import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { createFsFromVolume, Volume } from "memfs";
import type { FileSystem } from "../../utils/file-system.js";
import { createCliContainer } from "../container.js";

const { ingestGaslightMock, introMock, outroMock, runGaslightMock, selectMock } = vi.hoisted(() => ({
  ingestGaslightMock: vi.fn(),
  introMock: vi.fn(),
  outroMock: vi.fn(),
  runGaslightMock: vi.fn(),
  selectMock: vi.fn()
}));

vi.mock("../../sdk/gaslight.js", () => ({
  GASLIGHT_CONFIG_EXAMPLE: "prompt: Implement\nfollowups:\n  - Check it",
  ingestGaslight: ingestGaslightMock,
  runGaslight: runGaslightMock
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    intro: introMock,
    outro: outroMock,
    isCancel: vi.fn(() => false),
    select: selectMock,
    withSpinner: vi.fn(async ({ fn }: { fn: () => Promise<unknown> }) => await fn())
  };
});

const { registerGaslightCommand } = await import("./gaslight.js");

function createProgram(): Command {
  return new Command()
    .exitOverride()
    .name("poe-code")
    .option("-y, --yes")
    .option("--dry-run")
    .option("--verbose");
}

function createContainer(prompts = vi.fn().mockResolvedValue({}), logger = vi.fn()) {
  const volume = Volume.fromJSON({
    "/repo/docs/plans/a.md": "# A",
    "/repo/docs/plans/b.md": "# B"
  });
  return createCliContainer({
    fs: createFsFromVolume(volume).promises as unknown as FileSystem,
    prompts,
    env: { cwd: "/repo", homeDir: "/home/test" },
    logger
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
    runGaslightMock.mockReset().mockResolvedValue({ rounds: [{ prompt: "x", summary: "done" }] });
    selectMock.mockReset();
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
    expect(selectMock).not.toHaveBeenCalled();
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({ planPath: "docs/plans/a.md", agent: "codex", model: "gpt-5" })
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
        planPath: "docs/plans/a.md",
        agent: "codex",
        model: "gpt-5",
        configPath: ".poe-code/codex-gaslight.yaml"
      })
    );
  });

  it("prompts for plan, agent, and model when omitted", async () => {
    selectMock.mockResolvedValue("docs/plans/b.md");
    const prompts = vi
      .fn()
      .mockResolvedValueOnce({ serviceSelection: "codex" })
      .mockResolvedValueOnce({ model: "gpt-5" });
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts));

    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    try {
      await program.parseAsync(["node", "cli", "gaslight"]);
    } finally {
      if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    }

    expect(selectMock).toHaveBeenCalledOnce();
    expect(prompts).toHaveBeenCalledTimes(2);
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({ planPath: "docs/plans/b.md", agent: "codex", model: "gpt-5" })
    );
  });

  it("accepts defaults without prompts with --yes", async () => {
    const prompts = vi.fn();
    const program = createProgram();
    registerGaslightCommand(program, createContainer(prompts));

    await program.parseAsync(["node", "cli", "--yes", "gaslight"]);

    expect(prompts).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(runGaslightMock).toHaveBeenCalledWith(
      expect.objectContaining({ planPath: "docs/plans/a.md", agent: "claude-code", mode: "edit" })
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
