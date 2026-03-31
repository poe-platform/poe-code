import { describe, expect, it } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import {
  formatSessionUpdate,
  formatRunReportSummary,
  generateRunReportFromSessionUpdateStream,
  parseSessionUpdate,
  saveRunReport,
  type RunReport,
  type SessionUpdate,
  type SessionUpdateNotification,
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
        rawOutput: "bun test failed",
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
          rawOutput: "bun test failed",
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
          message: "bun test failed",
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
      errors: [{ message: "bun test failed", toolCallId: "tool-1" }],
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
