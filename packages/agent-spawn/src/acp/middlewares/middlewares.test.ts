import path from "node:path";
import { homedir } from "node:os";
import * as fs from "node:fs/promises";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

import { applyMiddlewares, type AcpMiddleware, type SpawnContext } from "../middleware.js";
import { sessionCapture } from "./session-capture.js";
import { spawnLog } from "./spawn-log.js";
import { usageCapture } from "./usage-capture.js";
import { adaptCodex } from "../../adapters/codex.js";
import type { AcpEvent } from "../types.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

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

describe("acp/middlewares/sessionCapture", () => {
  it("accumulates events and builds sessionResult while preserving event stream", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "session_start", threadId: "thread-123" },
      { event: "tool_start", id: "tool-1", kind: "exec", title: "ls -la" },
      { event: "tool_complete", id: "tool-1", kind: "exec", path: "ok" },
      { event: "agent_message", text: "First message" },
      { event: "agent_message", text: "Second message" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([sessionCapture, source], ctx);

    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual(sourceEvents);
    expect(observed[0]).toBe(sourceEvents[0]);
    expect(observed[1]).toBe(sourceEvents[1]);

    expect(ctx.events).toEqual(sourceEvents);
    expect(ctx.threadId).toBe("thread-123");
    expect(ctx.sessionId).toBe("thread-123");
    expect(ctx.sessionResult).toEqual({
      output: "First message\nSecond message",
      messages: ["First message", "Second message"],
      toolCalls: [
        {
          id: "tool-1",
          kind: "exec",
          title: "ls -la",
          path: "ok"
        }
      ]
    });
  });

  it("records tool_complete events even when no matching tool_start exists", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "tool_complete", id: "tool-2", kind: "edit", path: "src/app.ts" },
      { event: "agent_message", text: "done" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([sessionCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.events).toEqual(sourceEvents);
    expect(ctx.sessionResult).toEqual({
      output: "done",
      messages: ["done"],
      toolCalls: [
        {
          id: "tool-2",
          kind: "edit",
          path: "src/app.ts"
        }
      ]
    });
  });

  it("merges out-of-order tool events with the same id into one toolCall", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "tool_complete", id: "tool-3", kind: "read", path: "README.md" },
      { event: "tool_start", id: "tool-3", kind: "read", title: "Read readme" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([sessionCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.events).toEqual(sourceEvents);
    expect(ctx.sessionResult).toEqual({
      output: "",
      messages: [],
      toolCalls: [
        {
          id: "tool-3",
          kind: "read",
          title: "Read readme",
          path: "README.md"
        }
      ]
    });
  });

  it("captures tool input arguments from tool_start events", async () => {
    const sourceEvents: AcpEvent[] = [
      {
        event: "tool_start",
        id: "call-1",
        kind: "other",
        title: "mcp__superintendent-agentic-tools__workflow_transition",
        input: { action: "request_review", summary: "Board complete" }
      } as AcpEvent,
      { event: "tool_complete", id: "call-1", kind: "other", path: "Recorded workflow transition: request_review" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([sessionCapture, source], ctx);
    await collect(ctx.eventStream!);

    expect(ctx.sessionResult?.toolCalls).toEqual([
      {
        id: "call-1",
        kind: "other",
        title: "mcp__superintendent-agentic-tools__workflow_transition",
        input: { action: "request_review", summary: "Board complete" },
        path: "Recorded workflow transition: request_review"
      }
    ]);
  });

  it("builds sessionResult from preloaded events even without an event stream", async () => {
    const preloadedEvents: AcpEvent[] = [
      { event: "session_start", threadId: "thread-preloaded" },
      { event: "agent_message", text: "hello" },
      { event: "agent_message", text: "world" }
    ];

    const ctx = createContext({ events: [...preloadedEvents] });
    await applyMiddlewares([sessionCapture], ctx);

    expect(ctx.events).toEqual(preloadedEvents);
    expect(ctx.threadId).toBe("thread-preloaded");
    expect(ctx.sessionId).toBe("thread-preloaded");
    expect(ctx.eventStream).toBeUndefined();
    expect(ctx.sessionResult).toEqual({
      output: "hello\nworld",
      messages: ["hello", "world"],
      toolCalls: []
    });
  });
});

describe("acp/middlewares/spawnLog", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one JSONL event per line to the configured log directory", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "session_start", threadId: "thread-1" },
      { event: "agent_message", text: "hello" },
      { event: "usage", inputTokens: 1, outputTokens: 2 }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext({
      agent: "codex",
      logDir: "/tmp/spawn-logs",
      logContent: true,
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);

    const observed = await collect(ctx.eventStream!);
    expect(observed).toEqual(sourceEvents);

    const files = await fs.readdir("/tmp/spawn-logs");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^20260320-123456-789-codex-[\w-]+\.jsonl$/);

    const content = await fs.readFile(path.join("/tmp/spawn-logs", files[0]), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.parse(line))).toEqual(sourceEvents);
  });

  it("honors ctx.logPath over the auto-generated filename", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "agent_message", text: "custom filename" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext({
      agent: "codex",
      logDir: "/tmp/ignored",
      logFileName: "ignored.jsonl",
      logPath: "/tmp/spawn-logs/20260320-123456-789-builder.jsonl",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    await collect(ctx.eventStream!);

    const files = await fs.readdir("/tmp/spawn-logs");
    expect(files).toEqual(["20260320-123456-789-builder.jsonl"]);
    expect(ctx.logFile).toBe("/tmp/spawn-logs/20260320-123456-789-builder.jsonl");
  });

  it("logs transformed events without raw ACP payload metadata", async () => {
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        yield {
          event: "agent_message",
          text: "secret text",
          _meta: {
            raw: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "secret text" }
            },
            ts: 123
          }
        } as AcpEvent;
      })();
    };
    const redact: AcpMiddleware = async (ctx, next) => {
      await next();
      const sourceStream = ctx.eventStream;
      ctx.eventStream = (async function* () {
        for await (const event of sourceStream ?? []) {
          if (event.event === "agent_message") {
            yield { ...event, text: "<redacted>" };
          } else {
            yield event;
          }
        }
      })();
    };
    const ctx = createContext({
      logPath: "/tmp/redacted-log/session.jsonl",
      logContent: true
    });

    await applyMiddlewares([spawnLog, redact, source], ctx);
    const observed = await collect(ctx.eventStream!);

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ event: "agent_message", text: "<redacted>" });
    const content = await fs.readFile(ctx.logFile!, "utf8");
    expect(content).toContain("<redacted>");
    expect(content).not.toContain("secret text");
    expect(JSON.parse(content)).toEqual({
      event: "agent_message",
      text: "<redacted>",
      _meta: { ts: 123 }
    });
  });

  it("redacts message and tool content from spawn logs by default", async () => {
    const token = "sk-test-token-123";
    const sourceEvents: AcpEvent[] = [
      { event: "agent_message", text: `answer ${token}` },
      { event: "reasoning", text: `thought ${token}` },
      {
        event: "tool_start",
        id: "tool-1",
        kind: "exec",
        title: "run command",
        input: { command: `echo ${token}` }
      } as AcpEvent,
      { event: "tool_complete", id: "tool-1", kind: "exec", path: `stdout ${token}` }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };
    const ctx = createContext({
      logPath: "/tmp/default-redacted-log/session.jsonl"
    });

    await applyMiddlewares([spawnLog, source], ctx);
    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual(sourceEvents);
    const content = await fs.readFile(ctx.logFile!, "utf8");
    expect(content).not.toContain(token);
    expect(content.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      { event: "agent_message", text: "[redacted]" },
      { event: "reasoning", text: "[redacted]" },
      {
        event: "tool_start",
        id: "tool-1",
        kind: "exec",
        title: "[redacted]",
        input: "[redacted]"
      },
      { event: "tool_complete", id: "tool-1", kind: "exec", path: "[redacted]" }
    ]);
  });

  it("redacts adapter-produced command titles from spawn logs by default", async () => {
    const token = "sk-title-token-456";
    const command = `curl -H "Authorization: Bearer ${token}" https://example.test`;
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = adaptCodex((async function* () {
        yield JSON.stringify({
          type: "item.started",
          item: {
            id: "cmd-1",
            type: "command_execution",
            command
          }
        });
      })());
    };
    const ctx = createContext({
      logPath: "/tmp/default-redacted-log/command-title.jsonl"
    });

    await applyMiddlewares([spawnLog, source], ctx);
    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual([
      {
        event: "tool_start",
        id: "cmd-1",
        kind: "exec",
        title: command
      }
    ]);
    const content = await fs.readFile(ctx.logFile!, "utf8");
    expect(content).not.toContain(token);
    expect(JSON.parse(content)).toEqual({
      event: "tool_start",
      id: "cmd-1",
      kind: "exec",
      title: "[redacted]"
    });
  });

  it("does not allow ctx.logFileName to escape ctx.logDir", async () => {
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        yield { event: "agent_message", text: "safe" } as AcpEvent;
      })();
    };
    const ctx = createContext({
      logDir: "/tmp/spawn-logs",
      logFileName: "../escaped.jsonl"
    });

    await applyMiddlewares([spawnLog, source], ctx);
    await collect(ctx.eventStream!);

    expect(vol.existsSync("/tmp/escaped.jsonl")).toBe(false);
  });

  it("uses the default spawn log directory when ctx.logDir is missing", async () => {
    const sourceEvents: AcpEvent[] = [{ event: "agent_message", text: "default dir" }];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext({
      agent: "codex",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    await collect(ctx.eventStream!);

    const defaultDir = path.join(homedir(), ".poe-code", "spawn-logs");
    const files = await fs.readdir(defaultDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^20260320-123456-789-codex-[\w-]+\.jsonl$/);
  });

  it("does not write default logs through a symlink outside state", async () => {
    const stateDir = path.join(homedir(), ".poe-code");
    const logDir = path.join(stateDir, "spawn-logs");
    const outsideDir = path.join(homedir(), "outside");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.symlink(outsideDir, logDir);

    const ctx = createContext({
      events: [{ event: "agent_message", text: "external log probe" }],
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog], ctx);

    await expect(fs.readdir(outsideDir)).resolves.toEqual([]);
  });

  it("does not write default logs through a symlinked state root", async () => {
    const stateDir = path.join(homedir(), ".poe-code");
    const outsideDir = path.join(homedir(), "outside-state");
    await fs.mkdir(homedir(), { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.symlink(outsideDir, stateDir);

    const ctx = createContext({
      events: [{ event: "agent_message", text: "external state root probe" }],
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog], ctx);

    await expect(fs.readdir(outsideDir)).resolves.toEqual([]);
  });

  it("falls back to current time when startedAt is invalid", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-20T00:00:00.001Z"));

      const sourceEvents: AcpEvent[] = [{ event: "agent_message", text: "invalid date fallback" }];

      const source: AcpMiddleware = async (ctx) => {
        ctx.eventStream = (async function* () {
          for (const event of sourceEvents) {
            yield event;
          }
        })();
      };

      const ctx = createContext({
        agent: "codex",
        logDir: "/tmp/spawn-logs",
        startedAt: new Date("not-a-date")
      });

      await applyMiddlewares([spawnLog, source], ctx);
      await collect(ctx.eventStream!);

      const files = await fs.readdir("/tmp/spawn-logs");
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^20260320-000000-001-codex-[\w-]+\.jsonl$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("swallows logging errors and preserves the ACP event stream", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "agent_message", text: "first" },
      { event: "agent_message", text: "second" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    vi.spyOn(fs, "open").mockRejectedValue(new Error("boom"));

    const ctx = createContext({
      logDir: "/tmp/failing-logs",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual(sourceEvents);
  });

  it("reports an unwritable log directory instead of ignoring it", async () => {
    const sourceEvents: AcpEvent[] = [{ event: "agent_message", text: "first" }];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    vi.spyOn(fs, "mkdir").mockRejectedValue(new Error("EACCES: permission denied"));

    const ctx = createContext({
      logDir: "/no/perm/dir",
      logFileName: "probe.jsonl",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual(sourceEvents);
    expect(ctx.logError).toContain("/no/perm/dir/probe.jsonl");
    expect(ctx.logError).toContain("EACCES: permission denied");
    expect(ctx.logFile).toBeUndefined();
  });

  it("reports an append failure while keeping the partially written log path", async () => {
    const sourceEvents: AcpEvent[] = [{ event: "agent_message", text: "first" }];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext({
      logDir: "/tmp/spawn-logs",
      logFileName: "probe.jsonl",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    await fs.mkdir("/tmp/spawn-logs", { recursive: true });
    const handle = await fs.open("/tmp/spawn-logs/probe.jsonl", "a");
    vi.spyOn(handle, "appendFile").mockRejectedValue(new Error("ENOSPC: no space left"));
    vi.spyOn(fs, "open").mockResolvedValue(handle);

    await collect(ctx.eventStream!);

    expect(ctx.logError).toContain("ENOSPC: no space left");
    expect(ctx.logFile).toBe("/tmp/spawn-logs/probe.jsonl");
  });

  it("does not report a log error when logging succeeds", async () => {
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        yield { event: "agent_message", text: "ok" } as AcpEvent;
      })();
    };

    const ctx = createContext({
      logDir: "/tmp/spawn-logs",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    await collect(ctx.eventStream!);

    expect(ctx.logError).toBeUndefined();
    expect(ctx.logFile).toBeDefined();
  });

  it("rolls back a partial append before disabling event logging", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "agent_message", text: "first" },
      { event: "agent_message", text: "second" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const realOpen = fs.open.bind(fs);
    let appendAttempts = 0;
    vi.spyOn(fs, "open").mockImplementation(async (filePath, flags) => {
      const handle = await realOpen(filePath, flags);
      const appendFile = handle.appendFile.bind(handle);
      (handle as unknown as { appendFile: (content: string, encoding: string) => Promise<void> }).appendFile = async (
        content,
        encoding
      ) => {
        appendAttempts += 1;
        if (appendAttempts === 1) {
          await appendFile(content.slice(0, 1), encoding);
          throw new Error("disk full");
        }
        await appendFile(content, encoding);
      };
      return handle;
    });

    const ctx = createContext({
      logPath: "/tmp/partial-log/session.jsonl"
    });

    await applyMiddlewares([spawnLog, source], ctx);
    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual(sourceEvents);
    expect(appendAttempts).toBe(1);
    await expect(fs.readFile(ctx.logFile!, "utf8")).resolves.toBe("");
  });

  it("surfaces an append failure when a partial log cannot be rolled back", async () => {
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        yield { event: "agent_message", text: "first" } as AcpEvent;
      })();
    };

    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (filePath, flags) => {
      const handle = await realOpen(filePath, flags);
      const appendFile = handle.appendFile.bind(handle);
      (handle as unknown as { appendFile: (content: string, encoding: string) => Promise<void> }).appendFile = async (
        content,
        encoding
      ) => {
        await appendFile(content.slice(0, 1), encoding);
        throw new Error("disk full");
      };
      (handle as unknown as { truncate: (length: number) => Promise<void> }).truncate = async () => {
        throw new Error("truncate failed");
      };
      return handle;
    });

    const ctx = createContext({
      logPath: "/tmp/unrecoverable-log/session.jsonl"
    });

    await applyMiddlewares([spawnLog, source], ctx);

    await expect(collect(ctx.eventStream!)).rejects.toThrow("failed to restore ACP spawn log after append failure");
  });

  it("logs preloaded events when no event stream is available", async () => {
    const ctx = createContext({
      agent: "codex",
      logDir: "/tmp/preloaded-logs",
      logContent: true,
      startedAt: new Date("2026-03-20T12:34:56.789Z"),
      events: [
        { event: "session_start", threadId: "thread-preloaded" },
        { event: "agent_message", text: "preloaded event" }
      ]
    });

    await applyMiddlewares([spawnLog], ctx);

    const files = await fs.readdir("/tmp/preloaded-logs");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^20260320-123456-789-codex-[\w-]+\.jsonl$/);

    const content = await fs.readFile(path.join("/tmp/preloaded-logs", files[0]), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual(ctx.events);
  });

  it("sets ctx.logFile to the resolved log file path", async () => {
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        yield { event: "agent_message", text: "hello" } as AcpEvent;
      })();
    };

    const ctx = createContext({
      agent: "codex",
      logDir: "/tmp/spawn-logs",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    await collect(ctx.eventStream!);

    expect(ctx.logFile).toMatch(/^\/tmp\/spawn-logs\/20260320-123456-789-codex-[\w-]+\.jsonl$/);
  });

  it("separates generated logs for sessions started in the same millisecond", async () => {
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        yield { event: "agent_message", text: ctx.sessionId } as AcpEvent;
      })();
    };
    const startedAt = new Date("2026-03-20T12:34:56.789Z");
    const first = createContext({
      sessionId: "thread-one",
      agent: "codex",
      logDir: "/tmp/spawn-logs",
      startedAt
    });
    const second = createContext({
      sessionId: "thread-two",
      agent: "codex",
      logDir: "/tmp/spawn-logs",
      startedAt
    });

    await applyMiddlewares([spawnLog, source], first);
    await collect(first.eventStream!);
    await applyMiddlewares([spawnLog, source], second);
    await collect(second.eventStream!);

    expect(first.logFile).not.toBe(second.logFile);
    expect(await fs.readdir("/tmp/spawn-logs")).toHaveLength(2);
  });

  it("separates generated logs before a session id is known", async () => {
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        yield { event: "agent_message", text: "pending" } as AcpEvent;
      })();
    };
    const startedAt = new Date("2026-03-20T12:34:56.789Z");
    const first = createContext({ agent: "codex", logDir: "/tmp/spawn-logs", startedAt });
    const second = createContext({ agent: "codex", logDir: "/tmp/spawn-logs", startedAt });

    await applyMiddlewares([spawnLog, source], first);
    await collect(first.eventStream!);
    await applyMiddlewares([spawnLog, source], second);
    await collect(second.eventStream!);

    expect(first.logFile).not.toBe(second.logFile);
  });

  it("opens the file handle lazily and closes it when the stream completes", async () => {
    const sourceEvents: AcpEvent[] = [{ event: "agent_message", text: "close me" }];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const realOpen = fs.open.bind(fs);
    let closeCalls = 0;

    vi.spyOn(fs, "open").mockImplementation(async (filePath, flags) => {
      const handle = await realOpen(filePath, flags);
      const close = handle.close.bind(handle);
      (handle as unknown as { close: () => Promise<void> }).close = async () => {
        closeCalls += 1;
        await close();
      };
      return handle;
    });

    const ctx = createContext({
      logDir: "/tmp/close-logs",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    await collect(ctx.eventStream!);

    expect(closeCalls).toBe(1);
  });
});

