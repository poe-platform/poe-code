import { describe, expect, it } from "vitest";
import type { SessionUpdate } from "@poe-code/poe-acp-client";
import { sessionUpdateToEvents, createToolRenderState, toRenderKind } from "./session-update-converter.js";

describe("session-update-converter", () => {
  describe("toRenderKind", () => {
    it("maps execute to exec", () => {
      expect(toRenderKind("execute")).toBe("exec");
    });

    it("maps write to edit", () => {
      expect(toRenderKind("write")).toBe("edit");
    });

    it("maps read to read", () => {
      expect(toRenderKind("read")).toBe("read");
    });

    it("maps undefined to other", () => {
      expect(toRenderKind(undefined)).toBe("other");
    });

    it("maps null to other", () => {
      expect(toRenderKind(null)).toBe("other");
    });

    it("maps other to other", () => {
      expect(toRenderKind("other")).toBe("other");
    });
  });

  describe("sessionUpdateToEvents", () => {
    it("converts agent_message_chunk to agent_message", () => {
      const update: SessionUpdate = {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" }
      };

      const events = sessionUpdateToEvents(update, createToolRenderState());

      expect(events).toEqual([{ event: "agent_message", text: "hello" }]);
    });

    it("converts agent_thought_chunk to reasoning", () => {
      const update: SessionUpdate = {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking" }
      };

      const events = sessionUpdateToEvents(update, createToolRenderState());

      expect(events).toEqual([{ event: "reasoning", text: "thinking" }]);
    });

    it("converts tool_call to tool_start", () => {
      const update: SessionUpdate = {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Shell",
        kind: "execute",
        status: "pending"
      };

      const events = sessionUpdateToEvents(update, createToolRenderState());

      expect(events).toEqual([{
        event: "tool_start",
        kind: "exec",
        title: "Shell",
        id: "tc-1"
      }]);
    });

    it("converts tool_call_update with completed status to tool_complete", () => {
      const state = createToolRenderState();
      state.startedToolCalls.add("tc-1");
      state.toolCallKinds.set("tc-1", "exec");
      state.toolCallTitles.set("tc-1", "Shell");

      const update: SessionUpdate = {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        kind: "execute",
        status: "completed"
      };

      const events = sessionUpdateToEvents(update, state);

      expect(events).toEqual([{
        event: "tool_complete",
        kind: "exec",
        path: "",
        id: "tc-1"
      }]);
    });

    it("reuses the started tool kind when an update omits kind", () => {
      const state = createToolRenderState();
      sessionUpdateToEvents(
        {
          sessionUpdate: "tool_call",
          toolCallId: "tc-1",
          title: "Read",
          kind: "read"
        },
        state
      );

      const events = sessionUpdateToEvents(
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-1",
          status: "completed"
        },
        state
      );

      expect(events).toEqual([
        {
          event: "tool_complete",
          kind: "read",
          path: "",
          id: "tc-1"
        }
      ]);
    });

    it("converts tool_call_update with location path as title", () => {
      const update: SessionUpdate = {
        sessionUpdate: "tool_call",
        toolCallId: "tc-2",
        title: "Read",
        kind: "read",
        locations: [{ path: "src/index.ts" }]
      };

      const events = sessionUpdateToEvents(update, createToolRenderState());

      expect(events[0]).toMatchObject({ title: "src/index.ts" });
    });

    it("converts usage_update to usage", () => {
      const update: SessionUpdate = {
        sessionUpdate: "usage_update",
        used: 100,
        size: 150,
        cost: { amount: 0.01, currency: "USD" }
      };

      const events = sessionUpdateToEvents(update, createToolRenderState());

      expect(events).toEqual([{
        event: "usage",
        inputTokens: 100,
        outputTokens: 0,
        cachedTokens: 50,
        costUsd: 0.01,
        costSource: "reported"
      }]);
    });

    it("returns empty for unrecognized session updates", () => {
      const update: SessionUpdate = {
        sessionUpdate: "plan",
        entries: []
      };

      const events = sessionUpdateToEvents(update, createToolRenderState());

      expect(events).toEqual([]);
    });

    it("deduplicates tool_call start events", () => {
      const state = createToolRenderState();

      const call: SessionUpdate = {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Shell",
        kind: "execute"
      };

      const first = sessionUpdateToEvents(call, state);
      const second = sessionUpdateToEvents(call, state);

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    });
  });
});
