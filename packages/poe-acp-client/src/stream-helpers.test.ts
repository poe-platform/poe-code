import { describe, expect, it } from "vitest";
import {
  extractMessagesFromSessionUpdateStream,
  extractToolCallSummariesFromSessionUpdateStream,
  extractUsageFromSessionUpdateStream,
  formatSessionUpdate,
  mapLegacyEventToSessionUpdates,
  parseSessionUpdate,
  type SessionUpdate,
  type SessionUpdateNotification,
  type ToolCallSummary,
} from "./index.js";

async function* toAsync<T>(values: T[]): AsyncGenerator<T> {
  for (const value of values) {
    yield value;
  }
}

function toNotification(sessionId: string, update: SessionUpdate): SessionUpdateNotification {
  const notification = parseSessionUpdate(formatSessionUpdate(sessionId, update));
  if (!notification) {
    throw new Error("Expected valid session update notification");
  }

  return notification;
}

describe("extractMessagesFromSessionUpdateStream", () => {
  it("extracts user, agent, and thought chunks from mixed stream items", async () => {
    const updates: SessionUpdate[] = [
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "User question" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Assistant answer" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Internal reasoning" },
      },
      {
        sessionUpdate: "usage_update",
        used: 42,
        size: 100,
      },
    ];

    const streamItems = [
      toNotification("session-1", updates[0]),
      updates[1],
      toNotification("session-1", updates[2]),
      updates[3],
    ];

    const extracted = await extractMessagesFromSessionUpdateStream(toAsync(streamItems));

    expect(extracted).toEqual([updates[0], updates[1], updates[2]]);
  });
});

describe("extractUsageFromSessionUpdateStream", () => {
  it("extracts usage updates from a session update stream", async () => {
    const usageOne: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 20,
      size: 100,
      cost: { amount: 0.01, currency: "USD" },
    };
    const usageTwo: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 30,
      size: 120,
    };

    const streamItems = [
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      } satisfies SessionUpdate,
      toNotification("session-2", usageOne),
      usageTwo,
    ];

    const extracted = await extractUsageFromSessionUpdateStream(toAsync(streamItems));

    expect(extracted).toEqual([usageOne, usageTwo]);
  });
});

describe("extractToolCallSummariesFromSessionUpdateStream", () => {
  it("builds summaries from tool_call and tool_call_update events", async () => {
    const streamItems = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Run command",
        kind: "execute",
        status: "pending",
        rawInput: { command: "npm test" },
      } satisfies SessionUpdate,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "in_progress",
      } satisfies SessionUpdate,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: "ok",
      } satisfies SessionUpdate,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-2",
        title: "Fallback",
        kind: "read",
        status: "failed",
        rawOutput: "missing file",
      } satisfies SessionUpdate,
    ];

    const extracted = await extractToolCallSummariesFromSessionUpdateStream(
      toAsync(streamItems),
    );

    const expected: ToolCallSummary[] = [
      {
        toolCallId: "tool-1",
        title: "Run command",
        kind: "execute",
        status: "completed",
        rawInput: { command: "npm test" },
        rawOutput: "ok",
      },
      {
        toolCallId: "tool-2",
        title: "Fallback",
        kind: "read",
        status: "failed",
        rawOutput: "missing file",
      },
    ];

    expect(extracted).toEqual(expected);
  });
});

describe("mapLegacyEventToSessionUpdates", () => {
  it("maps legacy stream events into ACP session updates", () => {
    expect(
      mapLegacyEventToSessionUpdates({
        event: "agent_message",
        text: "Hello",
      }),
    ).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "reasoning",
        text: "Think step",
      }),
    ).toEqual([
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Think step" },
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_start",
        id: "tool-7",
        kind: "exec",
        title: "npm test",
        input: { command: "npm test" },
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-7",
        title: "npm test",
        kind: "execute",
        status: "pending",
        rawInput: { command: "npm test" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-7",
        kind: "execute",
        status: "in_progress",
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_start",
        id: "tool-8",
        kind: "delete",
        title: "remove stale file",
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-8",
        title: "remove stale file",
        kind: "write",
        status: "pending",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-8",
        kind: "write",
        status: "in_progress",
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_complete",
        id: "tool-7",
        kind: "exec",
        path: "ok",
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-7",
        kind: "execute",
        status: "completed",
        rawOutput: "ok",
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_complete",
        id: "tool-8",
        kind: "move",
        status: "cancelled",
        path: "cancelled",
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-8",
        kind: "write",
        status: "cancelled",
        rawOutput: "cancelled",
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "usage",
        inputTokens: 4,
        outputTokens: 6,
        cachedTokens: 2,
        costUsd: 0.11,
      }),
    ).toEqual([
      {
        sessionUpdate: "usage_update",
        used: 10,
        size: 12,
        cost: { amount: 0.11, currency: "USD" },
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "session_start",
        threadId: "thread-42",
      }),
    ).toEqual([
      {
        sessionUpdate: "session_info_update",
        _meta: { threadId: "thread-42" },
      },
    ]);

    expect(mapLegacyEventToSessionUpdates({ event: "unknown" })).toEqual([]);
  });
});
