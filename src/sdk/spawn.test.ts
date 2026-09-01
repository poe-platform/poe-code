import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
import { cloudflareProvider } from "@poe-code/providers";
import type { FileSystem } from "../utils/file-system.js";

const applyMiddlewaresMock = vi.hoisted(() => vi.fn());
const sessionCaptureMock = vi.hoisted(() => vi.fn());
const usageCaptureMock = vi.hoisted(() => vi.fn());
const spawnLogMock = vi.hoisted(() => vi.fn());
const resolveWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return {
    ...actual,
    spawn: vi.fn(),
    spawnAcp: vi.fn(),
    spawnStreaming: vi.fn(),
    spawnInteractive: vi.fn(),
    getAcpSpawnConfig: vi.fn(),
    getSpawnConfig: vi.fn(),
    runCommand: vi.fn(),
    renderAcpStream: vi.fn(),
    applyMiddlewares: applyMiddlewaresMock,
    sessionCapture: sessionCaptureMock,
    usageCapture: usageCaptureMock,
    spawnLog: spawnLogMock
  };
});

vi.mock("./spawn-core.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spawn-core.js")>();
  return {
    ...actual,
    spawnCore: vi.fn()
  };
});

vi.mock("./container.js", () => ({
  createSdkContainer: vi.fn()
}));

vi.mock("@poe-code/workspace-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/workspace-resolver")>();
  return {
    ...actual,
    resolveWorkspace: resolveWorkspaceMock
  };
});

const loadIntegrationsMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/braintrust", () => ({
  loadIntegrations: loadIntegrationsMock
}));

import { spawn } from "./spawn.js";
import {
  DEFAULT_SPAWN_MODE,
  getAcpSpawnConfig,
  getSpawnConfig,
  isActivityTimeoutError,
  spawn as agentSpawn,
  spawnAcp,
  spawnStreaming,
  spawnInteractive,
  renderAcpStream,
  applyMiddlewares,
  sessionCapture,
  usageCapture,
  spawnLog
} from "@poe-code/agent-spawn";
import { spawnCore } from "./spawn-core.js";
import { isUserError } from "@poe-code/user-error";
import { createSdkContainer } from "./container.js";
import { resolveWorkspace } from "@poe-code/workspace-resolver";

const originalEnv = { ...process.env };
const homeDir = "/home/test";

function createActivityTimeoutError(timeoutMs = 1_500): Error {
  const error = new Error(`Agent spawn timed out after ${timeoutMs / 1000}s of inactivity`);
  error.name = "ActivityTimeoutError";
  expect(isActivityTimeoutError(error)).toBe(true);
  return error;
}

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

