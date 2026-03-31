import { describe, expect, it } from "bun:test";
import {
  formatSessionUpdate,
  parseSessionUpdate,
  type SessionUpdate,
  type SessionUpdateNotification,
} from "./index.js";

describe("formatSessionUpdate", () => {
  it("formats valid JSON-RPC session/update notifications", () => {
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "hello",
      },
    };

    const json = formatSessionUpdate("session-1", update, { source: "test" });
    const parsed = JSON.parse(json) as SessionUpdateNotification;

    expect(parsed).toEqual({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update,
        _meta: { source: "test" },
      },
    });
  });
});

describe("parseSessionUpdate", () => {
  it("parses stable and unstable session update notifications", () => {
    const updates: SessionUpdate[] = [
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "user chunk" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "agent chunk" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thought" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read file",
        kind: "read",
        status: "cancelled",
        locations: [{ path: "/workspace/file.ts", lineNumber: 12 }],
        content: [
          { type: "text", text: "Reading file" },
          {
            type: "diff",
            path: "/workspace/file.ts",
            newText: "const answer = 42;",
            oldText: "const answer = 41;",
          },
          {
            type: "image",
            data: "base64-image",
            mimeType: "image/png",
          },
          {
            type: "resource_link",
            name: "Design Doc",
            uri: "file:///workspace/README.md",
          },
          {
            type: "resource",
            resource: {
              text: "contents",
              uri: "file:///workspace/README.md",
            },
          },
          {
            type: "terminal",
            terminalId: "terminal-1",
          },
        ],
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        kind: "write",
      },
      {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Inspect repository",
            priority: "high",
            status: "in_progress",
          },
        ],
      },
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "create_plan",
            description: "Create a project plan",
            input: { hint: "Feature request" },
          },
        ],
      },
      {
        sessionUpdate: "current_mode_update",
        currentModeId: "code",
      },
      {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            type: "select",
            id: "model",
            name: "Model",
            currentValue: "sonnet",
            options: [
              {
                value: "sonnet",
                name: "Sonnet",
              },
            ],
          },
        ],
      },
      {
        sessionUpdate: "session_info_update",
        title: "Refactor helper",
        updatedAt: "2026-02-24T00:00:00.000Z",
      },
      {
        sessionUpdate: "usage_update",
        used: 120,
        size: 1000,
        cost: {
          amount: 0.02,
          currency: "USD",
        },
      },
    ];

    for (const update of updates) {
      const json = formatSessionUpdate("session-42", update);
      const parsed = parseSessionUpdate(json);

      expect(parsed).toEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-42",
          update,
        },
      });
    }
  });

  it("returns null for malformed json", () => {
    expect(parseSessionUpdate("{not-json}")).toBeNull();
  });

  it("returns null for non-session/update notifications", () => {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/other",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        },
      },
    });

    expect(parseSessionUpdate(message)).toBeNull();
  });

  it("returns null for notifications with invalid update payload", () => {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          title: "Missing toolCallId",
        },
      },
    });

    expect(parseSessionUpdate(message)).toBeNull();
  });

  it("returns null for notifications using legacy tool payload fields", () => {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-legacy",
          title: "Legacy call",
          kind: "edit",
          locations: [{ path: "/workspace/file.ts", line: 4 }],
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "legacy",
              },
            },
          ],
        },
      },
    });

    expect(parseSessionUpdate(message)).toBeNull();
  });
});
