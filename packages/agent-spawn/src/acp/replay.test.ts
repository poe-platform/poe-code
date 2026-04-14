import path from "node:path";
import { homedir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("@poe-code/design-system", () => ({
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

import { acp } from "@poe-code/design-system";
import type { SessionUpdate } from "@poe-code/poe-acp-client";
import {
  findLatestLog,
  listSpawnLogs,
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
});
