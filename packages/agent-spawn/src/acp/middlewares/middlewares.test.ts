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
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);

    const observed = await collect(ctx.eventStream!);
    expect(observed).toEqual(sourceEvents);

    const files = await fs.readdir("/tmp/spawn-logs");
    expect(files).toEqual(["20260320-123456-789-codex.jsonl"]);

    const content = await fs.readFile(path.join("/tmp/spawn-logs", files[0]), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.parse(line))).toEqual(sourceEvents);
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
    expect(files).toEqual(["20260320-123456-789-codex.jsonl"]);
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
      expect(files).toEqual(["20260320-000000-001-codex.jsonl"]);
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

  it("logs preloaded events when no event stream is available", async () => {
    const ctx = createContext({
      agent: "codex",
      logDir: "/tmp/preloaded-logs",
      startedAt: new Date("2026-03-20T12:34:56.789Z"),
      events: [
        { event: "session_start", threadId: "thread-preloaded" },
        { event: "agent_message", text: "preloaded event" }
      ]
    });

    await applyMiddlewares([spawnLog], ctx);

    const files = await fs.readdir("/tmp/preloaded-logs");
    expect(files).toEqual(["20260320-123456-789-codex.jsonl"]);

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

    expect(ctx.logFile).toBe("/tmp/spawn-logs/20260320-123456-789-codex.jsonl");
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
