import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough, Readable } from "node:stream";
import { EventEmitter } from "node:events";
import {
  spawn as spawnChildProcess,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import {
  registerExecutionEnvFactory,
  type ExecutionEnvFactory,
  type OpenSpec,
  type RunSpec
} from "@poe-code/agent-harness-tools";

import { readLines } from "./line-reader.js";
import { applyMiddlewares, type AcpMiddleware, type SpawnContext } from "./middleware.js";
import { usageCapture } from "./middlewares/usage-capture.js";
import { spawnAcp } from "./spawn-acp.js";
import { spawnStreaming } from "./spawn.js";
import * as adapterModule from "../adapters/index.js";
import { codexSpawnConfig } from "../configs/codex.js";
import { openCodeSpawnConfig } from "../configs/opencode.js";
import { getMcpArgs } from "../mcp-args.js";
import type { CliSpawnConfig } from "../types.js";

const skillBridgeMock = vi.hoisted(() => ({
  bridgeActiveSkills: vi.fn(),
  cleanupBridgedSkills: vi.fn()
}));

const acpLaunchOrder = vi.hoisted(() => [] as string[]);

vi.mock("toolcraft-design", () => {
  return {
    logger: {
      warn: vi.fn()
    },
    acp: {
      renderAgentMessage: vi.fn(),
      renderToolStart: vi.fn(),
      renderToolComplete: vi.fn(),
      renderReasoning: vi.fn(),
      renderUsage: vi.fn(),
      renderError: vi.fn(),
      getAcpWriter: () => (line: string) => {
        process.stdout.write(`${line}\n`);
      },
      withAcpWriter: async <T>(_writer: (line: string) => void, fn: () => Promise<T>) => fn()
    },
    text: {
      muted: (content: string) => `<muted>${content}</muted>`
    },
    resolveOutputFormat: () => (process.env.OUTPUT_FORMAT === "json" ? "json" : "terminal")
  };
});

vi.mock("@poe-code/agent-skill-config", () => ({
  bridgeActiveSkills: skillBridgeMock.bridgeActiveSkills,
  cleanupBridgedSkills: skillBridgeMock.cleanupBridgedSkills
}));

let lastMockAcpClient: any;
let lastMockAcpClientOptions: any;
let mockPromptNotifications: any[] | null = null;
let mockAcpClientConstructorError: Error | null = null;
let mockNewSession: (() => Promise<{ sessionId: string }>) | null = null;

vi.mock("@poe-code/poe-acp-client", () => {
  const initResponse = { protocolVersion: 1 };
  const newSessionResponse = { sessionId: "ses_test_123" };

  const defaultNotifications = [
    {
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello " }
        }
      }
    },
    {
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "world!" }
        }
      }
    }
  ];

  class MockAcpClient {
    initialize = vi.fn().mockResolvedValue(initResponse);
    newSession = vi.fn().mockImplementation(() =>
      mockNewSession ? mockNewSession() : Promise.resolve(newSessionResponse)
    );
    loadSession = vi.fn().mockImplementation((sessionId: string) => {
      return Promise.resolve({ sessionId });
    });
    prompt = vi.fn().mockImplementation(() => {
      const notifications = mockPromptNotifications ?? defaultNotifications;

      return {
        response: Promise.resolve({ stopReason: "completed" }),
        [Symbol.asyncIterator]: async function* () {
          for (const n of notifications) yield n;
        }
      };
    });
    cancelSession = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn().mockResolvedValue(undefined);
    constructor(options: unknown) {
      acpLaunchOrder.push("client");
      if (mockAcpClientConstructorError) {
        throw mockAcpClientConstructorError;
      }
      lastMockAcpClientOptions = options;
      lastMockAcpClient = this; // eslint-disable-line @typescript-eslint/no-this-alias
    }
  }

  return { AcpClient: MockAcpClient };
});

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
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

function stripMeta<T>(events: T[]): T[] {
  return events.map((event) => {
    if (event && typeof event === "object") {
      const { _meta: _ignored, ...rest } = event as Record<string, unknown>;
      void _ignored;
      return rest as T;
    }
    return event;
  });
}

// --- line-reader helpers ---

// --- middleware helpers ---

function createContext(overrides: Partial<SpawnContext> = {}): SpawnContext {
  return {
    sessionId: "",
    agent: "codex",
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    },
    ...overrides
  };
}

// --- renderer helpers ---

function captureStdout(run: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as unknown as typeof process.stdout.write);

  try {
    run();
  } finally {
    spy.mockRestore();
  }

  return chunks.join("");
}

// --- spawn helpers ---

interface MockChildProcessOptions {
  stdoutLines?: string[];
  stderr?: string;
  exitCode?: number;
  autoClose?: boolean;
  error?: Error;
}

function createMockChildProcess(options: MockChildProcessOptions = {}): {
  child: ChildProcessWithoutNullStreams;
  stdin: PassThrough;
  getStdin(): string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();

  let stdinBuffer = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    stdinBuffer += String(chunk);
  });

  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  const childStreams = child as unknown as {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  childStreams.stdin = stdin;
  childStreams.stdout = stdout;
  childStreams.stderr = stderr;
  childStreams.kill = () => {
    stdout.end();
    stderr.end();
    child.emit("close", 1, "SIGTERM");
    return true;
  };

  const exitCode = options.exitCode ?? 0;
  const lines = options.stdoutLines ?? [];
  const errorOutput = options.stderr ?? "";
  const error = options.error;

  if (options.autoClose !== false) {
    setImmediate(() => {
      for (const line of lines) {
        stdout.write(`${line}\n`, "utf8");
      }
      stdout.end();

      if (errorOutput) {
        stderr.write(errorOutput, "utf8");
      }
      stderr.end();

      if (error) {
        child.emit("error", error);
        return;
      }

      child.emit("close", exitCode, null);
    });
  }

  return { child, stdin, getStdin: () => stdinBuffer };
}

// ============================================================
// line-reader tests
// ============================================================

