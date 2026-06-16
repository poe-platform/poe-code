import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import { Readable } from "node:stream";
import { Command } from "commander";
import { resetOutputFormatCache } from "toolcraft-design";
import type { AcpMiddleware } from "@poe-code/agent-spawn";
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
const selectMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const resolveWorkspaceMock = vi.hoisted(() => vi.fn());
const braintrustLoadIntegrationsMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/braintrust", () => ({
  loadIntegrations: braintrustLoadIntegrationsMock
}));

vi.mock("../../sdk/spawn.js", () => ({
  spawn: vi.fn()
}));

const ensurePoeApiKeyEnvMock = vi.hoisted(() => vi.fn());

vi.mock("../../sdk/credentials.js", () => ({
  ensurePoeApiKeyEnv: ensurePoeApiKeyEnvMock
}));

const spawnPoeAgentWithAcpMock = vi.hoisted(() =>
  vi.fn(() => ({
    events: (async function* () {})(),
    done: Promise.resolve({
      stdout: "poe-agent output\n",
      stderr: "",
      exitCode: 0
    })
  }))
);

vi.mock("../../providers/poe-agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/poe-agent.js")>();
  return {
    ...actual,
    spawnPoeAgentWithAcp: spawnPoeAgentWithAcpMock
  };
});

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

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    confirm: confirmMock,
    select: selectMock,
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

