import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("toolcraft-design", async () => {
  const actual =
    await vi.importActual<typeof import("toolcraft-design")>("toolcraft-design");
  return {
    ...actual,
    select: harnessMocks.selectMock,
    promptText: harnessMocks.promptTextMock,
    withSpinner: async <T>(options: { message: string | (() => string); fn: () => Promise<T> }) => {
      if (typeof options.message === "function") {
        options.message();
      }
      return options.fn();
    }
  };
});

vi.mock("../../sdk/spawn.js", () => ({
  spawn: harnessMocks.spawnMock
}));

vi.mock("../../providers/index.js", () => ({
  getDefaultProviders: () => []
}));

const { registerHarnessCommand } = await import("./harness.js");
const { run: runAgentScript } = await import("@poe-code/agent-script");

const cwd = "/repo";
const homeDir = "/home/test";
const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setProcessStdinIsTTY(value: boolean): () => void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true
  });

  return restoreProcessStdinIsTTY;
}

function restoreProcessStdinIsTTY(): void {
  if (stdinIsTTYDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinIsTTYDescriptor);
  } else {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
}

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

function writePair(
  root: string,
  basename: string,
  ajsSource = "export default () => true;\n"
): void {
  vol.fromJSON({
    [path.join(root, basename, `${basename}.md`)]: "---\nkind: test\nversion: 1\n---\n",
    [path.join(root, basename, `${basename}.ajs`)]: ajsSource
  });
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let reject: (error: unknown) => void = () => undefined;
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

async function waitForPath(filePath: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    if (vol.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function snapshotForSource(source: string): Promise<string> {
  const result = await runAgentScript(source);
  return JSON.stringify(result.snapshot, null, 2);
}

describe("harness command", () => {
  beforeEach(() => {
    setProcessStdinIsTTY(true);
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync(homeDir, { recursive: true });
    vol.fromJSON({
      "/repo/harness.md": "---\nkind: test\nversion: 1\n---\n",
      "/repo/harness.ajs": "export default () => true;\n",
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

  afterEach(() => {
    restoreProcessStdinIsTTY();
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

  it("passes --fix through to the harness runner explicitly", async () => {
    await runHarnessCommand(["harness", "run", "harness.md", "--fix"]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({ fix: true })
    );
  });

  it("previews harness runs without executing scripts or applying fixes", async () => {
    const logs: string[] = [];

    await runHarnessCommand(["--dry-run", "--yes", "harness", "run", "harness.md", "--fix"], logs);

    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Dry run: would run harness.md without executing its script or applying fixes.");
  });

  it("forwards --agent/--model/--mode as frontmatterOverrides on the agent block", async () => {
    await runHarnessCommand([
      "harness",
      "run",
      "harness.md",
      "--agent",
      "codex",
      "--model",
      "iris-alpha",
      "--mode",
      "edit"
    ]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({
        frontmatterOverrides: { agent: { agent: "codex", model: "iris-alpha", mode: "edit" } }
      })
    );
  });

  it("omits frontmatterOverrides when no override flags are supplied", async () => {
    await runHarnessCommand(["harness", "run", "harness.md"]);

    const call = harnessMocks.runHarnessPairMock.mock.calls.at(-1);
    expect(call?.[1].frontmatterOverrides).toBeUndefined();
  });

  it("forwards only the supplied override flag, leaving the others off the merge object", async () => {
    await runHarnessCommand(["harness", "run", "harness.md", "--model", "iris-alpha"]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({
        frontmatterOverrides: { agent: { model: "iris-alpha" } }
      })
    );
  });

  it("prints non-error lint diagnostics reported by the harness runner", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      options.onDiagnostics([
        {
          code: "AS-FRONTMATTER-FIELD-UNUSED",
          severity: "info",
          message: "Frontmatter field 'b' is declared by the schema but never read.",
          filename: "/repo/harness.ajs",
          line: 2,
          column: 1,
          span: {
            start: { line: 2, column: 1, offset: 10 },
            end: { line: 2, column: 1, offset: 10 }
          }
        }
      ]);
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    expect(logs.join("\n")).toContain("Lint diagnostics:");
    expect(logs.join("\n")).toContain(
      "/repo/harness.ajs:2:1 info AS-FRONTMATTER-FIELD-UNUSED Frontmatter field 'b' is declared by the schema but never read."
    );
  });

  it("prints the total cost line when the harness result includes usage cost", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValueOnce({
      ok: true,
      returnValue: "done",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 2,
        costUsd: 0.125,
        spawnCount: 1
      }
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    expect(logs.join("\n")).toContain("Total cost: $0.13");
  });

  it("passes an explicit snapshot path and writes checkpoints while running", async () => {
    const snapshotPath = "/repo/tmp/harness.snapshot.json";
    const runFinished = createDeferred();
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      await memfs.promises.mkdir(path.dirname(options.snapshotPath), { recursive: true });
      await memfs.promises.writeFile(options.snapshotPath, JSON.stringify({ step: 1 }));
      await runFinished.promise;
      return { ok: true, returnValue: "done" };
    });

    const command = runHarnessCommand([
      "harness",
      "run",
      "harness.md",
      "--snapshot-path",
      "tmp/harness.snapshot.json"
    ]);

    await waitForPath(snapshotPath);
    await expect(memfs.promises.readFile(snapshotPath, "utf8")).resolves.toContain('"step":1');
    runFinished.resolve();
    await command;

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({ snapshotPath })
    );
  });

  it("resumes from an existing snapshot after an interrupted run", async () => {
    const source = "export default () => true;\n";
    const snapshotPath = "/repo/tmp/resume.snapshot.json";
    harnessMocks.runHarnessPairMock.mockImplementationOnce(async (_mdPath, options) => {
      await memfs.promises.mkdir(path.dirname(options.snapshotPath), { recursive: true });
      await memfs.promises.writeFile(options.snapshotPath, await snapshotForSource(source));
      throw new Error("interrupted");
    });
    harnessMocks.runHarnessPairMock.mockResolvedValueOnce({ ok: true, returnValue: "resumed" });

    await expect(
      runHarnessCommand(["harness", "run", "harness.md", "--snapshot-path", snapshotPath])
    ).rejects.toThrow("interrupted");

    await runHarnessCommand([
      "harness",
      "run",
      "harness.md",
      "--snapshot-path",
      snapshotPath,
      "--resume"
    ]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenLastCalledWith(
      "/repo/harness.md",
      expect.objectContaining({ snapshotPath })
    );
  });

  it("fails resume clearly when the .ajs source changed", async () => {
    const snapshotPath = "/repo/tmp/source-changed.snapshot.json";
    await memfs.promises.mkdir(path.dirname(snapshotPath), { recursive: true });
    await memfs.promises.writeFile(
      snapshotPath,
      await snapshotForSource("export default () => true;\n")
    );
    await memfs.promises.writeFile("/repo/harness.ajs", "export default () => false;\n");

    await expect(
      runHarnessCommand([
        "harness",
        "run",
        "harness.md",
        "--snapshot-path",
        snapshotPath,
        "--resume"
      ])
    ).rejects.toThrow(/source changed.*script was edited/i);
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
  });

  it("starts fresh when --resume is set and the snapshot file does not exist", async () => {
    const snapshotPath = "/repo/tmp/missing.snapshot.json";

    await runHarnessCommand([
      "harness",
      "run",
      "harness.md",
      "--snapshot-path",
      snapshotPath,
      "--resume"
    ]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({ snapshotPath })
    );
  });

  it("writes the default snapshot path under .poe-code/harnesses/<basename>", async () => {
    const snapshotPath = "/repo/.poe-code/harnesses/harness/snapshot.json";
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      await memfs.promises.mkdir(path.dirname(options.snapshotPath), { recursive: true });
      await memfs.promises.writeFile(options.snapshotPath, JSON.stringify({ step: 2 }));
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"]);

    await expect(memfs.promises.readFile(snapshotPath, "utf8")).resolves.toContain('"step":2');
    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({ snapshotPath, snapshotPathIsDefault: true })
    );
  });

  it("surfaces the existing lock error for concurrent invocations with the same snapshot path", async () => {
    const snapshotPath = "/repo/tmp/concurrent.snapshot.json";
    const releaseFirstRun = createDeferred();
    let inFlight = false;
    harnessMocks.runHarnessPairMock.mockImplementation(async () => {
      if (inFlight) {
        throw new Error('Failed to acquire lock on "/repo/harness.md".');
      }
      inFlight = true;
      await releaseFirstRun.promise;
      inFlight = false;
      return { ok: true, returnValue: "done" };
    });

    const first = runHarnessCommand([
      "harness",
      "run",
      "harness.md",
      "--snapshot-path",
      snapshotPath
    ]);
    await vi.waitFor(() => expect(inFlight).toBe(true));

    await expect(
      runHarnessCommand(["harness", "run", "harness.md", "--snapshot-path", snapshotPath])
    ).rejects.toThrow(/failed to acquire lock/i);

    releaseFirstRun.resolve();
    await first;
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

  it("fails run discovery without prompting when multiple harnesses are found in non-interactive mode", async () => {
    const restoreStdin = setProcessStdinIsTTY(false);
    writePair("/repo/.poe-code/harnesses", "alpha");
    writePair("/repo/.poe-code/harnesses", "beta");

    try {
      await expect(runHarnessCommand(["harness", "run"])).rejects.toThrow(
        /pass a path or --yes when running without an interactive TTY/i
      );
    } finally {
      restoreStdin();
    }

    expect(harnessMocks.selectMock).not.toHaveBeenCalled();
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

  it("removes a partial scaffold when writing the script fails", async () => {
    const fs = {
      ...(memfs.promises as unknown as FileSystem),
      async writeFile(filePath: string, data: string | NodeJS.ArrayBufferView, options?: { encoding?: BufferEncoding; flag?: string }) {
        if (filePath.endsWith("example.ajs")) {
          throw new Error("script write failed");
        }
        await memfs.promises.writeFile(filePath, data, options);
      }
    } as FileSystem;
    const program = createBaseProgram();
    registerHarnessCommand(program, createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => undefined,
      commandRunner: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
    }));

    await expect(
      program.parseAsync(["node", "cli", "--yes", "harness", "new", "demo", "example"])
    ).rejects.toThrow("script write failed");

    await expect(
      memfs.promises.readFile("/repo/.poe-code/harnesses/example/example.md", "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      memfs.promises.readFile("/repo/.poe-code/harnesses/example/example.ajs", "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a basename that escapes the harness directory", async () => {
    await expect(runHarnessCommand(["--yes", "harness", "new", "demo", "../victim"])).rejects.toThrow(
      /invalid harness basename/i
    );

    await expect(memfs.promises.readFile("/repo/.poe-code/victim.md", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
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

  it("fails new without prompting for a directory in non-interactive mode", async () => {
    const restoreStdin = setProcessStdinIsTTY(false);

    try {
      await expect(runHarnessCommand(["harness", "new", "demo", "example"])).rejects.toThrow(
        /requires --dir or --yes when running without an interactive TTY/i
      );
    } finally {
      restoreStdin();
    }

    expect(harnessMocks.promptTextMock).not.toHaveBeenCalled();
    await expect(
      memfs.promises.readFile("/repo/.poe-code/harnesses/example/example.md", "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
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
