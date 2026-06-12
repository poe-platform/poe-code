import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { createFsFromVolume, Volume } from "memfs";
import type { FileSystem } from "../../utils/file-system.js";
import { createCliContainer } from "../container.js";

const { runGaslightMock, selectMock } = vi.hoisted(() => ({
  runGaslightMock: vi.fn(),
  selectMock: vi.fn()
}));

vi.mock("../../sdk/gaslight.js", () => ({
  GASLIGHT_CONFIG_EXAMPLE: "prompt: Implement\nfollowups:\n  - Check it",
  runGaslight: runGaslightMock
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    intro: vi.fn(),
    outro: vi.fn(),
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

function createContainer(prompts = vi.fn().mockResolvedValue({})) {
  const volume = Volume.fromJSON({
    "/repo/docs/plans/a.md": "# A",
    "/repo/docs/plans/b.md": "# B"
  });
  return createCliContainer({
    fs: createFsFromVolume(volume).promises as unknown as FileSystem,
    prompts,
    env: { cwd: "/repo", homeDir: "/home/test" },
    logger: () => {}
  });
}

describe("gaslight command", () => {
  beforeEach(() => {
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
});