describe("acp/readLines", () => {
  it("yields nothing for an empty stream", async () => {
    const stream = Readable.from([]);
    await expect(collect(readLines(stream))).resolves.toEqual([]);
  });

  it("yields a single line at end when there are no newlines", async () => {
    const stream = Readable.from(["hello"]);
    await expect(collect(readLines(stream))).resolves.toEqual(["hello"]);
  });

  it("buffers chunks and yields complete lines split on \\n", async () => {
    const stream = Readable.from(["hel", "lo\nwor", "ld\nx"]);
    await expect(collect(readLines(stream))).resolves.toEqual(["hello", "world", "x"]);
  });

  it("preserves multibyte UTF-8 characters split across chunks", async () => {
    const stream = Readable.from([
      Buffer.from([0x6f, 0x6b, 0x20, 0xf0, 0x9f]),
      Buffer.from([0xa7, 0xaa, 0x0a])
    ]);

    await expect(collect(readLines(stream))).resolves.toEqual(["ok 🧪"]);
  });

  it("throws if the stream errors", async () => {
    const stream = new PassThrough();
    const collected = collect(readLines(stream));

    stream.write("ok\n");
    stream.destroy(new Error("boom"));

    await expect(collected).rejects.toThrow("boom");
  });
});

// ============================================================
// middleware tests
// ============================================================

describe("acp/applyMiddlewares", () => {
  it("runs middlewares in onion order", async () => {
    const steps: string[] = [];
    const context = createContext();

    const first: AcpMiddleware = async (_ctx, next) => {
      steps.push("first:before");
      await next();
      steps.push("first:after");
    };

    const second: AcpMiddleware = async (_ctx, next) => {
      steps.push("second:before");
      await next();
      steps.push("second:after");
    };

    await applyMiddlewares([first, second], context);

    expect(steps).toEqual(["first:before", "second:before", "second:after", "first:after"]);
  });

  it("shares and mutates one context through the middleware chain", async () => {
    const context = createContext({
      prompt: "fix tests",
      model: "openai/gpt-5",
      mode: "yolo",
      cwd: "/tmp/work"
    });

    const first: AcpMiddleware = async (ctx, next) => {
      ctx.sessionId = "session-123";
      ctx.events.push({ event: "session_start", threadId: "session-123" });
      ctx.usage.inputTokens += 10;
      await next();
      ctx.events.push({ event: "agent_message", text: "done" });
    };

    const second: AcpMiddleware = async (ctx, next) => {
      ctx.usage.outputTokens += 4;
      ctx.usage.cachedTokens = 2;
      ctx.usage.costUsd = 0.01;
      await next();
    };

    await applyMiddlewares([first, second], context);

    expect(context).toEqual({
      sessionId: "session-123",
      agent: "codex",
      events: [
        { event: "session_start", threadId: "session-123" },
        { event: "agent_message", text: "done" }
      ],
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cachedTokens: 2,
        costUsd: 0.01
      },
      prompt: "fix tests",
      model: "openai/gpt-5",
      mode: "yolo",
      cwd: "/tmp/work"
    });
  });

  it("handles empty middleware lists", async () => {
    const context = createContext();

    await expect(applyMiddlewares([], context)).resolves.toBeUndefined();
    expect(context.events).toEqual([]);
    expect(context.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("throws if next is called multiple times by the same middleware", async () => {
    const context = createContext();

    const broken: AcpMiddleware = async (_ctx, next) => {
      await next();
      await next();
    };

    await expect(applyMiddlewares([broken], context)).rejects.toThrow(
      "next() called multiple times"
    );
  });

  it("allows middleware to short-circuit the chain by skipping next", async () => {
    const context = createContext();
    const steps: string[] = [];

    const first: AcpMiddleware = async (ctx, _next) => {
      steps.push("first");
      ctx.sessionId = "stopped";
    };

    const second: AcpMiddleware = async (_ctx, _next) => {
      steps.push("second");
    };

    await applyMiddlewares([first, second], context);

    expect(steps).toEqual(["first"]);
    expect(context.sessionId).toBe("stopped");
  });

  it("propagates errors thrown by downstream middleware", async () => {
    const context = createContext();
    const steps: string[] = [];
    const expectedError = new Error("downstream failed");

    const first: AcpMiddleware = async (_ctx, next) => {
      steps.push("first:before");
      await next();
      steps.push("first:after");
    };

    const second: AcpMiddleware = async () => {
      steps.push("second");
      throw expectedError;
    };

    await expect(applyMiddlewares([first, second], context)).rejects.toThrow(expectedError);
    expect(steps).toEqual(["first:before", "second"]);
  });

  it("throws when middleware list contains an invalid entry", async () => {
    const context = createContext();
    const valid: AcpMiddleware = async (_ctx, next) => {
      await next();
    };
    const invalidMiddlewares = [valid, undefined, valid] as unknown as AcpMiddleware[];

    await expect(applyMiddlewares(invalidMiddlewares, context)).rejects.toThrow(
      "Invalid ACP middleware at index 1"
    );
  });
});

// ============================================================
// renderer tests
// ============================================================

describe("acp/renderer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it("ignores session_start events (no output)", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    const output = captureStdout(() => renderAcpEvent({ event: "session_start" } as any));

    expect(output).toBe("");
    expect(acp.renderAgentMessage).not.toHaveBeenCalled();
    expect(acp.renderToolStart).not.toHaveBeenCalled();
    expect(acp.renderToolComplete).not.toHaveBeenCalled();
    expect(acp.renderReasoning).not.toHaveBeenCalled();
    expect(acp.renderUsage).not.toHaveBeenCalled();
    expect(acp.renderError).not.toHaveBeenCalled();
  });

  it("renders agent_message via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    renderAcpEvent({ event: "agent_message", text: "hello" } as any);

    expect(acp.renderAgentMessage).toHaveBeenCalledWith("hello");
  });

  it("renders tool_start via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    renderAcpEvent({ event: "tool_start", kind: "read", title: "README.md" } as any);

    expect(acp.renderToolStart).toHaveBeenCalledWith("read", "README.md");
  });

  it("renders tool_complete via design-system (kind only, no output)", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    renderAcpEvent({ event: "tool_complete", kind: "read", path: "README.md" } as any);

    expect(acp.renderToolComplete).toHaveBeenCalledWith("read");
  });

  it("renders reasoning via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    renderAcpEvent({ event: "reasoning", text: "thinking..." } as any);

    expect(acp.renderReasoning).toHaveBeenCalledWith("thinking...");
  });

  it("renders usage via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    renderAcpEvent({
      event: "usage",
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 3,
      costUsd: 0.04
    } as any);

    expect(acp.renderUsage).toHaveBeenCalledWith({
      input: 1,
      output: 2,
      cached: 3,
      costUsd: 0.04
    });
  });

  it("renders error via design-system", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    renderAcpEvent({ event: "error", message: "nope" } as any);

    expect(acp.renderError).toHaveBeenCalledWith("nope");
  });

  it("includes stack trace when present on error events", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    renderAcpEvent({ event: "error", message: "nope", stack: "stack line 1" } as any);

    expect(acp.renderError).toHaveBeenCalledWith("nope\nstack line 1");
  });

  it("renders unknown event types as muted text showing the type", async () => {
    const { renderAcpEvent } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    const output = captureStdout(() => renderAcpEvent({ event: "some_future_event" } as any));

    expect(output).toBe("<muted>some_future_event</muted>\n");
    expect(acp.renderAgentMessage).not.toHaveBeenCalled();
  });

  it("renders spawn_result as raw NDJSON in json mode", async () => {
    process.env.OUTPUT_FORMAT = "json";

    const { renderAcpEvent } = await import("./renderer.js");

    const output = captureStdout(() =>
      renderAcpEvent({
        event: "spawn_result",
        exitCode: 0,
        threadId: "thread_123",
        usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 1, costUsd: 0.03 },
        protocolVersion: 1
      } as any)
    );

    expect(output).toBe(
      `${JSON.stringify({
        event: "spawn_result",
        exitCode: 0,
        threadId: "thread_123",
        usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 1, costUsd: 0.03 },
        protocolVersion: 1
      })}\n`
    );
  });

  it("renderAcpStream buffers consecutive agent_message events and flushes at end", async () => {
    const { renderAcpStream } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    async function* fromArray<T>(items: T[]): AsyncIterable<T> {
      for (const item of items) yield item;
    }

    const events = [
      { event: "agent_message", text: "a" },
      { event: "agent_message", text: "b" }
    ];

    await renderAcpStream(fromArray(events as any[]));

    expect(acp.renderAgentMessage).toHaveBeenCalledTimes(1);
    expect(acp.renderAgentMessage).toHaveBeenCalledWith("ab");
  });

  it("renderAcpStream buffers consecutive reasoning events and flushes at end", async () => {
    const { renderAcpStream } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    async function* fromArray<T>(items: T[]): AsyncIterable<T> {
      for (const item of items) yield item;
    }

    const events = [
      { event: "reasoning", text: "thinking" },
      { event: "reasoning", text: " about" },
      { event: "reasoning", text: " this" }
    ];

    await renderAcpStream(fromArray(events as any[]));

    expect(acp.renderReasoning).toHaveBeenCalledTimes(1);
    expect(acp.renderReasoning).toHaveBeenCalledWith("thinking about this");
  });

  it("renderAcpStream flushes reasoning buffer when non-reasoning event arrives", async () => {
    const { renderAcpStream } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    async function* fromArray<T>(items: T[]): AsyncIterable<T> {
      for (const item of items) yield item;
    }

    const events = [
      { event: "reasoning", text: "Let me " },
      { event: "reasoning", text: "think" },
      { event: "tool_start", kind: "read", title: "file.txt" },
      { event: "reasoning", text: "done thinking" }
    ];

    await renderAcpStream(fromArray(events as any[]));

    expect(acp.renderReasoning).toHaveBeenCalledTimes(2);
    expect(acp.renderReasoning).toHaveBeenNthCalledWith(1, "Let me think");
    expect(acp.renderReasoning).toHaveBeenNthCalledWith(2, "done thinking");
    expect(acp.renderToolStart).toHaveBeenCalledWith("read", "file.txt");
  });

  it("renderAcpStream flushes buffer when non-agent_message event arrives", async () => {
    const { renderAcpStream } = await import("./renderer.js");
    const { acp } = await import("toolcraft-design");

    async function* fromArray<T>(items: T[]): AsyncIterable<T> {
      for (const item of items) yield item;
    }

    const events = [
      { event: "agent_message", text: "hello " },
      { event: "agent_message", text: "world" },
      { event: "tool_start", kind: "read", title: "file.txt" },
      { event: "agent_message", text: "done" }
    ];

    await renderAcpStream(fromArray(events as any[]));

    expect(acp.renderAgentMessage).toHaveBeenCalledTimes(2);
    expect(acp.renderAgentMessage).toHaveBeenNthCalledWith(1, "hello world");
    expect(acp.renderAgentMessage).toHaveBeenNthCalledWith(2, "done");
    expect(acp.renderToolStart).toHaveBeenCalledWith("read", "file.txt");
  });
});

