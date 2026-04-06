import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import { Readable } from "node:stream";
import { Command } from "commander";
import { resetOutputFormatCache } from "@poe-code/design-system";
import { DEFAULT_CLAUDE_CODE_MODEL, DEFAULT_CODEX_MODEL } from "../constants.js";
import { createProgram } from "../program.js";
import { registerSpawnCommand } from "./spawn.js";
import { createCliContainer, type CliDependencies } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import { OperationCancelledError } from "../errors.js";
import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "../../utils/command-checks.js";

const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const resolveWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock("../../sdk/spawn.js", () => ({
  spawn: vi.fn()
}));

vi.mock("@poe-code/workspace-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/workspace-resolver")>();
  return {
    ...actual,
    resolveWorkspace: resolveWorkspaceMock
  };
});

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    getSpawnConfig: vi.fn(actual.getSpawnConfig),
    supportsMcpAtSpawn: vi.fn(actual.supportsMcpAtSpawn),
    spawnInteractive: vi.fn()
  };
});

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    confirm: confirmMock,
    isCancel: isCancelMock
  };
});

import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import { getSpawnConfig, spawnInteractive, supportsMcpAtSpawn } from "@poe-code/agent-spawn";
import { resolveWorkspace } from "@poe-code/workspace-resolver";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

interface CommandCall {
  command: string;
  args: string[];
  options?: CommandRunnerOptions;
}

function createCommandRunnerStub(
  result: CommandRunnerResult = { stdout: "", stderr: "", exitCode: 0 }
): { runner: CommandRunner; calls: CommandCall[] } {
  const calls: CommandCall[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    const call: CommandCall = { command, args };
    if (options) {
      call.options = options;
    }
    calls.push(call);
    return { ...result };
  };
  return { runner, calls };
}

function createContainerWithDependencies(
  overrides: Partial<CliDependencies> = {}
): {
  container: ReturnType<typeof createCliContainer>;
  logs: string[];
  commandCalls: CommandCall[];
} {
  const logs: string[] = [];
  const { runner, calls } = createCommandRunnerStub();
  const container = createCliContainer({
    fs: overrides.fs ?? createMemFs(),
    prompts: overrides.prompts ?? vi.fn().mockResolvedValue({}),
    env: overrides.env ?? { cwd, homeDir },
    commandRunner: overrides.commandRunner ?? runner,
    logger: overrides.logger ?? ((message) => {
      logs.push(message);
    })
  });
  return { container, logs, commandCalls: calls };
}

function stripAnsi(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "\u001b") {
      output += char;
      continue;
    }
    const next = input[index + 1];
    if (next !== "[") continue;

    index += 2;
    while (index < input.length && input[index] !== "m") {
      index += 1;
    }
  }
  return output;
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return (async function* () {})();
}