beforeEach(() => {
  process.env = { ...originalEnv, POE_API_KEY: "test-key" };
  vi.mocked(spawnStreaming).mockReset();
  vi.mocked(spawnInteractive).mockReset();
  vi.mocked(agentSpawn).mockReset();
  vi.mocked(spawnAcp).mockReset();
  vi.mocked(getAcpSpawnConfig).mockReset();
  vi.mocked(getSpawnConfig).mockReset();
  vi.mocked(spawnCore).mockReset();
  vi.mocked(createSdkContainer).mockReset();
  vi.mocked(renderAcpStream).mockReset();
  vi.mocked(applyMiddlewares).mockReset();
  vi.mocked(getAcpSpawnConfig).mockReturnValue(undefined);
  vi.mocked(resolveWorkspace).mockReset();
  vi.mocked(renderAcpStream).mockResolvedValue(undefined);
  vi.mocked(resolveWorkspace).mockImplementation(async (input) => ({
    cwd: input,
    locator: { scheme: "local", path: input }
  }));
  vi.mocked(createSdkContainer).mockImplementation(
    () =>
      ({
        fs: createMemFs(),
        env: {
          configPath: resolveConfigPath(homeDir),
          projectConfigPath: resolveConfigPath(homeDir),
          variables: {}
        },
        registry: {
          get: vi.fn(() => undefined)
        }
      }) as any
  );
  loadIntegrationsMock.mockReset();
  loadIntegrationsMock.mockResolvedValue(null);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function configureStreamingAttempts(
  attempts: Array<{
    events?: unknown[];
    result: { stdout?: string; stderr?: string; exitCode: number; threadId?: string };
  }>
): void {
  vi.mocked(getSpawnConfig).mockReturnValue({
    kind: "cli",
    agentId: "codex",
    adapter: "codex"
  } as any);

  vi.mocked(spawnStreaming).mockImplementation(() => {
    const attempt = attempts.shift();
    if (!attempt) {
      throw new Error("Unexpected extra spawn attempt.");
    }

    return {
      events: (async function* () {
        for (const event of attempt.events ?? []) {
          yield event;
        }
      })(),
      done: Promise.resolve({
        stdout: attempt.result.stdout ?? "",
        stderr: attempt.result.stderr ?? "",
        exitCode: attempt.result.exitCode,
        ...(attempt.result.threadId ? { threadId: attempt.result.threadId } : {})
      })
    };
  });
}

async function collectEvents(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const received: unknown[] = [];
  for await (const event of events) {
    received.push(event);
  }
  return received;
}

describe("SDK spawn()", () => {
  it.each([
    ["an id containing spaces", "not a real id"],
    ["a blank id", "  "],
    ["a flag-shaped id", "--resume"]
  ])("rejects %s for resumeThreadId before reaching the agent", (_label, resumeThreadId) => {
    let thrown: unknown;
    try {
      spawn("claude", "hello", { mode: "read", resumeThreadId });
    } catch (error) {
      thrown = error;
    }

    expect(isUserError(thrown)).toBe(true);
    expect((thrown as Error).message).toContain("--resume-thread-id");
    expect(spawnStreaming).not.toHaveBeenCalled();
    expect(agentSpawn).not.toHaveBeenCalled();
    expect(spawnAcp).not.toHaveBeenCalled();
    expect(spawnCore).not.toHaveBeenCalled();
  });

  it("spawns Pi through the declarative streaming path without a provider registry entry", async () => {
    delete process.env.POE_API_KEY;
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "pi",
      adapter: "pi",
      interactive: { defaultArgs: [] }
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield { event: "agent_message", text: "ok" };
      })(),
      done: Promise.resolve({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        threadId: "session-pi"
      })
    }));

    const handle = spawn("pi", "hello from pi", { mode: "read" });
    const events = await collectEvents(handle.events);
    await expect(handle.result).resolves.toEqual({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      threadId: "session-pi"
    });

    expect(events).toEqual([{ event: "agent_message", text: "ok" }]);
    expect(spawnCore).not.toHaveBeenCalled();
    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "pi",
        prompt: "hello from pi",
        mode: "read"
      })
    );
  });

  it("runs interactive Pi without loading Poe credentials", async () => {
    delete process.env.POE_API_KEY;
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "pi",
      adapter: "pi",
      interactive: { defaultArgs: [] }
    } as any);
    vi.mocked(spawnInteractive).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    await expect(spawn("pi", "explore", { interactive: true }).result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    expect(spawnInteractive).toHaveBeenCalledWith(
      "pi",
      expect.objectContaining({ prompt: "explore" })
    );
  });

  it("forwards native OTel capture and trace sink middleware to streaming spawns", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const traceSink = vi.fn();
    await spawn("codex", "test prompt", {
      captureOtel: true,
      captureOtelContent: true,
      traceSink
    }).result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        captureOtel: true,
        captureOtelContent: true,
        middlewares: [expect.any(Function)]
      })
    );
  });

  it("runs integration and user middleware inside native capture", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));
    const integrationMiddleware = vi.fn();
    const userMiddleware = vi.fn();
    loadIntegrationsMock.mockResolvedValue({
      spawnMiddleware: integrationMiddleware,
      shutdown: vi.fn().mockResolvedValue(undefined)
    });

    await spawn("codex", "test prompt", {
      captureOtel: true,
      middlewares: [userMiddleware]
    }).result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ middlewares: [integrationMiddleware, userMiddleware] })
    );
    expect(applyMiddlewares).toHaveBeenCalledWith(
      [sessionCapture, usageCapture, spawnLog],
      expect.any(Object)
    );
  });

  it("enables native OTel capture from the SDK environment", async () => {
    process.env.POE_CODE_CAPTURE_OTEL = "1";
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    await spawn("codex", "test prompt").result;

    expect(spawnStreaming).toHaveBeenCalledWith(expect.objectContaining({ captureOtel: true }));
  });

  it("returns events and result from spawnStreaming() when supported", async () => {
    const event = { event: "agent_message", text: "hello" };

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield event;
      })(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_1"
      })
    }));

    const { events, result } = spawn("codex", "test prompt", {
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });

    const received: unknown[] = [];
    for await (const e of events) {
      received.push(e);
    }

    expect(received).toEqual([event]);
    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      threadId: "thread_1"
    });

    expect(spawnStreaming).toHaveBeenCalledTimes(1);
    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: {
          test: {
            command: "tiny-stdio-mcp-test-server",
            args: ["serve", "word-of-the-day"]
          }
        }
      })
    );
    expect(agentSpawn).not.toHaveBeenCalled();
    expect(spawnCore).not.toHaveBeenCalled();
  });

  it("forwards per-invocation environment overrides to streaming spawns", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    await spawn("codex", "test prompt", { env: { WORKSPACE_ID: "workspace-1" } }).result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ env: { WORKSPACE_ID: "workspace-1" } })
    );
  });

  it("passes resumeThreadId through to streaming agent spawns", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_abc123"
      })
    }));

    const { result } = spawn("codex", "continue", {
      resumeThreadId: "thread_abc123"
    });

    await result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "continue",
        resumeThreadId: "thread_abc123"
      })
    );
  });

  it("passes active skills through to streaming agent spawns", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt", {
      skills: ["foo", "claude/bar"]
    });

    await result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: ["foo", "claude/bar"]
      })
    );
  });

  it("passes bridged hooks through to streaming agent spawns", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt", {
      hooks: { from: "claude-code", strategy: "transform", scope: "project" }
    });

    await result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        hooks: { from: "claude-code", strategy: "transform", scope: "project" }
      })
    );
  });

  it("passes resumeThreadId through to ACP agent spawns", async () => {
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "opencode",
      acpArgs: ["acp"]
    });

    vi.mocked(spawnAcp).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "ses_existing"
      })
    }));

    const { result } = spawn("opencode", "continue", {
      resumeThreadId: "ses_existing"
    });

    await result;

    expect(spawnAcp).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "continue",
        resumeThreadId: "ses_existing"
      })
    );
  });

  it("falls back to middleware-captured usage in the streaming path", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        threadId: "thread_1"
      })
    }));

    vi.mocked(applyMiddlewares).mockImplementation(async (_middlewares, ctx) => {
      ctx.usage = {
        inputTokens: 10,
        outputTokens: 4,
        cachedTokens: 2,
        costUsd: 0.03
      };
    });

    const { result } = spawn("codex", "test prompt");

    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      threadId: "thread_1",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cachedTokens: 2,
        costUsd: 0.03
      }
    });
  });

  it("exposes middleware-captured sessionResult on the spawn result", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "done",
        stderr: "",
        exitCode: 0
      })
    }));

    vi.mocked(applyMiddlewares).mockImplementation(async (_middlewares, ctx) => {
      ctx.sessionResult = {
        output: "done",
        messages: ["done"],
        toolCalls: [
          {
            id: "call-1",
            title: "mcp__superintendent-tools__workflow.transition",
            input: { action: "request_review", summary: "ready" }
          }
        ]
      };
    });

    const { result } = spawn("codex", "test prompt");

    await expect(result).resolves.toMatchObject({
      sessionResult: {
        toolCalls: [
          expect.objectContaining({
            title: "mcp__superintendent-tools__workflow.transition",
            input: { action: "request_review", summary: "ready" }
          })
        ]
      }
    });
  });

  it("accepts deprecated mcpConfig as the SDK option name", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const { result } = spawn("codex", "test prompt", {
      mcpConfig: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });

    await result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: {
          test: {
            command: "tiny-stdio-mcp-test-server",
            args: ["serve", "word-of-the-day"]
          }
        }
      })
    );
  });

  it("passes deprecated mcpConfig to native ACP agents", async () => {
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      agentId: "opencode",
      supportsMcpServers: true
    } as any);

    vi.mocked(spawnAcp).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const { result } = spawn("opencode", "test prompt", {
      mcpConfig: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });

    await result;

    expect(spawnAcp).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: {
          test: {
            command: "tiny-stdio-mcp-test-server",
            args: ["serve", "word-of-the-day"]
          }
        }
      })
    );
  });

  it("prefers mcpServers over the deprecated mcpConfig alias", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const { result } = spawn("codex", "test prompt", {
      mcpServers: {
        preferred: {
          command: "preferred-server"
        }
      },
      mcpConfig: {
        deprecated: {
          command: "deprecated-server"
        }
      }
    });

    await result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: {
          preferred: {
            command: "preferred-server"
          }
        }
      })
    );
  });

  it("falls back to agent-spawn non-streaming and returns empty events when no adapter", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "aider",
      promptFlag: "-p",
      defaultArgs: []
    } as any);

    vi.mocked(agentSpawn).mockResolvedValue({
      stdout: "out",
      stderr: "err",
      exitCode: 0
    });

    const { events, result } = spawn("aider", "test prompt", {
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server"
        }
      }
    });

    const received: unknown[] = [];
    for await (const e of events) {
      received.push(e);
    }

    expect(received).toEqual([]);
    await expect(result).resolves.toEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 0
    });

    expect(spawnStreaming).not.toHaveBeenCalled();
    expect(agentSpawn).toHaveBeenCalledTimes(1);
    expect(agentSpawn).toHaveBeenCalledWith("aider", {
      prompt: "test prompt",
      cwd: undefined,
      model: undefined,
      mode: DEFAULT_SPAWN_MODE,
      args: undefined,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server"
        }
      },
      useStdin: false
    });
    expect(spawnCore).not.toHaveBeenCalled();
    expect(createSdkContainer).toHaveBeenCalledTimes(1);
  });

  it("passes active skills through to non-streaming agent spawns", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "aider",
      promptFlag: "-p",
      defaultArgs: []
    } as any);
    vi.mocked(agentSpawn).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const { result } = spawn("aider", "test prompt", {
      skills: ["foo"]
    });

    await result;

    expect(agentSpawn).toHaveBeenCalledWith(
      "aider",
      expect.objectContaining({
        skills: ["foo"]
      })
    );
  });

  it("passes bridged hooks through to non-streaming agent spawns", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "aider",
      promptFlag: "-p",
      defaultArgs: []
    } as any);
    vi.mocked(agentSpawn).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const { result } = spawn("aider", "test prompt", {
      hooks: { from: "claude-code" }
    });

    await result;

    expect(agentSpawn).toHaveBeenCalledWith(
      "aider",
      expect.objectContaining({
        hooks: { from: "claude-code" }
      })
    );
  });

  it("forwards signal to spawnStreaming when supported", async () => {
    const signal = new AbortController().signal;

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt", { signal });
    await result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        signal
      })
    );
  });

  it("propagates usage from agent-spawn non-streaming result when no adapter", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "aider",
      promptFlag: "-p",
      defaultArgs: []
    } as any);

    vi.mocked(agentSpawn).mockResolvedValue({
      stdout: "out",
      stderr: "err",
      exitCode: 0,
      usage: { inputTokens: 6, outputTokens: 4, cachedTokens: 2 }
    });

    const { events, result } = spawn("aider", "test prompt");

    const received: unknown[] = [];
    for await (const e of events) {
      received.push(e);
    }

    expect(received).toEqual([]);
    await expect(result).resolves.toEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 0,
      usage: { inputTokens: 6, outputTokens: 4, cachedTokens: 2 }
    });
  });

  it("falls back to non-streaming and returns empty events when unsupported", async () => {
    vi.mocked(createSdkContainer).mockReturnValue({
      fs: createMemFs(),
      env: {
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveConfigPath(homeDir),
        variables: {}
      },
      registry: {
        get: vi.fn(() => ({ name: "codex" }))
      }
    } as any);
    vi.mocked(getSpawnConfig).mockReturnValue(undefined);
    vi.mocked(spawnCore).mockResolvedValue({
      stdout: "out",
      stderr: "err",
      exitCode: 0
    });

    const { events, result } = spawn("codex", "test prompt", {
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server"
        }
      }
    });

    const received: unknown[] = [];
    for await (const e of events) {
      received.push(e);
    }

    expect(received).toEqual([]);
    await expect(result).resolves.toEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 0
    });

    expect(spawnStreaming).not.toHaveBeenCalled();
    expect(agentSpawn).not.toHaveBeenCalled();
    expect(spawnCore).toHaveBeenCalledTimes(1);
    expect(spawnCore).toHaveBeenCalledWith(
      expect.anything(),
      "codex",
      expect.objectContaining({
        mcpServers: {
          test: {
            command: "tiny-stdio-mcp-test-server"
          }
        }
      })
    );
  });

  it("ignores the stored configured model for streaming agents", async () => {
    const fs = createMemFs();
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({ models: { codex: "openai/gpt-5.4" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    vi.mocked(createSdkContainer).mockReturnValue({
      fs,
      env: {
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveConfigPath(homeDir),
        variables: {}
      },
      registry: {
        get: vi.fn(() => ({
          name: "codex"
        }))
      }
    } as any);
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt");
    await result;

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        model: undefined
      })
    );
  });

  it("propagates usage from spawnCore non-streaming result when unsupported", async () => {
    vi.mocked(createSdkContainer).mockReturnValue({
      fs: createMemFs(),
      env: {
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveConfigPath(homeDir),
        variables: {}
      },
      registry: {
        get: vi.fn(() => ({ name: "codex" }))
      }
    } as any);
    vi.mocked(getSpawnConfig).mockReturnValue(undefined);
    vi.mocked(spawnCore).mockResolvedValue({
      stdout: "out",
      stderr: "err",
      exitCode: 0,
      usage: { inputTokens: 9, outputTokens: 5 }
    });

    const { events, result } = spawn("codex", "test prompt");

    const received: unknown[] = [];
    for await (const e of events) {
      received.push(e);
    }

    expect(received).toEqual([]);
    await expect(result).resolves.toEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 0,
      usage: { inputTokens: 9, outputTokens: 5 }
    });
  });

  it("calls spawnInteractive and returns empty events when interactive is true", async () => {
    vi.mocked(spawnInteractive).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    const { events, result } = spawn("claude-code", "test prompt", {
      interactive: true,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });

    const received: unknown[] = [];
    for await (const e of events) {
      received.push(e);
    }

    expect(received).toEqual([]);
    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    expect(spawnInteractive).toHaveBeenCalledTimes(1);
    expect(spawnInteractive).toHaveBeenCalledWith("claude-code", {
      prompt: "test prompt",
      cwd: undefined,
      model: undefined,
      mode: DEFAULT_SPAWN_MODE,
      args: undefined,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });
    expect(spawnStreaming).not.toHaveBeenCalled();
    expect(agentSpawn).not.toHaveBeenCalled();
    expect(spawnCore).not.toHaveBeenCalled();
  });

  it("propagates usage from spawnInteractive result", async () => {
    vi.mocked(spawnInteractive).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      usage: { inputTokens: 11, outputTokens: 7, cachedTokens: 3 }
    });

    const { result } = spawn("claude-code", "test prompt", { interactive: true });

    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      usage: { inputTokens: 11, outputTokens: 7, cachedTokens: 3 }
    });
  });

  it("passes options through to spawnInteractive in interactive mode", async () => {
    vi.mocked(spawnInteractive).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 42
    });

    const { result } = spawn("codex", {
      prompt: "fix bug",
      interactive: true,
      cwd: "/tmp/project",
      model: "gpt-4",
      args: ["--extra"]
    });

    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 42
    });

    expect(spawnInteractive).toHaveBeenCalledWith("codex", {
      prompt: "fix bug",
      cwd: "/tmp/project",
      model: "gpt-4",
      mode: DEFAULT_SPAWN_MODE,
      args: ["--extra"]
    });
  });

  it("resolves an omitted mode before workspace and streaming dispatch", async () => {
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "inspect the repo", {
      cwd: "github://poe-platform/poe-code"
    });

    await result;

    expect(resolveWorkspace).toHaveBeenCalledWith(
      "github://poe-platform/poe-code",
      expect.objectContaining({ mode: DEFAULT_SPAWN_MODE })
    );
    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ mode: DEFAULT_SPAWN_MODE })
    );
  });

  it("resolves workspace locators before spawning streaming agents", async () => {
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const { result } = spawn("codex", "inspect the repo", {
      cwd: "github://poe-platform/poe-code",
      mode: "read"
    });

    await result;

    expect(resolveWorkspace).toHaveBeenCalledWith(
      "github://poe-platform/poe-code",
      expect.objectContaining({
        mode: "read"
      })
    );
    expect(createSdkContainer).toHaveBeenCalledWith({ cwd: "/tmp/workspaces/poe-code" });
    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/workspaces/poe-code"
      })
    );
  });

  it("cleans up writable resolved workspaces after the spawn completes", async () => {
    const cleanup = vi.fn(async () => {});
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      cleanup,
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const { result } = spawn("codex", "inspect the repo", {
      cwd: "github://poe-platform/poe-code",
      mode: "edit"
    });

    await result;

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("preserves successful streaming output when workspace cleanup fails", async () => {
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      cleanup: vi.fn(async () => {
        throw new Error("workspace cleanup denied");
      }),
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "done", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "inspect the repo", {
      cwd: "github://poe-platform/poe-code",
      mode: "edit"
    });

    await expect(result).resolves.toMatchObject({ stdout: "done", stderr: "", exitCode: 0 });
  });

  it("uses normal spawn flow when interactive is false", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt", { interactive: false });

    await result;

    expect(spawnInteractive).not.toHaveBeenCalled();
    expect(spawnStreaming).toHaveBeenCalledTimes(1);
  });

  it("uses ACP spawn flow when an ACP config exists", async () => {
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "opencode",
      acpArgs: ["acp"],
      skipAuth: true
    } as any);

    const unstableSetSessionModel = vi.fn(async () => undefined);
    vi.mocked(spawnAcp).mockImplementation(() => ({
      events: (async function* () {
        yield { event: "agent_message", text: "raw acp event" };
      })(),
      done: Promise.resolve({
        stdout: "acp out",
        stderr: "",
        exitCode: 0,
        threadId: "thread_acp"
      }),
      unstable_setSessionModel: unstableSetSessionModel
    }));

    vi.mocked(applyMiddlewares).mockImplementation(async (_middlewares, ctx) => {
      ctx.threadId = "thread_via_acp_middleware";
      ctx.eventStream = (async function* () {
        yield { event: "agent_message", text: "from acp middleware" };
      })();
    });

    const { events, result, unstable_setSessionModel } = spawn("opencode", "test prompt", {
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server"
        }
      }
    });

    const received: unknown[] = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toEqual([{ event: "agent_message", text: "from acp middleware" }]);
    await expect(result).resolves.toEqual({
      stdout: "acp out",
      stderr: "",
      exitCode: 0,
      threadId: "thread_via_acp_middleware"
    });
    await unstable_setSessionModel?.("gemini-3-pro");
    expect(unstableSetSessionModel).toHaveBeenCalledWith("gemini-3-pro");

    expect(spawnAcp).toHaveBeenCalledWith({
      agentId: "opencode",
      prompt: "test prompt",
      cwd: undefined,
      model: undefined,
      mode: DEFAULT_SPAWN_MODE,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server"
        }
      },
      signal: undefined
    });
    expect(spawnStreaming).not.toHaveBeenCalled();
    expect(agentSpawn).not.toHaveBeenCalled();
    expect(spawnCore).not.toHaveBeenCalled();
  });

  it("resolves workspace locators before spawning ACP agents", async () => {
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code/packages/auth",
      locator: {
        scheme: "github",
        owner: "poe-platform",
        repo: "poe-code",
        ref: "main",
        subdir: "packages/auth"
      }
    });
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "opencode",
      acpArgs: ["acp"],
      skipAuth: true
    } as any);
    vi.mocked(spawnAcp).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const { result } = spawn("opencode", "inspect auth", {
      cwd: "github://poe-platform/poe-code#main:packages/auth",
      mode: "read"
    });

    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    expect(resolveWorkspace).toHaveBeenCalledWith(
      "github://poe-platform/poe-code#main:packages/auth",
      expect.objectContaining({
        mode: "read"
      })
    );
    expect(createSdkContainer).toHaveBeenCalledWith({
      cwd: "/tmp/workspaces/poe-code/packages/auth"
    });
    expect(spawnAcp).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "opencode",
        prompt: "inspect auth",
        cwd: "/tmp/workspaces/poe-code/packages/auth",
        mode: "read"
      })
    );
    expect(applyMiddlewares).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyMiddlewares).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        agent: "opencode",
        prompt: "inspect auth",
        cwd: "/tmp/workspaces/poe-code/packages/auth",
        mode: "read"
      })
    );
  });

  it("merges caller environment over isolated ACP environment", async () => {
    vi.mocked(createSdkContainer).mockReturnValue({
      fs: createMemFs(),
      env: {
        cwd: "/repo",
        homeDir,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveConfigPath(homeDir),
        variables: {},
        getVariable: () => undefined,
        resolveHomePath: (...segments: string[]) => [homeDir, ...segments].join("/")
      },
      registry: {
        get: vi.fn(() => ({
          name: "gemini-cli",
          isolatedEnv: {
            agentBinary: "gemini",
            requiresConfig: false,
            env: { GEMINI_CLI_HOME: { kind: "isolatedDir" } }
          }
        }))
      },
      providerRegistry: {
        forAgent: vi.fn(() => []),
        isLoggedIn: vi.fn(async () => false)
      }
    } as any);
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "gemini-cli",
      acpArgs: ["--acp"],
      skipAuth: true
    } as any);
    vi.mocked(spawnAcp).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    await spawn("gemini-cli", "test", {
      env: { GEMINI_CLI_HOME: "/caller/home", WORKSPACE_ID: "workspace-1" }
    }).result;

    expect(spawnAcp).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          GEMINI_CLI_HOME: "/caller/home",
          WORKSPACE_ID: "workspace-1"
        })
      })
    );
  });

  it("does not require Poe credentials before resolving a non-Poe ACP provider", async () => {
    delete process.env.POE_API_KEY;
    const variables: Record<string, string> = {
      CF_AIG_TOKEN: "cf-token",
      CF_AIG_BASE_URL: "https://gateway.example.test"
    };
    const providerRegistry = {
      forAgent: vi.fn(() => [cloudflareProvider]),
      resolveCredential: vi.fn(async () => variables.CF_AIG_TOKEN)
    };
    const registry = {
      get: vi.fn((name: string) =>
        name === "opencode"
          ? {
              name: "opencode",
              label: "OpenCode",
              isolatedEnv: {
                agentBinary: "opencode",
                configProbe: { kind: "isolatedFile", relativePath: "config.json" },
                env: {
                  XDG_CONFIG_HOME: { kind: "isolatedDir", relativePath: ".config" }
                }
              }
            }
          : undefined
      )
    };
    vi.mocked(createSdkContainer).mockReturnValue({
      fs: createMemFs(),
      env: {
        cwd: "/repo",
        homeDir,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveConfigPath(homeDir),
        variables,
        getVariable: (name: string) => variables[name],
        resolveHomePath: (...segments: string[]) => [homeDir, ...segments].join("/")
      },
      registry,
      providerRegistry
    } as any);
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "opencode",
      acpArgs: ["acp"],
      skipAuth: true
    } as any);
    vi.mocked(spawnAcp).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const { result } = spawn("opencode", "inspect auth");

    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    expect(process.env.POE_API_KEY).toBeUndefined();
    expect(providerRegistry.resolveCredential).toHaveBeenCalledWith(
      "cloudflare",
      undefined,
      expect.objectContaining({ envVars: variables })
    );
    expect(spawnAcp).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "opencode",
        env: expect.objectContaining({
          ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer cf-token",
          XDG_CONFIG_HOME: "/home/test/.poe-code/opencode/.config"
        })
      })
    );
  });

  it("uses CLI streaming for ACP agents that do not support MCP over ACP", async () => {
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "kimi",
      acpArgs: ["acp"],
      supportsMcpServers: false
    } as any);
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "kimi",
      adapter: "kimi"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("kimi", "test prompt", {
      mcpServers: {
        test: { command: "tiny-stdio-mcp-test-server" }
      }
    });

    await result;

    expect(spawnAcp).not.toHaveBeenCalled();
    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "kimi",
        mcpServers: {
          test: { command: "tiny-stdio-mcp-test-server" }
        }
      })
    );
  });

  it("uses runtime-aware streaming flow when ACP agents receive runtime overrides", async () => {
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "opencode",
      acpArgs: ["acp"],
      skipAuth: true
    } as any);
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "opencode",
      adapter: "opencode"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield { event: "agent_message", text: "streamed" };
      })(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    const { events, result } = spawn("opencode", "test prompt", {
      runtime: "docker",
      runtimeImage: "poe-code:test",
      detach: true,
      mountPoeCode: true
    });

    const received: unknown[] = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toEqual([{ event: "agent_message", text: "streamed" }]);
    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    expect(spawnAcp).not.toHaveBeenCalled();
    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "opencode",
        prompt: "test prompt",
        runtime: "docker",
        runtimeImage: "poe-code:test",
        detach: true,
        mountPoeCode: true
      })
    );
  });

  it("rejects runtime overrides for ACP-only agents instead of running locally", async () => {
    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "gemini-cli",
      acpArgs: ["--acp"],
      skipAuth: true
    } as any);
    vi.mocked(getSpawnConfig).mockReturnValue(undefined);

    const { result } = spawn("gemini-cli", "test prompt", {
      runtime: "docker",
      detach: true
    });

    await expect(result).rejects.toThrow(
      'Agent "gemini-cli" does not support runtime overrides because it has no CLI spawn configuration.'
    );
    expect(spawnAcp).not.toHaveBeenCalled();
    expect(spawnStreaming).not.toHaveBeenCalled();
  });

  it("composes ACP middlewares in SDK streaming path", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield { event: "agent_message", text: "raw" };
      })(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    vi.mocked(applyMiddlewares).mockImplementation(async (_middlewares, ctx) => {
      ctx.threadId = "thread_via_middleware";
      ctx.eventStream = (async function* () {
        yield { event: "agent_message", text: "from middleware" };
      })();
    });

    const { events, result } = spawn("codex", "test prompt");

    const received: unknown[] = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toEqual([{ event: "agent_message", text: "from middleware" }]);
    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      threadId: "thread_via_middleware"
    });

    expect(applyMiddlewares).toHaveBeenCalledTimes(1);
    const [middlewares, ctx] = vi.mocked(applyMiddlewares).mock.calls[0];
    expect(middlewares).toEqual([sessionCapture, usageCapture, spawnLog]);
    expect(ctx.logDir).toBeUndefined();
    expect(ctx).toEqual(
      expect.objectContaining({
        sessionId: expect.any(String),
        agent: "codex",
        events: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        prompt: "test prompt",
        model: undefined,
        mode: DEFAULT_SPAWN_MODE,
        cwd: undefined,
        startedAt: expect.any(Date)
      })
    );
  });

  it("forwards logDir to middleware context in SDK streaming path", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt", {
      logDir: "/repo/.poe-code/pipeline/plans/logs/task-1-implement.jsonl"
    });

    await result;

    expect(applyMiddlewares).toHaveBeenCalledTimes(1);
    const [, ctx] = vi.mocked(applyMiddlewares).mock.calls[0];
    expect(ctx.logDir).toBe("/repo/.poe-code/pipeline/plans/logs/task-1-implement.jsonl");
  });

  it("forwards logContent to middleware context in SDK streaming path", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt", {
      logContent: true
    });

    await result;

    expect(applyMiddlewares).toHaveBeenCalledTimes(1);
    const [, ctx] = vi.mocked(applyMiddlewares).mock.calls[0];
    expect(ctx.logContent).toBe(true);
  });

  it("appends user middlewares after built-in streaming middlewares", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const extraMiddleware = vi.fn();
    const { result } = spawn("codex", "test prompt", {
      middlewares: [extraMiddleware]
    });

    await result;

    expect(applyMiddlewares).toHaveBeenCalledWith(
      [sessionCapture, usageCapture, spawnLog, extraMiddleware],
      expect.any(Object)
    );
  });

  it("prepends integrations.spawnMiddleware loaded from config in streaming path", async () => {
    const integrationMiddleware = vi.fn();
    const shutdown = vi.fn(async () => {});
    loadIntegrationsMock.mockResolvedValue({
      spawnMiddleware: integrationMiddleware,
      shutdown
    });

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const userMiddleware = vi.fn();
    const { result } = spawn("codex", "test prompt", {
      middlewares: [userMiddleware]
    });

    await result;

    expect(loadIntegrationsMock).toHaveBeenCalledTimes(1);
    expect(applyMiddlewares).toHaveBeenCalledWith(
      [sessionCapture, usageCapture, spawnLog, integrationMiddleware, userMiddleware],
      expect.any(Object)
    );
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("prepends integrations.spawnMiddleware in ACP path", async () => {
    const integrationMiddleware = vi.fn();
    const shutdown = vi.fn(async () => {});
    loadIntegrationsMock.mockResolvedValue({
      spawnMiddleware: integrationMiddleware,
      shutdown
    });

    vi.mocked(getAcpSpawnConfig).mockReturnValue({
      kind: "acp",
      agentId: "opencode",
      acpArgs: ["acp"],
      skipAuth: true
    } as any);

    vi.mocked(spawnAcp).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("opencode", "test prompt");
    await result;

    expect(applyMiddlewares).toHaveBeenCalledWith(
      [sessionCapture, usageCapture, spawnLog, integrationMiddleware],
      expect.any(Object)
    );
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("calls integrations.shutdown even when the spawn fails", async () => {
    const shutdown = vi.fn(async () => {});
    loadIntegrationsMock.mockResolvedValue({
      spawnMiddleware: vi.fn(),
      shutdown
    });

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.reject(new Error("boom"))
    }));

    const { result } = spawn("codex", "test prompt");

    await expect(result).rejects.toThrow("boom");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("preserves successful streaming output when integration shutdown fails", async () => {
    loadIntegrationsMock.mockResolvedValue({
      spawnMiddleware: vi.fn(),
      shutdown: vi.fn(async () => {
        throw new Error("integration shutdown denied");
      })
    });
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "done", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt");

    await expect(result).resolves.toMatchObject({ stdout: "done", stderr: "", exitCode: 0 });
  });

  it("does not modify middleware chain when loadIntegrations returns null", async () => {
    loadIntegrationsMock.mockResolvedValue(null);

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt");
    await result;

    expect(applyMiddlewares).toHaveBeenCalledWith(
      [sessionCapture, usageCapture, spawnLog],
      expect.any(Object)
    );
  });

  it("forwards an explicitly empty logDir to middleware context", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt", {
      logDir: ""
    });

    await result;

    expect(applyMiddlewares).toHaveBeenCalledTimes(1);
    const [, ctx] = vi.mocked(applyMiddlewares).mock.calls[0];
    expect(ctx.logDir).toBe("");
  });

  it("resolves events and rejects result when middleware composition fails", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield { event: "agent_message", text: "raw event" };
      })(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    vi.mocked(applyMiddlewares).mockRejectedValue(new Error("middleware failed"));

    const { events, result } = spawn("codex", "test prompt");

    const received: unknown[] = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toEqual([]);
    await expect(result).rejects.toThrow("middleware failed");
  });

  it("propagates errors from spawnInteractive", async () => {
    vi.mocked(spawnInteractive).mockRejectedValue(
      new Error('Agent "unknown" does not support interactive mode.')
    );

    const { events, result } = spawn("unknown", "test prompt", { interactive: true });

    const received: unknown[] = [];
    for await (const e of events) {
      received.push(e);
    }

    expect(received).toEqual([]);
    await expect(result).rejects.toThrow("does not support interactive mode");
  });

  it("propagates usage from streaming done result", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "done",
        stderr: "",
        exitCode: 0,
        threadId: "thread_usage",
        usage: { inputTokens: 33, outputTokens: 12, cachedTokens: 4 }
      })
    }));

    const { result } = spawn("codex", "test prompt");

    await expect(result).resolves.toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0,
      threadId: "thread_usage",
      usage: { inputTokens: 33, outputTokens: 12, cachedTokens: 4 }
    });
  });
});