// ============================================================
// spawn-acp tests
// ============================================================

describe("spawnAcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acpLaunchOrder.length = 0;
    lastMockAcpClient = undefined;
    lastMockAcpClientOptions = undefined;
    mockPromptNotifications = null;
    mockAcpClientConstructorError = null;
    mockNewSession = null;
    skillBridgeMock.bridgeActiveSkills.mockReturnValue({
      runId: "run-id",
      spawnAgentId: "opencode",
      targetDir: "/tmp/test/.opencode/skill",
      entries: [],
      warnings: []
    });
  });

  it("streams agent message events and resolves with exit code 0", async () => {
    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "Say hello",
      cwd: "/tmp/test"
    });

    const collected = await collect(events);
    const result = await done;

    expect(collected[0]).toMatchObject({ event: "session_start", threadId: "ses_test_123" });
    expect(collected[1]).toMatchObject({ event: "agent_message", text: "Hello " });
    expect(collected[1]._meta).toHaveProperty("raw");
    expect(collected[2]).toMatchObject({ event: "agent_message", text: "world!" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello world!\n");
    expect(result.threadId).toBe("ses_test_123");
  });

  it("returns the stream replaced by native ACP middleware", async () => {
    const redactMessages: AcpMiddleware = async (ctx, next) => {
      expect(ctx.eventStream).toBeDefined();
      await next();
      const source = ctx.eventStream!;
      ctx.eventStream = (async function* () {
        for await (const event of source) {
          yield event.event === "agent_message" ? { ...event, text: "redacted" } : event;
        }
      })();
    };

    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "Say hello",
      cwd: "/tmp/test",
      middlewares: [redactMessages]
    });

    await expect(collect(events).then(stripMeta)).resolves.toEqual([
      { event: "session_start", threadId: "ses_test_123" },
      { event: "agent_message", text: "redacted" },
      { event: "agent_message", text: "redacted" }
    ]);
    await expect(done).resolves.toMatchObject({ exitCode: 0 });
  });

  it("auto-approves permission requests only in yolo mode", async () => {
    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "test",
      cwd: "/tmp/test"
    });

    await collect(events);
    await done;

    expect(lastMockAcpClientOptions.autoApprove).toBe(true);
    expect(lastMockAcpClientOptions.permissionHandler).toBeUndefined();
  });

  it("rejects permission requests in auto mode and emits a permission_rejected event", async () => {
    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "test",
      cwd: "/tmp/test",
      mode: "auto"
    });

    expect(lastMockAcpClientOptions.autoApprove).toBe(false);
    const handler = lastMockAcpClientOptions.permissionHandler;
    expect(handler).toBeTypeOf("function");

    expect(
      handler({
        toolCall: { toolCallId: "tool-1", title: "Run rm -rf /tmp/x" },
        options: [
          { optionId: "allow-1", kind: "allow_once", name: "Allow" },
          { optionId: "reject-1", kind: "reject_once", name: "Reject" }
        ]
      })
    ).toEqual({ outcome: "selected", optionId: "reject-1" });

    expect(
      handler({
        toolCall: { toolCallId: "tool-2" },
        options: [{ optionId: "reject-all", kind: "reject_always", name: "Always reject" }]
      })
    ).toEqual({ outcome: "selected", optionId: "reject-all" });

    expect(
      handler({
        toolCall: { toolCallId: "tool-3" },
        options: [{ optionId: "allow-1", kind: "allow_once", name: "Allow" }]
      })
    ).toEqual({ outcome: "cancelled" });

    const collected = await collect(events);
    await done;

    expect(collected).toContainEqual(
      expect.objectContaining({ event: "permission_rejected", title: "Run rm -rf /tmp/x" })
    );
    expect(collected).toContainEqual(
      expect.objectContaining({ event: "permission_rejected", title: "tool-2" })
    );
  });

  it("leaves permission requests unanswered (cancelled) in edit and read modes", async () => {
    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "test",
      cwd: "/tmp/test",
      mode: "edit"
    });

    await collect(events);
    await done;

    expect(lastMockAcpClientOptions.autoApprove).toBe(false);
    expect(lastMockAcpClientOptions.permissionHandler).toBeUndefined();
  });

  it("passes MCP servers to newSession", async () => {
    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "test",
      cwd: "/tmp/test",
      mcpServers: {
        "tiny-test": {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });

    await collect(events);
    await done;

    expect(lastMockAcpClient.newSession).toHaveBeenCalledWith("/tmp/test", [
      {
        name: "tiny-test",
        command: "tiny-stdio-mcp-test-server",
        args: ["serve", "word-of-the-day"],
        env: [{ name: "MCP_LOG_LEVEL", value: "debug" }]
      }
    ]);
  });

  it("passes empty MCP array when no servers specified", async () => {
    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "test",
      cwd: "/tmp/test"
    });

    await collect(events);
    await done;

    expect(lastMockAcpClient.newSession).toHaveBeenCalledWith("/tmp/test", []);
  });

  it("loads the existing ACP session when resumeThreadId is provided", async () => {
    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "continue",
      cwd: "/tmp/test",
      resumeThreadId: "ses_existing",
      mcpServers: {
        docs: {
          command: "markdown-reader"
        }
      }
    });

    await collect(events);
    const result = await done;

    expect(lastMockAcpClient.newSession).not.toHaveBeenCalled();
    expect(lastMockAcpClient.loadSession).toHaveBeenCalledWith("ses_existing", "/tmp/test", [
      {
        name: "docs",
        command: "markdown-reader",
        args: [],
        env: []
      }
    ]);
    expect(lastMockAcpClient.prompt).toHaveBeenCalledWith("ses_existing", [
      { type: "text", text: "continue" }
    ]);
    expect(result.threadId).toBe("ses_existing");
  });

  it("passes Goose file-secret env to the ACP server", async () => {
    const { events, done } = spawnAcp({
      agentId: "goose",
      prompt: "test",
      cwd: "/tmp/test"
    });

    await collect(events);
    await done;

    expect(lastMockAcpClientOptions.env).toMatchObject({
      GOOSE_DISABLE_KEYRING: "1"
    });
  });

  it("lets caller environment override ACP config and MCP-derived environment", async () => {
    const { events, done } = spawnAcp({
      agentId: "goose",
      prompt: "test",
      cwd: "/tmp/test",
      env: { GOOSE_DISABLE_KEYRING: "caller", WORKSPACE_ID: "workspace-1" }
    });

    await collect(events);
    await done;

    expect(lastMockAcpClientOptions.env).toMatchObject({
      GOOSE_DISABLE_KEYRING: "caller",
      WORKSPACE_ID: "workspace-1"
    });
  });

  it("bridges active skills before constructing the ACP client", async () => {
    skillBridgeMock.bridgeActiveSkills.mockImplementation(() => {
      acpLaunchOrder.push("bridge");
      return {
        runId: "run-id",
        spawnAgentId: "opencode",
        targetDir: "/tmp/test/.opencode/skill",
        entries: [],
        warnings: []
      };
    });

    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "test",
      cwd: "/tmp/test",
      skills: ["foo", "claude/bar"]
    });

    await collect(events);
    await done;

    expect(skillBridgeMock.bridgeActiveSkills).toHaveBeenCalledWith(
      "opencode",
      "/tmp/test",
      ["foo", "claude/bar"],
      expect.any(String),
      expect.any(String)
    );
    expect(acpLaunchOrder).toEqual(["bridge", "client"]);
    expect(skillBridgeMock.cleanupBridgedSkills).toHaveBeenCalledTimes(1);
  });

  it("does not construct the ACP client when active skill bridging throws", () => {
    skillBridgeMock.bridgeActiveSkills.mockImplementation(() => {
      throw new Error("Unresolved skill reference: missing");
    });

    expect(() =>
      spawnAcp({
        agentId: "opencode",
        prompt: "test",
        cwd: "/tmp/test",
        skills: ["missing"]
      })
    ).toThrow("Unresolved skill reference: missing");

    expect(lastMockAcpClient).toBeUndefined();
    expect(acpLaunchOrder).toEqual([]);
    expect(skillBridgeMock.cleanupBridgedSkills).not.toHaveBeenCalled();
  });

  it("cleans up bridged skills when ACP client construction throws", () => {
    const manifest = {
      runId: "run-id",
      spawnAgentId: "opencode",
      targetDir: "/tmp/test/.opencode/skill",
      entries: [],
      warnings: []
    };
    skillBridgeMock.bridgeActiveSkills.mockImplementation(() => {
      acpLaunchOrder.push("bridge");
      return manifest;
    });
    mockAcpClientConstructorError = new Error("ACP launch failed");

    expect(() =>
      spawnAcp({
        agentId: "opencode",
        prompt: "test",
        cwd: "/tmp/test",
        skills: ["foo"]
      })
    ).toThrow("ACP launch failed");

    expect(acpLaunchOrder).toEqual(["bridge", "client"]);
    expect(skillBridgeMock.cleanupBridgedSkills).toHaveBeenCalledTimes(1);
    expect(skillBridgeMock.cleanupBridgedSkills).toHaveBeenCalledWith(manifest);
  });

  it("uses last tool output as stdout when no agent message is sent", async () => {
    mockPromptNotifications = [
      {
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tc_1",
            status: "completed",
            rawOutput: "bumfuzzle"
          }
        }
      }
    ];

    const { events, done } = spawnAcp({
      agentId: "opencode",
      prompt: "test",
      cwd: "/tmp/test"
    });

    await collect(events);
    const result = await done;

    expect(result.stdout).toBe("bumfuzzle\n");
  });

  it("throws for agents without ACP spawn config", () => {
    expect(() =>
      spawnAcp({
        agentId: "claude-code",
        prompt: "test"
      })
    ).toThrow("does not support ACP spawn");
  });

  it("throws when signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() =>
      spawnAcp({
        agentId: "opencode",
        prompt: "test",
        signal: controller.signal
      })
    ).toThrow("Agent spawn aborted");
  });

  it("rejects runtime overrides unsupported by native ACP spawning", () => {
    expect(() =>
      spawnAcp({
        agentId: "opencode",
        prompt: "test",
        runtime: "docker",
        runtimeImage: "poe-code:test",
        detach: true,
        mountPoeCode: true,
        runnerSync: "both"
      })
    ).toThrow("spawnAcp does not support runtime overrides; use spawnStreaming instead.");

    expect(lastMockAcpClient).toBeUndefined();
  });

  it("ignores inherited ACP spawn option fields", async () => {
    const cwd = process.cwd();

    await withObjectPrototypeProperties(
      {
        cwd: "/polluted",
        env: {
          POLLUTED: "1"
        },
        mcpServers: {
          polluted: {
            command: "polluted-mcp"
          }
        },
        mode: "read",
        model: "polluted/model",
        runtime: "docker"
      },
      async () => {
        const { events, done } = spawnAcp({
          agentId: "opencode",
          prompt: "test"
        });

        await collect(events);
        await done;
      }
    );

    expect(lastMockAcpClientOptions.cwd).toBe(cwd);
    expect(lastMockAcpClientOptions.args).not.toContain("polluted/model");
    expect(lastMockAcpClientOptions.env).toBeUndefined();
    expect(lastMockAcpClient.newSession).toHaveBeenCalledWith(cwd, []);
  });

  it("does not prompt when aborted while creating an ACP session", async () => {
    let resolveSession: ((value: { sessionId: string }) => void) | undefined;
    mockNewSession = () =>
      new Promise<{ sessionId: string }>((resolve) => {
        resolveSession = resolve;
      });
    const controller = new AbortController();
    const { done } = spawnAcp({
      agentId: "opencode",
      prompt: "do not send",
      signal: controller.signal
    });

    await vi.waitFor(() => expect(lastMockAcpClient.newSession).toHaveBeenCalledTimes(1));
    controller.abort();
    resolveSession?.({ sessionId: "ses_after_abort" });

    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(lastMockAcpClient.prompt).not.toHaveBeenCalled();
    expect(lastMockAcpClient.cancelSession).toHaveBeenCalledWith("ses_after_abort");
  });
});

