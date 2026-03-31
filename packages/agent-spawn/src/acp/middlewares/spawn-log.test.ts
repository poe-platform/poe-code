import path from "node:path";
import { homedir } from "node:os";
import * as fs from "node:fs/promises";
import { describe, expect, it, beforeEach, afterEach, vi } from "bun:test";
import { vol } from "memfs";

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const memfsPromises = require("memfs").fs.promises as typeof fs;
    vi.spyOn(fs, "mkdir").mockImplementation(memfsPromises.mkdir.bind(memfsPromises));
    vi.spyOn(fs, "open").mockImplementation(memfsPromises.open.bind(memfsPromises));
    vi.spyOn(fs, "readFile").mockImplementation(memfsPromises.readFile.bind(memfsPromises));
    vi.spyOn(fs, "readdir").mockImplementation(memfsPromises.readdir.bind(memfsPromises));
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
    const before = Date.now();
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
    const after = Date.now();

    const files = await fs.readdir("/tmp/spawn-logs");
    expect(files).toHaveLength(1);
    const [file] = files;
    expect(file.endsWith("-codex.jsonl")).toBe(true);

    const timestamp = file.slice(0, "YYYYMMDD-HHMMSS-SSS".length);
    const [day, time, millis] = timestamp.split("-");
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(4, 6));
    const date = Number(day.slice(6, 8));
    const hours = Number(time.slice(0, 2));
    const minutes = Number(time.slice(2, 4));
    const seconds = Number(time.slice(4, 6));
    const parsedMillis = Number(millis);
    const parsedTime = Date.UTC(year, month - 1, date, hours, minutes, seconds, parsedMillis);
    expect(parsedTime).toBeGreaterThanOrEqual(before - 1000);
    expect(parsedTime).toBeLessThanOrEqual(after + 1000);
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

    const ctx = createContext({
      logDir: "/tmp/close-logs",
      startedAt: new Date("2026-03-20T12:34:56.789Z")
    });

    await applyMiddlewares([spawnLog, source], ctx);
    await collect(ctx.eventStream!);

    const files = await fs.readdir("/tmp/close-logs");
    expect(files).toEqual(["20260320-123456-789-codex.jsonl"]);
    const content = await fs.readFile(path.join("/tmp/close-logs", files[0]), "utf8");
    expect(content.trim().length).toBeGreaterThan(0);
  });
});
