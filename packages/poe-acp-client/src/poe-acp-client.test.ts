import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  extractMessagesFromSessionUpdateStream,
  extractToolCallSummariesFromSessionUpdateStream,
  extractUsageFromSessionUpdateStream,
  formatRunReportSummary,
  formatSessionUpdate,
  generateRunReportFromSessionUpdateStream,
  mapLegacyEventToSessionUpdates,
  parseSessionUpdate,
  saveRunReport,
  type RunReport,
  type SessionUpdate,
  type SessionUpdateNotification,
  type ToolCallSummary,
} from "./index.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// jsonrpc.test.ts — formatSessionUpdate / parseSessionUpdate
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// run-report.test.ts
// ---------------------------------------------------------------------------

describe("generateRunReportFromSessionUpdateStream", () => {
  it("builds a run report with tool calls, usage, and errors", async () => {
    const streamItems = [
      toNotification("run-42", {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Run tests",
        kind: "execute",
        status: "pending",
      }),
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "failed",
        rawOutput: "npm test failed",
      } satisfies SessionUpdate,
      {
        sessionUpdate: "usage_update",
        used: 120,
        size: 150,
      } satisfies SessionUpdate,
      {
        sessionUpdate: "usage_update",
        used: 30,
        size: 45,
        cost: { amount: 0.12, currency: "USD" },
      } satisfies SessionUpdate,
    ];

    const report = await generateRunReportFromSessionUpdateStream(toAsync(streamItems), {
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:10.000Z",
    });

    expect(report).toEqual({
      runId: "run-42",
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:10.000Z",
      exitStatus: "failed",
      toolCalls: [
        {
          toolCallId: "tool-1",
          title: "Run tests",
          kind: "execute",
          status: "failed",
          rawOutput: "npm test failed",
        },
      ],
      usage: {
        used: 150,
        size: 195,
        cost: { amount: 0.12, currency: "USD" },
        updates: 2,
      },
      errors: [
        {
          toolCallId: "tool-1",
          message: "npm test failed",
        },
      ],
    });
  });

  it("throws when run id is missing from both options and stream", async () => {
    await expect(
      generateRunReportFromSessionUpdateStream(
        toAsync([
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          } satisfies SessionUpdate,
        ]),
      ),
    ).rejects.toThrow("Run id is required");
  });
});

describe("formatRunReportSummary", () => {
  it("includes duration, tool count, token usage, and error count", () => {
    const report: RunReport = {
      runId: "run-123",
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:12.500Z",
      exitStatus: "success",
      toolCalls: [
        { toolCallId: "1", title: "one", status: "completed" },
        { toolCallId: "2", title: "two", status: "completed" },
      ],
      usage: {
        used: 320,
        size: 400,
        updates: 2,
      },
      errors: [{ message: "none" }],
    };

    const summary = formatRunReportSummary(report);

    expect(summary).toContain("Duration: 12.5s");
    expect(summary).toContain("Tool count: 2");
    expect(summary).toContain("Token usage: 320/400");
    expect(summary).toContain("Error count: 1");
  });
});

describe("saveRunReport", () => {
  it("writes JSON and summary reports to ~/.poe-code/reports with timestamped names", async () => {
    const vol = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(vol).promises;

    const report: RunReport = {
      runId: "run/123",
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:10.000Z",
      exitStatus: "failed",
      toolCalls: [{ toolCallId: "tool-1", title: "Run tests", status: "failed" }],
      usage: { used: 150, size: 195, updates: 2 },
      errors: [{ message: "npm test failed", toolCallId: "tool-1" }],
    };

    const output = await saveRunReport(report, {
      fs,
      homeDir: "/home/test",
      now: () => new Date("2026-02-24T07:08:09.456Z"),
    });

    expect(output.reportsDir).toBe("/home/test/.poe-code/reports");
    expect(output.jsonPath).toBe(
      "/home/test/.poe-code/reports/20260224-070809-456-run-123.json",
    );
    expect(output.summaryPath).toBe(
      "/home/test/.poe-code/reports/20260224-070809-456-run-123.txt",
    );

    const jsonOnDisk = await fs.readFile(output.jsonPath, "utf8");
    expect(JSON.parse(jsonOnDisk)).toEqual(report);

    const summaryOnDisk = await fs.readFile(output.summaryPath, "utf8");
    expect(summaryOnDisk).toContain("Run ID: run/123");
    expect(summaryOnDisk).toContain("Error count: 1");
  });
});

// ---------------------------------------------------------------------------
// stream-helpers.test.ts
// ---------------------------------------------------------------------------

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
