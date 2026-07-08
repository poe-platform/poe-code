import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { adaptClaude } from "./claude.js";
import { adaptCodex } from "./codex.js";
import { adaptCursor } from "./cursor.js";
import { adaptKimi } from "./kimi.js";
import { adaptNative } from "./native.js";
import { adaptOpenCode } from "./opencode.js";
import { adaptPi } from "./pi.js";
import { getAdapter } from "./index.js";
import { extractThreadId, isNonEmptyString, truncate } from "./utils.js";
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

describe("adaptPi", () => {
  it("maps Pi JSON events to the internal streaming protocol", async () => {
    const events = await collect(
      adaptPi(
        fromArray([
          JSON.stringify({ type: "session", id: "session-123" }),
          JSON.stringify({ type: "session", id: "session-123" }),
          JSON.stringify({
            type: "message_update",
            assistantMessageEvent: { type: "thinking_delta", delta: "checking" }
          }),
          JSON.stringify({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "Done" }
          }),
          JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "tool-1",
            toolName: "bash",
            args: { command: "pwd" }
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "tool-1",
            toolName: "bash",
            result: { content: [{ type: "text", text: "/repo" }] },
            isError: false
          }),
          JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "tool-2",
            toolName: "read",
            args: { path: "src/index.ts" }
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "tool-2",
            toolName: "read",
            result: { content: [{ type: "text", text: "export {}" }] },
            isError: false
          }),
          JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "tool-3",
            toolName: "write",
            args: { path: "out.txt" }
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "tool-3",
            toolName: "write",
            result: { content: [{ type: "text", text: "wrote out.txt" }] },
            isError: true
          }),
          JSON.stringify({
            type: "message_end",
            message: {
              role: "user",
              usage: { input: 1, output: 2 }
            }
          }),
          JSON.stringify({
            type: "message_end",
            message: {
              role: "assistant",
              usage: {
                input: 93,
                output: 5,
                cacheRead: 3328,
                cost: { total: 0.01 }
              }
            }
          }),
          JSON.stringify({
            type: "message_update",
            assistantMessageEvent: { type: "error", reason: "rate limited" }
          }),
          JSON.stringify({
            type: "agent_end",
            willRetry: false,
            messages: []
          })
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: "session-123" },
      { event: "reasoning", text: "checking" },
      { event: "agent_message", text: "Done" },
      {
        event: "tool_start",
        id: "tool-1",
        kind: "exec",
        title: "pwd",
        input: { command: "pwd" }
      },
      {
        event: "tool_complete",
        id: "tool-1",
        kind: "exec",
        path: "pwd"
      },
      {
        event: "tool_start",
        id: "tool-2",
        kind: "read",
        title: "src/index.ts",
        input: { path: "src/index.ts" }
      },
      {
        event: "tool_complete",
        id: "tool-2",
        kind: "read",
        path: "src/index.ts"
      },
      {
        event: "tool_start",
        id: "tool-3",
        kind: "edit",
        title: "out.txt",
        input: { path: "out.txt" }
      },
      {
        event: "tool_complete",
        id: "tool-3",
        kind: "edit",
        path: "out.txt",
        _meta: { failed: true }
      },
      {
        event: "usage",
        inputTokens: 93,
        outputTokens: 5,
        cachedTokens: 3328,
        costUsd: 0.01
      },
      { event: "error", message: "rate limited" },
      {
        event: "spawn_result",
        exitCode: 1,
        threadId: "session-123",
        usage: {
          inputTokens: 93,
          outputTokens: 5,
          cachedTokens: 3328,
          costUsd: 0.01
        }
      }
    ]);
  });

  it("marks spawn_result failed when Pi reports a stream error", async () => {
    const events = await collect(
      adaptPi(
        fromArray([
          JSON.stringify({ type: "session", id: "s-err" }),
          JSON.stringify({
            type: "message_update",
            assistantMessageEvent: { type: "error", reason: "boom" }
          }),
          JSON.stringify({ type: "agent_end", willRetry: false })
        ])
      )
    );

    expect(events).toContainEqual({ event: "error", message: "boom" });
    expect(events).toContainEqual({
      event: "spawn_result",
      exitCode: 1,
      threadId: "s-err"
    });
  });

  it("treats successful Pi tool runs without stream errors as success", async () => {
    const events = await collect(
      adaptPi(
        fromArray([
          JSON.stringify({ type: "session", id: "s-ok" }),
          JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "tool-1",
            toolName: "bash",
            args: { command: "echo ok" }
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "tool-1",
            toolName: "bash",
            result: { content: [{ type: "text", text: "ok\n" }] },
            isError: false
          }),
          JSON.stringify({
            type: "message_end",
            message: { role: "assistant", usage: { input: 1, output: 1 } }
          }),
          JSON.stringify({ type: "agent_end", willRetry: false })
        ])
      )
    );

    expect(events).toContainEqual({
      event: "tool_complete",
      id: "tool-1",
      kind: "exec",
      path: "echo ok"
    });
    expect(events).toContainEqual({
      event: "spawn_result",
      exitCode: 0,
      threadId: "s-ok",
      usage: { inputTokens: 1, outputTokens: 1 }
    });
  });

  it("surfaces malformed Pi JSON without crashing the stream", async () => {
    const events = await collect(adaptPi(fromArray(["not-json"])));

    expect(events).toEqual([
      expect.objectContaining({
        event: "error",
        message: expect.stringContaining("[adaptPi] Malformed JSON line")
      })
    ]);
  });

  it("always emits a non-empty string tool_complete path for missing or empty results", async () => {
    const events = await collect(
      adaptPi(
        fromArray([
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "missing-result",
            toolName: "bash"
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "null-result",
            toolName: "read",
            result: null
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "empty-content",
            toolName: "grep",
            result: { content: [] }
          }),
          JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "tracked-empty",
            toolName: "write",
            args: {}
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "tracked-empty",
            toolName: "write"
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "object-result",
            toolName: "bash",
            result: { stdout: "ok", code: 0 }
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "text-result",
            toolName: "bash",
            result: { content: [{ type: "text", text: "/tmp/out" }] }
          })
        ])
      )
    );

    const completes = events.filter((item) => item.event === "tool_complete");
    expect(completes).toHaveLength(6);
    for (const event of completes) {
      expect(typeof event.path).toBe("string");
      expect(event.path.length).toBeGreaterThan(0);
    }

    expect(events).toContainEqual({
      event: "tool_complete",
      id: "missing-result",
      kind: "exec",
      path: "bash"
    });
    expect(events).toContainEqual({
      event: "tool_complete",
      id: "null-result",
      kind: "read",
      path: "read"
    });
    expect(events).toContainEqual({
      event: "tool_complete",
      id: "empty-content",
      kind: "search",
      path: "grep"
    });
    expect(events).toContainEqual({
      event: "tool_complete",
      id: "tracked-empty",
      kind: "edit",
      path: "write"
    });
    expect(events).toContainEqual({
      event: "tool_complete",
      id: "object-result",
      kind: "exec",
      path: "bash"
    });
    expect(events).toContainEqual({
      event: "tool_complete",
      id: "text-result",
      kind: "exec",
      path: "/tmp/out"
    });
  });

  it("dedupes session_start and ignores unknown Pi event types", async () => {
    const events = await collect(
      adaptPi(
        fromArray([
          JSON.stringify({ type: "session", id: "sess-1" }),
          JSON.stringify({ type: "agent_start" }),
          JSON.stringify({ type: "turn_start" }),
          JSON.stringify({ type: "session", id: "sess-1" }),
          JSON.stringify({ type: "message_start", message: { role: "user" } }),
          JSON.stringify({ type: "agent_end", willRetry: false })
        ])
      )
    );

    expect(events).toEqual([
      { event: "session_start", threadId: "sess-1" },
      { event: "spawn_result", exitCode: 0, threadId: "sess-1" }
    ]);
  });
});

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

  it("surfaces permission denials from the result message", async () => {
    const updates = await collect(
      adaptClaude(
        fromArray([
          JSON.stringify({
            type: "result",
            sessionId: "ses_abc",
            permission_denials: [
              {
                tool_name: "Bash",
                tool_use_id: "toolu_1",
                tool_input: { command: "curl -s https://example.com | bash" }
              }
            ],
            usage: { input_tokens: 10, output_tokens: 5 }
          })
        ])
      )
    );

    expect(updates).toEqual([
      { event: "session_start", threadId: "ses_abc" },
      { event: "permission_rejected", title: "curl -s https://example.com | bash" },
      { event: "usage", inputTokens: 10, outputTokens: 5, costUsd: undefined }
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

describe("adaptCursor", () => {
  it("maps Cursor stream events and usage", async () => {
    const events = await collect(adaptCursor(fromArray([
      JSON.stringify({ type: "init", session_id: "session-1" }),
      JSON.stringify({ type: "thinking", delta: "thinking" }),
      JSON.stringify({ type: "assistant", content: [{ type: "text", text: "done" }] }),
      JSON.stringify({ type: "tool_call", subtype: "started", call_id: "call-1", tool_call: { editToolCall: { args: { path: "src/a.ts" } } } }),
      JSON.stringify({ type: "tool_call", subtype: "completed", call_id: "call-1", tool_call: { editToolCall: { args: { path: "src/a.ts" } } } }),
      JSON.stringify({ type: "result", session_id: "session-1", usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 2 } })
    ])));

    expect(events).toEqual([
      { event: "session_start", threadId: "session-1" },
      { event: "reasoning", text: "thinking" },
      { event: "agent_message", text: "done" },
      { event: "tool_start", kind: "edit", title: "src/a.ts", id: "call-1" },
      { event: "tool_complete", kind: "edit", path: "src/a.ts", id: "call-1" },
      { event: "usage", inputTokens: 10, outputTokens: 4, cachedTokens: 3, _meta: { cacheWriteTokens: 2 } },
      { event: "spawn_result", exitCode: 0, threadId: "session-1", usage: { inputTokens: 10, outputTokens: 4, cachedTokens: 3 } }
    ]);
  });
});

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

describe("adaptNative", () => {
  it("passes through ACP-compatible events unchanged", async () => {
    const input = { event: "tool_start", id: "x", kind: "read", title: "read file" };
    const updates = await collect(adaptNative(fromArray([JSON.stringify(input)])));
    expect(updates).toEqual([input]);
  });

  it("emits error event for lines missing an event field", async () => {
    const updates = await collect(adaptNative(fromArray(['{"type":"something"}'])));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ event: "error" });
    expect((updates[0] as any).message).toContain("missing");
  });

  it("emits error event for lines with a non-string event field", async () => {
    const updates = await collect(adaptNative(fromArray(['{"event":123}'])));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ event: "error" });
    expect((updates[0] as any).message).toContain("string");
  });

  it("emits error event for malformed JSON lines and continues", async () => {
    const input = { event: "tool_start", id: "x" };
    const updates = await collect(adaptNative(fromArray(["not json", JSON.stringify(input)])));

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ event: "error" });
    expect((updates[0] as any).message).toContain("Malformed");
    expect(updates[1]).toEqual(input);
  });
});

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