describe("acp/middlewares/usageCapture", () => {
  it("accumulates usage totals while preserving event stream", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "session_start", threadId: "thread-123" },
      { event: "usage", inputTokens: 1, outputTokens: 2 },
      { event: "agent_message", text: "hello" },
      { event: "usage", inputTokens: 3, outputTokens: 4, cachedTokens: 5 },
      { event: "usage", inputTokens: 6, outputTokens: 7, cachedTokens: 0 }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([usageCapture, source], ctx);

    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual(sourceEvents);
    expect(observed[0]).toBe(sourceEvents[0]);
    expect(observed[1]).toBe(sourceEvents[1]);
    expect(observed[2]).toBe(sourceEvents[2]);

    expect(ctx.usage).toEqual({
      inputTokens: 10,
      outputTokens: 13,
      cachedTokens: 5
    });
  });

  it("accumulates usage from preloaded events without an event stream", async () => {
    const preloadedEvents: AcpEvent[] = [
      { event: "usage", inputTokens: 10, outputTokens: 20 },
      { event: "agent_message", text: "ignored" },
      { event: "usage", inputTokens: 30, outputTokens: 40, cachedTokens: 50 }
    ];

    const ctx = createContext({ events: [...preloadedEvents] });
    await applyMiddlewares([usageCapture], ctx);

    expect(ctx.eventStream).toBeUndefined();
    expect(ctx.usage).toEqual({
      inputTokens: 40,
      outputTokens: 60,
      cachedTokens: 50
    });
  });

  it("does not recount preloaded stream events while capturing later usage", async () => {
    const preloadedEvent: AcpEvent = { event: "usage", inputTokens: 10, outputTokens: 20 };
    const laterEvent: AcpEvent = { event: "usage", inputTokens: 30, outputTokens: 40 };
    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        yield preloadedEvent;
        yield laterEvent;
      })();
    };
    const ctx = createContext({
      events: [preloadedEvent],
      usage: { inputTokens: 10, outputTokens: 20 }
    });

    await applyMiddlewares([usageCapture, source], ctx);
    await collect(ctx.eventStream!);

    expect(ctx.usage).toEqual({ inputTokens: 40, outputTokens: 60 });
  });

  it("ignores malformed usage payloads", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "usage", inputTokens: 1, outputTokens: 2 },
      { event: "usage", inputTokens: "bad", outputTokens: 3 } as unknown as AcpEvent,
      { event: "usage", inputTokens: 4, outputTokens: null } as unknown as AcpEvent,
      { event: "usage", inputTokens: 5, outputTokens: 6, cachedTokens: "bad" } as unknown as AcpEvent
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([usageCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.usage).toEqual({
      inputTokens: 10,
      outputTokens: 11
    });
  });

  it("ignores non-finite usage values", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3 },
      {
        event: "usage",
        inputTokens: Number.NaN,
        outputTokens: Number.POSITIVE_INFINITY,
        cachedTokens: Number.NEGATIVE_INFINITY
      } as unknown as AcpEvent,
      { event: "usage", inputTokens: 4, outputTokens: 5, cachedTokens: 6 }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([usageCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.usage).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      cachedTokens: 9
    });
  });

  it("ignores negative usage values", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "usage", inputTokens: 3, outputTokens: 4, cachedTokens: 5 },
      { event: "usage", inputTokens: -1, outputTokens: -2, cachedTokens: -3 } as unknown as AcpEvent,
      { event: "usage", inputTokens: 6, outputTokens: 7, cachedTokens: 8 }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([usageCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.usage).toEqual({
      inputTokens: 9,
      outputTokens: 11,
      cachedTokens: 13
    });
  });
});
