import { describe, expect, it } from "vitest";

import type { SpawnEvent } from "../../types.js";
import { normalizeTrace } from "./normalize.js";

describe("normalizeTrace", () => {
  it("normalizes tool operations, arguments, and referenced paths in order", () => {
    const events = [
      toolCall("read-1", "Read file", "read", { path: "src/read.ts" }, [{ path: "src/read.ts" }]),
      toolStart("search-1", "Search files", "search", { pattern: "../outside", path: "src" }),
      toolStart("exec-1", "Run tests", "execute", { command: "/usr/bin/npm test" }),
      toolStart("edit-1", "Patch file", "edit", { file_path: "src/edit.ts" }),
      toolStart("write-1", "Write file", "write", { filePath: "src/new.ts" }),
      toolCall("mcp-1", "filesystem.read", "other", { path: "/tmp/input.txt" })
    ];

    const trace = normalizeTrace(events);

    expect(trace.events).toEqual([
      expect.objectContaining({
        type: "tool",
        sequence: 0,
        name: "Read file",
        operation: "read",
        paths: ["src/read.ts"],
        rawArguments: { path: "src/read.ts" }
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 1,
        name: "Search files",
        operation: "search",
        paths: ["src", "../outside"],
        rawArguments: { pattern: "../outside", path: "src" }
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 2,
        name: "Run tests",
        operation: "exec",
        paths: ["/usr/bin/npm"],
        rawArguments: { command: "/usr/bin/npm test" }
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 3,
        name: "Patch file",
        operation: "edit",
        paths: ["src/edit.ts"]
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 4,
        name: "Write file",
        operation: "write",
        paths: ["src/new.ts"]
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 5,
        name: "filesystem.read",
        operation: "mcp",
        paths: ["/tmp/input.txt"]
      })
    ]);
  });

  it("normalizes messages, usage totals, errors, timestamps, and malformed events", () => {
    const trace = normalizeTrace([
      { event: "agent_message", text: "working", timestamp: "2026-05-23T12:00:00Z" } as SpawnEvent,
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "checking" }
      } as SpawnEvent,
      {
        event: "usage",
        inputTokens: 10,
        outputTokens: 4,
        cachedTokens: 2,
        costUsd: 0.1
      } as SpawnEvent,
      {
        sessionUpdate: "usage_update",
        used: 3,
        size: 5,
        cost: { amount: 0.2, currency: "USD" }
      } as SpawnEvent,
      { event: "usage", inputTokens: -1, outputTokens: 1 } as SpawnEvent,
      { event: "error", message: "boom" } as SpawnEvent,
      { event: "agent_message" } as SpawnEvent
    ]);

    expect(trace.events).toEqual([
      { type: "message", sequence: 0, text: "working", timestamp: "2026-05-23T12:00:00Z" },
      { type: "message", sequence: 1, text: "checking", channel: "reasoning" },
      {
        type: "usage",
        sequence: 2,
        usage: { inputTokens: 10, outputTokens: 4, cachedTokens: 2, costUsd: 0.1 }
      },
      {
        type: "usage",
        sequence: 3,
        usage: { inputTokens: 3, outputTokens: 0, cachedTokens: 2, costUsd: 0.2 }
      },
      { type: "error", sequence: 5, message: "boom" }
    ]);
    expect(trace.usage).toEqual({
      inputTokens: 13,
      outputTokens: 4,
      cachedTokens: 4,
      costUsd: 0.30000000000000004
    });
  });

  it("preserves tool completion and failure outcomes", () => {
    const trace = normalizeTrace([
      toolCall("ok", "Read ok", "read", { path: "src/ok.ts" }),
      { sessionUpdate: "tool_call_update", toolCallId: "ok", status: "completed" } as SpawnEvent,
      toolStart("bad", "Run bad", "exec", { command: "false" }),
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "bad",
        status: "failed",
        rawOutput: "failed"
      } as SpawnEvent,
      { event: "tool_complete", id: "write", kind: "write", path: "src/written.ts" } as SpawnEvent
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({
        type: "tool",
        sequence: 0,
        phase: "start",
        id: "ok",
        operation: "read"
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 1,
        phase: "complete",
        id: "ok",
        name: "Read ok",
        operation: "read",
        outcome: "completed"
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 2,
        phase: "start",
        id: "bad",
        operation: "exec"
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 3,
        phase: "complete",
        id: "bad",
        name: "Run bad",
        operation: "exec",
        outcome: "failed",
        rawOutput: "failed"
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 4,
        phase: "complete",
        id: "write",
        operation: "write",
        paths: ["src/written.ts"],
        outcome: "completed"
      })
    ]);
  });

  it("preserves evidence when ACP emits only a terminal tool update", () => {
    const trace = normalizeTrace([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "terminal-only",
        title: "Write result",
        kind: "write",
        rawInput: { path: "src/result.ts", content: "ok" },
        rawOutput: "written",
        locations: [{ path: "src/result.ts" }],
        status: "completed"
      } as SpawnEvent,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "cancelled",
        title: "Run cancelled",
        kind: "execute",
        rawInput: { command: "npm test" },
        status: "cancelled"
      } as SpawnEvent
    ]);

    expect(trace.events).toEqual([
      {
        type: "tool",
        sequence: 0,
        phase: "complete",
        id: "terminal-only",
        name: "Write result",
        operation: "write",
        rawArguments: { path: "src/result.ts", content: "ok" },
        rawOutput: "written",
        paths: ["src/result.ts"],
        outcome: "completed"
      },
      {
        type: "tool",
        sequence: 1,
        phase: "complete",
        id: "cancelled",
        name: "Run cancelled",
        operation: "exec",
        rawArguments: { command: "npm test" },
        paths: ["npm"],
        outcome: "cancelled"
      }
    ]);
  });

  it("normalizes terminal tool-call records and ignores malformed tools", () => {
    const trace = normalizeTrace([
      {
        sessionUpdate: "tool_call",
        toolCallId: "finished",
        title: "Read finished",
        kind: "read",
        rawInput: { path: "src/finished.ts" },
        locations: [{ path: "src/finished.ts" }],
        status: "failed"
      } as SpawnEvent,
      { sessionUpdate: "tool_call", toolCallId: "missing-title", kind: "read" } as SpawnEvent,
      { event: "tool_start", id: "missing-kind", title: "Broken" } as SpawnEvent,
      { sessionUpdate: "tool_call_update", status: "completed" } as SpawnEvent
    ]);

    expect(trace.events).toEqual([
      {
        type: "tool",
        sequence: 0,
        phase: "complete",
        id: "finished",
        name: "Read finished",
        operation: "read",
        rawArguments: { path: "src/finished.ts" },
        paths: ["src/finished.ts"],
        outcome: "failed"
      }
    ]);
  });
});

function toolCall(
  id: string,
  title: string,
  kind: string,
  rawInput: unknown,
  locations?: readonly { path: string }[]
): SpawnEvent {
  return {
    sessionUpdate: "tool_call",
    toolCallId: id,
    title,
    kind,
    rawInput,
    ...(locations === undefined ? {} : { locations })
  } as SpawnEvent;
}

function toolStart(id: string, title: string, kind: string, input: unknown): SpawnEvent {
  return { event: "tool_start", id, title, kind, input } as SpawnEvent;
}
