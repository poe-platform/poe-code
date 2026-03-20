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
import { spawnLog } from "./spawn-log.js";
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