function fromArray<T>(items: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

describe("spawn command", () => {
  let fs: FileSystem;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fs = createMemFs();
    vi.clearAllMocks();
    process.env = { ...originalEnv, FORCE_COLOR: "1" };
    resetOutputFormatCache();

    confirmMock.mockResolvedValue(true);
    isCancelMock.mockReturnValue(false);

    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));
    vi.mocked(resolveWorkspace).mockReset();
    vi.mocked(resolveWorkspace).mockImplementation(async (input, options) => ({
      cwd: path.isAbsolute(input) ? input : path.join(options.baseDir, input),
      locator: { scheme: "local", path: input }
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetOutputFormatCache();
  });

  it("streams events via renderAcpStream()", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: fromArray([
        { event: "tool_start", kind: "exec", title: "npm test" },
        { event: "tool_complete", kind: "exec", path: "result.txt" },
        { event: "agent_message", text: "Hi" }
      ]),
      result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const logs: string[] = [];
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    vi.useFakeTimers();

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);

    try {
      const parsePromise = program.parseAsync([
        "node",
        "cli",
        "spawn",
        "claude",
        "hello"
      ]);
      await vi.runAllTimersAsync();
      await parsePromise;
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }

    expect(sdkSpawn).toHaveBeenCalledWith("claude-code", {
      prompt: "hello",
      args: [],
      model: DEFAULT_CLAUDE_CODE_MODEL,
      cwd: undefined
    });

    const plainChunks = chunks.map((chunk) => stripAnsi(chunk));
    expect(plainChunks).toEqual([
      "  → exec: npm test\n",
      "  ✓ exec\n",
      "✓ agent: Hi\n"
    ]);
    expect(logs.length).toBeGreaterThan(0);
  });

  it("prints final stdout when events are empty", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "Final output\n", stderr: "", exitCode: 0 })
    }));

    const logs: string[] = [];
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);

    try {
      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "codex",
        "hello"
      ]);
    } finally {
      spy.mockRestore();
    }

    expect(stripAnsi(chunks.join(""))).toBe("");
    expect(logs.some((line) => line.includes("Final output"))).toBe(true);
  });

  it("emits ACP NDJSON plus a final spawn_result event in json mode", async () => {
    process.env.OUTPUT_FORMAT = "json";
    resetOutputFormatCache();

    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: fromArray([{ event: "agent_message", text: "Hi" }]),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_json",
        usage: {
          inputTokens: 12,
          outputTokens: 3,
          cachedTokens: 4,
          costUsd: 0.05
        }
      })
    }));

    const logs: string[] = [];
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);

    try {
      await program.parseAsync(["node", "cli", "--yes", "spawn", "codex", "hello"]);
    } finally {
      spy.mockRestore();
    }

    const lines = chunks
      .join("")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));

    expect(lines).toEqual([
      { type: "agent", message: "Hi" },
      {
        event: "spawn_result",
        exitCode: 0,
        threadId: "thread_json",
        usage: {
          inputTokens: 12,
          outputTokens: 3,
          cachedTokens: 4,
          costUsd: 0.05
        },
        protocolVersion: 1
      }
    ]);
    expect(logs).toEqual([]);
  });

  it("does not throw on agent exit failure in json mode and ends with spawn_result", async () => {
    process.env.OUTPUT_FORMAT = "json";
    resetOutputFormatCache();

    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "spawn failed",
        exitCode: 23
      })
    }));

    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    const logs: string[] = [];
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);

    try {
      await expect(
        program.parseAsync(["node", "cli", "--yes", "spawn", "codex", "hello"])
      ).resolves.toBe(program);

      expect(chunks.join("").trim().split("\n").map((line) => JSON.parse(line))).toEqual([
        {
          event: "spawn_result",
          exitCode: 23,
          protocolVersion: 1
        }
      ]);
      expect(logs).toEqual([]);
      expect(process.exitCode).toBe(23);
    } finally {
      spy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it("fails when spawn command exits with error", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "", stderr: "spawn failed", exitCode: 1 })
    }));

    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "spawn",
        "claude-code",
        "Explain the change"
      ])
    ).rejects.toThrow(/spawn failed/i);
  });

  it("skips execution during dry run spawn", async () => {
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "spawn",
      "claude-code",
      "Dry run prompt"
    ]);

    expect(calls).toHaveLength(0);
    expect(sdkSpawn).not.toHaveBeenCalled();
    const dryRunLog = logs.find((line) =>
      line.includes("Dry run: would spawn Claude Code.")
    );
    expect(dryRunLog).toBeTruthy();
    expect(dryRunLog).toContain("Prompt:");
  });

  it("does not resolve workspace locators during dry run spawn", async () => {
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "spawn",
      "--cwd",
      "github://poe-platform/poe-code",
      "claude-code",
      "Dry run prompt"
    ]);

    expect(calls).toHaveLength(0);
    expect(sdkSpawn).not.toHaveBeenCalled();
    expect(resolveWorkspace).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes("github://poe-platform/poe-code"))).toBe(true);
  });

  it("invokes custom spawn handlers when provided", async () => {
    const { container, logs, commandCalls } = createContainerWithDependencies();
    const program = new Command();
    program.exitOverride();
    registerSpawnCommand(program, container, {
      handlers: {
        "poe-code": async (ctx) => {
          logs.push(`custom:${ctx.options.prompt}`);
          expect(ctx.service).toBe("poe-code");
          expect(ctx.options.args).toEqual(["--model", "beta"]);
        }
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "poe-code",
      "Explain the change",
      "--",
      "--model",
      "beta"
    ]);

    expect(logs).toContain("custom:Explain the change");
    expect(commandCalls).toHaveLength(0);
    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("includes extra services in spawn help output", () => {
    const { container } = createContainerWithDependencies();
    const program = new Command();
    registerSpawnCommand(program, container, {
      extraServices: ["poe-code", "beta-agent"]
    });

    const spawnCommand = program.commands.find((cmd) => cmd.name() === "spawn");
    expect(spawnCommand).toBeDefined();
    const help = spawnCommand?.helpInformation() ?? "";
    expect(help).toContain("poe-code");
    expect(help).toContain("beta-agent");
  });

  it("passes through model override via CLI flag", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--model",
      "some-model",
      "opencode",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("opencode", {
      prompt: "List files",
      args: [],
      model: "some-model",
      cwd: undefined
    });
  });

  it("uses the configured model for SDK spawn when --model is omitted", async () => {
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({ models: { codex: "openai/gpt-5.4" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: "openai/gpt-5.4",
      cwd: undefined
    });
  });

  it("passes --mcp-servers to SDK spawn for MCP-capable agents", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const mcpServersJson = JSON.stringify({
      test: {
        command: "tiny-stdio-mcp-test-server",
        args: ["serve", "word-of-the-day"],
        env: { MCP_LOG_LEVEL: "debug" }
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--mcp-servers",
      mcpServersJson,
      "codex",
      "Use word_of_the_day"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Use word_of_the_day",
      args: [],
      model: DEFAULT_CODEX_MODEL,
      cwd: undefined,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
  });

  it("passes --log-dir and --activity-timeout-ms to SDK spawn", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--log-dir",
      "/tmp/spawn-logs",
      "--activity-timeout-ms",
      "1500",
      "codex",
      "hello"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "hello",
      args: [],
      model: DEFAULT_CODEX_MODEL,
      cwd: undefined,
      logDir: "/tmp/spawn-logs",
      activityTimeoutMs: 1500
    });
  });

  it("rejects invalid --mcp-servers JSON", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--mcp-servers",
        "{nope",
        "codex",
        "hello"
      ])
    ).rejects.toThrow("--mcp-servers");

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects --mcp-servers for agents without spawn-time MCP support", async () => {
    vi.mocked(supportsMcpAtSpawn).mockReturnValueOnce(false);
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--mcp-servers",
        JSON.stringify({
          test: {
            command: "tiny-stdio-mcp-test-server",
            args: ["serve", "word-of-the-day"]
          }
        }),
        "kimi",
        "hello"
      ])
    ).rejects.toThrow(
      "does not support MCP servers at spawn time."
    );

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("runs spawn commands from a custom cwd via -C flag", async () => {
    const customCwd = "/projects/demo";
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "-C",
      customCwd,
      "claude-code",
      "Explain the change"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("claude-code", {
      prompt: "Explain the change",
      args: [],
      model: DEFAULT_CLAUDE_CODE_MODEL,
      cwd: customCwd
    });
  });

  it("resolves relative cwd paths against the CLI environment", async () => {
    const relative = "feature";
    const resolved = path.join(cwd, relative);
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--cwd",
      relative,
      "codex",
      "Summarize the diff"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Summarize the diff",
      args: [],
      model: DEFAULT_CODEX_MODEL,
      cwd: resolved
    });
  });

  it("resolves workspace locators before interactive spawns", async () => {
    const cleanup = vi.fn(async () => {});
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      cleanup,
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    vi.mocked(spawnInteractive).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--interactive",
      "--cwd",
      "github://poe-platform/poe-code",
      "codex",
      "Inspect the repo"
    ]);

    expect(resolveWorkspace).toHaveBeenCalledWith(
      "github://poe-platform/poe-code",
      expect.objectContaining({
        baseDir: cwd,
        homeDir
      })
    );
    expect(spawnInteractive).toHaveBeenCalledWith("codex", {
      prompt: "Inspect the repo",
      args: [],
      model: DEFAULT_CODEX_MODEL,
      cwd: "/tmp/workspaces/poe-code",
      mode: undefined
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("consumes prompt text from stdin when no prompt argument is provided", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    const stdinStream = Readable.from([Buffer.from("Prompt via stdin")]);
    Object.defineProperty(stdinStream, "isTTY", { value: false });
    const stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(stdinStream as NodeJS.ReadStream);

    try {
      await program.parseAsync(["node", "cli", "spawn", "codex"]);
    } finally {
      stdinSpy.mockRestore();
    }

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Prompt via stdin",
      args: [],
      model: DEFAULT_CODEX_MODEL,
      cwd: undefined
    });
  });

  it("treats the next argument as agent args when --stdin is set", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    const stdinStream = Readable.from([Buffer.from("Prompt via stdin")]);
    Object.defineProperty(stdinStream, "isTTY", { value: false });
    const stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(stdinStream as NodeJS.ReadStream);

    try {
      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--stdin",
        "codex",
        "--",
        "--foo",
        "bar"
      ]);
    } finally {
      stdinSpy.mockRestore();
    }

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Prompt via stdin",
      args: ["--foo", "bar"],
      model: DEFAULT_CODEX_MODEL,
      cwd: undefined
    });
  });

  it("prints a resume command when threadId is present", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_abc123"
      })
    }));

    const processCwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/projects/demo");

    try {
      const logs: string[] = [];
      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: (message) => logs.push(message)
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "codex",
        "hello"
      ]);

      const plainLog = stripAnsi(logs.join("\n"));
      expect(plainLog).toContain(
        "Resume: codex resume -C /projects/demo thread_abc123"
      );
    } finally {
      processCwdSpy.mockRestore();
    }
  });

  it("quotes resume cwd when it contains spaces", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_abc123"
      })
    }));

    const logs: string[] = [];
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "-C",
      "/projects/demo repo",
      "codex",
      "hello"
    ]);

    const plainLog = stripAnsi(logs.join("\n"));
    expect(plainLog).toContain(
      "Resume: codex resume -C '/projects/demo repo' thread_abc123"
    );
  });

  it("does not print a resume command when threadId is missing", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const logs: string[] = [];
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "codex",
      "hello"
    ]);

    const plainLog = stripAnsi(logs.join("\n"));
    expect(plainLog).not.toContain("Resume:");
  });

  it("prints claude-code resume command with --resume flag", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_abc123"
      })
    }));

    const processCwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/projects/demo");

    try {
      const logs: string[] = [];
      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: (message) => logs.push(message)
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "claude-code",
        "hello"
      ]);

      const plainLog = stripAnsi(logs.join("\n"));
      expect(plainLog).toContain(
        "Resume: cd /projects/demo && claude --resume thread_abc123"
      );
    } finally {
      processCwdSpy.mockRestore();
    }
  });

  it("prints opencode resume command with positional cwd", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_abc123"
      })
    }));

    const processCwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/projects/demo");

    try {
      const logs: string[] = [];
      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: (message) => logs.push(message)
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "opencode",
        "hello"
      ]);

      const plainLog = stripAnsi(logs.join("\n"));
      expect(plainLog).toContain(
        "Resume: opencode /projects/demo --session thread_abc123"
      );
    } finally {
      processCwdSpy.mockRestore();
    }
  });

  it("prints kimi resume command with --session and --work-dir", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_abc123"
      })
    }));

    const processCwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/projects/demo");

    try {
      const logs: string[] = [];
      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: (message) => logs.push(message)
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "kimi",
        "hello"
      ]);

      const plainLog = stripAnsi(logs.join("\n"));
      expect(plainLog).toContain(
        "Resume: kimi --session thread_abc123 --work-dir /projects/demo"
      );
    } finally {
      processCwdSpy.mockRestore();
    }
  });

  it("does not print resume when config has no resumeCommand", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_abc123"
      })
    }));

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex",
      promptFlag: "exec",
      modelStripProviderPrefix: true,
      defaultArgs: [],
      modes: { yolo: [], edit: [], read: [] }
    });

    const logs: string[] = [];
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "codex",
      "hello"
    ]);

    const plainLog = stripAnsi(logs.join("\n"));
    expect(plainLog).not.toContain("Resume:");
  });

  describe("--interactive flag", () => {
    it("calls spawnInteractive when --interactive is set", async () => {
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--interactive",
        "claude-code",
        "hello"
      ]);

      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "hello",
        args: [],
        model: DEFAULT_CLAUDE_CODE_MODEL,
        cwd: undefined
      });
      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("calls spawnInteractive when -i shorthand is used", async () => {
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "-i",
        "claude-code",
        "hello"
      ]);

      expect(spawnInteractive).toHaveBeenCalled();
      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("propagates non-zero exit code from interactive spawn", async () => {
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 42
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      const savedExitCode = process.exitCode;
      try {
        await program.parseAsync([
          "node",
          "cli",
          "spawn",
          "--interactive",
          "claude-code",
          "hello"
        ]);
        expect(process.exitCode).toBe(42);
      } finally {
        process.exitCode = savedExitCode;
      }
    });

    it("shows error when agent does not support interactive mode", async () => {
      vi.mocked(spawnInteractive).mockRejectedValue(
        new Error('Agent "codex" does not support interactive mode.')
      );

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await expect(
        program.parseAsync([
          "node",
          "cli",
          "spawn",
          "--interactive",
          "codex",
          "hello"
        ])
      ).rejects.toThrow("does not support interactive mode");
    });

    it("does not render ACP events in interactive mode", async () => {
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      const chunks: string[] = [];
      const spy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(((chunk: unknown) => {
          chunks.push(String(chunk));
          return true;
        }) as unknown as typeof process.stdout.write);

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      try {
        await program.parseAsync([
          "node",
          "cli",
          "spawn",
          "--interactive",
          "claude-code",
          "hello"
        ]);
      } finally {
        spy.mockRestore();
      }

      expect(sdkSpawn).not.toHaveBeenCalled();
      expect(chunks).toHaveLength(0);
    });

    it("works without a prompt in interactive mode", async () => {
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--interactive",
        "claude-code"
      ]);

      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "",
        args: [],
        model: DEFAULT_CLAUDE_CODE_MODEL,
        cwd: undefined
      });
      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("uses the configured model for interactive spawn when --model is omitted", async () => {
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      await fs.writeFile(
        resolveConfigPath(homeDir),
        `${JSON.stringify({ models: { "claude-code": "anthropic/claude-opus-4.6" } }, null, 2)}\n`,
        { encoding: "utf8" }
      );

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--interactive",
        "claude",
        "hello"
      ]);

      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "hello",
        args: [],
        model: "anthropic/claude-opus-4.6",
        cwd: undefined
      });
    });

    it("passes model and cwd to spawnInteractive", async () => {
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--interactive",
        "--model",
        "gpt-4",
        "-C",
        "/projects/demo",
        "claude-code",
        "hello"
      ]);

      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "hello",
        args: [],
        model: "gpt-4",
        cwd: "/projects/demo"
      });
    });
  });

  describe("unconfigured service warning", () => {
    const configPath = resolveConfigPath(homeDir);

    async function writeConfiguredServices(
      fileSystem: FileSystem,
      services: Record<string, { files: string[] }>
    ): Promise<void> {
      await fileSystem.writeFile(
        configPath,
        JSON.stringify({ configured_services: services }),
        { encoding: "utf8" }
      );
    }

    it("skips prompt when service is configured", async () => {
      await writeConfiguredServices(fs, {
        "claude-code": { files: [] }
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "claude-code",
        "hello"
      ]);

      expect(confirmMock).not.toHaveBeenCalled();
      expect(sdkSpawn).toHaveBeenCalled();
    });

    it("prompts and proceeds when user confirms", async () => {
      confirmMock.mockResolvedValueOnce(true);

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "claude-code",
        "hello"
      ]);

      expect(confirmMock).toHaveBeenCalled();
      expect(sdkSpawn).toHaveBeenCalled();
    });

    it("cancels spawn when user declines", async () => {
      confirmMock.mockResolvedValueOnce(false);

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "claude-code",
        "hello"
      ]);

      expect(confirmMock).toHaveBeenCalled();
      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("aborts spawn when confirmation is cancelled", async () => {
      confirmMock.mockResolvedValueOnce(Symbol("cancelled"));
      isCancelMock.mockReturnValue(true);

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await expect(
        program.parseAsync([
          "node",
          "cli",
          "spawn",
          "claude-code",
          "hello"
        ])
      ).rejects.toBeInstanceOf(OperationCancelledError);

      expect(confirmMock).toHaveBeenCalled();
      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("skips prompt with --yes when not configured", async () => {
      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "--yes",
        "spawn",
        "claude-code",
        "hello"
      ]);

      expect(confirmMock).not.toHaveBeenCalled();
      expect(sdkSpawn).toHaveBeenCalled();
    });

    it("prompts in interactive mode when not configured", async () => {
      confirmMock.mockResolvedValueOnce(true);
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--interactive",
        "claude-code",
        "hello"
      ]);

      expect(confirmMock).toHaveBeenCalled();
      expect(spawnInteractive).toHaveBeenCalled();
    });

    it("cancels interactive spawn when user declines", async () => {
      confirmMock.mockResolvedValueOnce(false);
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--interactive",
        "claude-code",
        "hello"
      ]);

      expect(confirmMock).toHaveBeenCalled();
      expect(spawnInteractive).not.toHaveBeenCalled();
    });
  });
});
