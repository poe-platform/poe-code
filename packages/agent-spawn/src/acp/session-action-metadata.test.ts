import { describe, expect, it } from "vitest";
import { createToolRenderState, sessionUpdateToEvents } from "./session-update-converter.js";

describe("ACP action metadata", () => {
  it("retains search inputs and terminal failures", () => {
    const state = createToolRenderState();
    const events = sessionUpdateToEvents({ sessionUpdate: "tool_call", toolCallId: "search", title: "Grep", kind: "search", rawInput: { pattern: "validation", path: "src" } }, state);
    expect(events[0]).toMatchObject({ kind: "search", input: { pattern: "validation", path: "src" } });
    const completed = sessionUpdateToEvents({ sessionUpdate: "tool_call_update", toolCallId: "search", status: "failed", rawOutput: "Permission denied" }, state);
    expect(completed[0]).toMatchObject({ event: "tool_complete", kind: "search", status: "failed" });
  });

  it("renders tool calls that first arrive in a terminal state", () => {
    const events = sessionUpdateToEvents({ sessionUpdate: "tool_call", toolCallId: "cmd", title: "Shell", kind: "execute", status: "completed", rawInput: { command: "npm test" } }, createToolRenderState());
    expect(events).toEqual([
      expect.objectContaining({ event: "tool_start", input: { command: "npm test" } }),
      expect.objectContaining({ event: "tool_complete", status: "completed" })
    ]);
  });
});
