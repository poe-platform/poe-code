import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { Readable } from "node:stream";
import { Command } from "commander";
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

vi.mock("../../sdk/spawn.js", () => ({
  spawn: vi.fn()
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    getSpawnConfig: vi.fn(actual.getSpawnConfig),
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
import { getSpawnConfig, spawnInteractive } from "@poe-code/agent-spawn";

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

    confirmMock.mockResolvedValue(true);
    isCancelMock.mockReturnValue(false);

    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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
      model: undefined,
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

  it("passes --mcp-config to SDK spawn for MCP-capable agents", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const mcpConfig = JSON.stringify({
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
      "--mcp-config",
      mcpConfig,
      "codex",
      "Use word_of_the_day"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Use word_of_the_day",
      args: [],
      model: undefined,
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

  it("passes --mcp-config to SDK spawn for poe-agent", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const mcpConfig = JSON.stringify({
      test: {
        command: "tiny-stdio-mcp-test-server",
        args: ["serve", "word-of-the-day"]
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--mcp-config",
      mcpConfig,
      "poe-agent",
      "Use word_of_the_day"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("poe-agent", {
      prompt: "Use word_of_the_day",
      args: [],
      model: undefined,
      cwd: undefined,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });
  });

  it("rejects invalid --mcp-config JSON", async () => {
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
        "--mcp-config",
        "{nope",
        "codex",
        "hello"
      ])
    ).rejects.toThrow("--mcp-config");

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects --mcp-config for agents without spawn-time MCP support", async () => {
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
        "--mcp-config",
        JSON.stringify({
          test: {
            command: "tiny-stdio-mcp-test-server",
            args: ["serve", "word-of-the-day"]
          }
        }),
        "opencode",
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
      model: undefined,
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
      model: undefined,
      cwd: resolved
    });
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
      model: undefined,
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
      model: undefined,
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
        model: undefined,
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
        model: undefined,
        cwd: undefined
      });
      expect(sdkSpawn).not.toHaveBeenCalled();
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
    const configPath = `${homeDir}/.poe-code/config.json`;

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
