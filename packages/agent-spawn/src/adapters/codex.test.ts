import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { adaptCodex } from "./codex.js";
import { fromArray, collect } from "./test-utils.js";

async function loadCodexSessionFixture(): Promise<string[]> {
  const fixturesUrl = new URL("../acp/__fixtures__/sample-sessions.json", import.meta.url);
  const fixtures = JSON.parse(await fs.readFile(fixturesUrl, "utf8")) as {
    codexSession?: unknown;
  };
  const session = fixtures.codexSession;
  if (!Array.isArray(session) || !session.every((line) => typeof line === "string")) {
    throw new Error("Fixture codexSession is missing or invalid");
  }
  return session;
}

describe("adaptCodex", () => {
  it("adapts sampleFixtures.codexSession from the PRD", async () => {
    const session = await loadCodexSessionFixture();
    const events = await collect(adaptCodex(fromArray(session)));

    expect(events).toEqual([
      { event: "session_start", threadId: "thread_abc123" },
      { event: "tool_start", id: "item_1", kind: "exec", title: "ls -la" },
      { event: "tool_complete", id: "item_1", kind: "exec", path: "ls -la" },
      { event: "tool_start", id: "item_2", kind: "edit", title: "src/config.ts" },
      { event: "tool_complete", id: "item_2", kind: "edit", path: "src/config.ts" },
      { event: "tool_start", id: "item_3", kind: "think", title: "thinking..." },
      { event: "reasoning", text: "I need to update the imports after the file edit." },
      {
        event: "agent_message",
        text: "I've updated the configuration file with the new settings."
      },
      { event: "usage", inputTokens: 1500, outputTokens: 350, cachedTokens: 800 }
    ]);
  });

  it("skips turn.started silently", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          '{"type":"turn.started"}',
          '{"type":"item.started","item":{"id":"x","type":"thinking"}}'
        ])
      )
    );

    expect(updates).toEqual([
      {
        event: "tool_start",
        id: "x",
        kind: "think",
        title: "thinking..."
      }
    ]);
  });

  it("emits thread.started as SessionStartEvent", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          '{"type":"thread.started","thread_id":"thread_abc123"}',
          '{"type":"turn.started"}'
        ])
      )
    );

    expect(updates).toEqual([{ event: "session_start", threadId: "thread_abc123" }]);
  });

  it("maps item.started types to ToolStartEvent", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          '{"type":"item.started","item":{"id":"c","type":"command_execution","command":"echo hi"}}',
          '{"type":"item.started","item":{"id":"f","type":"file_edit","path":"src/app.ts"}}',
          '{"type":"item.started","item":{"id":"t","type":"thinking"}}',
          '{"type":"item.started","item":{"id":"m","type":"mcp_tool_call","server":"fs","tool":"read","arguments":{"path":"/tmp/a"}}}'
        ])
      )
    );

    expect(updates).toEqual([
      {
        event: "tool_start",
        id: "c",
        kind: "exec",
        title: "echo hi"
      },
      {
        event: "tool_start",
        id: "f",
        kind: "edit",
        title: "src/app.ts"
      },
      {
        event: "tool_start",
        id: "t",
        kind: "think",
        title: "thinking..."
      },
      {
        event: "tool_start",
        id: "m",
        kind: "other",
        title: "fs.read"
      }
    ]);
  });

  it("maps item.completed types to events", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          '{"type":"item.started","item":{"id":"x","type":"command_execution","command":"echo hi"}}',
          '{"type":"item.started","item":{"id":"y","type":"file_edit","path":"src/app.ts"}}',
          '{"type":"item.started","item":{"id":"z","type":"mcp_tool_call","server":"fs","tool":"read","arguments":{"path":"/tmp/a"}}}',
          '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
          '{"type":"item.completed","item":{"id":"x","type":"command_execution"}}',
          '{"type":"item.completed","item":{"id":"y","type":"file_edit","path":"src/app.ts"}}',
          '{"type":"item.completed","item":{"id":"z","type":"mcp_tool_call","server":"fs","tool":"read","result":{"ok":true}}}'
        ])
      )
    );

    expect(updates).toEqual([
      {
        event: "tool_start",
        id: "x",
        kind: "exec",
        title: "echo hi"
      },
      { event: "tool_start", id: "y", kind: "edit", title: "src/app.ts" },
      { event: "tool_start", id: "z", kind: "other", title: "fs.read" },
      { event: "agent_message", text: "done" },
      { event: "tool_complete", id: "x", kind: "exec", path: "echo hi" },
      { event: "tool_complete", id: "y", kind: "edit", path: "src/app.ts" },
      { event: "tool_complete", id: "z", kind: "other", path: "fs.read" }
    ]);
  });

  it("maps item.completed reasoning to ReasoningEvent", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          '{"type":"item.completed","item":{"id":"x","type":"reasoning","text":"done"}}'
        ])
      )
    );

    expect(updates).toEqual([{ event: "reasoning", text: "done" }]);
  });

  it("uses reasoning fallback chain: text → content → summary", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          '{"type":"item.completed","item":{"type":"reasoning","text":"t"}}',
          '{"type":"item.completed","item":{"type":"reasoning","content":"c"}}',
          '{"type":"item.completed","item":{"type":"reasoning","summary":"s"}}'
        ])
      )
    );

    expect(updates).toEqual([
      { event: "reasoning", text: "t" },
      { event: "reasoning", text: "c" },
      { event: "reasoning", text: "s" }
    ]);
  });

  it("emits turn.completed as UsageEvent with all fields", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2,"cached_input_tokens":3}}'
        ])
      )
    );

    expect(updates).toEqual([
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3 }
    ]);
  });

  it("emits turn.failed as ErrorEvent with fallback message", async () => {
    const updates = await collect(adaptCodex(fromArray(['{"type":"turn.failed"}'])));
    expect(updates).toEqual([{ event: "error", message: "Turn failed" }]);
  });

  it("emits turn.failed with message from payload", async () => {
    const updates = await collect(
      adaptCodex(fromArray([JSON.stringify({ type: "turn.failed", message: "rate limit exceeded" })]))
    );
    expect(updates).toEqual([{ event: "error", message: "rate limit exceeded" }]);
  });

  it("emits turn.failed with error string from payload", async () => {
    const updates = await collect(
      adaptCodex(fromArray([JSON.stringify({ type: "turn.failed", error: "context window full" })]))
    );
    expect(updates).toEqual([{ event: "error", message: "context window full" }]);
  });

  it("emits turn.failed with nested error.message from payload", async () => {
    const updates = await collect(
      adaptCodex(fromArray([JSON.stringify({ type: "turn.failed", error: { message: "API timeout" } })]))
    );
    expect(updates).toEqual([{ event: "error", message: "API timeout" }]);
  });

  it("truncates command title to 80 characters", async () => {
    const longCommand = "a".repeat(100);
    const updates = await collect(
      adaptCodex(
        fromArray([
          JSON.stringify({
            type: "item.started",
            item: { id: "x", type: "command_execution", command: longCommand }
          })
        ])
      )
    );

    const first = updates[0] as { title?: string };
    expect((updates[0] as { event?: string }).event).toBe("tool_start");
    expect(first.title).toHaveLength(80);
    expect(first.title).toMatch(/\.\.\.$/);
  });

  it("emits inline error event for malformed JSON and continues", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          "not json",
          '{"type":"item.started","item":{"id":"x","type":"thinking"}}'
        ])
      )
    );

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ event: "error" });
    expect((updates[0] as any).message).toContain("Malformed");
    expect(updates[1]).toEqual({
      event: "tool_start",
      id: "x",
      kind: "think",
      title: "thinking..."
    });
  });

  it("skips empty lines", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          "",
          "   ",
          "\n",
          '{"type":"item.started","item":{"id":"x","type":"thinking"}}'
        ])
      )
    );

    expect(updates).toEqual([{ event: "tool_start", id: "x", kind: "think", title: "thinking..." }]);
  });

  it("skips unknown item type silently", async () => {
    const updates = await collect(
      adaptCodex(
        fromArray([
          '{"type":"item.started","item":{"id":"x","type":"unknown"}}',
          '{"type":"item.completed","item":{"id":"x","type":"unknown"}}'
        ])
      )
    );
    expect(updates).toEqual([]);
  });

  
});