// ============================================================
// spawn (spawnStreaming) tests
// ============================================================

describe("acp/spawnStreaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams OpenCode JSON events via the opencode adapter", async () => {
    const stdoutLines = [
      JSON.stringify({
        type: "text",
        sessionID: "ses_abc",
        part: { type: "text", messageID: "msg_1", text: "hi" }
      }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "ses_abc",
        part: { tokens: { input: 1, output: 2, cache: { read: 3, write: 0 } } }
      })
    ];
    const mock = createMockChildProcess({
      stdoutLines,
      stderr: "warn\n",
      exitCode: 0
    });
    let teeStdout = "";
    let teeStderr = "";

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello",
      cwd: "/tmp",
      tee: {
        stdout: {
          write: (chunk: string) => {
            teeStdout += chunk;
          }
        },
        stderr: {
          write: (chunk: string) => {
            teeStderr += chunk;
          }
        }
      }
    });

    await expect(collect(events).then(stripMeta)).resolves.toEqual([
      { event: "session_start", threadId: "ses_abc" },
      { event: "agent_message", text: "hi" },
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3 }
    ]);

    await expect(done).resolves.toEqual({
      stdout: "",
      stderr: "warn\n",
      exitCode: 0
    });
    expect(teeStdout).toBe(`${stdoutLines.join("\n")}\n`);
    expect(teeStderr).toBe("warn\n");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = spawnMock.mock.calls[0];
    expect(command).toBe("opencode");
    expect(args).toEqual([
      openCodeSpawnConfig.promptFlag,
      "hello",
      ...openCodeSpawnConfig.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
    expect(spawnOptions).toMatchObject({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] });
  });

  it("ignores inherited streaming spawn option fields", async () => {
    const stdoutLines = [
      JSON.stringify({
        type: "text",
        sessionID: "ses_inherited",
        part: { type: "text", messageID: "msg_1", text: "clean" }
      })
    ];
    const mock = createMockChildProcess({
      stdoutLines,
      exitCode: 0
    });
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const cwd = process.cwd();

    await withObjectPrototypeProperties(
      {
        args: ["--polluted"],
        cwd: "/polluted",
        detached: true,
        mcpServers: {
          polluted: {
            command: "polluted-mcp"
          }
        },
        mode: "read",
        model: "polluted/model",
        runtime: "docker"
      },
      async () => {
        const { events, done } = spawnStreaming({
          agentId: "opencode",
          prompt: "hello"
        });

        await expect(collect(events).then(stripMeta)).resolves.toEqual([
          { event: "session_start", threadId: "ses_inherited" },
          { event: "agent_message", text: "clean" }
        ]);
        await expect(done).resolves.toMatchObject({ exitCode: 0 });
      }
    );

    const [command, args, spawnOptions] = spawnMock.mock.calls[0];
    expect(command).toBe("opencode");
    expect(args).toEqual([
      openCodeSpawnConfig.promptFlag,
      "hello",
      ...openCodeSpawnConfig.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
    expect(Object.getPrototypeOf(spawnOptions)).toBeNull();
    expect(spawnOptions).toMatchObject({ cwd, stdio: ["pipe", "pipe", "pipe"] });
  });

  it("runs streaming middlewares in onion order with populated context on the way out", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_middleware",
          part: { type: "text", messageID: "msg_1", text: "hi" }
        }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_middleware",
          part: { tokens: { input: 2, output: 3, cache: { read: 5, write: 0 } } }
        })
      ],
      exitCode: 0
    });

    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const steps: string[] = [];
    const firstMiddleware: AcpMiddleware = async (_ctx, next) => {
      steps.push("first:before");
      await next();
      steps.push("first:after");
    };
    const secondMiddleware: AcpMiddleware = async (ctx, next) => {
      steps.push("second:before");
      expect(ctx).toEqual(
        expect.objectContaining({
          sessionId: "unknown",
          agent: "opencode",
          events: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          prompt: "hello",
          model: "poe/test-model",
          mode: "yolo",
          cwd: "/tmp",
          startedAt: expect.any(Date)
        })
      );

      await next();

      steps.push("second:after");
      expect(stripMeta(ctx.events)).toEqual([
        { event: "session_start", threadId: "ses_middleware" },
        { event: "agent_message", text: "hi" },
        { event: "usage", inputTokens: 2, outputTokens: 3, cachedTokens: 5 }
      ]);
      expect(ctx.usage).toEqual({
        inputTokens: 2,
        outputTokens: 3,
        cachedTokens: 5
      });
      expect(ctx.sessionId).toBe("ses_middleware");
      expect(ctx.threadId).toBe("ses_middleware");
    };

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello",
      cwd: "/tmp",
      model: "poe/test-model",
      mode: "yolo",
      middlewares: [firstMiddleware, secondMiddleware]
    });

    steps.push("collect:before");
    await expect(collect(events).then(stripMeta)).resolves.toEqual([
      { event: "session_start", threadId: "ses_middleware" },
      { event: "agent_message", text: "hi" },
      { event: "usage", inputTokens: 2, outputTokens: 3, cachedTokens: 5 }
    ]);
    steps.push("collect:after");

    await expect(done).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    expect(steps).toEqual([
      "first:before",
      "second:before",
      "collect:before",
      "second:after",
      "first:after",
      "collect:after"
    ]);
  });

  it("populates streaming middleware context even when callers only await done", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_done_only",
          part: { type: "text", messageID: "msg_1", text: "done" }
        }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_done_only",
          part: { tokens: { input: 7, output: 11, cache: { read: 13, write: 0 } } }
        })
      ],
      exitCode: 0
    });

    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const observed: Array<{ events: unknown[]; usage: unknown; sessionId: string }> = [];
    const middleware: AcpMiddleware = async (ctx, next) => {
      await next();
      observed.push({
        events: stripMeta(ctx.events),
        usage: ctx.usage,
        sessionId: ctx.sessionId
      });
    };

    const { done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello",
      cwd: "/tmp",
      middlewares: [middleware]
    });

    await expect(done).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    expect(observed).toEqual([
      {
        events: [
          { event: "session_start", threadId: "ses_done_only" },
          { event: "agent_message", text: "done" },
          { event: "usage", inputTokens: 7, outputTokens: 11, cachedTokens: 13 }
        ],
        usage: {
          inputTokens: 7,
          outputTokens: 11,
          cachedTokens: 13
        },
        sessionId: "ses_done_only"
      }
    ]);
  });

  it("returns the stream replaced by streaming middleware", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_redacted",
          part: { type: "text", messageID: "msg_1", text: "secret" }
        })
      ],
      exitCode: 0
    });

    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const redactMessages: AcpMiddleware = async (ctx, next) => {
      await next();
      const source = ctx.eventStream!;
      ctx.eventStream = (async function* () {
        for await (const event of source) {
          yield event.event === "agent_message" ? { ...event, text: "redacted" } : event;
        }
      })();
    };

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello",
      cwd: "/tmp",
      middlewares: [redactMessages]
    });

    await expect(collect(events).then(stripMeta)).resolves.toEqual([
      { event: "session_start", threadId: "ses_redacted" },
      { event: "agent_message", text: "redacted" }
    ]);
    await expect(done).resolves.toMatchObject({ exitCode: 0 });
  });

  it("does not double count usage captured by streaming middleware", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_usage",
          part: { tokens: { input: 2, output: 3, cache: { read: 5, write: 0 } } }
        })
      ],
      exitCode: 0
    });

    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    let observedUsage: unknown;
    const inspectUsage: AcpMiddleware = async (ctx, next) => {
      await next();
      observedUsage = ctx.usage;
    };

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello",
      cwd: "/tmp",
      middlewares: [inspectUsage, usageCapture]
    });

    await collect(events);
    await expect(done).resolves.toMatchObject({ exitCode: 0 });
    expect(observedUsage).toEqual({ inputTokens: 2, outputTokens: 3, cachedTokens: 5 });
  });

  it("passes resumeThreadId through streaming provider args", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [JSON.stringify({ event: "session_start", threadId: "thread_abc123" })],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "continue",
      cwd: "/tmp",
      resumeThreadId: "thread_abc123"
    });

    await collect(events);
    await done;

    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("codex");
    expect(args).toEqual([
      codexSpawnConfig.promptFlag,
      "resume",
      "thread_abc123",
      "continue",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("routes streaming spawns through the requested runtime backend", async () => {
    let capturedOpenSpec: OpenSpec | undefined;
    let capturedRunSpec: RunSpec | undefined;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const kill = vi.fn();

    const dockerFactory: ExecutionEnvFactory = {
      type: "docker",
      supportsDetach: true,
      async open(openSpec) {
        capturedOpenSpec = openSpec;
        return {
          id: "docker-test",
          job: null,
          async uploadWorkspace() {
            return { files: 0, bytes: 0, skipped: [] };
          },
          async downloadWorkspace() {
            return { files: 0, bytes: 0, conflicts: [] };
          },
          exec(spec) {
            capturedRunSpec = spec;
            queueMicrotask(() => {
              stdout.write(
                `${JSON.stringify({
                  type: "text",
                  sessionID: "ses_docker",
                  part: { type: "text", messageID: "msg_1", text: "from docker" }
                })}\n`
              );
              stdout.end();
              stderr.write("warn\n");
              stderr.end();
            });
            return {
              pid: 123,
              stdin,
              stdout,
              stderr,
              result: Promise.resolve({ exitCode: 0 }),
              kill
            };
          },
          async detach() {
            throw new Error("unused");
          },
          shell() {
            throw new Error("unused");
          },
          async close() {}
        };
      },
      async attach() {
        throw new Error("unused");
      }
    };
    registerExecutionEnvFactory(dockerFactory);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "inspect api_key=sk-secret",
      cwd: "/tmp",
      env: { WORKSPACE_ID: "workspace-1" },
      runtime: "docker",
      runtimeImage: "poe-code:test",
      mountPoeCode: true
    });

    await expect(collect(events).then(stripMeta)).resolves.toEqual([
      { event: "session_start", threadId: "ses_docker" },
      { event: "agent_message", text: "from docker" }
    ]);
    await expect(done).resolves.toEqual({
      stdout: "",
      stderr: "warn\n",
      exitCode: 0
    });

    expect(spawnChildProcess).not.toHaveBeenCalled();
    expect(capturedOpenSpec?.runtime).toMatchObject({
      type: "docker",
      image: "poe-code:test"
    });
    expect(capturedOpenSpec?.runtime.mounts).toContainEqual({
      source: "/tmp",
      target: "/usr/local/lib/poe-code",
      readonly: true
    });
    expect(capturedOpenSpec?.jobLabel.argv).toContain("inspect api_key=sk-secret");
    expect(capturedOpenSpec?.jobLabel.displayArgv).toContain("[prompt redacted]");
    expect(JSON.stringify(capturedOpenSpec?.jobLabel.displayArgv)).not.toContain("sk-secret");
    expect(capturedRunSpec).toMatchObject({
      command: "opencode",
      args: expect.arrayContaining(["inspect api_key=sk-secret"]),
      cwd: "/tmp",
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(capturedOpenSpec?.env).toMatchObject({ WORKSPACE_ID: "workspace-1" });
    expect(capturedRunSpec?.env).toMatchObject({ WORKSPACE_ID: "workspace-1" });
  });

  it("passes through multiple usage events without accumulating into done", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_agg",
          part: { type: "text", messageID: "msg_1", text: "hi" }
        }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_agg",
          part: { tokens: { input: 1, output: 2, cache: { read: 3, write: 0 } } }
        }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_agg",
          part: { tokens: { input: 4, output: 5, cache: { read: 6, write: 0 } } }
        })
      ],
      exitCode: 0
    });

    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello"
    });

    await expect(collect(events).then(stripMeta)).resolves.toEqual([
      { event: "session_start", threadId: "ses_agg" },
      { event: "agent_message", text: "hi" },
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3 },
      { event: "usage", inputTokens: 4, outputTokens: 5, cachedTokens: 6 }
    ]);

    const final = await done;
    expect(final).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    expect(final.threadId).toBeUndefined();
    expect(final.usage).toBeUndefined();
  });

  it("ignores non-ACP adapter outputs and yields only raw ACP events", async () => {
    const mock = createMockChildProcess({ exitCode: 0 });
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const getAdapterMock = vi
      .spyOn(adapterModule, "getAdapter")
      .mockReturnValue(async function* () {
        yield {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "ignore me" }
        };
        yield { event: "agent_message", text: "raw event" };
      });
    try {
      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "hello"
      });

      await expect(collect(events).then(stripMeta)).resolves.toEqual([
        { event: "agent_message", text: "raw event" }
      ]);
      await expect(done).resolves.toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(getAdapterMock).toHaveBeenCalledWith("codex");
    } finally {
      getAdapterMock.mockRestore();
    }
  });

  it("returns exit code 1 when the runtime reports a process launch error", async () => {
    const mock = createMockChildProcess({ error: new Error("spawn failed") });
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello"
    });

    await expect(collect(events)).resolves.toEqual([]);
    await expect(done).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 1
    });
  });

  it("writes prompt to stdin when useStdin is true and stdinMode is available", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "hi" }
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0 }
        })
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "hello from stdin",
      useStdin: true
    });

    await expect(collect(events).then(stripMeta)).resolves.toEqual([
      { event: "session_start", threadId: "t1" },
      { event: "agent_message", text: "hi" },
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 0 }
    ]);

    await expect(done).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      codexSpawnConfig.promptFlag,
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo,
      ...codexSpawnConfig.stdinMode!.extraArgs
    ]);
    expect(mock.getStdin()).toBe("hello from stdin");
  });

  it("writes prompts containing null bytes to stdin when stdinMode is available", async () => {
    const prompt = 'Tokenize "a\0b" without crashing';
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0 }
        })
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt
    });

    await collect(events);
    await done;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      codexSpawnConfig.promptFlag,
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo,
      ...codexSpawnConfig.stdinMode!.extraArgs
    ]);
    expect(args).not.toContain(prompt);
    expect(mock.getStdin()).toBe(prompt);
  });

  it("strips provider namespace and transforms model before passing to CLI", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [JSON.stringify({ type: "system", subtype: "init", session_id: "s1" })],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "claude-code",
      prompt: "test",
      model: "anthropic/claude-opus-4.6"
    });

    await collect(events);
    await done;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("claude-opus-4-6");
    expect(args).not.toContain("anthropic/claude-opus-4.6");
    expect(args).not.toContain("claude-opus-4.6");
  });

  it("applies modelTransform for opencode models (bare)", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_abc",
          part: { type: "text", messageID: "msg_1", text: "hi" }
        })
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "test",
      model: "gpt-5.2"
    });

    await collect(events);
    await done;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("poe/gpt-5.2");
    expect(args).not.toContain("gpt-5.2");
  });

  it("applies modelTransform for opencode models (namespaced)", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_abc",
          part: { type: "text", messageID: "msg_1", text: "hi" }
        })
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "test",
      model: "openai/gpt-5.2"
    });

    await collect(events);
    await done;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("poe/openai/gpt-5.2");
    expect(args).not.toContain("openai/gpt-5.2");
  });

  it("serializes MCP servers for streaming spawn when supported", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [JSON.stringify({ type: "thread.started", thread_id: "t1" })],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "hello",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });

    await collect(events);
    await done;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      "-c",
      'mcp_servers.test.command="tiny-stdio-mcp-test-server"',
      "-c",
      'mcp_servers.test.default_tools_approval_mode="approve"',
      "-c",
      'mcp_servers.test.args=["serve", "word-of-the-day"]',
      "-c",
      'mcp_servers.test.env={"MCP_LOG_LEVEL"="debug"}',
      codexSpawnConfig.promptFlag,
      "hello",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("throws a clear error when MCP config is passed to unsupported agents", () => {
    const fakeConfig = { kind: "cli" as const, agentId: "fake-agent" } as CliSpawnConfig;
    expect(() =>
      getMcpArgs(fakeConfig, { test: { command: "tiny-stdio-mcp-test-server" } })
    ).toThrow('Agent "fake-agent" does not support MCP servers at spawn time.');
  });

  it("throws on unknown agentId before spawning", () => {
    const spawnMock = vi.mocked(spawnChildProcess);
    expect(() =>
      spawnStreaming({
        agentId: "unknown",
        prompt: "hello"
      })
    ).toThrow('Unknown agent "unknown".');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws error if agent has no spawn config", () => {
    const spawnMock = vi.mocked(spawnChildProcess);
    expect(() =>
      spawnStreaming({
        agentId: "claude-desktop",
        prompt: "hello"
      })
    ).toThrow('Agent "claude-desktop" has no spawn config.');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("kills the child and rejects with AbortError when the signal aborts", async () => {
    const controller = new AbortController();
    const mock = createMockChildProcess({ autoClose: false });
    const killSpy = vi.spyOn(mock.child, "kill");
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { done } = spawnStreaming({
      agentId: "codex",
      prompt: "hello",
      signal: controller.signal
    });

    controller.abort();

    await expect(done).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
  });

  describe("activityTimeoutMs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("kills process and rejects done with ActivityTimeoutError after inactivity", async () => {
      const mock = createMockChildProcess({ autoClose: false });
      const killSpy = vi.spyOn(mock.child, "kill");
      vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "hello",
        activityTimeoutMs: 5000
      });

      // Start consuming events (otherwise the generator never runs)
      const eventsPromise = collect(events);
      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const doneRejection = expect(done).rejects.toMatchObject({
        name: "ActivityTimeoutError"
      });

      await vi.advanceTimersByTimeAsync(5000);

      await doneRejection;
      expect(killSpy).toHaveBeenCalledWith("SIGTERM");
      // Events should complete (empty since no output was sent)
      await expect(eventsPromise).resolves.toEqual([]);
    });

    it("resets timeout when stdout data is received", async () => {
      const mock = createMockChildProcess({ autoClose: false });
      const killSpy = vi.spyOn(mock.child, "kill");
      vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "hello",
        activityTimeoutMs: 5000
      });

      const eventsPromise = collect(events);
      // Attach rejection handler early to avoid unhandled rejection
      const doneRejection = expect(done).rejects.toMatchObject({
        name: "ActivityTimeoutError"
      });

      // Advance 4s, send data, advance another 4s — should not timeout
      await vi.advanceTimersByTimeAsync(4000);
      mock.child.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "t1" }) + "\n");
      await vi.advanceTimersByTimeAsync(4000);
      expect(killSpy).not.toHaveBeenCalled();

      // Now let it timeout
      await vi.advanceTimersByTimeAsync(1001);
      await doneRejection;
      const collected = await eventsPromise;
      expect(stripMeta(collected)).toEqual([{ event: "session_start", threadId: "t1" }]);
    });

    it("does not reset timeout when only stderr data is received", async () => {
      const mock = createMockChildProcess({ autoClose: false });
      const killSpy = vi.spyOn(mock.child, "kill");
      vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "hello",
        activityTimeoutMs: 5000
      });

      const eventsPromise = collect(events);
      const doneRejection = expect(done).rejects.toMatchObject({
        name: "ActivityTimeoutError"
      });

      await vi.advanceTimersByTimeAsync(4000);
      mock.child.stderr.write("diagnostic noise\n");
      await vi.advanceTimersByTimeAsync(1000);

      await doneRejection;
      expect(killSpy).toHaveBeenCalledWith("SIGTERM");
      await expect(eventsPromise).resolves.toEqual([]);
    });

    it("clears timeout when process exits normally", async () => {
      const mock = createMockChildProcess({ autoClose: false });
      vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "hello",
        activityTimeoutMs: 5000
      });

      const eventsPromise = collect(events);

      await vi.waitFor(() => expect(spawnChildProcess).toHaveBeenCalledTimes(1));

      mock.child.stdout.end();
      mock.child.stderr.end();
      mock.child.emit("close", 0, null);

      const result = await done;
      expect(result.exitCode).toBe(0);
      await eventsPromise;
    });
  });
});
