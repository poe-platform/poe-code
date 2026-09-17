import { describe, expect, it } from "vitest";
import { adaptCodex } from "./codex.js";
import { adaptClaude } from "./claude.js";
import { adaptOpenCode } from "./opencode.js";
import { adaptPi } from "./pi.js";
import { adaptCursor } from "./cursor.js";
import { fromArray, collect } from "./test-utils.js";
import { summarizeToolAction } from "../acp/tool-summary.js";
import type { ToolStartEvent } from "../acp/types.js";

describe("agent action metadata", () => {
  it("preserves the full Codex command for concise parsing and reports nonzero exits", async () => {
    const file = `src/${"long-directory/".repeat(8)}validation.ts`;
    const command = `/bin/zsh -lc 'cat ${file}'`;
    const events = await collect(adaptCodex(fromArray([
      JSON.stringify({ type: "item.started", item: { id: "cmd", type: "command_execution", command } }),
      JSON.stringify({ type: "item.completed", item: { id: "cmd", type: "command_execution", command, exit_code: 1, status: "completed" } })
    ])));
    expect(events[0]).toMatchObject({ event: "tool_start", input: { command } });
    expect(summarizeToolAction(events[0] as ToolStartEvent)).toMatchObject({ label: expect.stringMatching(/^Read src\//), detail: command });
    expect(events[1]).toMatchObject({ event: "tool_complete", status: "failed" });
  });

  it("renders completed-only Codex file changes and web searches from the current JSONL schema", async () => {
    const events = await collect(adaptCodex(fromArray([
      JSON.stringify({ type: "item.completed", item: { id: "patch", type: "file_change", changes: [{ path: "src/app.ts", kind: "update" }], status: "failed" } }),
      JSON.stringify({ type: "item.started", item: { id: "web", type: "web_search", query: "API documentation" } }),
      JSON.stringify({ type: "item.completed", item: { id: "web", type: "web_search", query: "API documentation" } })
    ])));
    expect(events).toEqual([
      expect.objectContaining({ event: "tool_start", id: "patch", kind: "edit", title: "src/app.ts" }),
      expect.objectContaining({ event: "tool_complete", id: "patch", kind: "edit", status: "failed" }),
      expect.objectContaining({ event: "tool_start", id: "web", kind: "search", title: "API documentation" }),
      expect.objectContaining({ event: "tool_complete", id: "web", kind: "search" })
    ]);
  });

  it("reports Codex declined commands and fatal stream errors", async () => {
    const events = await collect(adaptCodex(fromArray([
      JSON.stringify({ type: "item.completed", item: { id: "cmd", type: "command_execution", command: "npm test", status: "declined" } }),
      JSON.stringify({ type: "error", message: "Connection lost" })
    ])));
    expect(events).toContainEqual(expect.objectContaining({ event: "tool_complete", status: "cancelled" }));
    expect(events).toContainEqual({ event: "error", message: "Connection lost" });
  });

  it("preserves Claude failed tool results", async () => {
    const events = await collect(adaptClaude(fromArray([
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read", content: "Permission denied", is_error: true }] } })
    ])));
    expect(events).toContainEqual(expect.objectContaining({ event: "tool_complete", status: "failed" }));
  });

  it.each(["failed", "cancelled"])("preserves OpenCode %s tool results", async (status) => {
    const events = await collect(adaptOpenCode(fromArray([
      JSON.stringify({ type: "tool_use", part: { callID: "cmd", tool: "bash", state: { status, input: { command: "npm test" }, output: "Stopped" } } })
    ])));
    expect(events).toContainEqual(expect.objectContaining({ event: "tool_complete", status }));
  });

  it("preserves Pi failed tool results in the shared status field", async () => {
    const events = await collect(adaptPi(fromArray([
      JSON.stringify({ type: "tool_execution_end", toolCallId: "cmd", toolName: "bash", isError: true })
    ])));
    expect(events).toContainEqual(expect.objectContaining({ event: "tool_complete", status: "failed" }));
  });

  it("preserves Cursor shell arguments so the dashboard can translate the action", async () => {
    const events = await collect(adaptCursor(fromArray([
      JSON.stringify({ type: "tool_call", subtype: "started", call_id: "cmd", tool_call: { shellToolCall: { args: { command: "cat src/app.ts" } } } })
    ])));
    expect(events[0]).toMatchObject({ event: "tool_start", kind: "exec", input: { command: "cat src/app.ts" } });
    expect(summarizeToolAction(events[0] as ToolStartEvent).label).toBe("Read src/app.ts");
  });
});
