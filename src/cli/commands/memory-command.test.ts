import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfs } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";

const memoryModuleMocks = vi.hoisted(() => ({
  memoryRoot: "/repo/.memfs/memory",
  resolveConfiguredMemoryRootMock: vi.fn(),
  openMemoryMock: vi.fn(),
  installMemoryMock: vi.fn(),
  editPageMock: vi.fn(),
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
    openMemory: memoryModuleMocks.openMemoryMock,
    installMemory: memoryModuleMocks.installMemoryMock,
    editPage: memoryModuleMocks.editPageMock
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

function createContainer(logs: string[] = []): ReturnType<typeof createCliContainer> {
  const fs = memfs.promises as unknown as FileSystem;
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (message) => {
      logs.push(message);
    }
  });
}

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

function withMockedStdin<T>(run: () => Promise<T>, isTTY: boolean): Promise<T> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: isTTY
  });

  return run().finally(() => {
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
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
    memoryModuleMocks.installMemoryMock.mockReset();
    memoryModuleMocks.editPageMock.mockReset();
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

  it("rejects memory clear without --yes in non-interactive mode", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [`${memoryRoot}/pages/one.md`]: "# One\n"
    });

    await expect(
      withMockedStdin(() => program.parseAsync(["node", "cli", "memory", "clear"]), false)
    ).rejects.toThrow("memory clear requires --yes when running without an interactive TTY.");

    await expect(memfs.promises.readFile(`${memoryRoot}/pages/one.md`, "utf8")).resolves.toBe(
      "# One\n"
    );
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
    const logs: string[] = [];
    const container = createContainer(logs);
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
    expect(logs).toEqual([]);
    expect(memoryModuleMocks.resolveConfiguredMemoryRootMock).toHaveBeenCalledOnce();
    expect(memoryModuleMocks.openMemoryMock).toHaveBeenCalledWith({ root: memoryRoot });
    writeSpy.mockRestore();
  });

  it("does not treat inherited read codes as missing memory pages", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);
    const pagePath = `${memoryRoot}/pages/nested/example.md`;
    const readError = new Error("memory read denied");
    const originalReadFile = memfs.promises.readFile.bind(memfs.promises);

    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [pagePath]: "Hello world"
    });
    vi.spyOn(memfs.promises, "readFile").mockImplementation(async (filePath, options) => {
      if (String(filePath) === pagePath) {
        throw readError;
      }
      return originalReadFile(filePath, options as never) as never;
    });

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(
        program.parseAsync(["node", "cli", "--yes", "memory", "show", "nested/example"])
      ).rejects.toBe(readError);
    });
  });

  it("rejects show paths that escape the pages directory", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);

    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [`${memoryRoot}/pages/valid.md`]: "# Valid\n",
      [`${memoryRoot}/secret.md`]: "outside-page-secret\n"
    });

    await expect(
      program.parseAsync(["node", "cli", "--yes", "memory", "show", "../secret"])
    ).rejects.toThrow(/escape|page path/i);
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

  it("registers the documented authoring and retrieval commands", () => {
    const program = createBaseProgram();
    registerMemoryCommand(program, createContainer());
    const memory = program.commands.find((command) => command.name() === "memory");

    expect(memory?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(["write", "append", "edit", "ingest", "lint", "query", "explain", "install"])
    );
  });

  it("writes and appends page content from command input", async () => {
    const program = createBaseProgram();
    registerMemoryCommand(program, createContainer());
    vol.fromJSON({
      [`${memoryRoot}/INDEX.md`]: "# Memory index\n",
      [`${memoryRoot}/LOG.md`]: "",
      [`${memoryRoot}/pages/one.md`]: "Old content\n"
    });

    await program.parseAsync(["node", "cli", "--yes", "memory", "write", "one", "--reason", "rewrite", "--content", "Fresh content\n"]);
    await expect(memfs.promises.readFile(`${memoryRoot}/pages/one.md`, "utf8")).resolves.toContain("Fresh content");

    await program.parseAsync(["node", "cli", "--yes", "memory", "append", "one", "--reason", "append", "--content", "More content\n"]);
    await expect(memfs.promises.readFile(`${memoryRoot}/pages/one.md`, "utf8")).resolves.toContain("More content");
  });

  it("queries, explains, and audits through the memory handle", async () => {
    const handle = {
      statusOf: vi.fn().mockResolvedValue({ initialized: true }),
      query: vi.fn().mockResolvedValue({ answer: "Known.", citations: [], tokensUsed: 3, budget: 256, exitCode: 0 }),
      explainPage: vi.fn().mockResolvedValue({ answer: "Page.", citations: [], tokensUsed: 4, budget: 256, exitCode: 0, inboundPages: [], outboundSources: [] }),
      auditClaims: vi.fn().mockResolvedValue([{ page: "pages/one.md", issues: ["Missing source"] }])
    };
    memoryModuleMocks.openMemoryMock.mockReturnValue(handle);
    const program = createBaseProgram();
    registerMemoryCommand(program, createContainer());
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "query", "what?", "--budget", "256"]);
    await program.parseAsync(["node", "cli", "--yes", "memory", "explain", "one", "--budget", "256"]);
    await program.parseAsync(["node", "cli", "--yes", "memory", "lint"]);

    expect(handle.query).toHaveBeenCalledWith({ question: "what?", budget: 256, agent: undefined });
    expect(handle.explainPage).toHaveBeenCalledWith({ relPath: "pages/one.md", budget: 256, agent: undefined });
    expect(handle.auditClaims).toHaveBeenCalledWith({ repoRoot: cwd });
    expect(writeSpy).toHaveBeenCalledWith("Known.\n");
    expect(writeSpy).toHaveBeenCalledWith("Page.\n");
    expect(writeSpy).toHaveBeenCalledWith("pages/one.md: Missing source\n");
    writeSpy.mockRestore();
  });

  it("does not accept the unimplemented memory lint --fix option", async () => {
    const handle = {
      statusOf: vi.fn().mockResolvedValue({ initialized: true }),
      auditClaims: vi.fn()
    };
    memoryModuleMocks.openMemoryMock.mockReturnValue(handle);
    const program = createBaseProgram();
    registerMemoryCommand(program, createContainer());

    await expect(
      program.parseAsync(["node", "cli", "--yes", "memory", "lint", "--fix"])
    ).rejects.toThrow("unknown option '--fix'");
    expect(handle.auditClaims).not.toHaveBeenCalled();
  });

  it("does not spawn query or explain agents during dry-run", async () => {
    const handle = {
      statusOf: vi.fn().mockResolvedValue({ initialized: true }),
      query: vi.fn(),
      explainPage: vi.fn()
    };
    memoryModuleMocks.openMemoryMock.mockReturnValue(handle);
    const logs: string[] = [];
    const program = createBaseProgram();
    registerMemoryCommand(program, createContainer(logs));

    await program.parseAsync(["node", "cli", "--dry-run", "--yes", "memory", "query", "what?", "--budget", "256"]);
    await program.parseAsync(["node", "cli", "--dry-run", "--yes", "memory", "explain", "one", "--budget", "256"]);

    expect(handle.query).not.toHaveBeenCalled();
    expect(handle.explainPage).not.toHaveBeenCalled();
    expect(logs).toContain("Would query memory with budget 256.");
    expect(logs).toContain("Would explain pages/one.md with budget 256.");
  });

  it("ingests sources and installs the advertised memory integration", async () => {
    const handle = {
      statusOf: vi.fn().mockResolvedValue({ initialized: true }),
      ingest: vi.fn().mockResolvedValue({
        diff: { created: ["pages/new.md"], updated: [], deleted: [] },
        cacheHit: false
      })
    };
    memoryModuleMocks.openMemoryMock.mockReturnValue(handle);
    memoryModuleMocks.installMemoryMock.mockResolvedValue({ skillInstalled: true, mcpConfigured: true });
    const program = createBaseProgram();
    registerMemoryCommand(program, createContainer());
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "--yes", "memory", "ingest", "docs/source.md", "--force"]);
    await program.parseAsync(["node", "cli", "--yes", "memory", "install", "--agent", "codex", "--allow-writes"]);

    expect(handle.ingest).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: "file", absPath: "/repo/docs/source.md" },
      force: true
    }));
    expect(memoryModuleMocks.installMemoryMock).toHaveBeenCalledWith(expect.objectContaining({
      agent: "codex",
      allowWrites: true,
      skillContent: expect.stringContaining("poe-code memory")
    }));
    expect(writeSpy).toHaveBeenCalledWith("Ingested: 1 created, 0 updated, 0 deleted.\n");
    writeSpy.mockRestore();
  });

  it("rejects non-decimal ingest timeout values", async () => {
    const handle = {
      statusOf: vi.fn().mockResolvedValue({ initialized: true }),
      ingest: vi.fn()
    };
    memoryModuleMocks.openMemoryMock.mockReturnValue(handle);
    const program = createBaseProgram();
    registerMemoryCommand(program, createContainer());

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "memory", "ingest", "docs/source.md", "--timeout-ms", "0x10"])
    ).rejects.toThrow("Timeout must be a decimal non-negative integer.");
    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "memory", "ingest", "docs/source.md", "--timeout-ms", "1e2"])
    ).rejects.toThrow("Timeout must be a decimal non-negative integer.");
    expect(handle.ingest).not.toHaveBeenCalled();
  });

  it("requires initialized memory before editing a page", async () => {
    const handle = {
      statusOf: vi.fn().mockResolvedValue({ initialized: false })
    };
    memoryModuleMocks.openMemoryMock.mockReturnValue(handle);
    const program = createBaseProgram();
    registerMemoryCommand(program, createContainer());

    await expect(
      program.parseAsync(["node", "cli", "--yes", "memory", "edit", "one"])
    ).rejects.toThrow(/memory init/i);
    expect(memoryModuleMocks.editPageMock).not.toHaveBeenCalled();
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

  it("reports memory cache status", async () => {
    const logs: string[] = [];
    const container = createContainer(logs);
    const program = createBaseProgram();
    registerMemoryCommand(program, container);
    vol.fromJSON({ [`${memoryRoot}/.cache/ingest/one.json`]: "abc" });

    await program.parseAsync(["node", "cli", "--yes", "memory", "cache", "status"]);

    expect(logs).toContain("1 cache entry (3 bytes)");
  });

  it("clears memory cache entries when confirmed", async () => {
    const container = createContainer();
    const program = createBaseProgram();
    registerMemoryCommand(program, container);
    vol.fromJSON({ [`${memoryRoot}/.cache/ingest/one.json`]: "abc" });

    await program.parseAsync(["node", "cli", "--yes", "memory", "cache", "clear"]);

    await expect(memfs.promises.stat(`${memoryRoot}/.cache`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not clear memory cache entries during dry-run", async () => {
    const logs: string[] = [];
    const container = createContainer(logs);
    const program = createBaseProgram();
    registerMemoryCommand(program, container);
    vol.fromJSON({ [`${memoryRoot}/.cache/ingest/one.json`]: "abc" });

    await program.parseAsync(["node", "cli", "--dry-run", "--yes", "memory", "cache", "clear"]);

    await expect(memfs.promises.stat(`${memoryRoot}/.cache/ingest/one.json`)).resolves.toBeDefined();
    expect(logs).toContain("Would clear all memory cache entries.");
  });
});
