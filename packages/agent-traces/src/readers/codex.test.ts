import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { collectHumanPrompts } from "../collect.js";
import { codexTraceReader } from "./codex.js";
import type { SqliteTraceDatabase } from "../types.js";

describe("codexTraceReader", () => {
  it("discovers Codex threads from SQLite and extracts rollout user prompts", async () => {
    const db: SqliteTraceDatabase = {
      all: vi.fn(() => [
        {
          id: "thread-one",
          rollout_path: "/home/me/.codex/sessions/rollout-one.jsonl",
          created_at: 1781360000,
          updated_at: 1781360300,
          created_at_ms: null,
          updated_at_ms: null,
          source: "vscode",
          model: "gpt-5.5",
          cwd: "/repo",
          title: "Parser work",
          first_user_message: "fallback prompt"
        }
      ]),
      close: vi.fn()
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.codex/sessions/rollout-one.jsonl": [
          JSON.stringify({
            type: "session_meta",
            payload: { id: "thread-one", cwd: "/repo", timestamp: "2026-06-13T12:00:00.000Z" }
          }),
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-06-13T12:00:01.000Z",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Implement gaslight ingest." }]
            }
          }),
          JSON.stringify({
            type: "event_msg",
            timestamp: "2026-06-13T12:01:00.000Z",
            payload: {
              type: "user_message",
              message: "Actually inspect local traces too.",
              text_elements: ["Actually inspect local traces too."]
            }
          }),
          JSON.stringify({
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "ok" }]
            }
          })
        ].join("\n")
      })
    ).promises;

    const references = await codexTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs,
      sqlite: async () => db
    });

    expect(db.all).toHaveBeenCalledWith(expect.stringContaining("FROM threads"), [
      "/repo",
      null,
      null,
      null
    ]);
    expect(db.close).toHaveBeenCalledOnce();
    expect(references).toHaveLength(1);

    const trace = await codexTraceReader.read(references[0]!, { fs });

    expect(trace).toMatchObject({
      source: "codex",
      id: "thread-one",
      cwd: "/repo",
      title: "Parser work"
    });
    expect(trace.turns.map((turn) => ({ role: turn.role, text: turn.text }))).toEqual([
      { role: "human", text: "Implement gaslight ingest." },
      { role: "human", text: "Actually inspect local traces too." },
      { role: "assistant", text: "ok" }
    ]);
  });

  it("falls back to first_user_message when rollout is unavailable", async () => {
    const reference = {
      source: "codex" as const,
      id: "thread-two",
      cwd: "/repo",
      title: "Fallback",
      metadata: {
        firstUserMessage: "Use the metadata prompt",
        createdAt: new Date("2026-06-13T12:00:00.000Z")
      }
    };
    const fs = createFsFromVolume(new Volume()).promises;

    await expect(codexTraceReader.read(reference, { fs })).resolves.toMatchObject({
      turns: [
        {
          role: "human",
          text: "Use the metadata prompt",
          timestamp: new Date("2026-06-13T12:00:00.000Z"),
          sourceKind: "first_user_message"
        }
      ]
    });
  });

  it("normalizes Codex rollout system, reasoning, tool, and MCP payloads", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.codex/sessions/rollout-one.jsonl": [
          JSON.stringify({
            type: "session_meta",
            timestamp: "2026-06-13T12:00:00.000Z",
            payload: {
              type: "session_meta",
              base_instructions: { text: "\nYou are Codex.\n" }
            }
          }),
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-06-13T12:00:01.000Z",
            payload: { type: "reasoning", text: "Need inspect." }
          }),
          JSON.stringify({
            type: "event_msg",
            timestamp: "2026-06-13T12:00:02.000Z",
            payload: { type: "user_message", message: "Please inspect traces." }
          }),
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-06-13T12:00:03.000Z",
            payload: { type: "agent_message", message: "I will run pwd." }
          }),
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-06-13T12:00:04.000Z",
            payload: {
              type: "function_call",
              name: "exec_command",
              arguments: '{"cmd":"pwd"}',
              call_id: "call_exec"
            }
          }),
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-06-13T12:00:05.000Z",
            payload: {
              type: "function_call_output",
              call_id: "call_exec",
              output: "/repo\n"
            }
          }),
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-06-13T12:00:06.000Z",
            payload: {
              type: "custom_tool_call",
              name: "apply_patch",
              arguments: "*** Begin Patch\n*** End Patch",
              id: "call_patch"
            }
          }),
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-06-13T12:00:07.000Z",
            payload: {
              type: "custom_tool_call_output",
              call_id: "call_patch",
              output: "patched"
            }
          }),
          JSON.stringify({
            type: "event_msg",
            timestamp: "2026-06-13T12:00:08.000Z",
            payload: {
              type: "mcp_tool_call_end",
              invocation: {
                server: "pdf",
                tool: "read_pdf",
                arguments: { path: "brief.pdf" }
              },
              result: {
                Ok: {
                  content: [
                    { type: "text", text: "Page one." },
                    { type: "text", text: "Page two." }
                  ]
                }
              }
            }
          })
        ].join("\n")
      })
    ).promises;

    const trace = await codexTraceReader.read(
      {
        source: "codex",
        id: "thread-one",
        path: "/home/me/.codex/sessions/rollout-one.jsonl"
      },
      { fs }
    );

    expect(
      trace.turns.map(({ role, sourceKind, text, toolName, mcpServer }) => ({
        role,
        sourceKind,
        text,
        toolName,
        mcpServer
      }))
    ).toEqual([
      {
        role: "system",
        sourceKind: "base_instructions",
        text: "\nYou are Codex.\n",
        toolName: undefined,
        mcpServer: undefined
      },
      {
        role: "assistant",
        sourceKind: "reasoning",
        text: "Need inspect.",
        toolName: undefined,
        mcpServer: undefined
      },
      {
        role: "human",
        sourceKind: "user_message",
        text: "Please inspect traces.",
        toolName: undefined,
        mcpServer: undefined
      },
      {
        role: "assistant",
        sourceKind: "agent_message",
        text: "I will run pwd.",
        toolName: undefined,
        mcpServer: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_use",
        text: '{"cmd":"pwd"}',
        toolName: "exec_command",
        mcpServer: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_result",
        text: "/repo\n",
        toolName: "exec_command",
        mcpServer: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_use",
        text: "*** Begin Patch\n*** End Patch",
        toolName: "apply_patch",
        mcpServer: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_result",
        text: "patched",
        toolName: "apply_patch",
        mcpServer: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_result",
        text: '{"path":"brief.pdf"}\nPage one.\nPage two.',
        toolName: "read_pdf",
        mcpServer: "pdf"
      }
    ]);
  });

  it("keeps Codex system, reasoning, and tool payloads out of collected human prompts", async () => {
    const db: SqliteTraceDatabase = {
      all: vi.fn(() => [
        {
          id: "thread-one",
          rollout_path: "/home/me/.codex/sessions/rollout-one.jsonl",
          cwd: "/repo"
        }
      ]),
      close: vi.fn()
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.codex/sessions/rollout-one.jsonl": [
          JSON.stringify({
            type: "session_meta",
            payload: {
              type: "session_meta",
              base_instructions: { text: "You are Codex." }
            }
          }),
          JSON.stringify({
            type: "response_item",
            payload: { type: "reasoning", text: "private reasoning" }
          }),
          JSON.stringify({
            type: "response_item",
            payload: {
              type: "function_call",
              name: "exec_command",
              arguments: '{"cmd":"pwd"}',
              call_id: "call_exec"
            }
          }),
          JSON.stringify({
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "call_exec",
              output: "/repo"
            }
          }),
          JSON.stringify({
            type: "event_msg",
            payload: { type: "user_message", message: "Genuine Codex prompt" }
          })
        ].join("\n")
      })
    ).promises;

    const records = await collectHumanPrompts({
      sources: ["codex"],
      cwd: "/repo",
      homeDir: "/home/me",
      fs,
      sqlite: async () => db
    });

    expect(records.map((record) => record.text)).toEqual(["Genuine Codex prompt"]);
  });

  it("normalizes reported usage, context window, and model from the latest Codex token count", async () => {
    const db: SqliteTraceDatabase = {
      all: vi.fn(() => [
        {
          id: "thread-one",
          rollout_path: "/home/me/.codex/sessions/rollout-one.jsonl",
          model: "gpt-5.5",
          cwd: "/repo"
        }
      ]),
      close: vi.fn()
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.codex/sessions/rollout-one.jsonl": [
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                last_token_usage: {
                  input_tokens: 10,
                  cached_input_tokens: 2,
                  output_tokens: 3,
                  total_tokens: 13
                },
                model_context_window: 1000
              }
            }
          }),
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {},
                last_token_usage: {
                  input_tokens: 33693,
                  cached_input_tokens: 4992,
                  output_tokens: 390,
                  reasoning_output_tokens: 170,
                  total_tokens: 34083
                },
                model_context_window: 258400
              }
            }
          })
        ].join("\n")
      })
    ).promises;

    const references = await codexTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs,
      sqlite: async () => db
    });
    const trace = await codexTraceReader.read(references[0]!, { fs });

    expect(trace.model).toBe("gpt-5.5");
    expect(trace.contextWindow).toBe(258400);
    expect(trace.usage).toEqual({
      source: "reported",
      inputTokens: 33693,
      outputTokens: 390,
      cachedTokens: 4992,
      contextTokens: 34083
    });
  });

  it("omits usage when Codex rollouts do not include token counts", async () => {
    const reference = {
      source: "codex" as const,
      id: "thread-one",
      path: "/home/me/.codex/sessions/rollout-one.jsonl",
      metadata: { model: "gpt-5.5" }
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.codex/sessions/rollout-one.jsonl": JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "No token count here." }
        })
      })
    ).promises;

    const trace = await codexTraceReader.read(reference, { fs });

    expect(trace.model).toBe("gpt-5.5");
    expect(trace).not.toHaveProperty("usage");
    expect(trace).not.toHaveProperty("contextWindow");
  });

  it("ignores malformed Codex usage values from the latest token count", async () => {
    const reference = {
      source: "codex" as const,
      id: "thread-one",
      path: "/home/me/.codex/sessions/rollout-one.jsonl"
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.codex/sessions/rollout-one.jsonl": [
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                last_token_usage: {
                  input_tokens: 10,
                  cached_input_tokens: 2,
                  output_tokens: 3,
                  total_tokens: 13
                },
                model_context_window: 1000
              }
            }
          }),
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                last_token_usage: {
                  input_tokens: "33693",
                  cached_input_tokens: null,
                  output_tokens: 390,
                  total_tokens: "34083"
                },
                model_context_window: "258400"
              }
            }
          })
        ].join("\n")
      })
    ).promises;

    const trace = await codexTraceReader.read(reference, { fs });

    expect(trace).not.toHaveProperty("contextWindow");
    expect(trace.usage).toEqual({
      source: "reported",
      inputTokens: 0,
      outputTokens: 390,
      contextTokens: 0
    });
  });

  it("filters all-workspace discovery by since without cwd parameters", async () => {
    const db: SqliteTraceDatabase = {
      all: vi.fn(() => []),
      close: vi.fn()
    };

    await codexTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      allWorkspaces: true,
      since: new Date("2026-06-13T12:00:00.000Z"),
      fs: createFsFromVolume(new Volume()).promises,
      sqlite: async () => db
    });

    expect(db.all).toHaveBeenCalledWith(
      expect.stringContaining("FROM threads"),
      [1781352000, 1781352000000]
    );
  });

  it("throws sqlite errors that inherit ENOENT without owning it", async () => {
    const inheritedMissing = Object.create({ code: "ENOENT" }) as Error;
    Object.assign(inheritedMissing, { message: "sqlite permission denied" });

    await expect(
      codexTraceReader.discover({
        cwd: "/repo",
        homeDir: "/home/me",
        fs: createFsFromVolume(new Volume()).promises,
        sqlite: async () => {
          throw inheritedMissing;
        }
      })
    ).rejects.toBe(inheritedMissing);
  });
});
