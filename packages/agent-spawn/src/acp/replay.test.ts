import path from "node:path";
import { homedir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("toolcraft-design", () => ({
  acp: {
    renderAgentMessage: vi.fn(),
    renderToolStart: vi.fn(),
    renderToolComplete: vi.fn(),
    renderReasoning: vi.fn(),
    renderUsage: vi.fn(),
    renderError: vi.fn()
  },
  text: {
    muted: (content: string) => `<muted>${content}</muted>`
  },
  resolveOutputFormat: () => "terminal"
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

import { acp } from "toolcraft-design";
import type { SessionUpdate } from "@poe-code/poe-acp-client";
import {
  findLatestLog,
  listSpawnLogs,
  type MalformedSpawnLogRecord,
  pickRandomLog,
  readSpawnLog,
  replaySpawnLog
} from "./replay.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

function createLogFile(filename: string): string {
  return path.join(homedir(), ".poe-code", "spawn-logs", filename);
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

describe("acp/replay", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("readSpawnLog yields raw SessionUpdate objects from a JSONL file", async () => {
    const updates: SessionUpdate[] = [
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
      { sessionUpdate: "usage_update", used: 1, size: 3 }
    ];

    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: updates
        .map((u) => JSON.stringify(u))
        .join("\n")
    });

    const observed = await collect(readSpawnLog(createLogFile("20260320-123456-789-codex.jsonl")));

    expect(observed).toEqual(updates);
  });

  it("readSpawnLog converts legacy internal events to SessionUpdate", async () => {
    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: [
        JSON.stringify({ event: "agent_message", text: "hello" }),
        JSON.stringify({ event: "reasoning", text: "thinking" })
      ].join("\n")
    });

    const observed = await collect(readSpawnLog(createLogFile("20260320-123456-789-codex.jsonl")));

    expect(observed).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } }
    ]);
  });

  it("readSpawnLog skips blank lines", async () => {
    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: [
        JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } }),
        "",
        "   ",
        JSON.stringify({ sessionUpdate: "usage_update", used: 1, size: 3 }),
        ""
      ].join("\n")
    });

    const observed = await collect(readSpawnLog(createLogFile("20260320-123456-789-codex.jsonl")));

    expect(observed).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
      { sessionUpdate: "usage_update", used: 1, size: 3 }
    ]);
  });

  it("readSpawnLog skips malformed JSONL records and reports their location", async () => {
    const filePath = createLogFile("20260320-123456-789-codex.jsonl");
    const onMalformedRecord = vi.fn<(record: MalformedSpawnLogRecord) => void>();
    vol.fromJSON({
      [filePath]: [
        JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } }),
        "{not valid json",
        JSON.stringify({ sessionUpdate: "usage_update", used: 1, size: 3 })
      ].join("\n")
    });

    const observed = await collect(readSpawnLog(filePath, { onMalformedRecord }));

    expect(observed).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } },
      { sessionUpdate: "usage_update", used: 1, size: 3 }
    ]);
    expect(onMalformedRecord).toHaveBeenCalledWith({
      filePath,
      lineNumber: 2,
      message: expect.any(String)
    });
    expect(onMalformedRecord.mock.calls[0]?.[0].message.length).toBeGreaterThan(0);
  });

  it("readSpawnLog rejects malformed JSONL records in strict mode with path and line context", async () => {
    const filePath = createLogFile("20260320-123456-789-codex.jsonl");
    const onMalformedRecord = vi.fn<(record: MalformedSpawnLogRecord) => void>();
    vol.fromJSON({
      [filePath]: [
        JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } }),
        "{not valid json",
        JSON.stringify({ sessionUpdate: "usage_update", used: 1, size: 3 })
      ].join("\n")
    });

    await expect(
      collect(readSpawnLog(filePath, { strict: true, onMalformedRecord }))
    ).rejects.toThrow(`Malformed spawn log record at ${filePath}:2`);
    expect(onMalformedRecord).not.toHaveBeenCalled();
  });

  it("readSpawnLog reports parsed records that are not session updates or legacy events", async () => {
    const filePath = createLogFile("20260320-123456-789-codex.jsonl");
    const onMalformedRecord = vi.fn<(record: MalformedSpawnLogRecord) => void>();
    vol.fromJSON({
      [filePath]: [
        JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } }),
        JSON.stringify({ type: "unexpected", value: true }),
        JSON.stringify({ sessionUpdate: "usage_update", used: 1, size: 3 })
      ].join("\n")
    });

    const observed = await collect(readSpawnLog(filePath, { onMalformedRecord }));

    expect(observed).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } },
      { sessionUpdate: "usage_update", used: 1, size: 3 }
    ]);
    expect(onMalformedRecord).toHaveBeenCalledWith({
      filePath,
      lineNumber: 2,
      message: "Unknown spawn log record shape."
    });
  });

  it("readSpawnLog rejects unknown parsed record shapes in strict mode", async () => {
    const filePath = createLogFile("20260320-123456-789-codex.jsonl");
    vol.fromJSON({
      [filePath]: JSON.stringify({ type: "unexpected", value: true })
    });

    await expect(collect(readSpawnLog(filePath, { strict: true }))).rejects.toThrow(
      `Malformed spawn log record at ${filePath}:1: Unknown spawn log record shape.`
    );
  });

  it("readSpawnLog writes contextual warnings for malformed JSONL records by default", async () => {
    const filePath = createLogFile("20260320-123456-789-codex.jsonl");
    const stderrChunks: string[] = [];
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    vol.fromJSON({
      [filePath]: [
        JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } }),
        "{not valid json",
        JSON.stringify({ sessionUpdate: "usage_update", used: 1, size: 3 })
      ].join("\n")
    });

    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
      const callback = typeof rest.at(-1) === "function" ? (rest.at(-1) as (() => void)) : undefined;
      callback?.();
      return true;
    }) as typeof process.stderr.write;

    try {
      await collect(readSpawnLog(filePath));
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    expect(stderrChunks.join("")).toContain(`Skipping malformed spawn log record at ${filePath}:2:`);
  });

  it("listSpawnLogs returns sorted log entries", async () => {
    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: "",
      [createLogFile("20260321-010203-004-claude-code.jsonl")]: "",
      [createLogFile("notes.txt")]: "ignore",
      [path.join(
        homedir(),
        ".poe-code",
        "spawn-logs",
        "nested",
        "20260322-000000-000-codex.jsonl"
      )]: "ignore"
    });

    const entries = await listSpawnLogs();

    expect(entries.map((entry) => entry.filename)).toEqual([
      "20260321-010203-004-claude-code.jsonl",
      "20260320-123456-789-codex.jsonl"
    ]);
    expect(entries[0]).toMatchObject({
      path: createLogFile("20260321-010203-004-claude-code.jsonl"),
      filename: "20260321-010203-004-claude-code.jsonl",
      agent: "claude-code"
    });
    expect(entries[0].timestamp?.toISOString()).toBe("2026-03-21T01:02:03.004Z");
    expect(entries[1]).toMatchObject({
      path: createLogFile("20260320-123456-789-codex.jsonl"),
      filename: "20260320-123456-789-codex.jsonl",
      agent: "codex"
    });
    expect(entries[1].timestamp?.toISOString()).toBe("2026-03-20T12:34:56.789Z");
  });

  it("listSpawnLogs returns an empty array when the log directory is missing", async () => {
    await expect(listSpawnLogs()).resolves.toEqual([]);
  });

  it("listSpawnLogs rejects a default log directory symlink outside state", async () => {
    const stateDir = path.join(homedir(), ".poe-code");
    const logDir = path.join(stateDir, "spawn-logs");
    const outsideDir = path.join(homedir(), "outside");
    vol.mkdirSync(stateDir, { recursive: true });
    vol.mkdirSync(outsideDir, { recursive: true });
    vol.symlinkSync(outsideDir, logDir);
    vol.writeFileSync(path.join(outsideDir, "20260320-123456-789-codex.jsonl"), "secret");

    await expect(listSpawnLogs()).rejects.toThrow("symbolic links");
  });

  it("does not ignore default log directory symlinks with inherited missing-path codes", async () => {
    const stateDir = path.join(homedir(), ".poe-code");
    const logDir = path.join(stateDir, "spawn-logs");
    const realLogDir = path.join(stateDir, "real-logs");
    vol.mkdirSync(realLogDir, { recursive: true });
    vol.symlinkSync(realLogDir, logDir);

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(listSpawnLogs()).rejects.toThrow("symbolic links");
    });
  });

  it("listSpawnLogs rejects a symlinked default state root", async () => {
    const stateDir = path.join(homedir(), ".poe-code");
    const outsideDir = path.join(homedir(), "outside-state");
    vol.mkdirSync(homedir(), { recursive: true });
    vol.mkdirSync(path.join(outsideDir, "spawn-logs"), { recursive: true });
    vol.symlinkSync(outsideDir, stateDir);
    vol.writeFileSync(
      path.join(outsideDir, "spawn-logs", "20260320-123456-789-codex.jsonl"),
      "external"
    );

    await expect(listSpawnLogs()).rejects.toThrow("symbolic links");
  });

  it("listSpawnLogs keeps jsonl files even when metadata cannot be derived", async () => {
    vol.fromJSON({
      [createLogFile("manual.jsonl")]: "",
      [createLogFile("20260320-123456-789-codex.jsonl")]: ""
    });

    const entries = await listSpawnLogs();

    expect(entries.map((entry) => entry.filename)).toEqual([
      "manual.jsonl",
      "20260320-123456-789-codex.jsonl"
    ]);
    expect(entries[0]).toEqual({
      path: createLogFile("manual.jsonl"),
      filename: "manual.jsonl",
      agent: undefined,
      timestamp: undefined
    });
  });

  it("listSpawnLogs applies the default limit of 80", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 81 }, (_, index) => {
        const serial = String(index).padStart(3, "0");
        return [createLogFile(`20260320-123456-${serial}-codex-${serial}.jsonl`), ""];
      })
    );

    vol.fromJSON(files);

    const entries = await listSpawnLogs();

    expect(entries).toHaveLength(80);
    expect(entries[0]?.filename).toBe("20260320-123456-080-codex-080.jsonl");
    expect(entries.at(-1)?.filename).toBe("20260320-123456-001-codex-001.jsonl");
  });

  it("listSpawnLogs filters by agent name", async () => {
    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: "",
      [createLogFile("20260321-123456-789-claude-code.jsonl")]: "",
      [createLogFile("20260322-123456-789-codex.jsonl")]: ""
    });

    const entries = await listSpawnLogs({ agent: "codex" });

    expect(entries.map((entry) => entry.filename)).toEqual([
      "20260322-123456-789-codex.jsonl",
      "20260320-123456-789-codex.jsonl"
    ]);
    expect(entries.every((entry) => entry.agent === "codex")).toBe(true);
  });

  it("findLatestLog returns the most recent log path", async () => {
    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: "",
      [createLogFile("20260321-123456-789-codex.jsonl")]: "",
      [createLogFile("20260322-123456-789-claude-code.jsonl")]: ""
    });

    expect(await findLatestLog()).toBe(createLogFile("20260322-123456-789-claude-code.jsonl"));
    expect(await findLatestLog("codex")).toBe(createLogFile("20260321-123456-789-codex.jsonl"));
  });

  it("findLatestLog prefers newer timestamped logs over custom filenames", async () => {
    vol.fromJSON({
      [createLogFile("manual.jsonl")]: "",
      [createLogFile("20260322-123456-789-codex.jsonl")]: ""
    });

    expect(await findLatestLog()).toBe(createLogFile("20260322-123456-789-codex.jsonl"));
  });

  it("findLatestLog returns undefined when there is no matching log", async () => {
    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: ""
    });

    await expect(findLatestLog("claude-code")).resolves.toBeUndefined();
  });

  it("pickRandomLog returns a valid log path", async () => {
    const expectedPaths = [
      createLogFile("20260320-123456-789-codex.jsonl"),
      createLogFile("20260321-123456-789-codex.jsonl")
    ];

    vol.fromJSON({
      [expectedPaths[0]]: "",
      [expectedPaths[1]]: "",
      [createLogFile("20260322-123456-789-claude-code.jsonl")]: ""
    });

    vi.spyOn(Math, "random").mockReturnValue(0);

    const picked = await pickRandomLog("codex");

    expect(expectedPaths).toContain(picked);
    expect(picked).toBe(expectedPaths[1]);
  });

  it("pickRandomLog returns undefined when there are no matching logs", async () => {
    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: ""
    });

    await expect(pickRandomLog("claude-code")).resolves.toBeUndefined();
  });

  it("replaySpawnLog renders raw SessionUpdate events from a JSONL log", async () => {
    vol.fromJSON({
      [createLogFile("20260320-123456-789-codex.jsonl")]: [
        "",
        JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } }),
        JSON.stringify({ sessionUpdate: "usage_update", used: 3, size: 8 }),
        ""
      ].join("\n")
    });

    await replaySpawnLog(createLogFile("20260320-123456-789-codex.jsonl"));

    expect(acp.renderAgentMessage).toHaveBeenCalledWith("hello");
    expect(acp.renderUsage).toHaveBeenCalledWith({
      input: 3,
      output: 0,
      cached: 5
    });
  });

  it("replaySpawnLog renders valid records around malformed JSONL records", async () => {
    const filePath = createLogFile("20260320-123456-789-codex.jsonl");
    const onMalformedRecord = vi.fn<(record: MalformedSpawnLogRecord) => void>();
    vol.fromJSON({
      [filePath]: [
        JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } }),
        "{not valid json",
        JSON.stringify({ sessionUpdate: "usage_update", used: 3, size: 8 })
      ].join("\n")
    });

    await replaySpawnLog(filePath, { onMalformedRecord });

    expect(acp.renderAgentMessage).toHaveBeenCalledWith("hello");
    expect(acp.renderUsage).toHaveBeenCalledWith({
      input: 3,
      output: 0,
      cached: 5
    });
    expect(onMalformedRecord).toHaveBeenCalledWith(expect.objectContaining({ filePath, lineNumber: 2 }));
  });
});
