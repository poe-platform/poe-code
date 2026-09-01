import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfs } from "memfs";
import { Command } from "commander";
import { isCancel } from "toolcraft-design";
import { createCliContainer } from "../container.js";
import { OperationCancelledError, ValidationError } from "../errors.js";
import type { FileSystem } from "../../utils/file-system.js";

const harnessMocks = vi.hoisted(() => ({
  runHarnessPairMock: vi.fn(),
  listBuiltinTemplatesMock: vi.fn(),
  selectMock: vi.fn(),
  promptTextMock: vi.fn(),
  cancelMock: vi.fn(),
  spawnMock: vi.fn(),
  runWithOptionalWorktreeMock: vi.fn()
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
  const actual = await vi.importActual<typeof import("toolcraft-design")>("toolcraft-design");
  return {
    ...actual,
    cancel: harnessMocks.cancelMock,
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

vi.mock("../../sdk/worktree.js", () => ({
  runWithOptionalWorktree: harnessMocks.runWithOptionalWorktreeMock
}));

vi.mock("../../providers/index.js", () => ({
  getDefaultProviders: () => []
}));

const { registerHarnessCommand } = await import("./harness.js");
const { run: runSafeJS } = await import("@poe-code/safe-js");

// The registry the command hands runSafeJS, taken from runSafeJS's own signature so a
// change to what a module may export reaches these tests as a type error.
type SafeJSModuleRecord = Extract<
  NonNullable<NonNullable<Parameters<typeof runSafeJS>[1]>["modules"]>,
  Record<string, unknown>
>;

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
  program.configureOutput({ writeErr: vi.fn() });
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
  const result = await runSafeJS(source);
  return JSON.stringify(result.snapshot, null, 2);
}

describe("harness command", () => {
  it("uses the snapshot migration SDK for inspection, dry run, and exclusive output", async () => {
    const { dump } = await import("@poe-code/safe-js");
    const execution = runSafeJS("return 1;");
    await execution;
    vol.fromJSON({
      "/repo/old.ajs": "return 1;",
      "/repo/new.ajs": "export default () => import.meta.migration.count;",
      "/repo/old.json": await dump(execution)
    });
    const logs: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runHarnessCommand(
      ["harness", "migrate", "old.json", "--from", "old.ajs", "--inspect"],
      logs
    );
    const result = JSON.parse(stdout.mock.calls.map((call) => String(call[0])).join(""));
    expect(logs).toEqual([]);
    vol.fromJSON({
      "/repo/plan.json": JSON.stringify({
        state: { count: 4 },
        reconciliation: {
          checkpointDigest: result.inspection.checkpointDigest,
          quiescent: true,
          calls: []
        }
      })
    });
    const args = [
      "harness",
      "migrate",
      "old.json",
      "--from",
      "old.ajs",
      "--to",
      "new.ajs",
      "--plan",
      "plan.json",
      "--output",
      "next.json"
    ];
    await runHarnessCommand(["--dry-run", ...args]);
    expect(memfs.existsSync("/repo/next.json")).toBe(false);
    await runHarnessCommand(args);
    const snapshot = JSON.parse(memfs.readFileSync("/repo/next.json", "utf8") as string);
    expect(
      (
        await runSafeJS("export default () => import.meta.migration.count;", {
          snapshot,
          entryPointArgs: []
        })
      ).returnValue
    ).toBe(4);
    await expect(runHarnessCommand(args)).rejects.toMatchObject({ code: "EEXIST" });
  });

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
    harnessMocks.cancelMock.mockReset();
    harnessMocks.spawnMock.mockReset();
    harnessMocks.spawnMock.mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve({ exitCode: 0, stdout: "spawned", stderr: "" })
    });
    harnessMocks.runWithOptionalWorktreeMock.mockReset();
    harnessMocks.runWithOptionalWorktreeMock.mockImplementation(async (input) => {
      const enabled = input.worktree === true;
      const worktreeCwd = enabled ? path.join(cwd, ".poe-code", "worktrees", "generated") : cwd;
      const worktreeName = enabled ? "generated" : "source";
      const value = await input.run({
        sourceCwd: cwd,
        worktreeCwd,
        worktree: {
          name: worktreeName,
          path: worktreeCwd,
          branch: enabled ? `poe-code/${worktreeName}` : "",
          baseBranch: "HEAD",
          createdAt: "2026-01-01T00:00:00.000Z",
          source: "sdk",
          agent: input.selectedAgent,
          status: "active"
        }
      });
      return {
        value,
        ...(enabled
          ? {
              worktree: {
                worktree: {
                  name: worktreeName,
                  path: worktreeCwd,
                  branch: `poe-code/${worktreeName}`,
                  baseBranch: "HEAD",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  source: "sdk",
                  agent: input.selectedAgent,
                  status: "done"
                }
              }
            }
          : {})
      };
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
        spawnOptions: { prompt: string; timeoutMs?: number }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Build it", timeoutMs: 12_345 });
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({ modulesFor: expect.any(Function) })
    );
    expect(harnessMocks.spawnMock).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        activityTimeoutMs: 12_345,
        cwd: "/repo",
        prompt: "Build it"
      })
    );
  });

  it("runs multiple positional harness paths sequentially", async () => {
    vol.fromJSON({
      "/repo/second.md": "---\nkind: test\nversion: 1\n---\n",
      "/repo/second.ajs": "export default () => true;\n"
    });

    await runHarnessCommand(["harness", "run", "harness.md", "second.md"]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledTimes(2);
    expect(harnessMocks.runHarnessPairMock.mock.calls.map(([path]) => path)).toEqual([
      "/repo/harness.md",
      "/repo/second.md"
    ]);
  });

  it("passes worktree flags through the SDK helper and runs the harness path inside the worktree", async () => {
    await runHarnessCommand(["harness", "run", "harness.md", "--worktree", "--agent", "codex"]);

    expect(harnessMocks.runWithOptionalWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        selectedAgent: "codex",
        worktree: true
      })
    );
    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/.poe-code/worktrees/generated/harness.md",
      expect.objectContaining({
        snapshotPath:
          "/repo/.poe-code/worktrees/generated/.poe-code/harnesses/harness/snapshot.json"
      })
    );
  });

  it("validates missing harness files before previewing a dry run", async () => {
    const logs: string[] = [];

    await expect(
      runHarnessCommand(["--dry-run", "harness", "run", "missing.md"], logs)
    ).rejects.toThrow("Missing harness md file: /repo/missing.md");

    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("Dry run");
  });

  it("validates missing companion ajs files before previewing a dry run", async () => {
    const logs: string[] = [];
    vol.fromJSON({
      "/repo/only-md.md": "---\nkind: test\nversion: 1\n---\n"
    });

    await expect(
      runHarnessCommand(["--dry-run", "harness", "run", "only-md.md"], logs)
    ).rejects.toThrow("Missing harness ajs file: /repo/only-md.ajs");

    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("Dry run");
  });

  it("numbers sequential loop spawns so progress remains easy to follow", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "First" });
      await spawn("codex", { prompt: "Second" });
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    expect(logs.join("\n")).toContain("Spawn #1 codex — First started");
    expect(logs.join("\n")).toContain("Spawn #1 codex — First completed (");
    expect(logs.join("\n")).toContain("Spawn #2 codex — Second started");
    expect(logs.join("\n")).toContain("Spawn #2 codex — Second completed (");
    expect(logs.join("\n")).not.toContain("completed on attempt 1/5");
  });

  it("keeps larger sequential loops numbered and compact", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { label: string; prompt: string }
      ) => Promise<unknown>;
      for (let index = 1; index <= 12; index += 1) {
        await spawn("codex", { label: `Review item ${index}`, prompt: `Generated ${index}` });
      }
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    const output = logs.join("\n");
    expect(output).toContain("Spawn #1 codex — Review item 1 started");
    expect(output).toContain("Spawn #12 codex — Review item 12 completed (");
    expect(output).not.toContain("Generated 12");
    expect(Math.max(...logs.map((line) => line.length))).toBeLessThan(120);
  });

  it("renders explicit spawn labels for generated loop prompts", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { label: string; prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { label: "Review auth", prompt: "Generated prompt with details" });
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    expect(logs.join("\n")).toContain("Spawn #1 codex — Review auth started");
    expect(harnessMocks.spawnMock).toHaveBeenCalledWith(
      "codex",
      expect.not.objectContaining({ label: expect.anything() })
    );
  });

  it("fails permanent configuration errors immediately without retry backoff", async () => {
    const logs: string[] = [];
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.reject(new Error('Unknown service "missing".'))
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("missing", { prompt: "Build it" });
      return { ok: true, returnValue: "done" };
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toThrow(
      'Unknown service "missing".'
    );

    expect(harnessMocks.spawnMock).toHaveBeenCalledOnce();
    expect(logs.join("\n")).toContain("Spawn #1 missing — Build it failed after 1 attempt");
    expect(logs.join("\n")).not.toContain("Retrying in");
  });

  it("sanitizes and deduplicates long permanent spawn errors", async () => {
    const logs: string[] = [];
    const message = `Unknown service "missing".\n\u001b[31m${"detail ".repeat(100)}`;
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.reject(new Error(message))
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("missing", { prompt: "Build it" });
      return { ok: true, returnValue: "done" };
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toMatchObject({
      name: "ReportedError"
    });

    const output = logs.join("\n");
    expect(output).toContain('Unknown service "missing". [31m');
    expect(output).not.toContain("\u001b");
    expect(output.length).toBeLessThan(600);
  });

  it("fails permanent non-zero setup results immediately without retry backoff", async () => {
    const logs: string[] = [];
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.resolve({ exitCode: 1, stdout: "", stderr: "No API key found." })
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string; check: boolean }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Build it", check: true });
      return { ok: true, returnValue: "done" };
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toThrow(
      "No API key found."
    );

    expect(harnessMocks.spawnMock).toHaveBeenCalledOnce();
    expect(logs.join("\n")).not.toContain("Retrying in");
  });

  it.each([false, true])(
    "returns unchecked child failures without marking the harness failed (parallel=%s)",
    async (parallel) => {
      const logs: string[] = [];
      harnessMocks.spawnMock.mockImplementation(() => ({
        events: (async function* () {})(),
        result: Promise.resolve({
          exitCode: 1,
          stdout: "partial output",
          stderr: "No API key found."
        })
      }));
      harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
        const modules = options.modulesFor(
          { kind: "test", version: 1 },
          { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
        );
        const spawn = modules.agent.get("spawn") as ReturnType<
          typeof import("@poe-code/safe-js").makeAgentModule
        >["spawn"];
        const result = parallel
          ? (await spawn.parallel([["codex", { prompt: "Build it" }]]))[0]
          : await spawn("codex", { prompt: "Build it" });
        expect(result).toMatchObject({ exitCode: 1, stdout: "partial output" });
        return { ok: true, returnValue: "handled" };
      });

      await runHarnessCommand(["harness", "run", "harness.md"], logs);

      expect(harnessMocks.spawnMock).toHaveBeenCalledOnce();
      expect(logs.join("\n")).toContain("returned an unsuccessful result after 1 attempt");
      expect(logs.join("\n")).not.toContain("failed after");
      expect(logs.join("\n")).not.toContain("Retrying in");
    }
  );

  it.each([
    "API key rejected.",
    'No API key available for provider "anthropic".',
    "Missing Poe API key. Provide apiKey or run 'poe-code login'.",
    "Poe API key expired. Run `opencode providers login` again.",
    'Agent "codex" has no spawn config.',
    'Agent "codex" has no binaryName.',
    'Agent "codex" does not support ACP spawn.',
    'Agent "codex" does not support MCP servers over ACP spawn.',
    'Agent "codex" does not support CLI spawn.',
    "Gemini CLI spawn requires an active configured provider.",
    "codex CLI binary not found on PATH.",
    "Unauthorized: invalid credentials.",
    "Request failed: HTTP 401 Unauthorized.",
    "Forbidden: insufficient permissions.",
    "Authentication failed for configured provider.",
    "Invalid API key."
  ])("fails the permanent setup error %s immediately", async (message) => {
    const logs: string[] = [];
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.reject(new Error(message))
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Build it" });
      return { ok: true, returnValue: "done" };
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toThrow(
      message
    );

    expect(harnessMocks.spawnMock).toHaveBeenCalledOnce();
    expect(logs.join("\n")).not.toContain("Retrying in");
  });

  it("fails malformed provider results immediately without retry backoff", async () => {
    const logs: string[] = [];
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.resolve({ stdout: "missing exit code", stderr: "" })
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Build it" });
      return { ok: true, returnValue: "done" };
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toThrow(
      "spawnAgent result exitCode must be a finite number."
    );

    expect(harnessMocks.spawnMock).toHaveBeenCalledOnce();
    expect(logs.join("\n")).not.toContain("Retrying in");
  });

  it("renders cancelled spawns without treating them as final failures", async () => {
    const logs: string[] = [];
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.reject({ name: "AbortError", message: "cancelled by parent" })
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Review feature" });
      return { ok: true, returnValue: "done" };
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toMatchObject({
      name: "AbortError"
    });

    expect(logs.join("\n")).toContain("Spawn #1 codex — Review feature cancelled");
    expect(logs.join("\n")).not.toContain("failed after");
  });

  it("renders loop spawn progress and retries transient spawn failures up to five attempts", async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    harnessMocks.spawnMock
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        result: Promise.reject(new Error("sandbox unavailable"))
      }))
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        result: Promise.resolve({ exitCode: 0, stdout: "done", stderr: "" })
      }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Build it" });
      return { ok: true, returnValue: "done" };
    });

    const run = runHarnessCommand(["harness", "run", "harness.md"], logs);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;

    expect(harnessMocks.spawnMock).toHaveBeenCalledTimes(2);
    expect(logs.join("\n")).toContain(
      "Spawn #1 codex — Build it failed (attempt 1/5): sandbox unavailable"
    );
    expect(logs.join("\n")).toContain("Retrying in 1s");
    expect(logs.join("\n")).toContain("Spawn #1 codex — Build it attempt 2/5 started");
    expect(logs.join("\n")).toContain("Spawn #1 codex — Build it completed on attempt 2/5");
    vi.useRealTimers();
  });

  it("renders concise provider details for non-zero retry results", async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    harnessMocks.spawnMock
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        result: Promise.resolve({ exitCode: 1, stdout: "", stderr: "sandbox unavailable" })
      }))
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        result: Promise.resolve({ exitCode: 0, stdout: "done", stderr: "" })
      }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Build it" });
      return { ok: true, returnValue: "done" };
    });

    const run = runHarnessCommand(["harness", "run", "harness.md"], logs);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;

    expect(logs.join("\n")).toContain("failed (attempt 1/5): sandbox unavailable (exit 1)");
    expect(logs.join("\n")).not.toContain("failed (attempt 1/5): Agent spawn failed");
    vi.useRealTimers();
  });

  it("formats fractional-second retry delays cleanly", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as {
        retry: (
          agentDef: string,
          spawnOptions: { prompt: string },
          retryOptions: { maxAttempts: number; backoffMs: number }
        ) => Promise<unknown>;
      };
      await spawn.retry("codex", { prompt: "Build it" }, { maxAttempts: 2, backoffMs: 1_500 });
      return { ok: true, returnValue: "done" };
    });
    harnessMocks.spawnMock
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        result: Promise.reject(new Error("temporary"))
      }))
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        result: Promise.resolve({ exitCode: 0, stdout: "done", stderr: "" })
      }));

    vi.useFakeTimers();
    const run = runHarnessCommand(["harness", "run", "harness.md"], logs);
    await vi.advanceTimersByTimeAsync(1_500);
    await run;

    expect(logs.join("\n")).toContain("Retrying in 1.5s");
    vi.useRealTimers();
  });

  it.each(["Request failed: HTTP 500.", "network connection reset", "sandbox unavailable"])(
    "still retries the transient spawn error %s",
    async (message) => {
      vi.useFakeTimers();
      harnessMocks.spawnMock
        .mockImplementationOnce(() => ({
          events: (async function* () {})(),
          result: Promise.reject(new Error(message))
        }))
        .mockImplementationOnce(() => ({
          events: (async function* () {})(),
          result: Promise.resolve({ exitCode: 0, stdout: "done", stderr: "" })
        }));
      harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
        const modules = options.modulesFor(
          { kind: "test", version: 1 },
          { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
        );
        const spawn = modules.agent.get("spawn") as (
          agentDef: string,
          spawnOptions: { prompt: string }
        ) => Promise<unknown>;
        await spawn("codex", { prompt: "Build it" });
        return { ok: true, returnValue: "done" };
      });

      const run = runHarnessCommand(["harness", "run", "harness.md"]);
      await vi.advanceTimersByTimeAsync(1_000);
      await run;

      expect(harnessMocks.spawnMock).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    }
  );

  it("renders a prominent final spawn error after five failures", async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.reject(new Error("sandbox unavailable"))
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("codex", { prompt: "Build it" });
      return { ok: true, returnValue: "done" };
    });

    const run = runHarnessCommand(["harness", "run", "harness.md"], logs);
    const rejection = expect(run).rejects.toThrow("sandbox unavailable");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;

    expect(harnessMocks.spawnMock).toHaveBeenCalledTimes(5);
    expect(logs.join("\n")).toContain("Spawn #1 codex — Build it failed after 5 attempts");
    expect(logs.join("\n")).toContain("sandbox unavailable");
    vi.useRealTimers();
  });

  it("does not hide an unrelated harness error after a caught spawn failure", async () => {
    const logs: string[] = [];
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.reject(new Error('Unknown service "missing".'))
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as (
        agentDef: string,
        spawnOptions: { prompt: string }
      ) => Promise<unknown>;
      await spawn("missing", { prompt: "Try optional review" }).catch(() => undefined);
      throw new Error("later harness failure");
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toMatchObject({
      name: "Error",
      message: "later harness failure"
    });

    expect(logs.join("\n")).toContain('Unknown service "missing".');
  });

  it("suppresses the generic parallel wrapper after rendering the underlying final spawn error", async () => {
    const logs: string[] = [];
    harnessMocks.spawnMock.mockImplementation(() => ({
      events: (async function* () {})(),
      result: Promise.resolve({ exitCode: 2, stdout: "", stderr: "review failed" })
    }));
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as {
        parallel: (
          calls: Array<[string, { prompt: string }]>,
          options?: { failFast?: boolean; check?: boolean }
        ) => Promise<unknown>;
      };
      await spawn.parallel([["codex", { prompt: "Review feature" }]], { check: true });
      return { ok: true, returnValue: "done" };
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toMatchObject({
      name: "ReportedError"
    });

    expect(logs.join("\n")).toContain("Spawn #1 codex — Review feature failed after 1 attempt");
    expect(logs.join("\n")).not.toContain("spawn.parallel call 0 failed");
  });

  it("renders numbered lifecycle lines for successful parallel tuple spawns", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      const modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      const spawn = modules.agent.get("spawn") as {
        parallel: (
          calls: Array<[string, { label: string; prompt: string }]>,
          options?: { maxConcurrent?: number }
        ) => Promise<unknown>;
      };
      await spawn.parallel(
        [
          ["codex", { label: "Review auth", prompt: "Generated auth" }],
          ["codex", { label: "Review billing", prompt: "Generated billing" }]
        ],
        { maxConcurrent: 2 }
      );
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    const output = logs.join("\n");
    expect(output).toContain("Spawn #1 codex — Review auth started");
    expect(output).toContain("Spawn #2 codex — Review billing started");
    expect(output).toContain("Spawn #1 codex — Review auth completed (");
    expect(output).toContain("Spawn #2 codex — Review billing completed (");
    expect(output).not.toContain("Generated auth");
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
    expect(logs.join("\n")).toContain(
      "Dry run: would run harness.md without executing its script or applying fixes."
    );
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

  it("states the run outcome in plain language next to the result summary", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: true,
      returnValue: { kind: "coverage", version: 1, message: "ok" },
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, spawnCount: 0 }
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    const output = logs.join("\n");
    // "Result: object · kind, version" is a shape dump: the outcome must be stated outright.
    expect(output).toContain("Harness passed");
    expect(output).not.toContain("coverage");
  });

  it("prints a concise harness result without dumping snapshots or internal agent stderr", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: true,
      returnValue: { reviewed: 2 },
      snapshot: { bindings: { secret: "internal snapshot" } },
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cachedTokens: 20,
        spawnCount: 2
      }
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    const output = logs.join("\n");
    expect(output).toContain("Result: object · reviewed");
    expect(output).toContain("Usage: 2 spawns · 120 input · 30 output · 20 cached");
    expect(output).not.toContain("internal snapshot");
    expect(output).not.toContain('"snapshot"');
  });

  it("summarizes returned objects without exposing embedded agent output", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: true,
      returnValue: {
        first: "agent warning with sensitive details",
        second: "another long agent response"
      },
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, spawnCount: 2 }
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    const output = logs.join("\n");
    expect(output).toContain("Result: object · first, second");
    expect(output).toContain("Usage: 2 spawns");
    expect(output).not.toContain("0 input");
    expect(output).not.toContain("sensitive details");
    expect(output).not.toContain("another long agent response");
  });

  it("distinguishes logical spawns from retry attempts in usage output", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: true,
      returnValue: "done",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        spawnCount: 1,
        attemptCount: 2
      }
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    expect(logs.join("\n")).toContain("Usage: 1 spawn · 2 attempts");
  });

  it("sanitizes and truncates returned object keys", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: true,
      returnValue: {
        [`reviewed\n\u001b[31m-${"detail".repeat(60)}`]: true
      }
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    const output = logs.join("\n");
    expect(output).toContain("Result: object · reviewed [31m-");
    expect(output).not.toContain("\u001b");
    expect(output.length).toBeLessThan(400);
  });

  it("caps the total structural result summary width", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: true,
      returnValue: Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [`key-${index}-${"detail".repeat(60)}`, true])
      )
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    const resultLine = logs.find((line) => line.startsWith("Result:"));
    expect(resultLine).toBeDefined();
    expect(resultLine!.length).toBeLessThanOrEqual(248);
    expect(resultLine).toContain("…");
  });

  it("sanitizes control characters in scalar harness results", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: true,
      returnValue: "done\u001b[31m\nnext",
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, spawnCount: 0 }
    });

    await runHarnessCommand(["harness", "run", "harness.md"], logs);

    expect(logs.join("\n")).toContain("Result: done [31m next");
    expect(logs.join("\n")).not.toContain("\u001b");
  });

  it("exits as a reported failure when the interpreter returns an unsuccessful result", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: false,
      error: { name: "Error", message: "sandbox failed", stack: "sandbox stack" },
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, spawnCount: 0 }
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toMatchObject({
      name: "ReportedError",
      message: "sandbox failed"
    });

    expect(logs.join("\n")).toContain("Harness failed: sandbox failed");
    expect(logs.join("\n")).not.toContain("sandbox stack");
  });

  it("sanitizes and truncates unsuccessful interpreter errors", async () => {
    const logs: string[] = [];
    harnessMocks.runHarnessPairMock.mockResolvedValue({
      ok: false,
      error: {
        name: "Error",
        message: `sandbox failed\n\u001b[31m${"detail ".repeat(100)}`,
        stack: "sandbox stack"
      },
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, spawnCount: 0 }
    });

    await expect(runHarnessCommand(["harness", "run", "harness.md"], logs)).rejects.toMatchObject({
      name: "ReportedError"
    });

    const output = logs.join("\n");
    expect(output).toContain("Harness failed: sandbox failed [31m");
    expect(output).not.toContain("\u001b");
    expect(output.length).toBeLessThan(600);
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

  it("passes explicit resource limits to the harness SDK", async () => {
    await runHarnessCommand([
      "harness",
      "run",
      "harness.md",
      "--max-steps",
      "75",
      "--data-size",
      "1000"
    ]);
    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/repo/harness.md",
      expect.objectContaining({
        budget: expect.objectContaining({
          limits: expect.objectContaining({ maxSteps: 75, dataSize: 1000 })
        })
      })
    );
  });

  it.each(["-1", "1.5", "Infinity", "NaN", "", "9007199254740992"])(
    "rejects invalid resource limit %s before execution",
    async (limit) => {
      await expect(
        runHarnessCommand(["harness", "run", "harness.md", "--max-steps", limit])
      ).rejects.toThrow();
      expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    }
  );

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
    expect(harnessMocks.selectMock).not.toHaveBeenCalled();
  });

  it.each([false, true])("silently cancels harness selection (dry run: %s)", async (dryRun) => {
    writePair("/repo/.poe-code/harnesses", "alpha");
    writePair("/repo/.poe-code/harnesses", "beta");
    const cancelled = Symbol.for("poe.cancel");
    expect(isCancel(cancelled)).toBe(true);
    harnessMocks.selectMock.mockResolvedValue(cancelled);
    const filesBefore = vol.toJSON();
    const logs: string[] = [];

    await expect(
      runHarnessCommand([...(dryRun ? ["--dry-run"] : []), "harness", "run"], logs)
    ).rejects.toBeInstanceOf(OperationCancelledError);

    expect(harnessMocks.selectMock).toHaveBeenCalledExactlyOnceWith({
      message: "Select harness",
      options: expect.arrayContaining([
        expect.objectContaining({ value: "/repo/.poe-code/harnesses/alpha/alpha.md" }),
        expect.objectContaining({ value: "/repo/.poe-code/harnesses/beta/beta.md" })
      ])
    });
    expect(harnessMocks.cancelMock).toHaveBeenCalledExactlyOnceWith("Operation cancelled.");
    expect(harnessMocks.promptTextMock).not.toHaveBeenCalled();
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    expect(harnessMocks.runWithOptionalWorktreeMock).not.toHaveBeenCalled();
    expect(harnessMocks.spawnMock).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
    expect(vol.toJSON()).toEqual(filesBefore);
  });

  it.each([false, true])("rejects an unmatched harness selection (dry run: %s)", async (dryRun) => {
    writePair("/repo/.poe-code/harnesses", "alpha");
    writePair("/repo/.poe-code/harnesses", "beta");
    harnessMocks.selectMock.mockResolvedValue("/repo/missing.md");
    const filesBefore = vol.toJSON();

    await expect(
      runHarnessCommand([...(dryRun ? ["--dry-run"] : []), "harness", "run"])
    ).rejects.toEqual(new ValidationError("Selected harness was not found."));

    expect(harnessMocks.cancelMock).not.toHaveBeenCalled();
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    expect(vol.toJSON()).toEqual(filesBefore);
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

  it("removes Git from harness injection while retaining other default modules", async () => {
    let modules: SafeJSModuleRecord | undefined;
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      return { ok: true, returnValue: "done" };
    });
    await runHarnessCommand(["harness", "run", "harness.md"]);
    expect(modules).toBeDefined();
    expect(Object.keys(modules!).sort()).toEqual(["agent", "fail", "harness", "log", "metric"]);
    await expect(
      runSafeJS('import * as git from "git"; return git;', { modules: modules! })
    ).rejects.toThrow("Unknown module 'git'.");
  });

  it("registers no fs module by default, so an fs import fails as an unknown module", async () => {
    let modules: SafeJSModuleRecord | undefined;
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      modules = options.modulesFor(
        { kind: "test", version: 1 },
        { kind: "test", version: 1, filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "harness.md"]);

    expect(modules).toBeDefined();
    expect(Object.keys(modules!)).not.toContain("fs");
    // The registry is what the sandbox resolves an import against, so its absence is
    // what makes the import unknown rather than a message this command writes.
    await expect(
      runSafeJS('import { readFile } from "fs";\nexport default () => readFile;\n', {
        modules: modules!
      })
    ).rejects.toThrow(
      "Unknown module 'fs'. Available modules: agent, fail, harness, log, metric."
    );
  });

  it("registers named MCP capabilities only with an explicit config", async () => {
    vol.writeFileSync(
      "/repo/mcp.json",
      JSON.stringify({ servers: { docs: { command: "never-start-this" } } })
    );
    let modules: SafeJSModuleRecord | undefined;
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      modules = options.modulesFor(
        {},
        { filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      return { ok: true, returnValue: "done" };
    });
    await runHarnessCommand(["harness", "run", "harness.md", "--mcp-config", "mcp.json"]);
    await expect(
      runSafeJS(
        'import {servers,server} from "mcp"; return [Object.keys(servers),server("docs")];',
        { modules: modules! }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [["docs"], { name: "docs" }]
    });
  });

  it("registers explicit environment capabilities without ambient fallback", async () => {
    vol.writeFileSync(
      "/repo/env.json",
      JSON.stringify({
        allow: ["TOKEN", "EMPTY", "MISSING"],
        values: { TOKEN: "configured", EMPTY: "" }
      })
    );
    let modules: SafeJSModuleRecord | undefined;
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      modules = options.modulesFor(
        {},
        { filename: "/repo/harness.md", dirname: "/repo", body: "" }
      );
      return { ok: true, returnValue: "done" };
    });
    await runHarnessCommand(["harness", "run", "harness.md", "--env-config", "env.json"]);
    await expect(
      runSafeJS(
        'import {get} from "env"; let denied; try{get("DENIED");}catch(error){denied=error.code;} return [get("TOKEN"),get("EMPTY"),get("MISSING"),denied];',
        { modules: modules! }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["configured", "", undefined, "ENV_ACCESS_DENIED"]
    });
  });

  it.each([false, true])(
    "rejects malformed environment grants before execution (dry run: %s)",
    async (dryRun) => {
      vol.writeFileSync("/repo/env.json", '{"allow":"*"}');
      await expect(
        runHarnessCommand([
          ...(dryRun ? ["--dry-run"] : []),
          "harness",
          "run",
          "harness.md",
          "--env-config",
          "env.json"
        ])
      ).rejects.toThrow("allow list");
      expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    }
  );

  it.each(["resolve", "reject"])(
    "awaits harness cleanup before handling SIGINT (%s)",
    async (outcome) => {
      const listenersBefore = process.listeners("SIGINT");
      const exitCodeBefore = process.exitCode;
      const started = createDeferred<AbortSignal | undefined>();
      const cleanup = createDeferred();
      const logs: string[] = [];
      harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
        started.resolve(options.signal);
        await cleanup.promise;
        if (outcome === "reject") {
          throw options.signal?.reason ?? new Error("Missing cancellation signal");
        }
        return { ok: true, returnValue: "done" };
      });
      let settled = false;
      const running = runHarnessCommand(["harness", "run", "harness.md"], logs);
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      try {
        const signal = await started.promise;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal!.aborted).toBe(false);
        const handlers = process
          .listeners("SIGINT")
          .filter((listener) => !listenersBefore.includes(listener));
        expect(handlers).toHaveLength(1);
        handlers[0]!("SIGINT");
        handlers[0]!("SIGINT");
        expect(signal!.aborted).toBe(true);
        await Promise.resolve();
        expect(settled).toBe(false);
        cleanup.resolve();
        await running;
        expect(process.exitCode).toBe(130);
        expect(logs.filter((line) => line.includes("Harness interrupted."))).toHaveLength(1);
        expect(logs.some((line) => line.includes("Harness passed"))).toBe(false);
        expect(process.listeners("SIGINT")).toEqual(listenersBefore);
      } finally {
        cleanup.resolve();
        await running.catch(() => undefined);
        process.exitCode = exitCodeBefore;
      }
    }
  );

  it.each(["resolve", "reject"])("removes the SIGINT listener after %s", async (outcome) => {
    const listenersBefore = process.listeners("SIGINT");
    const failure = new Error("Harness execution failed");
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(process.listenerCount("SIGINT")).toBe(listenersBefore.length + 1);
      if (outcome === "reject") throw failure;
      return { ok: true, returnValue: "done" };
    });
    const running = runHarnessCommand(["harness", "run", "harness.md"]);
    if (outcome === "reject") await expect(running).rejects.toBe(failure);
    else await running;
    expect(process.listeners("SIGINT")).toEqual(listenersBefore);
  });

  it("does not start a harness after cancellation during worktree setup", async () => {
    const listenersBefore = process.listeners("SIGINT");
    const exitCodeBefore = process.exitCode;
    harnessMocks.runWithOptionalWorktreeMock.mockImplementation(async (input) => {
      const handler = process
        .listeners("SIGINT")
        .find((listener) => !listenersBefore.includes(listener));
      expect(handler).toBeDefined();
      handler!("SIGINT");
      return { value: await input.run({ worktreeCwd: cwd }) };
    });
    try {
      await runHarnessCommand(["harness", "run", "harness.md"]);
      expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(130);
      expect(process.listeners("SIGINT")).toEqual(listenersBefore);
    } finally {
      process.exitCode = exitCodeBefore;
    }
  });

  it("registers fs rooted at the harness directory when --fs is given", async () => {
    vol.fromJSON({
      "/repo/nested/harness.md": "---\nkind: test\nversion: 1\n---\n",
      "/repo/nested/harness.ajs": "export default () => true;\n",
      "/repo/nested/inside.txt": "inside\n",
      "/repo/outside.txt": "outside\n"
    });
    let fsModule: Map<string, unknown> | undefined;
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      fsModule = options.modulesFor(
        { kind: "test", version: 1 },
        {
          kind: "test",
          version: 1,
          filename: "/repo/nested/harness.md",
          dirname: "/repo/nested",
          body: ""
        }
      ).fs;
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "nested/harness.md", "--fs"]);

    const readFile = fsModule?.get("readFile") as (
      filePath: string,
      encoding: string
    ) => Promise<string>;
    await expect(readFile("inside.txt", "utf8")).resolves.toBe("inside\n");
    await expect(readFile("../outside.txt", "utf8")).rejects.toMatchObject({ code: "EACCES" });
  });

  it("roots fs at --fs-root resolved against the cwd rather than the harness directory", async () => {
    vol.fromJSON({
      "/repo/nested/harness.md": "---\nkind: test\nversion: 1\n---\n",
      "/repo/nested/harness.ajs": "export default () => true;\n",
      "/repo/roots/allowed.txt": "allowed\n",
      "/repo/nested/inside.txt": "inside\n"
    });
    let fsModule: Map<string, unknown> | undefined;
    harnessMocks.runHarnessPairMock.mockImplementation(async (_mdPath, options) => {
      fsModule = options.modulesFor(
        { kind: "test", version: 1 },
        {
          kind: "test",
          version: 1,
          filename: "/repo/nested/harness.md",
          dirname: "/repo/nested",
          body: ""
        }
      ).fs;
      return { ok: true, returnValue: "done" };
    });

    await runHarnessCommand(["harness", "run", "nested/harness.md", "--fs", "--fs-root", "roots"]);

    const readFile = fsModule?.get("readFile") as (
      filePath: string,
      encoding: string
    ) => Promise<string>;
    await expect(readFile("allowed.txt", "utf8")).resolves.toBe("allowed\n");
    await expect(readFile("/repo/nested/inside.txt", "utf8")).rejects.toMatchObject({
      code: "EACCES"
    });
  });

  it("refuses --fs-root without --fs rather than silently ignoring the root", async () => {
    await expect(
      runHarnessCommand(["harness", "run", "harness.md", "--fs-root", "roots"])
    ).rejects.toThrow(/--fs-root requires --fs/i);
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
  });

  it("reports the fs root a dry run would enable without running the harness", async () => {
    const logs: string[] = [];

    await runHarnessCommand(["--dry-run", "harness", "run", "harness.md", "--fs"], logs);

    expect(logs.join("\n")).toContain("would enable the fs module rooted at /repo");
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
  });

  it("reports a dry run's fs root the way it reports every other path", async () => {
    vol.fromJSON({
      "/repo/nested/harness.md": "---\nkind: test\nversion: 1\n---\n",
      "/repo/nested/harness.ajs": "export default () => true;\n"
    });
    const logs: string[] = [];

    await runHarnessCommand(["--dry-run", "harness", "run", "nested/harness.md", "--fs"], logs);

    expect(logs.join("\n")).toContain("would enable the fs module rooted at nested");
  });

  // An unset shell variable expands to an empty argument, and path.resolve reads that as
  // the cwd, so accepting it would silently widen the root from the harness directory to
  // the whole project — the opposite of what --fs-root is for.
  it("refuses an empty --fs-root rather than widening the root to the whole cwd", async () => {
    await expect(
      runHarnessCommand(["harness", "run", "harness.md", "--fs", "--fs-root", ""])
    ).rejects.toThrow(/--fs-root needs a directory path/i);
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
  });

  it("refuses a blank --fs-root, which resolves to a directory nobody asked for", async () => {
    await expect(
      runHarnessCommand(["harness", "run", "harness.md", "--fs", "--fs-root", "   "])
    ).rejects.toThrow(/--fs-root needs a directory path/i);
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
  });

  it("fails new when the template kind is missing", async () => {
    await expect(
      runHarnessCommand(["--yes", "harness", "new", "missing", "example"])
    ).rejects.toThrow(/value 'missing' is invalid for argument 'kind'/);
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
      async writeFile(
        filePath: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { encoding?: BufferEncoding; flag?: string }
      ) {
        if (filePath.endsWith("example.ajs")) {
          await memfs.promises.writeFile(filePath, "partial script", options);
          throw new Error("script write failed");
        }
        await memfs.promises.writeFile(filePath, data, options);
      }
    } as FileSystem;
    const program = createBaseProgram();
    registerHarnessCommand(
      program,
      createCliContainer({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: () => undefined,
        commandRunner: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
      })
    );

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

  it("does not follow or remove a scaffold file symlink inserted after the existence check", async () => {
    const mdPath = "/repo/.poe-code/harnesses/example/example.md";
    const ajsPath = "/repo/.poe-code/harnesses/example/example.ajs";
    const outsidePath = "/outside/example.md";
    vol.fromJSON({
      [outsidePath]: "outside-state\n"
    });
    const fs = {
      ...(memfs.promises as unknown as FileSystem),
      async writeFile(
        filePath: string,
        data: string | NodeJS.ArrayBufferView,
        options?: { encoding?: BufferEncoding; flag?: string }
      ) {
        if (filePath === mdPath) {
          await memfs.promises.symlink(outsidePath, mdPath);
        }
        await memfs.promises.writeFile(filePath, data, options);
      }
    } as FileSystem;
    const program = createBaseProgram();
    registerHarnessCommand(
      program,
      createCliContainer({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        logger: () => undefined,
        commandRunner: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
      })
    );

    await expect(
      program.parseAsync(["node", "cli", "--yes", "harness", "new", "demo", "example"])
    ).rejects.toMatchObject({ code: "EEXIST" });

    await expect(memfs.promises.readFile(outsidePath, "utf8")).resolves.toBe("outside-state\n");
    await expect(memfs.promises.lstat(mdPath)).resolves.toSatisfy((stats) =>
      stats.isSymbolicLink()
    );
    await expect(memfs.promises.lstat(ajsPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a basename that escapes the harness directory", async () => {
    await expect(
      runHarnessCommand(["--yes", "harness", "new", "demo", "../victim"])
    ).rejects.toThrow(/invalid harness basename/i);

    await expect(
      memfs.promises.readFile("/repo/.poe-code/victim.md", "utf8")
    ).rejects.toMatchObject({
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

  it.each([false, true])("silently cancels the harness directory prompt (dry run: %s)", async (dryRun) => {
    harnessMocks.listBuiltinTemplatesMock.mockReturnValue([
      { kind: "ralph-demo", mdPath: "/templates/demo.md", ajsPath: "/templates/demo.ajs" }
    ]);
    const cancelled = Symbol.for("poe.cancel");
    expect(isCancel(cancelled)).toBe(true);
    harnessMocks.promptTextMock.mockResolvedValue(cancelled);
    const filesBefore = vol.toJSON();
    const logs: string[] = [];

    await expect(
      runHarnessCommand(
        [...(dryRun ? ["--dry-run"] : []), "harness", "new", "ralph-demo", "audit"],
        logs
      )
    ).rejects.toBeInstanceOf(OperationCancelledError);

    expect(harnessMocks.promptTextMock).toHaveBeenCalledExactlyOnceWith({
      message: "Harness directory",
      initialValue: ".poe-code/harnesses/audit"
    });
    expect(harnessMocks.cancelMock).toHaveBeenCalledExactlyOnceWith("Operation cancelled.");
    expect(harnessMocks.selectMock).not.toHaveBeenCalled();
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    expect(harnessMocks.runWithOptionalWorktreeMock).not.toHaveBeenCalled();
    expect(harnessMocks.spawnMock).not.toHaveBeenCalled();
    expect(logs).toEqual(["harness new"]);
    expect(vol.toJSON()).toEqual(filesBefore);
  });

  it.each([false, true])("rejects a blank harness directory (dry run: %s)", async (dryRun) => {
    harnessMocks.promptTextMock.mockResolvedValue(" \t ");
    const filesBefore = vol.toJSON();

    await expect(
      runHarnessCommand([...(dryRun ? ["--dry-run"] : []), "harness", "new", "demo", "example"])
    ).rejects.toEqual(new ValidationError("Harness directory is required."));

    expect(harnessMocks.cancelMock).not.toHaveBeenCalled();
    expect(harnessMocks.runHarnessPairMock).not.toHaveBeenCalled();
    expect(vol.toJSON()).toEqual(filesBefore);
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

  it("lists empty discovery results with the searched roots", async () => {
    const logs: string[] = [];

    await runHarnessCommand(["harness", "list"], logs);

    const output = logs.join("\n");
    expect(output).toContain("No harness pairs found");
    expect(output).toContain(".poe-code/harnesses");
    expect(output).toContain("~/.poe-code/harnesses");
  });

  it("documents the built-in template kinds in new help", () => {
    const program = createBaseProgram();
    registerHarnessCommand(program, createContainer());
    const newCommand = program.commands
      .find((command) => command.name() === "harness")
      ?.commands.find((command) => command.name() === "new");

    expect(newCommand?.helpInformation()).toContain("demo");
  });

  it("names the available kinds when the template kind is unknown", async () => {
    await expect(
      runHarnessCommand(["--yes", "harness", "new", "safejs", "example"])
    ).rejects.toThrow(
      /value 'safejs' is invalid for argument 'kind'\..*Allowed choices are .*demo/s
    );
  });

  it("prints the run command for the pair that new created", async () => {
    const logs: string[] = [];

    await runHarnessCommand(["harness", "new", "demo", "demo4", "--dir", "/tmp/h4"], logs);

    expect(logs.join("\n")).toContain("harness run /tmp/h4/demo4.md");
  });

  it("lists a harness pair created in an explicit --dir", async () => {
    const logs: string[] = [];
    await runHarnessCommand(["harness", "new", "demo", "demo4", "--dir", "/tmp/h4"]);

    await runHarnessCommand(["harness", "list", "--dir", "/tmp/h4"], logs);

    expect(logs.join("\n")).toContain("demo4");
  });

  it("runs a harness discovered from an explicit --dir", async () => {
    await runHarnessCommand(["harness", "new", "demo", "demo4", "--dir", "/tmp/h4"]);

    await runHarnessCommand(["--yes", "harness", "run", "--dir", "/tmp/h4"]);

    expect(harnessMocks.runHarnessPairMock).toHaveBeenCalledWith(
      "/tmp/h4/demo4.md",
      expect.objectContaining({ modulesFor: expect.any(Function) })
    );
  });

  it("explains how to supply a harness when run finds no pairs", async () => {
    await expect(runHarnessCommand(["--yes", "harness", "run"])).rejects.toThrow(
      /No harness pairs found.*\.poe-code\/harnesses.*harness new/s
    );
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
