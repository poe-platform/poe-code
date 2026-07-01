import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { collectHumanPrompts } from "../collect.js";
import { claudeTraceReader } from "./claude.js";

describe("claudeTraceReader", () => {
  it("discovers workspace JSONL sessions and extracts human text turns", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": [
          JSON.stringify({
            type: "user",
            sessionId: "session-one",
            uuid: "turn-one",
            cwd: "/repo",
            timestamp: "2026-06-13T12:00:00.000Z",
            message: {
              role: "user",
              content: [
                { type: "text", text: "Please implement the parser." },
                { type: "tool_result", content: "ignore tool output" },
                { text: "Did you test it?" }
              ]
            }
          }),
          "not json",
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            message: { role: "assistant", content: "done" }
          })
        ].join("\n"),
        "/home/me/.claude/projects/-other/trace-two.jsonl": JSON.stringify({
          type: "user",
          sessionId: "session-two",
          cwd: "/other",
          timestamp: "2026-06-13T13:00:00.000Z",
          message: { role: "user", content: "Ignore other workspace" }
        })
      })
    ).promises;

    const references = await claudeTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      source: "claude",
      id: "session-one",
      cwd: "/repo"
    });

    const trace = await claudeTraceReader.read(references[0]!, { fs });

    expect(trace.turns).toEqual([
      {
        id: "turn-one",
        role: "human",
        text: "Please implement the parser.",
        timestamp: new Date("2026-06-13T12:00:00.000Z"),
        sourceKind: "user"
      },
      {
        id: "turn-one",
        role: "tool",
        text: "ignore tool output",
        timestamp: new Date("2026-06-13T12:00:00.000Z"),
        sourceKind: "tool_result"
      },
      {
        id: "turn-one",
        role: "human",
        text: "Did you test it?",
        timestamp: new Date("2026-06-13T12:00:00.000Z"),
        sourceKind: "user"
      },
      {
        role: "assistant",
        text: "done",
        sourceKind: "assistant"
      }
    ]);
  });

  it("scans every Claude project when allWorkspaces is true", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/one.jsonl": JSON.stringify({
          type: "user",
          sessionId: "one",
          cwd: "/repo",
          message: { role: "user", content: "one" }
        }),
        "/home/me/.claude/projects/-other/two.jsonl": JSON.stringify({
          type: "user",
          sessionId: "two",
          cwd: "/other",
          message: { role: "user", content: "two" }
        })
      })
    ).promises;

    const references = await claudeTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      allWorkspaces: true,
      fs
    });

    expect(references.map((reference) => reference.id).sort()).toEqual(["one", "two"]);
  });

  it("does not discover subagent transcripts as top-level Claude sessions", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/parent-session.jsonl": JSON.stringify({
          type: "user",
          sessionId: "parent-session",
          cwd: "/repo",
          message: { role: "user", content: "parent prompt" }
        }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-child.jsonl":
          JSON.stringify({
            type: "user",
            sessionId: "parent-session",
            cwd: "/repo",
            isSidechain: true,
            agentId: "child",
            message: { role: "user", content: "child prompt" }
          })
      })
    ).promises;

    const references = await claudeTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });

    expect(references.map((reference) => reference.id)).toEqual(["parent-session"]);
  });

  it("surfaces matching Claude subagent transcripts as ordered child trace references", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/parent-session.jsonl": [
          JSON.stringify({
            type: "assistant",
            sessionId: "parent-session",
            cwd: "/repo",
            timestamp: "2026-06-13T12:00:00.000Z",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_second",
                  name: "Task",
                  input: { description: "Second child first in transcript" }
                },
                {
                  type: "tool_use",
                  id: "toolu_first",
                  name: "Agent",
                  input: { description: "First child second in transcript" }
                },
                {
                  type: "tool_use",
                  id: "toolu_ignored",
                  name: "Bash",
                  input: { command: "pwd" }
                }
              ]
            }
          })
        ].join("\n"),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-first.jsonl": [
          JSON.stringify({
            type: "assistant",
            sessionId: "parent-session",
            cwd: "/repo",
            isSidechain: true,
            agentId: "first",
            timestamp: "2026-06-13T12:01:00.000Z",
            message: {
              role: "assistant",
              model: "claude-fable-5",
              usage: {
                input_tokens: 50,
                output_tokens: 7
              },
              content: [
                {
                  type: "tool_use",
                  id: "toolu_nested",
                  name: "Agent",
                  input: { description: "Nested child" }
                }
              ]
            }
          })
        ].join("\n"),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-first.meta.json":
          JSON.stringify({
            agentType: "Explore",
            description: "Research trace formats",
            toolUseId: "toolu_first",
            spawnDepth: 1
          }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-second.jsonl":
          JSON.stringify({
            type: "assistant",
            sessionId: "parent-session",
            cwd: "/repo",
            isSidechain: true,
            agentId: "second",
            timestamp: "2026-06-13T12:02:00.000Z",
            message: {
              role: "assistant",
              content: "Second child transcript"
            }
          }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-second.meta.json":
          JSON.stringify({
            agentType: "Explore",
            description: "Inspect codebase",
            toolUseId: "toolu_second",
            spawnDepth: 1
          }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-nested.jsonl":
          JSON.stringify({
            type: "assistant",
            sessionId: "parent-session",
            cwd: "/repo",
            isSidechain: true,
            agentId: "nested",
            timestamp: "2026-06-13T12:03:00.000Z",
            message: {
              role: "assistant",
              content: "Nested child transcript"
            }
          }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-nested.meta.json":
          JSON.stringify({
            agentType: "Explore",
            description: "Follow nested clue",
            toolUseId: "toolu_nested",
            spawnDepth: 2
          }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-orphan.jsonl":
          JSON.stringify({
            type: "assistant",
            sessionId: "parent-session",
            cwd: "/repo",
            isSidechain: true,
            agentId: "orphan",
            message: { role: "assistant", content: "orphan" }
          }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-orphan.meta.json":
          JSON.stringify({
            agentType: "Explore",
            description: "Should not attach",
            toolUseId: "toolu_orphan",
            spawnDepth: 1
          }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-broken.jsonl":
          JSON.stringify({
            type: "assistant",
            sessionId: "parent-session",
            cwd: "/repo",
            isSidechain: true,
            agentId: "broken",
            message: { role: "assistant", content: "broken" }
          }),
        "/home/me/.claude/projects/-repo/parent-session/subagents/agent-broken.meta.json": "{"
      })
    ).promises;

    const secondUpdatedAt = (await fs.stat(
      "/home/me/.claude/projects/-repo/parent-session/subagents/agent-second.jsonl"
    )).mtime;
    const firstUpdatedAt = (await fs.stat(
      "/home/me/.claude/projects/-repo/parent-session/subagents/agent-first.jsonl"
    )).mtime;
    const nestedUpdatedAt = (await fs.stat(
      "/home/me/.claude/projects/-repo/parent-session/subagents/agent-nested.jsonl"
    )).mtime;

    const parent = await claudeTraceReader.read(
      {
        source: "claude",
        id: "parent-session",
        path: "/home/me/.claude/projects/-repo/parent-session.jsonl"
      },
      { fs }
    );

    expect(parent.children).toEqual([
      {
        source: "claude",
        id: "second",
        path: "/home/me/.claude/projects/-repo/parent-session/subagents/agent-second.jsonl",
        cwd: "/repo",
        updatedAt: secondUpdatedAt,
        title: "Inspect codebase",
        agentType: "Explore",
        spawnDepth: 1
      },
      {
        source: "claude",
        id: "first",
        path: "/home/me/.claude/projects/-repo/parent-session/subagents/agent-first.jsonl",
        cwd: "/repo",
        updatedAt: firstUpdatedAt,
        title: "Research trace formats",
        agentType: "Explore",
        spawnDepth: 1
      }
    ]);

    const firstChild = await claudeTraceReader.read(parent.children![1]!, { fs });

    expect(firstChild.usage).toEqual({
      source: "reported",
      inputTokens: 50,
      outputTokens: 7,
      contextTokens: 57
    });
    expect(firstChild.children).toEqual([
      {
        source: "claude",
        id: "nested",
        path: "/home/me/.claude/projects/-repo/parent-session/subagents/agent-nested.jsonl",
        cwd: "/repo",
        updatedAt: nestedUpdatedAt,
        title: "Follow nested clue",
        agentType: "Explore",
        spawnDepth: 2
      }
    ]);
  });

  it("omits invalid numeric timestamps instead of creating invalid dates", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": JSON.stringify({
          type: "user",
          sessionId: "session-one",
          cwd: "/repo",
          timestamp: 100_000_000_000_000_000_000,
          message: { role: "user", content: "collect this prompt" }
        })
      })
    ).promises;

    const references = await claudeTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });
    const trace = await claudeTraceReader.read(references[0]!, { fs });

    expect(references[0]).not.toHaveProperty("updatedAt");
    expect(trace.turns[0]).toEqual({
      role: "human",
      text: "collect this prompt",
      sourceKind: "user"
    });
  });

  it("normalizes Claude content blocks with tool, MCP, skill, and system attribution", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": [
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            timestamp: "2026-06-13T12:00:00.000Z",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "I will inspect the project." },
                { type: "thinking", thinking: "Need repository context." },
                {
                  type: "tool_use",
                  id: "toolu_bash",
                  name: "Bash",
                  input: { command: "pwd" }
                },
                {
                  type: "tool_use",
                  id: "toolu_mcp",
                  name: "mcp__pdf__read_pdf",
                  input: { path: "brief.pdf" }
                },
                {
                  type: "tool_use",
                  id: "toolu_skill",
                  name: "Skill",
                  input: { skill: "write-spec" }
                }
              ]
            }
          }),
          JSON.stringify({
            type: "user",
            sessionId: "session-one",
            timestamp: "2026-06-13T12:00:01.000Z",
            message: {
              role: "user",
              content: [
                { type: "tool_result", tool_use_id: "toolu_bash", content: "repo" },
                {
                  type: "tool_result",
                  tool_use_id: "toolu_mcp",
                  content: [{ type: "text", text: "PDF text" }]
                },
                {
                  type: "tool_result",
                  tool_use_id: "toolu_skill",
                  content: "Launching skill: write-spec"
                },
                {
                  type: "text",
                  text: "Base directory for this skill: /home/me/.codex/skills/write-spec"
                },
                { type: "text", text: "<system-reminder>Keep going</system-reminder>" },
                { type: "text", text: "Please implement it." }
              ]
            }
          })
        ].join("\n")
      })
    ).promises;

    const trace = await claudeTraceReader.read(
      {
        source: "claude",
        id: "session-one",
        path: "/home/me/.claude/projects/-repo/trace-one.jsonl"
      },
      { fs }
    );

    expect(
      trace.turns.map(({ role, sourceKind, text, toolName, mcpServer, skillName }) => ({
        role,
        sourceKind,
        text,
        toolName,
        mcpServer,
        skillName
      }))
    ).toEqual([
      {
        role: "assistant",
        sourceKind: "assistant",
        text: "I will inspect the project.",
        toolName: undefined,
        mcpServer: undefined,
        skillName: undefined
      },
      {
        role: "assistant",
        sourceKind: "reasoning",
        text: "Need repository context.",
        toolName: undefined,
        mcpServer: undefined,
        skillName: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_use",
        text: '{"command":"pwd"}',
        toolName: "Bash",
        mcpServer: undefined,
        skillName: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_use",
        text: '{"path":"brief.pdf"}',
        toolName: "mcp__pdf__read_pdf",
        mcpServer: "pdf",
        skillName: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_use",
        text: '{"skill":"write-spec"}',
        toolName: "Skill",
        mcpServer: undefined,
        skillName: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_result",
        text: "repo",
        toolName: "Bash",
        mcpServer: undefined,
        skillName: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_result",
        text: "PDF text",
        toolName: "mcp__pdf__read_pdf",
        mcpServer: "pdf",
        skillName: undefined
      },
      {
        role: "tool",
        sourceKind: "tool_result",
        text: "Launching skill: write-spec",
        toolName: "Skill",
        mcpServer: undefined,
        skillName: undefined
      },
      {
        role: "system",
        sourceKind: "skill_instructions",
        text: "Base directory for this skill: /home/me/.codex/skills/write-spec",
        toolName: undefined,
        mcpServer: undefined,
        skillName: "write-spec"
      },
      {
        role: "system",
        sourceKind: "system_reminder",
        text: "<system-reminder>Keep going</system-reminder>",
        toolName: undefined,
        mcpServer: undefined,
        skillName: undefined
      },
      {
        role: "human",
        sourceKind: "user",
        text: "Please implement it.",
        toolName: undefined,
        mcpServer: undefined,
        skillName: undefined
      }
    ]);
  });

  it("keeps Claude skill instructions, system reminders, and tool blocks out of collected human prompts", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": [
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            cwd: "/repo",
            message: {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "private reasoning" },
                {
                  type: "tool_use",
                  id: "toolu_skill",
                  name: "Skill",
                  input: { skill: "write-spec" }
                }
              ]
            }
          }),
          JSON.stringify({
            type: "user",
            sessionId: "session-one",
            cwd: "/repo",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_skill",
                  content: "Launching skill: write-spec"
                },
                {
                  type: "text",
                  text: "Base directory for this skill: /home/me/.codex/skills/write-spec"
                },
                { type: "text", text: "<system-reminder>Keep working</system-reminder>" },
                { type: "text", text: "Genuine human prompt" }
              ]
            }
          })
        ].join("\n")
      })
    ).promises;

    const records = await collectHumanPrompts({
      sources: ["claude"],
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });

    expect(records.map((record) => record.text)).toEqual(["Genuine human prompt"]);
  });

  it("parses Claude skill names from skill instruction paths when no Skill tool call is pending", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": JSON.stringify({
          type: "user",
          sessionId: "session-one",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "Base directory for this skill: /home/me/.codex/skills/openai-docs\nUse official docs."
              }
            ]
          }
        })
      })
    ).promises;

    const trace = await claudeTraceReader.read(
      {
        source: "claude",
        id: "session-one",
        path: "/home/me/.claude/projects/-repo/trace-one.jsonl"
      },
      { fs }
    );

    expect(trace.turns).toEqual([
      {
        role: "system",
        text: "Base directory for this skill: /home/me/.codex/skills/openai-docs\nUse official docs.",
        sourceKind: "skill_instructions",
        skillName: "openai-docs"
      }
    ]);
  });

  it("normalizes Claude skill listing attachments as skill context", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": JSON.stringify({
          type: "attachment",
          sessionId: "session-one",
          uuid: "skill-listing",
          timestamp: "2026-06-13T12:00:00.000Z",
          attachment: {
            type: "skill_listing",
            names: ["write-spec", "openai-docs"],
            content: [
              "- write-spec: Create authoritative project specifications.",
              "  Continue the description.",
              "- openai-docs: Use official OpenAI docs."
            ].join("\n")
          }
        })
      })
    ).promises;

    const trace = await claudeTraceReader.read(
      {
        source: "claude",
        id: "session-one",
        path: "/home/me/.claude/projects/-repo/trace-one.jsonl"
      },
      { fs }
    );

    expect(trace.turns).toEqual([
      {
        id: "skill-listing",
        role: "system",
        text: "write-spec: Create authoritative project specifications. Continue the description.",
        timestamp: new Date("2026-06-13T12:00:00.000Z"),
        sourceKind: "skill_listing",
        skillName: "write-spec"
      },
      {
        id: "skill-listing",
        role: "system",
        text: "openai-docs: Use official OpenAI docs.",
        timestamp: new Date("2026-06-13T12:00:00.000Z"),
        sourceKind: "skill_listing",
        skillName: "openai-docs"
      }
    ]);
  });

  it("uses a pending Claude skill name once before falling back to the instruction path", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": [
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_skill",
                  name: "Skill",
                  input: { skill: "write-spec" }
                }
              ]
            }
          }),
          JSON.stringify({
            type: "user",
            sessionId: "session-one",
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Base directory for this skill: /home/me/.codex/skills/path-would-be-wrong"
                },
                {
                  type: "text",
                  text: "Base directory for this skill: /home/me/.codex/skills/openai-docs"
                }
              ]
            }
          })
        ].join("\n")
      })
    ).promises;

    const trace = await claudeTraceReader.read(
      {
        source: "claude",
        id: "session-one",
        path: "/home/me/.claude/projects/-repo/trace-one.jsonl"
      },
      { fs }
    );

    expect(trace.turns.map((turn) => turn.skillName)).toEqual([
      undefined,
      "write-spec",
      "openai-docs"
    ]);
  });

  it("normalizes reported usage and model from the latest Claude assistant usage record", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": [
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            message: {
              role: "assistant",
              model: "claude-fable-4",
              content: "first",
              usage: {
                input_tokens: 100,
                cache_creation_input_tokens: 20,
                cache_read_input_tokens: 30,
                output_tokens: 10
              }
            }
          }),
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            message: {
              role: "assistant",
              model: "claude-fable-5",
              content: "second",
              usage: {
                input_tokens: 4223,
                cache_creation_input_tokens: 7564,
                cache_read_input_tokens: 15103,
                output_tokens: 247
              }
            }
          })
        ].join("\n")
      })
    ).promises;

    const trace = await claudeTraceReader.read(
      {
        source: "claude",
        id: "session-one",
        path: "/home/me/.claude/projects/-repo/trace-one.jsonl"
      },
      { fs }
    );

    expect(trace.model).toBe("claude-fable-5");
    expect(trace.usage).toEqual({
      source: "reported",
      inputTokens: 4223,
      outputTokens: 247,
      cachedTokens: 15103,
      cacheCreationTokens: 7564,
      contextTokens: 27137
    });
  });

  it("omits usage when Claude assistant records do not report usage", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": JSON.stringify({
          type: "assistant",
          sessionId: "session-one",
          message: { role: "assistant", model: "claude-fable-5", content: "done" }
        })
      })
    ).promises;

    const trace = await claudeTraceReader.read(
      {
        source: "claude",
        id: "session-one",
        path: "/home/me/.claude/projects/-repo/trace-one.jsonl"
      },
      { fs }
    );

    expect(trace).not.toHaveProperty("model");
    expect(trace).not.toHaveProperty("usage");
  });

  it("ignores malformed Claude usage values from the latest usage record", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": [
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            message: {
              role: "assistant",
              model: "claude-fable-4",
              content: "first",
              usage: {
                input_tokens: 100,
                cache_creation_input_tokens: 20,
                cache_read_input_tokens: 30,
                output_tokens: 10
              }
            }
          }),
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            message: {
              role: "assistant",
              model: "claude-fable-5",
              content: "second",
              usage: {
                input_tokens: "4223",
                cache_creation_input_tokens: 7564,
                cache_read_input_tokens: null,
                output_tokens: 247
              }
            }
          })
        ].join("\n")
      })
    ).promises;

    const trace = await claudeTraceReader.read(
      {
        source: "claude",
        id: "session-one",
        path: "/home/me/.claude/projects/-repo/trace-one.jsonl"
      },
      { fs }
    );

    expect(trace.model).toBe("claude-fable-5");
    expect(trace.usage).toEqual({
      source: "reported",
      inputTokens: 0,
      outputTokens: 247,
      cacheCreationTokens: 7564,
      contextTokens: 7811
    });
  });

  it("throws readdir errors that inherit ENOENT without owning it", async () => {
    const inheritedMissing = Object.create({ code: "ENOENT" }) as Error;
    Object.assign(inheritedMissing, { message: "permission denied" });
    const fs = {
      async readdir(): Promise<string[]> {
        throw inheritedMissing;
      },
      async readFile(): Promise<string> {
        throw new Error("unexpected read");
      },
      async mkdir(): Promise<void> {},
      async writeFile(): Promise<void> {},
      async stat(): Promise<{ isFile(): boolean; isDirectory(): boolean }> {
        return { isFile: () => false, isDirectory: () => false };
      }
    };

    await expect(
      claudeTraceReader.discover({
        cwd: "/repo",
        homeDir: "/home/me",
        fs
      })
    ).rejects.toBe(inheritedMissing);
  });
});
