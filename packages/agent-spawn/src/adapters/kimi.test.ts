import { describe, it, expect } from "bun:test";
import { adaptKimi } from "./kimi.js";
import { fromArray, collect } from "./test-utils.js";

describe("adaptKimi", () => {
  it("emits session_start once when sessionId is present", async () => {
    const events = await collect(
      adaptKimi(fromArray(['{"sessionId":"ses_abc","role":"assistant","content":"Hello"}']))
    );

    expect(events).toEqual([
      { event: "session_start", threadId: "ses_abc" },
      { event: "agent_message", text: "Hello" }
    ]);
  });

  it("converts OpenAI-style assistant messages to agent_message events", async () => {
    const events = await collect(
      adaptKimi(fromArray(['{"role":"assistant","content":"Hello"}']))
    );

    expect(events).toEqual([{ event: "agent_message", text: "Hello" }]);
  });

  it("emits error event for malformed JSON and continues processing", async () => {
    const events = await collect(
      adaptKimi(fromArray(["{invalid json", '{"role":"assistant","content":"Hello"}']))
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "error" });
    expect((events[0] as any).message).toContain("[adaptKimi] Malformed JSON");
    expect(events[1]).toEqual({ event: "agent_message", text: "Hello" });
  });

  it("truncates long malformed JSON lines in error messages", async () => {
    const longMalformedLine = `{${"x".repeat(500)}`;
    const events = await collect(adaptKimi(fromArray([longMalformedLine])));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "error" });

    const prefix = "[adaptKimi] Malformed JSON line: ";
    const message = (events[0] as any).message as string;

    expect(message.startsWith(prefix)).toBe(true);
    expect(message.endsWith("...")).toBe(true);
    expect(message.length).toBe(prefix.length + 200);
  });

  it("ignores empty lines and non-assistant roles", async () => {
    const events = await collect(
      adaptKimi(
        fromArray([
          "",
          "   ",
          "\n",
          '{"role":"system","content":"ignore"}',
          '{"role":"user","content":"ignore"}',
          '{"role":"assistant","content":"ok"}'
        ])
      )
    );

    expect(events).toEqual([{ event: "agent_message", text: "ok" }]);
  });
});
