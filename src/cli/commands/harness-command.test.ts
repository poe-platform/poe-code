import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfs } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";

const harnessMocks = vi.hoisted(() => ({
  runHarnessPairMock: vi.fn(),
  listBuiltinTemplatesMock: vi.fn(),
  selectMock: vi.fn(),
  promptTextMock: vi.fn(),
  spawnMock: vi.fn()
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

vi.mock("@poe-code/agent-harness", async () => {
  const actual =
    await vi.importActual<typeof import("@poe-code/agent-harness")>("@poe-code/agent-harness");
  return {
    ...actual,
    runHarnessPair: harnessMocks.runHarnessPairMock,
    listBuiltinTemplates: harnessMocks.listBuiltinTemplatesMock
  };
});

vi.mock("@poe-code/design-system", async () => {
  const actual =
    await vi.importActual<typeof import("@poe-code/design-system")>("@poe-code/design-system");
  return {
    ...actual,
    select: harnessMocks.selectMock,
    promptText: harnessMocks.promptTextMock,
    withSpinner: async <T>(options: { fn: () => Promise<T> }) => options.fn()
  };
});

vi.mock("../../sdk/spawn.js", () => ({
  spawn: harnessMocks.spawnMock
}));

vi.mock("../../providers/index.js", () => ({
  getDefaultProviders: () => []
}));

const { registerHarnessCommand } = await import("./harness.js");

const cwd = "/repo";
const homeDir = "/home/test";

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createContainer(logs: string[] = []): ReturnType<typeof createCliContainer> {
  return createCliContainer({
    fs: memfs.promises as unknown as FileSystem,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (message) => logs.push(message),
    commandRunner: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "1\n", stderr: "" })
  });
}

async function runHarnessCommand(args: string[], logs: string[] = []): Promise<void> {
  const program = createBaseProgram();
  registerHarnessCommand(program, createContainer(logs));
  await program.parseAsync(["node", "cli", ...args]);
}

function writePair(root: string, basename: string): void {
  vol.fromJSON({
    [path.join(root, basename, `${basename}.md`)]: "---\nkind: test\nversion: 1\n---\n",
    [path.join(root, basename, `${basename}.ajs`)]: "export default () => true;\n"
  });
}

describe("harness command", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
    vol.fromJSON({
      "/templates/demo.md": "---\nkind: demo\nversion: 1\n---\n# Demo\n",
      "/templates/demo.ajs": "export default () => true;\n"
    });
    harnessMocks.runHarnessPairMock.mockReset();
    harnessMocks.runHarnessPairMock.mockResolvedValue({ ok: true, returnValue: "done" });
    harnessMocks.listBuiltinTemplatesMock.mockReset();
    harnessMocks.listBuiltinTemplatesMock.mockReturnValue([
      { kind: "demo", mdPath: "/templates/demo.md", ajsPath: "/templates/demo.ajs" }
    ]);
    harnessMocks.selectMock.mockReset();
    harnessMocks.promptTextMock.mockReset();
    harnessMocks.spawnMock.mockReset();
    harnessMocks.spawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve({ exitCode: 0, stdout: "spawned", stderr: "" })
    });
  });

  it("runs an explicit harness path and wires agent spawns through the SDK", async () => {
    let agentModule: Map<string, unknown> | undefined;
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1, agents: { builder: "codex" }, tasks: [] },
        {
          kind: "test",
          version: 1,
          filename: "/repo/harness.md",
          dirname: "/repo",
          body: ""
        }
      );
      agentModule = modules.agent;
      const spawn = agentModule?.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Build it" });
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({ modulesFor: expect.any(Function) })
    );
    expect(harnessMocks.spawnMock).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({ cwd: "/repo", prompt: "Build it" })
    );
  });

  it("runs the single discovered project harness when no path is provided", async () => {
    writePair("/repo/.poe-code/harnesses", "review");

    await runHarnessCommand(["--yes", "harness", "run"]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/.poe-code/harnesses/review/review.md",
      expect.objectContaining({ modulesFor: expect.any(Function) })
    );
  });

  it("fails run discovery when no harnesses are found", async () => {
    await expect(runHarnessCommand(["harness", "run"])).rejects.toThrow(/no harness pairs found/i);
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
  });

  it("runs the selected discovered harness when multiple harnesses are found interactively", async () => {
    writePair("/repo/.poe-code/harnesses", "alpha");
    writePair("/repo/.poe-code/harnesses", "beta");
    harnessMocks.selectMock.mockResolvedValue("/repo/.poe-code/harnesses/beta/beta.md");

    await runHarnessCommand(["harness", "run"]);

    expect(harnessMocks.selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select harness",
        options: expect.arrayContaining([
          expect.objectContaining({ label: expect.stringContaining("alpha") }),
          expect.objectContaining({ label: expect.stringContaining("beta") })
        ])
      })
    );
    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/.poe-code/harnesses/beta/beta.md",
      expect.objectContaining({ modulesFor: expect.any(Function) })
    );
  });

  it("fails discovery under --yes when multiple harnesses are found", async () => {
    writePair("/repo/.poe-code/harnesses", "alpha");
    writePair("/repo/.poe-code/harnesses", "beta");

    await expect(runHarnessCommand(["--yes", "harness", "run"])).rejects.toThrow(
      /ambiguous, pass a path/i
    );
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
  });

  it("fails new when the template kind is missing", async () => {
    await expect(
      runHarnessCommand(["--yes", "harness", "new", "missing", "example"])
    ).rejects.toThrow(/unknown harness template/i);
  });

  it("scaffolds a new pair from a built-in template", async () => {
    const logs: string[] = [];

    await runHarnessCommand(["--yes", "harness", "new", "demo", "example"], logs);

    await expect(
      memfs.promises.readFile("/repo/.poe-code/harnesses/example/example.md", "utf8")
    ).resolves.toContain("# Demo");
    await expect(
      memfs.promises.readFile("/repo/.poe-code/harnesses/example/example.ajs", "utf8")
    ).resolves.toContain("export default");
    expect(logs.join("\n")).toContain("Created harness pair");
  });

  it("scaffolds into an explicit directory without prompting", async () => {
    await runHarnessCommand(["harness", "new", "demo", "example", "--dir", "qa/harnesses/demo"]);

    await expect(
      memfs.promises.readFile("/repo/qa/harnesses/demo/example.md", "utf8")
    ).resolves.toContain("# Demo");
    expect(harnessMocks.promptTextMock).not.toHaveBeenCalled();
  });

  it("prompts for the scaffold directory when --dir and --yes are omitted", async () => {
    harnessMocks.promptTextMock.mockResolvedValue("custom/harness");

    await runHarnessCommand(["harness", "new", "demo", "example"]);

    await expect(
      memfs.promises.readFile("/repo/custom/harness/example.md", "utf8")
    ).resolves.toContain("# Demo");
    expect(harnessMocks.promptTextMock).toHaveBeenCalledWith({
      message: "Harness directory",
      initialValue: ".poe-code/harnesses/example"
    });
  });

  it("refuses to overwrite an existing scaffold file", async () => {
    vol.fromJSON({
      "/repo/.poe-code/harnesses/example/example.md": "# Existing\n"
    });

    await expect(runHarnessCommand(["--yes", "harness", "new", "demo", "example"])).rejects.toThrow(
      /refusing to overwrite/i
    );
    await expect(
      memfs.promises.readFile("/repo/.poe-code/harnesses/example/example.md", "utf8")
    ).resolves.toBe("# Existing\n");
  });

  it("lists empty discovery results", async () => {
    const logs: string[] = [];

    await runHarnessCommand(["harness", "list"], logs);

    expect(logs.join("\n")).toContain("No harness pairs found.");
  });

  it("lists multiple discovered harness pairs", async () => {
    const logs: string[] = [];
    writePair("/repo/.poe-code/harnesses", "alpha");
    writePair("/home/test/.poe-code/harnesses", "beta");

    await runHarnessCommand(["harness", "list"], logs);

    const output = logs.join("\n");
    expect(output).toContain("alpha");
    expect(output).toContain("beta");
    expect(output).toContain(".poe-code/harnesses/alpha");
    expect(output).toContain("~/.poe-code/harnesses/beta");
  });
});
