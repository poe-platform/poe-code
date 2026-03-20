import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import auditLog from "./poe-agent-plugin-audit-log.js";

const appendFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({
  appendFile: appendFileMock,
}));

describe("poe-agent-plugin-audit-log", () => {
  beforeEach(() => {
    appendFileMock.mockReset();
  });

  it("writes one JSONL record per tool invocation", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    appendFileMock.mockImplementation(fs.appendFile.bind(fs));

    const plugin = auditLog("/audit.jsonl");
    const postToolUse = plugin.hooks?.postToolUse;
    const signal = new AbortController().signal;

    await postToolUse?.({
      tool: "read_file",
      args: { path: "README.md" },
      intentId: "intent-1",
      messages: [],
      signal,
    });
    await postToolUse?.({
      tool: "run_command",
      args: { command: "ls" },
      intentId: "intent-2",
      messages: [],
      signal,
    });

    const lines = volume.readFileSync("/audit.jsonl", "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as { ts: string; tool: string };
    const second = JSON.parse(lines[1]) as { ts: string; tool: string };

    expect(first.tool).toBe("read_file");
    expect(second.tool).toBe("run_command");
    expect(Number.isNaN(Date.parse(first.ts))).toBe(false);
    expect(Number.isNaN(Date.parse(second.ts))).toBe(false);
  });

  it("writes JSONL with only timestamp and tool fields", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    appendFileMock.mockImplementation(fs.appendFile.bind(fs));

    const plugin = auditLog("/audit.jsonl");
    await plugin.hooks?.postToolUse?.({
      tool: "search_web",
      args: { query: "docs" },
      intentId: "intent-3",
      messages: [],
      result: { text: "ok" },
      error: "ignored",
      signal: new AbortController().signal,
    });

    const line = volume.readFileSync("/audit.jsonl", "utf8").trim();
    const record = JSON.parse(line) as Record<string, unknown>;

    expect(Object.keys(record).sort()).toEqual(["tool", "ts"]);
    expect(record.tool).toBe("search_web");
    expect(Number.isNaN(Date.parse(String(record.ts)))).toBe(false);
  });
});