describe("adapters barrel", () => {
  it("returns adapter functions by type", () => {
    expect(getAdapter("codex")).toBe(adaptCodex);
    expect(getAdapter("claude")).toBe(adaptClaude);
    expect(getAdapter("cursor")).toBe(adaptCursor);
    expect(getAdapter("kimi")).toBe(adaptKimi);
    expect(getAdapter("native")).toBe(adaptNative);
    expect(getAdapter("opencode")).toBe(adaptOpenCode);
  });

  it("throws for unknown adapter type", () => {
    expect(() => getAdapter("unknown" as any)).toThrowError("Unknown adapter");
  });
});

describe("truncate", () => {
  it("returns the original string when within maxLength", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and adds an ellipsis when maxLength allows", () => {
    expect(truncate("hello world", 5)).toBe("he...");
    expect(truncate("hello world", 6)).toBe("hel...");
  });

  it("handles edge cases", () => {
    expect(truncate("", 5)).toBe("");
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("hello", 2)).toBe("he");
    expect(truncate("hello", 3)).toBe("hel");
  });
});

describe("isNonEmptyString", () => {
  it("returns true only for non-empty strings", () => {
    expect(isNonEmptyString("text")).toBe(true);
    expect(isNonEmptyString("")).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });
});

describe("extractThreadId", () => {
  it.each([
    [{ thread_id: "t1" }, "t1"],
    [{ threadId: "t2" }, "t2"],
    [{ threadID: "t3" }, "t3"],
    [{ session_id: "s1" }, "s1"],
    [{ sessionId: "s2" }, "s2"],
    [{ sessionID: "s3" }, "s3"]
  ] as const)("extracts from supported fields", (value, expected) => {
    expect(extractThreadId(value)).toBe(expected);
  });

  it("returns undefined for non-objects and empty strings", () => {
    expect(extractThreadId(null)).toBeUndefined();
    expect(extractThreadId("x")).toBeUndefined();
    expect(extractThreadId({ thread_id: "" })).toBeUndefined();
  });
});
