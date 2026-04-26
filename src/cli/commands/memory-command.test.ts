import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfs } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";

const memoryModuleMocks = vi.hoisted(() => ({
  memoryRoot: "/repo/.memfs/memory",
  resolveConfiguredMemoryRootMock: vi.fn(),
  openMemoryMock: vi.fn(),
  actualOpenMemory: undefined as
    | undefined
    | ((options: { root: string; agent?: string }) => unknown)
}));

vi.mock("../../providers/index.js", () => ({
  getDefaultProviders: () => []
}));

vi.mock("@poe-code/memory", async () => {
  const actual = await vi.importActual<typeof import("@poe-code/memory")>("@poe-code/memory");
  memoryModuleMocks.actualOpenMemory = actual.openMemory;
  memoryModuleMocks.resolveConfiguredMemoryRootMock.mockResolvedValue(memoryModuleMocks.memoryRoot);
  memoryModuleMocks.openMemoryMock.mockImplementation((options) => actual.openMemory(options));

  return {
    ...actual,
    resolveConfiguredMemoryRoot: memoryModuleMocks.resolveConfiguredMemoryRootMock,
    openMemory: memoryModuleMocks.openMemoryMock
  };
});

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
const memoryRoot = memoryModuleMocks.memoryRoot;

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
    memoryModuleMocks.resolveConfiguredMemoryRootMock.mockReset();
    memoryModuleMocks.resolveConfiguredMemoryRootMock.mockResolvedValue(memoryRoot);
    memoryModuleMocks.openMemoryMock.mockClear();
    memoryModuleMocks.openMemoryMock.mockImplementation((options) => {
      const openMemory = memoryModuleMocks.actualOpenMemory;
      if (openMemory === undefined) {
        throw new Error("Expected actual openMemory implementation to be available.");
      }
      return openMemory(options);
    });
  });

  it("initializes the memory directory", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "memory", "init"]);

    await expect(
      memfs.promises.readFile(`${memoryRoot}/INDEX.md`, "utf8")
    ).resolves.toContain("Memory index");
    await expect(memfs.promises.readFile(`${memoryRoot}/LOG.md`, "utf8")).resolves.toBe("");
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledOnce();
    expect(memoryModuleMocks.openMemoryMock).not.toHaveBeenCalled();
  });

  it("refuses to list pages when memory is not initialized", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--yes", "memory", "ls"])
    ).rejects.toThrow(/memory init/i);
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledOnce();
    expect(memoryModuleMocks.openMemoryMock).toHaveBeenCalledWith({ root: memoryRoot });
  });

  it("clears memory", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [`${memoryRoot}/pages/one.md`]: "# One\n"
    });

    await program.parseAsync(["node", "cli", "--yes", "memory", "clear"]);

    await expect(memfs.promises.readdir(`${memoryRoot}/pages`)).resolves.toEqual([]);
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledOnce();
    expect(memoryModuleMocks.openMemoryMock).toHaveBeenCalledWith({ root: memoryRoot });
  });

  it("lists pages with descriptions", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [`${memoryRoot}/pages/one.md`]: "---\ndescription: First page\n---\n# One\n",
      [`${memoryRoot}/pages/two.md`]: "# Two\n"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "ls"]);

    expect(writeSpy).toHaveBeenCalledWith("one.md — First page\n");
    expect(writeSpy).toHaveBeenCalledWith("two.md\n");
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledOnce();
    expect(memoryModuleMocks.openMemoryMock).toHaveBeenCalledWith({ root: memoryRoot });
    writeSpy.mockRestore();
  });

  it("shows a page by relative path", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [`${memoryRoot}/pages/nested/example.md`]: "Hello world"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "show", "nested/example"]);

    expect(writeSpy).toHaveBeenCalledWith("Hello world\n");
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledOnce();
    expect(memoryModuleMocks.openMemoryMock).toHaveBeenCalledWith({ root: memoryRoot });
    writeSpy.mockRestore();
  });

  it("searches memory pages", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [`${memoryRoot}/pages/one.md`]: "alpha\nbeta match\n",
      [`${memoryRoot}/pages/two.md`]: "match again\n"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "search", "match"]);

    expect(writeSpy).toHaveBeenCalledWith("one.md:2: beta match\n");
    expect(writeSpy).toHaveBeenCalledWith("two.md:1: match again\n");
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledOnce();
    expect(memoryModuleMocks.openMemoryMock).toHaveBeenCalledWith({ root: memoryRoot });
    writeSpy.mockRestore();
  });

  it("shows token output by default and supports --no-tokens", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [`${memoryRoot}/pages/one.md`]:
        "---\nsources:\n  - path: src/example.ts\n---\nHello\n",
      "/repo/src/example.ts": "const x = 1;\n"
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "status"]);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringMatching(/tokens/i));
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledTimes(1);
    expect(memoryModuleMocks.openMemoryMock).toHaveBeenCalledWith({ root: memoryRoot });

    writeSpy.mockClear();
    await program.parseAsync(["node", "cli", "--yes", "memory", "status", "--no-tokens"]);
    expect(writeSpy).not.toHaveBeenCalledWith(expect.stringMatching(/tokens/i));
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledTimes(2);
    expect(memoryModuleMocks.openMemoryMock).toHaveBeenCalledTimes(2);

    writeSpy.mockRestore();
  });
});
