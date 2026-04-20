import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfs } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";

vi.mock("../../providers/index.js", () => ({
  getDefaultProviders: () => []
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("tokenfill", () => ({
  countTokens: (input: string) => input.length
}));

const { registerMemoryCommand } = await import("./memory.js");

const cwd = "/repo";
const homeDir = "/home/test";

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createContainer(): ReturnType<typeof createCliContainer> {
  const fs = memfs.promises as unknown as FileSystem;
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
}

describe("memory command", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
  });

  it("initializes the memory directory", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "memory", "init"]);

    await expect(
      memfs.promises.readFile("/repo/.poe-code/memory/INDEX.md", "utf8")
    ).resolves.toContain("Memory index");
    await expect(
      memfs.promises.readFile("/repo/.poe-code/memory/LOG.md", "utf8")
    ).resolves.toBe("");
  });

  it("refuses to list pages when memory is not initialized", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--yes", "memory", "ls"])
    ).rejects.toThrow(/memory init/i);
  });

  it("clears memory", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/one.md": "# One\n"
    });

    await program.parseAsync(["node", "cli", "--yes", "memory", "clear"]);

    await expect(
      memfs.promises.readdir("/repo/.poe-code/memory/pages")
    ).resolves.toEqual([]);
  });

  it("lists pages with descriptions", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/one.md": "---\ndescription: First page\n---\n# One\n",
      "/repo/.poe-code/memory/pages/two.md": "# Two\n"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "ls"]);

    expect(writeSpy).toHaveBeenCalledWith("one.md — First page\n");
    expect(writeSpy).toHaveBeenCalledWith("two.md\n");
    writeSpy.mockRestore();
  });

  it("shows a page by relative path", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/nested/example.md": "Hello world"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "show", "nested/example"]);

    expect(writeSpy).toHaveBeenCalledWith("Hello world\n");
    writeSpy.mockRestore();
  });

  it("searches memory pages", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/one.md": "alpha\nbeta match\n",
      "/repo/.poe-code/memory/pages/two.md": "match again\n"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "search", "match"]);

    expect(writeSpy).toHaveBeenCalledWith("one.md:2: beta match\n");
    expect(writeSpy).toHaveBeenCalledWith("two.md:1: match again\n");
    writeSpy.mockRestore();
  });

  it("shows token output by default and supports --no-tokens", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/one.md": "---\nsources:\n  - path: src/example.ts\n---\nHello\n",
      "/repo/src/example.ts": "const x = 1;\n"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "status"]);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringMatching(/tokens/i));

    writeSpy.mockClear();
    await program.parseAsync(["node", "cli", "--yes", "memory", "status", "--no-tokens"]);
    expect(writeSpy).not.toHaveBeenCalledWith(expect.stringMatching(/tokens/i));

    writeSpy.mockRestore();
  });
});