describe("SDK spawn.retry()", () => {
  it("does not retry when the first attempt succeeds", async () => {
    configureStreamingAttempts([
      {
        events: [{ event: "agent_message", text: "done" }],
        result: { stdout: "ok", stderr: "", exitCode: 0 }
      }
    ]);

    const { events, result } = spawn.retry(
      "codex",
      { prompt: "test prompt" },
      { maxAttempts: 3, backoffMs: 1 }
    );
    const eventsPromise = collectEvents(events);

    await expect(result).resolves.toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    await expect(eventsPromise).resolves.toEqual([
      { event: "agent_message", text: "attempt: 1 done" }
    ]);
    expect(spawnStreaming).toHaveBeenCalledTimes(1);
  });

  it("retries retryable failures and returns the successful final result", async () => {
    configureStreamingAttempts([
      {
        events: [{ event: "agent_message", text: "first" }],
        result: { stdout: "", stderr: "failed", exitCode: 1 }
      },
      {
        events: [{ event: "agent_message", text: "second" }],
        result: { stdout: "ok", stderr: "", exitCode: 0 }
      }
    ]);

    const { events, result } = spawn.retry(
      "codex",
      { prompt: "test prompt" },
      { maxAttempts: 2, backoffMs: 1 }
    );
    const eventsPromise = collectEvents(events);

    await expect(result).resolves.toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    await expect(eventsPromise).resolves.toEqual([
      { event: "agent_message", text: "attempt: 1 first" },
      { event: "agent_message", text: "attempt: 1 wait 1ms before retry" },
      { event: "agent_message", text: "attempt: 2 second" }
    ]);
    expect(spawnStreaming).toHaveBeenCalledTimes(2);
  });

  it("returns the last failed result after all attempts fail", async () => {
    configureStreamingAttempts([
      { result: { stdout: "first", stderr: "", exitCode: 1 } },
      { result: { stdout: "second", stderr: "", exitCode: 124 } },
      { result: { stdout: "third", stderr: "last", exitCode: 137 } }
    ]);

    const { result } = spawn.retry(
      "codex",
      { prompt: "test prompt" },
      { maxAttempts: 3, backoffMs: 1 }
    );

    await expect(result).resolves.toEqual({ stdout: "third", stderr: "last", exitCode: 137 });
    expect(spawnStreaming).toHaveBeenCalledTimes(3);
  });

  it.each([130, 143])("does not retry non-retryable exit code %s", async (exitCode) => {
    configureStreamingAttempts([
      { result: { stdout: "", stderr: "interrupted", exitCode } },
      { result: { stdout: "unexpected", stderr: "", exitCode: 0 } }
    ]);

    const { result } = spawn.retry(
      "codex",
      { prompt: "test prompt" },
      { maxAttempts: 2, backoffMs: 1 }
    );

    await expect(result).resolves.toEqual({ stdout: "", stderr: "interrupted", exitCode });
    expect(spawnStreaming).toHaveBeenCalledTimes(1);
  });

  it("honors custom retry predicates", async () => {
    configureStreamingAttempts([
      { result: { stdout: "", stderr: "failed", exitCode: 1 } },
      { result: { stdout: "unexpected", stderr: "", exitCode: 0 } }
    ]);

    const { result } = spawn.retry(
      "codex",
      { prompt: "test prompt" },
      { maxAttempts: 2, backoffMs: 1, isRetryable: () => false }
    );

    await expect(result).resolves.toEqual({ stdout: "", stderr: "failed", exitCode: 1 });
    expect(spawnStreaming).toHaveBeenCalledTimes(1);
  });

  it("emits wait markers and waits for exponential backoff delays", async () => {
    configureStreamingAttempts([
      { result: { stdout: "", stderr: "failed", exitCode: 1 } },
      { result: { stdout: "", stderr: "failed again", exitCode: 1 } },
      { result: { stdout: "ok", stderr: "", exitCode: 0 } }
    ]);

    const startedAt = Date.now();
    const { events, result } = spawn.retry(
      "codex",
      { prompt: "test prompt" },
      { maxAttempts: 3, backoffMs: 10 }
    );
    const eventsPromise = collectEvents(events);

    await expect(result).resolves.toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30);
    await expect(eventsPromise).resolves.toEqual([
      { event: "agent_message", text: "attempt: 1 wait 10ms before retry" },
      { event: "agent_message", text: "attempt: 2 wait 20ms before retry" }
    ]);
  });

  it("rejects on abort during backoff and does not start another attempt", async () => {
    configureStreamingAttempts([
      { result: { stdout: "", stderr: "failed", exitCode: 1 } },
      { result: { stdout: "unexpected", stderr: "", exitCode: 0 } }
    ]);
    const controller = new AbortController();

    const { events, result } = spawn.retry(
      "codex",
      { prompt: "test prompt", signal: controller.signal },
      { maxAttempts: 2, backoffMs: 50 }
    );
    const eventsPromise = collectEvents(events).catch(() => []);
    setTimeout(() => controller.abort(), 5);

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    await eventsPromise;
    expect(spawnStreaming).toHaveBeenCalledTimes(1);
  });
});