function createContainerWithDependencies(overrides: Partial<CliDependencies> = {}): {
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
    logger:
      overrides.logger ??
      ((message) => {
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setProcessStdinIsTTY(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true
  });
}

function restoreProcessStdinIsTTY(): void {
  if (stdinIsTTYDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinIsTTYDescriptor);
  } else {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
}

describe("spawn command", () => {
  let fs: FileSystem;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fs = createMemFs();
    vi.clearAllMocks();
    process.env = { ...originalEnv, FORCE_COLOR: "1" };
    setProcessStdinIsTTY(true);
    resetOutputFormatCache();

    confirmMock.mockResolvedValue(true);
    selectMock.mockResolvedValue("yolo");
    isCancelMock.mockReturnValue(false);

    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));
    ensurePoeApiKeyEnvMock.mockReset();
    ensurePoeApiKeyEnvMock.mockResolvedValue(undefined);
    vi.mocked(resolveWorkspace).mockReset();
    vi.mocked(resolveWorkspace).mockImplementation(async (input, options) => ({
      cwd: path.isAbsolute(input) ? input : path.join(options.baseDir, input),
      locator: { scheme: "local", path: input }
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    restoreProcessStdinIsTTY();
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
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

    try {
      const parsePromise = program.parseAsync(["node", "cli", "spawn", "claude", "hello"]);
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
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });

    const plainChunks = chunks.map((chunk) => stripAnsi(chunk));
    expect(plainChunks).toEqual(["  → exec: npm test\n", "  ✓ exec\n", "✓ agent: Hi\n"]);
    expect(logs.length).toBeGreaterThan(0);
  });

  it("snapshots --detach output", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        detached: { jobId: "job-123", envId: "env-456" }
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

    await program.parseAsync(["node", "cli", "spawn", "codex", "--detach", "hello"]);

    expect(stripAnsi(logs.join("\n"))).toMatchInlineSnapshot(`
      "spawn codex
      job started: job-123
      sandbox: env-456
      detached."
    `);
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
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

    try {
      await program.parseAsync(["node", "cli", "spawn", "codex", "hello"]);
    } finally {
      spy.mockRestore();
    }

    expect(stripAnsi(chunks.join(""))).toBe("");
    expect(logs.some((line) => line.includes("Final output"))).toBe(true);
  });

  it("passes runtime flags to the spawn SDK", async () => {
    vi.mocked(sdkSpawn).mockImplementation(() => ({
      events: emptyAsyncIterable(),
      result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

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
      "claude",
      "--runtime",
      "docker",
      "--runtime-image",
      "poe-code:test",
      "--detach",
      "--mount-poe-code",
      "--runner-sync",
      "upload",
      "hello"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        runtime: "docker",
        runtimeImage: "poe-code:test",
        detach: true,
        mountPoeCode: true,
        runnerSync: "upload"
      })
    );
  });

  it("wraps spawn runs with enabled integrations without forwarding spawn middleware", async () => {
    const calls: string[] = [];
    const spawnMiddleware: AcpMiddleware = vi.fn(async (_ctx, next) => {
      calls.push("middleware");
      await next();
    });
    const traceRun = vi.fn(async (_surface: string, _name: string, run: () => Promise<unknown>) => {
      calls.push("trace:start");
      const result = await run();
      calls.push("trace:end");
      return result;
    });
    const shutdown = vi.fn(async () => {
      calls.push("shutdown");
    });

    braintrustLoadIntegrationsMock.mockResolvedValue({
      spawnMiddleware,
      traceRun,
      shutdown
    });
    vi.mocked(sdkSpawn).mockImplementation((_service, options) => {
      calls.push("spawn");
      expect(options.middlewares).toBeUndefined();
      return {
        events: emptyAsyncIterable(),
        result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
      };
    });
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({
        integrations: {
          braintrust: {
            enabled: true,
            apiKey: "key",
            project: "project"
          }
        }
      })}\n`,
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

    try {
      await program.parseAsync(["node", "cli", "--yes", "spawn", "codex", "hello"]);

      expect(traceRun).toHaveBeenCalledWith("spawn", "codex", expect.any(Function));
      expect(calls).toEqual(["trace:start", "spawn", "trace:end", "shutdown"]);
    } finally {
      braintrustLoadIntegrationsMock.mockReset();
    }
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
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
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
      { event: "agent_message", text: "Hi" },
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
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

    try {
      await expect(
        program.parseAsync(["node", "cli", "--yes", "spawn", "codex", "hello"])
      ).resolves.toBe(program);

      expect(
        chunks
          .join("")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      ).toEqual([
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

  it("retries on ActivityTimeoutError", async () => {
    const timeoutError = new Error("Agent spawn timed out after 600s of inactivity");
    timeoutError.name = "ActivityTimeoutError";

    vi.mocked(sdkSpawn)
      .mockImplementationOnce(() => ({
        events: emptyAsyncIterable(),
        result: Promise.reject(timeoutError)
      }))
      .mockImplementationOnce(() => ({
        events: emptyAsyncIterable(),
        result: Promise.resolve({ stdout: "retry-success", stderr: "", exitCode: 0 })
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

    await program.parseAsync(["node", "cli", "spawn", "codex", "hello"]);

    expect(sdkSpawn).toHaveBeenCalledTimes(2);
    expect(logs.some((line) => line.includes("retry-success"))).toBe(true);
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
      program.parseAsync(["node", "cli", "spawn", "claude-code", "Explain the change"])
    ).rejects.toThrow(/spawn failed/i);
  });

  it("skips execution during dry run spawn", async () => {
    const logs: string[] = [];
    const prompt = "investigate token=sk-dry-run-secret";
    const { runner, calls } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "--dry-run", "spawn", "claude-code", prompt]);

    expect(calls).toHaveLength(0);
    expect(sdkSpawn).not.toHaveBeenCalled();
    const dryRunLog = logs.find((line) => line.includes("Dry run: would spawn Claude Code."));
    expect(dryRunLog).toBeTruthy();
    expect(dryRunLog).toContain("Prompt:");
    expect(dryRunLog).toContain("[prompt redacted]");
    expect(dryRunLog).not.toContain("sk-dry-run-secret");
  });

  it("validates active skill references before previewing dry run spawn", async () => {
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--dry-run",
        "--yes",
        "spawn",
        "codex",
        "hello",
        "--skill",
        "missing-skill"
      ])
    ).rejects.toThrow(/missing-skill/);

    expect(calls).toHaveLength(0);
    expect(sdkSpawn).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("Dry run: would spawn");
  });

  it("validates hook bridge sources before previewing dry run spawn", async () => {
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--dry-run",
        "--yes",
        "spawn",
        "codex",
        "hello",
        "--hooks-from",
        "missing-agent"
      ])
    ).rejects.toThrow(/Unsupported source hook agent "missing-agent"/);

    expect(calls).toHaveLength(0);
    expect(sdkSpawn).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("Dry run: would spawn");
  });

  it("does not recover malformed config during dry run spawn", async () => {
    const malformedConfig = "{ invalid json\n";
    const configPath = resolveConfigPath(homeDir);
    await fs.writeFile(configPath, malformedConfig, { encoding: "utf8" });
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "spawn", "codex", "hello"])
    ).rejects.toThrow();

    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
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

  it("routes spawn poe-agent through in-process handler", async () => {
    spawnPoeAgentWithAcpMock.mockClear();
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "spawn", "poe-agent", "Explain the change"]);

    expect(sdkSpawn).not.toHaveBeenCalled();
    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledOnce();
    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Explain the change" })
    );
  });

  it("forwards poe-agent resume thread and prints a resume hint", async () => {
    spawnPoeAgentWithAcpMock.mockReturnValueOnce({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "continued\n",
        stderr: "",
        exitCode: 0,
        threadId: "poe-agent-existing"
      })
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
      "poe-agent",
      "continue",
      "--resume-thread-id",
      "poe-agent-existing"
    ]);

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ resumeThreadId: "poe-agent-existing" })
    );
    expect(logs.join("\n")).toContain(
      "Resume: poe-code spawn --agent poe-agent --resume-thread-id poe-agent-existing"
    );
  });

  it("does not invoke inherited custom handler names", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync(["node", "cli", "spawn", "constructor", "hello"])
    ).rejects.toThrow('Unknown agent "constructor".');
    expect(sdkSpawn).not.toHaveBeenCalled();
    expect(spawnPoeAgentWithAcpMock).not.toHaveBeenCalled();
  });

  it("honors --dry-run for spawn poe-agent", async () => {
    spawnPoeAgentWithAcpMock.mockClear();
    const logs: string[] = [];
    const prompt = "investigate token=sk-poe-agent-dry-run-secret";
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => logs.push(message)
    });

    await program.parseAsync(["node", "cli", "--dry-run", "spawn", "poe-agent", prompt]);

    expect(spawnPoeAgentWithAcpMock).not.toHaveBeenCalled();
    const dryRunLog = logs.find((line) => line.includes("Dry run: would spawn Poe Agent."));
    expect(dryRunLog).toBeTruthy();
    expect(dryRunLog).toContain("[prompt redacted]");
    expect(dryRunLog).not.toContain("sk-poe-agent-dry-run-secret");
  });

  it("lists poe-agent in spawn help", () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    const spawnCommand = program.commands.find((cmd) => cmd.name() === "spawn");
    expect(spawnCommand?.helpInformation()).toContain("poe-agent");
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
    expect(help).toContain("prompted;");
    expect(help).toContain("--yes uses yolo");
  });

  it("prompts for permission mode when omitted in an interactive terminal", async () => {
    selectMock.mockResolvedValueOnce("read");
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "spawn", "codex", "hello"]);

    expect(selectMock).toHaveBeenCalledWith({
      message: "Select permission mode:",
      initialValue: "edit",
      options: expect.arrayContaining([
        expect.objectContaining({ value: "edit" }),
        expect.objectContaining({ value: "read" }),
        expect.objectContaining({ value: "yolo" })
      ])
    });
    const offeredModes = (
      selectMock.mock.calls[0]![0] as { options: Array<{ value: string }> }
    ).options.map((option) => option.value);
    expect(offeredModes).not.toContain("auto");
    expect(sdkSpawn).toHaveBeenCalledWith("codex", expect.objectContaining({ mode: "read" }));
  });

  it("uses yolo for omitted permission mode when --yes is passed", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "--yes", "spawn", "codex", "hello"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(sdkSpawn).toHaveBeenCalledWith("codex", expect.objectContaining({ mode: "yolo" }));
  });

  it("rejects omitted permission mode without --yes when stdin is non-interactive", async () => {
    setProcessStdinIsTTY(false);
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(program.parseAsync(["node", "cli", "spawn", "codex", "hello"])).rejects.toThrow(
      "spawn requires --mode when running without an interactive TTY"
    );

    expect(selectMock).not.toHaveBeenCalled();
    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects invalid permission mode values before spawning", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync(["node", "cli", "spawn", "--mode", "dance", "codex", "hello"])
    ).rejects.toThrow('Invalid --mode "dance". Expected yolo, auto, edit, or read.');

    expect(selectMock).not.toHaveBeenCalled();
    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("passes through auto permission mode for agents that support it", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "spawn", "--mode", "auto", "claude-code", "hello"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(sdkSpawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({ mode: "auto" })
    );
  });

  it("rejects auto permission mode for agents without an approval channel", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync(["node", "cli", "spawn", "--mode", "auto", "codex", "hello"])
    ).rejects.toThrow(
      'Agent "codex" does not support --mode auto. Supported modes: yolo, edit, read.'
    );

    expect(sdkSpawn).not.toHaveBeenCalled();
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
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("passes active skills from repeated --skill flags to SDK spawn", async () => {
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
      "--skill",
      "foo",
      "--skill",
      "claude/bar",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      skills: ["foo", "claude/bar"],
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("passes comma-separated --skills entries to SDK spawn", async () => {
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
      "--skills",
      "foo,claude/bar",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      skills: ["foo", "claude/bar"],
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("trims --skills entries and drops empty comma entries", async () => {
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
      "--skills",
      " foo, , claude/bar ,, ",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      skills: ["foo", "claude/bar"],
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("concatenates repeated --skills flags for SDK spawn", async () => {
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
      "--skills",
      "foo",
      "--skills",
      "claude/bar",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      skills: ["foo", "claude/bar"],
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it.each([
    ["empty --skills value", ["--skills", ""], "codex", "List files"],
    ["bare --skills flag", [], "codex", "List files", "--skills"],
    ["whitespace-only --skills value", ["--skills", "  \t  "], "codex", "List files"],
    ["no --skills flag", [], "codex", "List files"]
  ])("omits skills for %s", async (_name, leadingArgs, agent, prompt, trailingArg) => {
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
      ...leadingArgs,
      agent,
      prompt,
      ...(trailingArg ? [trailingArg] : [])
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("passes --hooks-from to SDK spawn with the default auto strategy", async () => {
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
      "--hooks-from",
      "claude",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      hooks: { from: "claude", strategy: "auto" },
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("passes --hooks-from through without CLI agent-id normalization", async () => {
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
      "--hooks-from",
      "CLAUDE-CODE",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      hooks: { from: "CLAUDE-CODE", strategy: "auto" },
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("passes --hooks-strategy through to SDK spawn", async () => {
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
      "--hooks-from",
      "claude",
      "--hooks-strategy",
      "transform",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      hooks: { from: "claude", strategy: "transform" },
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("passes --hooks-scope through to SDK spawn", async () => {
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
      "--hooks-from",
      "claude",
      "--hooks-scope",
      "project",
      "codex",
      "List files"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      hooks: { from: "claude", strategy: "auto", scope: "project" },
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("shows usage when --hooks-strategy is provided without --hooks-from", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    let stderr = "";
    const spawnCommand = program.commands.find((command) => command.name() === "spawn");
    spawnCommand?.configureOutput({ writeErr: (value) => (stderr += value) });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--hooks-strategy",
        "auto",
        "codex",
        "List files"
      ])
    ).rejects.toThrow("--hooks-from");

    expect(stderr).toContain("Usage:");
    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("shows usage when --hooks-scope is provided without --hooks-from", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    let stderr = "";
    const spawnCommand = program.commands.find((command) => command.name() === "spawn");
    spawnCommand?.configureOutput({ writeErr: (value) => (stderr += value) });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--hooks-scope",
        "project",
        "codex",
        "List files"
      ])
    ).rejects.toThrow("--hooks-from");

    expect(stderr).toContain("Usage:");
    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects invalid --hooks-strategy values", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const spawnCommand = program.commands.find((command) => command.name() === "spawn");
    spawnCommand?.configureOutput({ writeErr: () => {} });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--hooks-from",
        "claude",
        "--hooks-strategy",
        "copy",
        "codex",
        "List files"
      ])
    ).rejects.toThrow("Allowed choices");

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("omits hooks when no --hooks-* flags are provided", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "spawn", "codex", "List files"]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
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

    await program.parseAsync(["node", "cli", "spawn", "codex", "List files"]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "List files",
      args: [],
      model: "openai/gpt-5.4",
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
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
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
  });

  it("preserves special MCP environment variable names", async () => {
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
      "--mcp-servers",
      '{"test":{"command":"server","env":{"__proto__":"visible"}}}',
      "codex",
      "hello"
    ]);

    const options = vi.mocked(sdkSpawn).mock.calls.at(-1)?.[1];
    expect(Object.hasOwn(options?.mcpServers?.test.env ?? {}, "__proto__")).toBe(true);
    expect(options?.mcpServers?.test.env?.["__proto__"]).toBe("visible");
  });

  it("preserves explicitly configured special MCP server names", async () => {
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
      "--mcp-servers",
      '{"__proto__":{"command":"server"}}',
      "codex",
      "hello"
    ]);

    const options = vi.mocked(sdkSpawn).mock.calls.at(-1)?.[1];
    expect(Object.hasOwn(options?.mcpServers ?? {}, "__proto__")).toBe(true);
    expect(options?.mcpServers?.["__proto__"]?.command).toBe("server");
  });

  it("ignores inherited MCP server wrapper fields", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await withObjectPrototypeProperties(
      { mcpServers: { polluted: { command: "polluted-server" } } },
      async () => {
        await program.parseAsync([
          "node",
          "cli",
          "spawn",
          "--mcp-servers",
          '{"test":{"command":"server"}}',
          "codex",
          "hello"
        ]);
      }
    );

    const options = vi.mocked(sdkSpawn).mock.calls.at(-1)?.[1];
    expect(options?.mcpServers).toEqual({ test: { command: "server" } });
  });

  it("requires MCP server commands to be own properties", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await withObjectPrototypeProperties({ command: "polluted-server" }, async () => {
      await expect(
        program.parseAsync([
          "node",
          "cli",
          "spawn",
          "--mcp-servers",
          '{"test":{}}',
          "codex",
          "hello"
        ])
      ).rejects.toThrow('--mcp-servers entry "test" must include a non-empty string "command"');
    });

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("ignores inherited optional MCP server fields", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await withObjectPrototypeProperties(
      { args: ["polluted"], autoApprove: true, timeout: 5 },
      async () => {
        await program.parseAsync([
          "node",
          "cli",
          "spawn",
          "--mcp-servers",
          '{"test":{"command":"server"}}',
          "codex",
          "hello"
        ]);
      }
    );

    const options = vi.mocked(sdkSpawn).mock.calls.at(-1)?.[1];
    expect(options?.mcpServers).toEqual({ test: { command: "server" } });
  });

  it("reads --mcp-servers from an absolute @file path", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const filePath = "/tmp/mcp.json";
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }),
      { encoding: "utf8" }
    );

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--mcp-servers",
      `@${filePath}`,
      "codex",
      "Use word_of_the_day"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Use word_of_the_day",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
  });

  it("resolves relative --mcp-servers @file paths against the CLI cwd", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const filePath = path.join(cwd, "mcp.json");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }),
      { encoding: "utf8" }
    );

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--mcp-servers",
      "@mcp.json",
      "codex",
      "Use word_of_the_day"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Use word_of_the_day",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
  });

  it("unwraps the mcpServers key when --mcp-servers points at a standard .mcp.json", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const filePath = path.join(cwd, ".mcp.json");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        mcpServers: {
          test: {
            command: "tiny-stdio-mcp-test-server",
            args: ["serve", "word-of-the-day"],
            env: { MCP_LOG_LEVEL: "debug" }
          }
        }
      }),
      { encoding: "utf8" }
    );

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--mcp-servers",
      "@.mcp.json",
      "codex",
      "Use word_of_the_day"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Use word_of_the_day",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
  });

  it("reads deprecated --mcp-config from an @file path", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const filePath = path.join(cwd, "mcp.json");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }),
      { encoding: "utf8" }
    );

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--mcp-config",
      "@mcp.json",
      "codex",
      "Use word_of_the_day"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Use word_of_the_day",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
  });

  it("passes --resume-thread-id to SDK spawn", async () => {
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
      "--resume-thread-id",
      "thread_abc123",
      "codex",
      "continue"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "continue",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      resumeThreadId: "thread_abc123",
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("passes log and activity timeout options to SDK spawn", async () => {
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
      "--log-file-name",
      "attempt.jsonl",
      "--log-content",
      "--activity-timeout-ms",
      "1500",
      "codex",
      "hello"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "hello",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      logDir: "/tmp/spawn-logs",
      logFileName: "attempt.jsonl",
      logContent: true,
      activityTimeoutMs: 1500,
      runtimeConfigCwd: cwd
    });
  });

  it("rejects activity timeout values with trailing suffixes", async () => {
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
        "--activity-timeout-ms",
        "2abc",
        "codex",
        "hello"
      ])
    ).rejects.toThrow('Invalid --activity-timeout-ms "2abc". Expected a positive integer.');

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("passes native OTel capture options to SDK spawn", async () => {
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
      "--capture-otel",
      "--capture-otel-content",
      "codex",
      "hello"
    ]);

    expect(sdkSpawn).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({ captureOtel: true, captureOtelContent: true })
    );
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
      program.parseAsync(["node", "cli", "spawn", "--mcp-servers", "{nope", "codex", "hello"])
    ).rejects.toThrow("--mcp-servers");

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects overflowing --mcp-servers timeout values", async () => {
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
        '{"bad":{"command":"srv","timeout":1e400}}',
        "codex",
        "hello"
      ])
    ).rejects.toThrow('--mcp-servers entry "bad".timeout must be a positive number');

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects --mcp-servers when the referenced @file does not exist", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const missingPath = path.join(cwd, "missing.json");

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "spawn",
        "--mcp-servers",
        "@missing.json",
        "codex",
        "hello"
      ])
    ).rejects.toThrow(missingPath);

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON loaded from an --mcp-servers @file", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const filePath = path.join(cwd, "mcp.json");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(filePath, "{nope", { encoding: "utf8" });

    await expect(
      program.parseAsync(["node", "cli", "spawn", "--mcp-servers", "@mcp.json", "codex", "hello"])
    ).rejects.toThrow("--mcp-servers");

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects --mcp-servers when @ has no file path", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync(["node", "cli", "spawn", "--mcp-servers", "@", "codex", "hello"])
    ).rejects.toThrow("--mcp-servers @<path> requires a file path after '@'");

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("reads positional prompt from an absolute @file path", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const filePath = "/tmp/prompt.md";
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "Review the diff carefully.\n", { encoding: "utf8" });

    await program.parseAsync(["node", "cli", "spawn", "codex", `@${filePath}`]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Review the diff carefully.",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("resolves relative positional prompt @file paths against the CLI cwd", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const filePath = path.join(cwd, "prompt.md");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(filePath, "Summarize the file.\n", { encoding: "utf8" });

    await program.parseAsync(["node", "cli", "spawn", "codex", "@prompt.md"]);

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Summarize the file.",
      args: [],
      model: undefined,
      mode: "yolo",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
    });
  });

  it("rejects positional prompt when the referenced @file does not exist", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });
    const missingPath = path.join(cwd, "missing.md");

    await expect(
      program.parseAsync(["node", "cli", "spawn", "codex", "@missing.md"])
    ).rejects.toThrow(missingPath);

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("rejects positional prompt when @ has no file path", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(program.parseAsync(["node", "cli", "spawn", "codex", "@"])).rejects.toThrow(
      "prompt @<path> requires a file path after '@'"
    );

    expect(sdkSpawn).not.toHaveBeenCalled();
  });

  it("treats stdin starting with @ as literal prompt text, not a file reference", async () => {
    const { runner } = createCommandRunnerStub();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    const stdinStream = Readable.from([Buffer.from("@not-a-file.md")]);
    Object.defineProperty(stdinStream, "isTTY", { value: false });
    const stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(stdinStream as NodeJS.ReadStream);

    try {
      await program.parseAsync([
        "node",
        "cli",
        "--yes",
        "spawn",
        "--stdin",
        "--mode",
        "read",
        "codex"
      ]);
    } finally {
      stdinSpy.mockRestore();
    }

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "@not-a-file.md",
      args: [],
      model: undefined,
      mode: "read",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      useStdin: true,
      runtimeConfigCwd: cwd
    });
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
    ).rejects.toThrow("does not support MCP servers at spawn time.");

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
      mode: "yolo",
      cwd: customCwd,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
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
      mode: "yolo",
      cwd: resolved,
      activityTimeoutMs: 600_000,
      runtimeConfigCwd: cwd
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
      model: undefined,
      cwd: "/tmp/workspaces/poe-code",
      mode: "yolo",
      runtimeConfigCwd: cwd
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
      await program.parseAsync(["node", "cli", "--yes", "spawn", "--mode", "read", "codex"]);
    } finally {
      stdinSpy.mockRestore();
    }

    expect(sdkSpawn).toHaveBeenCalledWith("codex", {
      prompt: "Prompt via stdin",
      args: [],
      model: undefined,
      mode: "read",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      useStdin: true,
      runtimeConfigCwd: cwd
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
        "--yes",
        "spawn",
        "--stdin",
        "--mode",
        "read",
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
      mode: "read",
      cwd: undefined,
      activityTimeoutMs: 600_000,
      useStdin: true,
      runtimeConfigCwd: cwd
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

      await program.parseAsync(["node", "cli", "spawn", "codex", "hello"]);

      const plainLog = stripAnsi(logs.join("\n"));
      expect(plainLog).toContain("Resume: codex resume -C /projects/demo thread_abc123");
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
    expect(plainLog).toContain("Resume: codex resume -C '/projects/demo repo' thread_abc123");
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

    await program.parseAsync(["node", "cli", "spawn", "codex", "hello"]);

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

      await program.parseAsync(["node", "cli", "spawn", "claude-code", "hello"]);

      const plainLog = stripAnsi(logs.join("\n"));
      expect(plainLog).toContain("Resume: cd /projects/demo && claude --resume thread_abc123");
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

      await program.parseAsync(["node", "cli", "spawn", "opencode", "hello"]);

      const plainLog = stripAnsi(logs.join("\n"));
      expect(plainLog).toContain("Resume: opencode /projects/demo --session thread_abc123");
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

      await program.parseAsync(["node", "cli", "spawn", "kimi", "hello"]);

      const plainLog = stripAnsi(logs.join("\n"));
      expect(plainLog).toContain("Resume: kimi --session thread_abc123 --work-dir /projects/demo");
    } finally {
      processCwdSpy.mockRestore();
    }
  });

  it("does not print resume when config has no resume spec", async () => {
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

    await program.parseAsync(["node", "cli", "spawn", "codex", "hello"]);

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

      await program.parseAsync(["node", "cli", "spawn", "--interactive", "claude-code", "hello"]);

      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "hello",
        args: [],
        model: undefined,
        cwd: undefined,
        mode: "yolo",
        runtimeConfigCwd: cwd
      });
      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("passes --resume-thread-id to interactive spawns", async () => {
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
        "--resume-thread-id",
        "thread_abc123",
        "claude-code",
        "continue"
      ]);

      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "continue",
        args: [],
        model: undefined,
        cwd: undefined,
        mode: "yolo",
        resumeThreadId: "thread_abc123",
        runtimeConfigCwd: cwd
      });
      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("exports stored Poe credentials before interactive spawns", async () => {
      delete process.env.POE_API_KEY;
      ensurePoeApiKeyEnvMock.mockImplementationOnce(async () => {
        process.env.POE_API_KEY = "stored-key";
      });
      vi.mocked(spawnInteractive).mockImplementation(async () => {
        expect(process.env.POE_API_KEY).toBe("stored-key");
        return {
          stdout: "",
          stderr: "",
          exitCode: 0
        };
      });

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await program.parseAsync(["node", "cli", "spawn", "--interactive", "claude-code", "hello"]);

      expect(ensurePoeApiKeyEnvMock).toHaveBeenCalledTimes(1);
      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "hello",
        args: [],
        model: undefined,
        cwd: undefined,
        mode: "yolo",
        runtimeConfigCwd: cwd
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

      await program.parseAsync(["node", "cli", "spawn", "-i", "claude-code", "hello"]);

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
        await program.parseAsync(["node", "cli", "spawn", "--interactive", "claude-code", "hello"]);
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
        program.parseAsync(["node", "cli", "spawn", "--interactive", "codex", "hello"])
      ).rejects.toThrow("does not support interactive mode");
    });

    it("calls spawnInteractive for goose when --interactive is set", async () => {
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

      await program.parseAsync(["node", "cli", "spawn", "--interactive", "goose", "hello"]);

      expect(spawnInteractive).toHaveBeenCalledWith("goose", {
        prompt: "hello",
        args: [],
        model: undefined,
        cwd: undefined,
        mode: "yolo",
        runtimeConfigCwd: cwd
      });
    });

    it("does not render ACP events in interactive mode", async () => {
      vi.mocked(spawnInteractive).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      const chunks: string[] = [];
      const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
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
        await program.parseAsync(["node", "cli", "spawn", "--interactive", "claude-code", "hello"]);
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

      await program.parseAsync(["node", "cli", "spawn", "--interactive", "claude-code"]);

      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "",
        args: [],
        model: undefined,
        cwd: undefined,
        mode: "yolo",
        runtimeConfigCwd: cwd
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
        `${JSON.stringify({ models: { "claude-code": "anthropic/claude-opus-4.7" } }, null, 2)}\n`,
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

      await program.parseAsync(["node", "cli", "spawn", "--interactive", "claude", "hello"]);

      expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
        prompt: "hello",
        args: [],
        model: "anthropic/claude-opus-4.7",
        cwd: undefined,
        mode: "yolo",
        runtimeConfigCwd: cwd
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
        cwd: "/projects/demo",
        mode: "yolo",
        runtimeConfigCwd: cwd
      });
    });
  });

  describe("unconfigured service warning", () => {
    const configPath = resolveConfigPath(homeDir);

    async function writeConfiguredServices(
      fileSystem: FileSystem,
      services: Record<string, { files: string[] }>
    ): Promise<void> {
      await fileSystem.writeFile(configPath, JSON.stringify({ configured_services: services }), {
        encoding: "utf8"
      });
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

      await program.parseAsync(["node", "cli", "spawn", "--mode", "read", "claude-code", "hello"]);

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

      await program.parseAsync(["node", "cli", "spawn", "--mode", "read", "claude-code", "hello"]);

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

      await program.parseAsync(["node", "cli", "spawn", "claude-code", "hello"]);

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
        program.parseAsync(["node", "cli", "spawn", "--mode", "read", "claude-code", "hello"])
      ).rejects.toBeInstanceOf(OperationCancelledError);

      expect(confirmMock).toHaveBeenCalled();
      expect(sdkSpawn).not.toHaveBeenCalled();
    });

    it("rejects non-interactive unconfigured services without --yes", async () => {
      setProcessStdinIsTTY(false);

      const { runner } = createCommandRunnerStub();
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd, homeDir },
        commandRunner: runner,
        logger: () => {}
      });

      await expect(
        program.parseAsync(["node", "cli", "spawn", "--mode", "read", "claude-code", "hello"])
      ).rejects.toThrow(
        "Claude Code is not configured via poe. Pass --yes to proceed without prompting."
      );

      expect(confirmMock).not.toHaveBeenCalled();
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

      await program.parseAsync(["node", "cli", "--yes", "spawn", "claude-code", "hello"]);

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
        "--mode",
        "read",
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
        "--mode",
        "read",
        "claude-code",
        "hello"
      ]);

      expect(confirmMock).toHaveBeenCalled();
      expect(spawnInteractive).not.toHaveBeenCalled();
    });
  });
});
