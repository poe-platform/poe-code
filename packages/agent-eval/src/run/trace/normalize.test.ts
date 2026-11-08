import { describe, expect, it } from "vitest";

import type { SpawnEvent } from "../../types.js";
import { normalizeTrace } from "./normalize.js";

describe("normalizeTrace", () => {
  it("normalizes tool operations, arguments, and referenced paths in order", () => {
    const events = [
      toolCall("read-1", "Read file", "read", { path: "src/read.ts" }, [{ path: "src/read.ts" }]),
      toolStart("search-1", "Search files", "search", { pattern: "needle", path: "src" }),
      toolStart("glob-1", "Glob outside", "glob", { pattern: "../outside" }),
      toolStart("exec-1", "Run tests", "execute", { command: "/usr/bin/npm test" }),
      toolStart("edit-1", "Patch file", "edit", { file_path: "src/edit.ts" }),
      toolStart("write-1", "Write file", "write", { filePath: "src/new.ts" }),
      toolCall("mcp-1", "filesystem.read", "other", { path: "/tmp/input.txt" }),
      toolCall("mcp-2", "mcp__filesystem__write_file", "other", { path: "/tmp/output.txt" })
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
        paths: ["src"],
        rawArguments: { pattern: "needle", path: "src" }
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 2,
        name: "Glob outside",
        operation: "search",
        paths: ["../outside"],
        rawArguments: { pattern: "../outside" }
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 3,
        name: "Run tests",
        operation: "exec",
        paths: [],
        rawArguments: { command: "/usr/bin/npm test" }
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 4,
        name: "Patch file",
        operation: "edit",
        paths: ["src/edit.ts"]
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 5,
        name: "Write file",
        operation: "write",
        paths: ["src/new.ts"]
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 6,
        name: "filesystem.read",
        operation: "mcp",
        paths: ["/tmp/input.txt"]
      }),
      expect.objectContaining({
        type: "tool",
        sequence: 7,
        name: "mcp__filesystem__write_file",
        operation: "mcp",
        paths: ["/tmp/output.txt"]
      })
    ]);
  });

  it("normalizes structured command path arguments without including executables", () => {
    const trace = normalizeTrace([
      toolStart("exec-1", "Copy file", "execute", {
        command: "/usr/bin/env",
        args: ["cp", "src/input.txt", "/private/output.txt"],
        cwd: "src"
      })
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({
        operation: "exec",
        paths: ["src", "src/input.txt", "/private/output.txt"],
        rawArguments: {
          command: "/usr/bin/env",
          args: ["cp", "src/input.txt", "/private/output.txt"],
          cwd: "src"
        }
      })
    ]);
  });

  it("does not treat URL arguments as filesystem targets", () => {
    const trace = normalizeTrace([
      toolStart("exec-1", "Fetch docs", "execute", {
        command: "/usr/bin/env",
        args: ["curl", "https://example.com/private/output.txt"]
      })
    ]);

    expect(trace.events).toEqual([expect.objectContaining({ operation: "exec", paths: [] })]);
  });

  it("reports shell script command arguments as uninspectable evidence", () => {
    const trace = normalizeTrace([
      toolStart("exec-1", "Shell write", "execute", {
        command: "/bin/sh",
        args: ["-c", "cat src/input.txt > /private/output.txt"]
      })
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({
        operation: "exec",
        paths: [],
        inspection: { status: "uninspectable", reason: "shell-command" }
      })
    ]);
  });

  it("reports env-wrapped shell scripts without extracting script paths", () => {
    const trace = normalizeTrace([
      toolStart("exec-1", "Wrapped shell write", "execute", {
        command: "/usr/bin/env",
        args: ["sh", "-c", "cat src/input.txt > /private/output.txt"]
      })
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({
        operation: "exec",
        paths: [],
        inspection: { status: "uninspectable", reason: "shell-command" }
      })
    ]);
  });

  it("reports shell syntax in structured arguments while retaining explicit directories", () => {
    const trace = normalizeTrace([
      toolStart("exec-1", "Wrapped script", "execute", {
        command: "/usr/bin/sudo",
        args: ["/bin/sh", "-c", "cat src/input.txt > /private/output.txt"],
        cwd: "src"
      })
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({
        operation: "exec",
        paths: ["src"],
        inspection: { status: "uninspectable", reason: "shell-command" }
      })
    ]);
  });

  it("extracts outside targets from adapter edit titles", () => {
    const trace = normalizeTrace([
      {
        event: "tool_start",
        id: "edit-1",
        kind: "edit",
        title: "/private/secret.txt"
      } as SpawnEvent
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({ operation: "edit", paths: ["/private/secret.txt"] })
    ]);
  });

  it("reports visible shell titles and targetless file tools as uninspectable", () => {
    const trace = normalizeTrace([
      {
        event: "tool_start",
        id: "exec-1",
        kind: "exec",
        title: "cat src/a > /private/out"
      } as SpawnEvent,
      { event: "tool_start", id: "mcp-1", kind: "other", title: "fs.write_file" } as SpawnEvent
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({
        operation: "exec",
        paths: [],
        inspection: { status: "uninspectable", reason: "shell-command" }
      }),
      expect.objectContaining({
        operation: "mcp",
        paths: [],
        inspection: { status: "uninspectable", reason: "missing-path" }
      })
    ]);
  });

  it("does not treat MCP completion output as a filesystem target", () => {
    const trace = normalizeTrace([
      toolCall("mcp-1", "fs.read", "other", { path: "src/local.txt" }),
      {
        event: "tool_complete",
        id: "mcp-1",
        kind: "other",
        path: "/private/output text"
      } as SpawnEvent
    ]);

    expect(trace.events[1]).toEqual(
      expect.objectContaining({ operation: "mcp", paths: ["src/local.txt"] })
    );
  });

  it("uses completion locations before declaring an MCP action uninspectable", () => {
    const trace = normalizeTrace([
      {
        sessionUpdate: "tool_call",
        toolCallId: "mcp-1",
        title: "fs.write_file",
        kind: "other"
      } as SpawnEvent,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "mcp-1",
        status: "completed",
        locations: [{ path: "/private/output.txt" }]
      } as SpawnEvent
    ]);

    expect(trace.events[0]).toEqual(
      expect.objectContaining({ inspection: { status: "uninspectable", reason: "missing-path" } })
    );
    expect(trace.events[1]).toEqual(
      expect.objectContaining({ operation: "mcp", paths: ["/private/output.txt"] })
    );
    expect(trace.events[1]).not.toHaveProperty("inspection");
  });

  it("does not report shell commands without file-affecting evidence", () => {
    const trace = normalizeTrace([
      toolStart("exec-1", "Shell echo", "execute", {
        command: "/bin/sh",
        args: ["-c", "echo hi"]
      })
    ]);

    expect(trace.events).toEqual([expect.objectContaining({ operation: "exec", paths: [] })]);
    expect(trace.events[0]).not.toHaveProperty("inspection");
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

  it("does not interpret command output paths as command targets", () => {
    const trace = normalizeTrace([
      {
        event: "tool_complete",
        id: "exec-output",
        kind: "exec",
        path: "/private/printed-output.txt\n"
      } as SpawnEvent
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({ operation: "exec", paths: [], outcome: "completed" })
    ]);
  });

  it("preserves explicit terminal-only legacy read paths", () => {
    const trace = normalizeTrace([
      {
        event: "tool_complete",
        title: "Read external",
        kind: "read",
        path: "/private/secret.txt"
      } as SpawnEvent
    ]);

    expect(trace.events).toEqual([
      expect.objectContaining({
        operation: "read",
        phase: "complete",
        paths: ["/private/secret.txt"],
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
        paths: [],
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