describe("spawn.pretty()", () => {
  it("renders events and returns the result", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield { event: "agent_message", text: "done" };
      })(),
      done: Promise.resolve({
        stdout: "out",
        stderr: "",
        exitCode: 0,
        threadId: "t1"
      })
    }));

    const result = await spawn.pretty("codex", "test prompt");

    expect(renderAcpStream).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      stdout: "out",
      stderr: "",
      exitCode: 0,
      threadId: "t1"
    });
  });

  it("accepts options object overload", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const result = await spawn.pretty("codex", { prompt: "fix bug", model: "gpt-4" });

    expect(renderAcpStream).toHaveBeenCalledTimes(1);
    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "fix bug", model: "gpt-4" })
    );
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

describe("spawn.autonomous()", () => {
  it("retries timeout errors with the default activity timeout and returns the retry result", async () => {
    const timeoutError = createActivityTimeoutError();

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming)
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        done: Promise.reject(timeoutError)
      }))
      .mockImplementationOnce(() => ({
        events: (async function* () {})(),
        done: Promise.resolve({
          stdout: "retry-ok",
          stderr: "",
          exitCode: 0,
          threadId: "thread_retry"
        })
      }));

    const result = await spawn.autonomous("codex", "test prompt");

    expect(result).toEqual({
      stdout: "retry-ok",
      stderr: "",
      exitCode: 0,
      threadId: "thread_retry"
    });
    expect(spawnStreaming).toHaveBeenCalledTimes(2);
    expect(spawnStreaming).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        prompt: "test prompt",
        activityTimeoutMs: 10 * 60 * 1000
      })
    );
    expect(spawnStreaming).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: "test prompt",
        activityTimeoutMs: 10 * 60 * 1000
      })
    );
  });

  it("accepts the options overload and custom retry settings", async () => {
    const timeoutError = createActivityTimeoutError();

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.reject(timeoutError)
    }));

    await expect(
      spawn.autonomous("codex", {
        prompt: "custom retry",
        model: "gpt-5.4",
        activityTimeoutMs: 1_234,
        maxTimeoutRetries: 2
      })
    ).rejects.toBe(timeoutError);

    expect(spawnStreaming).toHaveBeenCalledTimes(2);
    expect(spawnStreaming).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        prompt: "custom retry",
        model: "gpt-5.4",
        activityTimeoutMs: 1_234
      })
    );
    expect(spawnStreaming).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: "custom retry",
        model: "gpt-5.4",
        activityTimeoutMs: 1_234
      })
    );
  });

  it("forwards tee and useStdin through autonomous spawns", async () => {
    const tee = {
      stdout: {
        write: vi.fn()
      },
      stderr: {
        write: vi.fn()
      }
    };

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);

    vi.mocked(spawnStreaming).mockImplementationOnce(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    }));

    await spawn.autonomous("codex", {
      prompt: "stream through stdin",
      cwd: "/repo",
      useStdin: true,
      tee
    });

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "stream through stdin",
        cwd: "/repo",
        useStdin: true,
        tee
      })
    );
  });

  it("spawns provider-capable agents without consulting Poe credentials", async () => {
    delete process.env.POE_API_KEY;
    vi.mocked(createSdkContainer).mockReturnValue({
      fs: createMemFs(),
      env: {
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveConfigPath(homeDir),
        variables: {}
      },
      registry: {
        get: vi.fn((name: string) =>
          name === "codex"
            ? {
                name: "codex",
                label: "Codex",
                requiresProvider: true
              }
            : undefined
        )
      }
    } as any);

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt");
    await expect(result).resolves.toEqual({ stdout: "", stderr: "", exitCode: 0 });

    expect(process.env.POE_API_KEY).toBeUndefined();
  });

  it("does not overwrite POE_API_KEY when it is already exported", async () => {
    process.env.POE_API_KEY = "exported-key";

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    } as any);
    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt");
    await result;

    expect(process.env.POE_API_KEY).toBe("exported-key");
  });

  it("does not export stored credentials when the service is unknown", async () => {
    delete process.env.POE_API_KEY;
    vi.mocked(getSpawnConfig).mockReturnValue(undefined);

    const { result } = spawn("unknown", "test prompt");

    await expect(result).rejects.toThrow(/^Unknown agent "unknown"\. Agents supporting spawn: /);
    expect(process.env.POE_API_KEY).toBeUndefined();
  });

  it("does not export stored credentials when interactive service validation fails", async () => {
    delete process.env.POE_API_KEY;
    vi.mocked(getSpawnConfig).mockReturnValue(undefined);
    vi.mocked(spawnInteractive).mockRejectedValue(
      new Error('Agent "unknown" has no spawn config.')
    );

    const { result } = spawn("unknown", "test prompt", { interactive: true });

    await expect(result).rejects.toThrow('Agent "unknown" has no spawn config.');
    expect(process.env.POE_API_KEY).toBeUndefined();
  });
});
