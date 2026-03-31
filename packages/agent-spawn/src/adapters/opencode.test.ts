import { describe, it, expect } from "bun:test";
import { adaptOpenCode } from "./opencode.js";
import { fromArray, collect } from "./test-utils.js";

describe("adaptOpenCode", () => {
  it("ignores empty/whitespace lines", async () => {
    const events = await collect(adaptOpenCode(fromArray(["", "   ", "\n", "\t"])));
    expect(events).toEqual([]);
  });

  it("emits session_start once for sessionID", async () => {
    const events = await collect(
      adaptOpenCode(
        fromArray([
          '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Hello"}}',
          '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"World"}}'
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: "ses_1" },
      { event: "agent_message", text: "Hello" },
      { event: "agent_message", text: "World" }
    ]);
  });

  it("converts text events to agent_message events", async () => {
    const events = await collect(
      adaptOpenCode(fromArray(['{"type":"text","part":{"type":"text","text":"Hello"}}']))
    );

    expect(events).toEqual([{ event: "agent_message", text: "Hello" }]);
  });

  it("ignores non-object JSON and malformed/partial text events", async () => {
    const events = await collect(
      adaptOpenCode(
        fromArray([
          "null",
          "[]",
          "\"hello\"",
          "1",
          '{"type":123}',
          '{"type":"text"}',
          '{"type":"text","part":null}',
          '{"type":"text","part":{}}',
          '{"type":"text","part":{"text":123}}',
          '{"type":"text","part":{"text":"ok"}}'
        ])
      )
    );

    expect(events).toEqual([{ event: "agent_message", text: "ok" }]);
  });

  it("converts completed tool_use events into tool_start + tool_complete", async () => {
    const events = await collect(
      adaptOpenCode(
        fromArray([
          JSON.stringify({
            type: "tool_use",
            sessionID: "ses_1",
            part: {
              type: "tool",
              callID: "call_1",
              tool: "bash",
              state: {
                status: "completed",
                input: { command: "echo hello" },
                output: "hello\n"
              }
            }
          })
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: "ses_1" },
      {
        event: "tool_start",
        id: "call_1",
        kind: "exec",
        title: "echo hello",
        input: { command: "echo hello" }
      },
      { event: "tool_complete", id: "call_1", kind: "exec", path: "hello\n" }
    ]);
  });

  it("emits tool_start once then tool_complete on terminal update (kind tracked from start)", async () => {
    const events = await collect(
      adaptOpenCode(
        fromArray([
          JSON.stringify({
            type: "tool_use",
            sessionID: "ses_1",
            part: {
              type: "tool",
              callID: "call_1",
              tool: "bash",
              state: {
                status: "running",
                input: { command: "echo hi" }
              }
            }
          }),
          JSON.stringify({
            type: "tool_use",
            sessionID: "ses_1",
            part: {
              type: "tool",
              callID: "call_1",
              tool: "write_file",
              state: {
                status: "completed",
                input: { path: "a.txt", content: "hi" },
                output: { ok: true }
              }
            }
          })
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: "ses_1" },
      { event: "tool_start", id: "call_1", kind: "exec", title: "echo hi", input: { command: "echo hi" } },
      { event: "tool_complete", id: "call_1", kind: "exec", path: "{\"ok\":true}" }
    ]);
  });

  it("converts step_finish tokens to usage events", async () => {
    const events = await collect(
      adaptOpenCode(
        fromArray([
          JSON.stringify({
            type: "step_finish",
            sessionID: "ses_1",
            part: { tokens: { input: 1, output: 2, cache: { read: 3 } } }
          })
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: "ses_1" },
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3 }
    ]);
  });

  it("ignores step_finish when usage is effectively empty", async () => {
    const events = await collect(
      adaptOpenCode(
        fromArray([
          JSON.stringify({
            type: "step_finish",
            sessionID: "ses_1",
            part: { tokens: { input: 0, output: 0, cache: {} } }
          })
        ])
      )
    );

    expect(events).toEqual([{ event: "session_start", threadId: "ses_1" }]);
  });

  it("emits error event for malformed JSON and continues processing", async () => {
    const events = await collect(
      adaptOpenCode(fromArray(["{invalid json", '{"type":"text","part":{"type":"text","text":"Hello"}}']))
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "error" });
    expect((events[0] as any).message).toContain("[adaptOpenCode] Malformed JSON");
    expect(events[1]).toEqual({ event: "agent_message", text: "Hello" });
  });

  it("truncates long malformed JSON lines in error messages", async () => {
    const longMalformedLine = `{${"x".repeat(500)}`;
    const events = await collect(adaptOpenCode(fromArray([longMalformedLine])));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "error" });

    const prefix = "[adaptOpenCode] Malformed JSON line: ";
    const message = (events[0] as any).message as string;

    expect(message.startsWith(prefix)).toBe(true);
    expect(message.endsWith("...")).toBe(true);
    expect(message.length).toBe(prefix.length + 200);
  });
});
