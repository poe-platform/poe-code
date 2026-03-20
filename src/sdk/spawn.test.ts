import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const applyMiddlewaresMock = vi.hoisted(() => vi.fn());
const sessionCaptureMock = vi.hoisted(() => vi.fn());
const usageCaptureMock = vi.hoisted(() => vi.fn());
const spawnLogMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-spawn", () => ({
  spawn: vi.fn(),
  spawnStreaming: vi.fn(),
  spawnInteractive: vi.fn(),
  getSpawnConfig: vi.fn(),
  renderAcpStream: vi.fn(),
  applyMiddlewares: applyMiddlewaresMock,
  sessionCapture: sessionCaptureMock,
  usageCapture: usageCaptureMock,
  spawnLog: spawnLogMock
}));

vi.mock("./spawn-core.js", () => ({
  spawnCore: vi.fn()
}));

vi.mock("./container.js", () => ({
  createSdkContainer: vi.fn()
}));

import { spawn } from "./spawn.js";
import {
  getSpawnConfig,
  spawn as agentSpawn,
  spawnStreaming,
  spawnInteractive,
  renderAcpStream,
  applyMiddlewares,
  sessionCapture,
  usageCapture,
  spawnLog
} from "@poe-code/agent-spawn";
import { spawnCore } from "./spawn-core.js";
import { createSdkContainer } from "./container.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv, POE_API_KEY: "test-key" };
  vi.mocked(spawnStreaming).mockReset();
  vi.mocked(spawnInteractive).mockReset();
  vi.mocked(agentSpawn).mockReset();
  vi.mocked(getSpawnConfig).mockReset();
  vi.mocked(spawnCore).mockReset();
  vi.mocked(createSdkContainer).mockReset();
  vi.mocked(renderAcpStream).mockReset();
  vi.mocked(applyMiddlewares).mockReset();
  vi.mocked(renderAcpStream).mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("SDK spawn()", () => {
  it("returns events and result from spawnStreaming() when supported", async () => {
    const event = { event: "agent_message", text: "hello" };

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    });

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield event;
      })(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0, threadId: "thread_1", sessionId: "thread_1" })
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
      threadId: "thread_1",
      sessionId: "thread_1"
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
      mode: undefined,
      args: undefined,
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server"
        }
      },
      useStdin: false
    });
    expect(spawnCore).not.toHaveBeenCalled();
    expect(createSdkContainer).not.toHaveBeenCalled();
  });

  it("forwards signal to spawnStreaming when supported", async () => {
    const signal = new AbortController().signal;

    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    });
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

  it("falls back to non-streaming and returns empty events when unsupported", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue(undefined);
    vi.mocked(createSdkContainer).mockReturnValue({} as any);
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
      args: ["--extra"]
    });
  });

  it("uses normal spawn flow when interactive is false", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    });

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    const { result } = spawn("codex", "test prompt", { interactive: false });

    await result;

    expect(spawnInteractive).not.toHaveBeenCalled();
    expect(spawnStreaming).toHaveBeenCalledTimes(1);
  });

  it("composes ACP middlewares in SDK streaming path", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    });

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield { event: "agent_message", text: "raw" };
      })(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    }));

    vi.mocked(applyMiddlewares).mockImplementation(async (_middlewares, ctx) => {
      ctx.threadId = "thread_via_middleware";
      ctx.sessionId = "thread_via_middleware";
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
      threadId: "thread_via_middleware",
      sessionId: "thread_via_middleware"
    });

    expect(applyMiddlewares).toHaveBeenCalledTimes(1);
    const [middlewares, ctx] = vi.mocked(applyMiddlewares).mock.calls[0];
    expect(middlewares).toEqual([sessionCapture, usageCapture, spawnLog]);
    expect(ctx).toEqual(
      expect.objectContaining({
        sessionId: expect.any(String),
        agent: "codex",
        events: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        prompt: "test prompt",
        model: undefined,
        mode: undefined,
        cwd: undefined,
        startedAt: expect.any(Date)
      })
    );
  });

  it("resolves events and rejects result when middleware composition fails", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    });

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

  it("propagates provider spawn errors for poe-agent and returns empty events", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue(undefined);
    vi.mocked(createSdkContainer).mockReturnValue({} as any);
    vi.mocked(spawnCore).mockRejectedValue(
      new Error("Poe Agent does not support spawn.")
    );

    const { events, result } = spawn("poe-agent", "test prompt", {
      cwd: "/workspace/project",
      model: "anthropic/claude-opus-4.6",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });

    const received: unknown[] = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toEqual([]);
    await expect(result).rejects.toThrow("does not support spawn");
    expect(spawnStreaming).not.toHaveBeenCalled();
    expect(agentSpawn).not.toHaveBeenCalled();
    expect(spawnCore).not.toHaveBeenCalled();
    expect(createSdkContainer).not.toHaveBeenCalled();
  });

  it("propagates usage from poe-agent ACP result", async () => {
    vi.mocked(spawnPoeAgentWithAcp).mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "from poe-agent\n",
        stderr: "",
        exitCode: 0,
        threadId: "poe-agent-session-usage",
        sessionId: "poe-agent-session-usage",
        usage: { inputTokens: 101, outputTokens: 55, cachedTokens: 8 }
      })
    });

    const { result } = spawn("poe-agent", "test prompt");

    await expect(result).resolves.toEqual({
      stdout: "from poe-agent\n",
      stderr: "",
      exitCode: 0,
      threadId: "poe-agent-session-usage",
      sessionId: "poe-agent-session-usage",
      usage: { inputTokens: 101, outputTokens: 55, cachedTokens: 8 }
    });
  });

  it("forwards mcpServers to poe-agent ACP runtime", async () => {
    vi.mocked(spawnPoeAgentWithAcp).mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "from poe-agent\n",
        stderr: "",
        exitCode: 0,
        threadId: "poe-agent-session-2",
        sessionId: "poe-agent-session-2"
      })
    });

    const { result } = spawn("poe-agent", "test prompt", {
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    );
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
    });

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {})(),
      done: Promise.resolve({
        stdout: "done",
        stderr: "",
        exitCode: 0,
        threadId: "thread_usage",
        sessionId: "thread_usage",
        usage: { inputTokens: 33, outputTokens: 12, cachedTokens: 4 }
      })
    }));

    const { result } = spawn("codex", "test prompt");

    await expect(result).resolves.toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0,
      threadId: "thread_usage",
      sessionId: "thread_usage",
      usage: { inputTokens: 33, outputTokens: 12, cachedTokens: 4 }
    });
  });
});

describe("spawn.pretty()", () => {
  it("renders events and returns the result", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    });

    vi.mocked(spawnStreaming).mockImplementation(() => ({
      events: (async function* () {
        yield { event: "agent_message", text: "done" };
      })(),
      done: Promise.resolve({ stdout: "out", stderr: "", exitCode: 0, threadId: "t1", sessionId: "t1" })
    }));

    const result = await spawn.pretty("codex", "test prompt");

    expect(renderAcpStream).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      stdout: "out",
      stderr: "",
      exitCode: 0,
      threadId: "t1",
      sessionId: "t1"
    });
  });

  it("accepts options object overload", async () => {
    vi.mocked(getSpawnConfig).mockReturnValue({
      kind: "cli",
      agentId: "codex",
      adapter: "codex"
    });

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
