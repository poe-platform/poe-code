import { describe, it, expect } from "bun:test";
import fs from "node:fs/promises";
import { adaptClaude } from "./claude.js";
import { fromArray, collect } from "./test-utils.js";

async function loadClaudeSessionFixture(): Promise<string[]> {
  const fixturesUrl = new URL("../acp/__fixtures__/sample-sessions.json", import.meta.url);
  const fixtures = JSON.parse(await fs.readFile(fixturesUrl, "utf8")) as {
    claudeSession?: unknown;
  };
  const session = fixtures.claudeSession;
  if (!Array.isArray(session) || !session.every((line) => typeof line === "string")) {
    throw new Error("Fixture claudeSession is missing or invalid");
  }
  return session;
}

describe("adaptClaude", () => {
  it("emits session_start once when sessionId is present", async () => {
    const updates = await collect(
      adaptClaude(
        fromArray([
          JSON.stringify({
            type: "assistant",
            sessionId: "ses_abc",
            message: { content: [{ type: "text", text: "hello" }] }
          })
        ])
      )
    );

    expect(updates).toEqual([
      { event: "session_start", threadId: "ses_abc" },
      { event: "agent_message", text: "hello" }
    ]);
  });

  it("adapts sampleFixtures.claudeSession from the PRD", async () => {
    const session = await loadClaudeSessionFixture();
    const events = await collect(adaptClaude(fromArray(session)));

    expect(events).toEqual([
      { event: "session_start", threadId: undefined },
      {
        event: "agent_message",
        text: "I'll check the current directory structure."
      },
      {
        event: "tool_start",
        id: "tu_1",
        kind: "exec",
        title: "ls -la",
        input: { command: "ls -la" }
      },
      {
        event: "tool_complete",
        id: "tu_1",
        kind: "exec",
        path: "total 24\ndrwxr-xr-x  5 user  staff   160 Jan 15 10:00 .\n..."
      },
      {
        event: "tool_start",
        id: "tu_2",
        kind: "edit",
        title: "src/config.ts",
        input: {
          file_path: "src/config.ts",
          old_string: "port: 3000",
          new_string: "port: 8080"
        }
      },
      {
        event: "tool_complete",
        id: "tu_2",
        kind: "edit",
        path: "File edited successfully"
      },
      {
        event: "agent_message",
        text: "I've updated the port configuration from 3000 to 8080."
      },
      { event: "usage", inputTokens: 2000, outputTokens: 500, costUsd: 0.015 }
    ]);
  });

  it("emits agent_message for assistant text blocks", async () => {
    const updates = await collect(
      adaptClaude(
        fromArray([
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] }
          })
        ])
      )
    );

    expect(updates).toEqual([
      { event: "session_start", threadId: undefined },
      { event: "agent_message", text: "hello" },
      { event: "agent_message", text: "world" }
    ]);
  });

  it.each([
    ["Read", "read", { file_path: "/src/app.ts" }, "/src/app.ts"],
    ["Write", "edit", { file_path: "/src/app.ts", content: "x" }, "/src/app.ts"],
    ["Edit", "edit", { file_path: "/src/app.ts", old_string: "a", new_string: "b" }, "/src/app.ts"],
    ["NotebookEdit", "edit", { notebook_path: "/nb.ipynb", new_source: "x" }, "/nb.ipynb"],
    ["Bash", "exec", { command: "ls -la" }, "ls -la"],
    ["Glob", "search", { pattern: "**/*.ts" }, "**/*.ts"],
    ["Grep", "search", { pattern: "TODO" }, "TODO"],
    ["Task", "think", { description: "explore codebase", prompt: "find files" }, "explore codebase"]
  ] as const)("maps tool_use %s to kind: %s with descriptive title", async (name, kind, input, expectedTitle) => {
    const events = await collect(
      adaptClaude(
        fromArray([
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "tool_use", id: "tu_1", name, input }] }
          })
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: undefined },
      {
        event: "tool_start",
        id: "tu_1",
        kind,
        title: expectedTitle,
        input
      }
    ]);
  });

  it("falls back to tool name when input has no extractable title", async () => {
    const events = await collect(
      adaptClaude(
        fromArray([
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "tool_use", id: "tu_1", name: "Read", input: {} }] }
          })
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: undefined },
      {
        event: "tool_start",
        id: "tu_1",
        kind: "read",
        title: "Read",
        input: {}
      }
    ]);
  });

  it("maps unknown tool name to kind: other and keeps tool name as title", async () => {
    const updates = await collect(
      adaptClaude(
        fromArray([
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "tool_use", id: "tu_x", name: "Unknown", input: { a: 1 } }] }
          })
        ])
      )
    );

    expect(updates).toEqual([
      { event: "session_start", threadId: undefined },
      {
        event: "tool_start",
        id: "tu_x",
        kind: "other",
        title: "Unknown",
        input: { a: 1 }
      }
    ]);
  });

  it("tracks tool kind from tool_start to tool_complete", async () => {
    const events = await collect(
      adaptClaude(
        fromArray([
          '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls"}}]}}',
          '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","content":"ok"}]}}'
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: undefined },
      {
        event: "tool_start",
        id: "tu_1",
        kind: "exec",
        title: "ls",
        input: { command: "ls" }
      },
      {
        event: "tool_complete",
        id: "tu_1",
        kind: "exec",
        path: "ok"
      }
    ]);
  });

  it("emits tool_complete with kind: undefined for unknown tool_use_id (no crash)", async () => {
    const updates = await collect(
      adaptClaude(
        fromArray([
          '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_unknown","content":{"ok":true}}]}}'
        ])
      )
    );

    expect(updates).toEqual([
      { event: "session_start", threadId: undefined },
      {
        kind: undefined,
        event: "tool_complete",
        id: "tu_unknown",
        path: "{\"ok\":true}"
      }
    ]);
  });

  it("emits usage for result with costUsd", async () => {
    const updates = await collect(
      adaptClaude(
        fromArray([
          JSON.stringify({ type: "result", input_tokens: 1, output_tokens: 2, cost_usd: 0.03 })
        ])
      )
    );

    expect(updates).toEqual([
      { event: "session_start", threadId: undefined },
      {
        event: "usage",
        inputTokens: 1,
        outputTokens: 2,
        costUsd: 0.03
      }
    ]);
  });

  it("emits inline error event for malformed JSON and continues", async () => {
    const updates = await collect(
      adaptClaude(
        fromArray([
          "{not json",
          '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}'
        ])
      )
    );

    expect(updates).toHaveLength(3);
    expect(updates[0]).toMatchObject({ event: "error" });
    expect((updates[0] as any).message).toContain("Malformed");
    expect(updates[1]).toEqual({ event: "session_start", threadId: undefined });
    expect(updates[2]).toEqual({ event: "agent_message", text: "ok" });
  });

  it("ignores non-JSON lines (e.g. verbose stdout) and continues", async () => {
    const updates = await collect(
      adaptClaude(
        fromArray([
          "starting up...",
          '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}'
        ])
      )
    );

    expect(updates).toEqual([
      { event: "session_start", threadId: undefined },
      { event: "agent_message", text: "ok" }
    ]);
  });
});
