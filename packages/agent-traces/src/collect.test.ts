import { describe, expect, it } from "vitest";
import { collectHumanPromptsFromReaders } from "./collect.js";
import type { TraceReader } from "./types.js";

describe("collectHumanPromptsFromReaders", () => {
  it("collects through registered readers, sorts newest first, and applies the limit", async () => {
    const readers: TraceReader[] = [
      {
        id: "claude",
        defaultRoots: () => [],
        discover: async () => [
          { source: "claude", id: "claude-one", cwd: "/repo", title: "Claude" }
        ],
        read: async () => ({
          source: "claude",
          id: "claude-one",
          cwd: "/repo",
          title: "Claude",
          turns: [
            {
              role: "human",
              text: "older",
              timestamp: new Date("2026-06-13T10:00:00.000Z")
            }
          ]
        })
      },
      {
        id: "codex",
        defaultRoots: () => [],
        discover: async () => [{ source: "codex", id: "codex-one", cwd: "/repo", title: "Codex" }],
        read: async () => ({
          source: "codex",
          id: "codex-one",
          cwd: "/repo",
          title: "Codex",
          turns: [
            { role: "assistant", text: "ignored" },
            {
              role: "human",
              text: "newer",
              timestamp: new Date("2026-06-13T11:00:00.000Z")
            }
          ]
        })
      }
    ];

    const result = await collectHumanPromptsFromReaders(readers, {
      sources: ["codex", "claude"],
      cwd: "/repo",
      homeDir: "/home/me",
      limit: 1
    });

    expect(result.traceCount).toBe(2);
    expect(result.records).toEqual([
      {
        traceId: "codex-one",
        source: "codex",
        cwd: "/repo",
        title: "Codex",
        timestamp: "2026-06-13T11:00:00.000Z",
        text: "newer"
      }
    ]);
  });

  it("excludes injected context records and de-duplicates exact repeated human prompts", async () => {
    const readers: TraceReader[] = [
      {
        id: "codex",
        defaultRoots: () => [],
        discover: async () => [{ source: "codex", id: "codex-one", cwd: "/repo" }],
        read: async () => ({
          source: "codex",
          id: "codex-one",
          cwd: "/repo",
          turns: [
            {
              role: "human",
              text: '<codex_internal_context source="goal">ignore</codex_internal_context>',
              timestamp: new Date("2026-06-13T12:00:00.000Z")
            },
            {
              role: "human",
              text: "# AGENTS.md instructions for /repo\nignore",
              timestamp: new Date("2026-06-13T12:00:01.000Z")
            },
            {
              role: "human",
              text: '## Prior conversation with Codex:\n{"conversation":[]}',
              timestamp: new Date("2026-06-13T12:00:01.500Z")
            },
            {
              role: "human",
              text: "<turn_aborted>\nignore",
              timestamp: new Date("2026-06-13T12:00:01.750Z")
            },
            {
              role: "human",
              text: "<subagent_notification>\nignore",
              timestamp: new Date("2026-06-13T12:00:01.875Z")
            },
            {
              role: "human",
              text: "Read this JSONL file of human prompts from coding-agent traces:\n/tmp/prompts.jsonl",
              timestamp: new Date("2026-06-13T12:00:01.900Z")
            },
            {
              role: "human",
              text: "Did you test it?",
              timestamp: new Date("2026-06-13T12:00:02.000Z")
            },
            {
              role: "human",
              text: "<ide_opened_file>The user opened a file.</ide_opened_file>\ncommit",
              timestamp: new Date("2026-06-13T12:00:03.000Z")
            },
            {
              role: "human",
              text: "Did you test it?",
              timestamp: new Date("2026-06-13T12:00:02.000Z")
            }
          ]
        })
      }
    ];

    const result = await collectHumanPromptsFromReaders(readers, {
      sources: ["codex"],
      cwd: "/repo",
      homeDir: "/home/me"
    });

    expect(result.records.map((record) => record.text)).toEqual(["commit", "Did you test it?"]);
  });

  it("keeps repeated human prompts from separate turns when timestamps differ", async () => {
    const readers: TraceReader[] = [
      {
        id: "codex",
        defaultRoots: () => [],
        discover: async () => [{ source: "codex", id: "codex-one", cwd: "/repo" }],
        read: async () => ({
          source: "codex",
          id: "codex-one",
          cwd: "/repo",
          turns: [
            {
              role: "human",
              text: "retry the command",
              timestamp: new Date("2026-06-13T12:00:00.000Z")
            },
            {
              role: "assistant",
              text: "failed"
            },
            {
              role: "human",
              text: "retry the command",
              timestamp: new Date("2026-06-13T12:05:00.000Z")
            }
          ]
        })
      }
    ];

    const result = await collectHumanPromptsFromReaders(readers, {
      sources: ["codex"],
      cwd: "/repo",
      homeDir: "/home/me"
    });

    expect(result.records).toMatchObject([
      {
        text: "retry the command",
        timestamp: "2026-06-13T12:05:00.000Z"
      },
      {
        text: "retry the command",
        timestamp: "2026-06-13T12:00:00.000Z"
      }
    ]);
  });

  it("rejects invalid since dates before readers run", async () => {
    const discover = vi.fn();
    const readers: TraceReader[] = [
      {
        id: "codex",
        defaultRoots: () => [],
        discover,
        read: async () => ({
          source: "codex",
          id: "codex-one",
          turns: []
        })
      }
    ];

    await expect(
      collectHumanPromptsFromReaders(readers, {
        sources: ["codex"],
        cwd: "/repo",
        homeDir: "/home/me",
        since: new Date(Number.NaN)
      })
    ).rejects.toThrow("since must be a valid Date");
    expect(discover).not.toHaveBeenCalled();
  });

  it("rejects invalid limits", async () => {
    const readers: TraceReader[] = [
      {
        id: "codex",
        defaultRoots: () => [],
        discover: async () => [{ source: "codex", id: "codex-one", cwd: "/repo" }],
        read: async () => ({
          source: "codex",
          id: "codex-one",
          cwd: "/repo",
          turns: [{ role: "human", text: "one" }]
        })
      }
    ];

    for (const limit of [-1, 1.5, Number.NaN, Infinity]) {
      await expect(
        collectHumanPromptsFromReaders(readers, {
          sources: ["codex"],
          cwd: "/repo",
          homeDir: "/home/me",
          limit
        })
      ).rejects.toThrow("limit must be a non-negative integer");
    }
  });
});
