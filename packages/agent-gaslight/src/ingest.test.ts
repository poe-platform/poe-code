import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { ingestGaslight } from "./ingest.js";

describe("ingestGaslight", () => {
  it("writes prompt data, sends the selected agent the data file path, and creates a prefixed variant when gaslight.yaml exists", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/.poe-code/gaslight.yaml": "prompt: Existing\nfollowups:\n  - Keep\n"
      })
    ).promises;
    const collectHumanPrompts = vi.fn().mockResolvedValue({
      traceCount: 2,
      records: [
        {
          traceId: "one",
          source: "codex",
          cwd: "/repo",
          timestamp: "2026-06-13T12:00:00.000Z",
          text: "Did you test it?"
        }
      ]
    });
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout:
        "prompt: Implement\nfollowups:\n  - Did you test it?\n  - Did you inspect the output?\n",
      stderr: "",
      threadId: "analysis"
    });

    const result = await ingestGaslight({
      cwd: "/repo",
      homeDir: "/home/me",
      analysisAgent: "codex",
      keepDataPath: ".poe-code/ingest/human-prompts.md",
      fs,
      spawn,
      collectHumanPrompts
    });

    expect(result).toMatchObject({
      outputPath: ".poe-code/codex-gaslight.yaml",
      dataPath: ".poe-code/ingest/human-prompts.md",
      promptCount: 1,
      traceCount: 2
    });
    await expect(fs.readFile("/repo/.poe-code/ingest/human-prompts.md", "utf8")).resolves.toContain(
      "Did you test it?"
    );
    expect(spawn).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        cwd: "/repo",
        mode: "read",
        prompt: expect.stringContaining("/repo/.poe-code/ingest/human-prompts.md")
      })
    );
    await expect(fs.readFile("/repo/.poe-code/codex-gaslight.yaml", "utf8")).resolves.toBe(
      "prompt: Implement\nfollowups:\n  - Did you test it?\n  - Did you inspect the output?\n"
    );
  });

  it("writes gaslight.yaml when no config exists", async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "prompt: Implement\nfollowups:\n  - Check it\n",
      stderr: ""
    });

    const result = await ingestGaslight({
      cwd: "/repo",
      homeDir: "/home/me",
      analysisAgent: "claude-code",
      keepDataPath: "/tmp/prompts.md",
      fs,
      spawn,
      collectHumanPrompts: vi.fn().mockResolvedValue({
        traceCount: 1,
        records: [{ traceId: "one", source: "claude", text: "Check it" }]
      })
    });

    expect(result.outputPath).toBe(".poe-code/gaslight.yaml");
    await expect(fs.readFile("/repo/.poe-code/gaslight.yaml", "utf8")).resolves.toContain(
      "prompt: Implement"
    );
  });

  it("stores default prompt data under the workspace for analysis and removes it afterwards", async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "prompt: Implement\nfollowups:\n  - Check workspace data\n",
      stderr: ""
    });

    const result = await ingestGaslight({
      cwd: "/repo",
      homeDir: "/home/me",
      analysisAgent: "claude-code",
      fs,
      spawn,
      collectHumanPrompts: vi.fn().mockResolvedValue({
        traceCount: 1,
        records: [{ traceId: "one", source: "claude", text: "Check workspace data" }]
      })
    });

    expect(result.dataPath).toMatch(/^\.poe-code\/ingest\/human-prompts-\d+-\d+-\d+\.md$/);
    const absoluteDataPath = `/repo/${result.dataPath}`;
    expect(spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: expect.stringContaining(absoluteDataPath)
      })
    );
    await expect(fs.readFile(absoluteDataPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes default prompt data when analysis fails", async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "analysis failed"
    });

    await expect(
      ingestGaslight({
        cwd: "/repo",
        homeDir: "/home/me",
        analysisAgent: "claude-code",
        fs,
        spawn,
        collectHumanPrompts: vi.fn().mockResolvedValue({
          traceCount: 1,
          records: [{ traceId: "one", source: "claude", text: "Check workspace data" }]
        })
      })
    ).rejects.toThrow("Gaslight ingest analysis failed");

    const spawnOptions = spawn.mock.calls[0]?.[1];
    expect(spawnOptions?.prompt).toEqual(expect.stringContaining("/repo/.poe-code/ingest/"));
    const match = spawnOptions?.prompt.match(/\/repo\/\.poe-code\/ingest\/[^\s]+\.md/);
    expect(match?.[0]).toBeDefined();
    await expect(fs.readFile(match?.[0] ?? "", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes a curated Markdown analysis input instead of raw trace JSONL", async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "prompt: Implement\nfollowups:\n  - Did you verify and then make one appropriate commit?\n",
      stderr: ""
    });

    await ingestGaslight({
      cwd: "/repo",
      homeDir: "/home/me",
      analysisAgent: "claude-code",
      keepDataPath: ".poe-code/ingest/prompts.md",
      fs,
      spawn,
      collectHumanPrompts: vi.fn().mockResolvedValue({
        traceCount: 2,
        records: [
          {
            traceId: "one",
            source: "codex",
            cwd: "/repo",
            title: "Build feature",
            timestamp: "2026-06-13T12:00:00.000Z",
            text: "commit"
          },
          {
            traceId: "two",
            source: "claude",
            cwd: "/repo",
            title: "Ship feature",
            timestamp: "2026-06-13T12:05:00.000Z",
            text: "commit"
          },
          {
            traceId: "two",
            source: "claude",
            cwd: "/repo",
            title: "Ship feature",
            timestamp: "2026-06-13T12:06:00.000Z",
            text: "Run tests in /repo and inspect logs under /home/me/.poe-code/logs/errors.log"
          }
        ]
      })
    });

    const content = await fs.readFile("/repo/.poe-code/ingest/prompts.md", "utf8");
    expect(content).toContain("# Gaslight ingest analysis input");
    expect(content).toContain("## Repeated short prompts");
    expect(content).toContain("- `commit` - 2 occurrences");
    expect(content).toContain("### Trace 1: Build feature");
    expect(content).toContain("### Trace 2: Ship feature");
    expect(content).toContain("Run tests in <workspace> and inspect logs under <home>/.poe-code/logs/errors.log");
    expect(content).not.toContain('{"traceId"');
    expect(content).not.toContain("/repo");
    expect(content).not.toContain("/home/me");

    expect(spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: expect.stringContaining("Do not produce two followups for the same workflow step")
      })
    );
  });

  it("extracts YAML from Codex JSONL agent message output", async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "thread-one" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "prompt: Implement\nfollowups:\n  - Did you run the real command?\n"
          }
        })
      ].join("\n"),
      stderr: ""
    });

    await ingestGaslight({
      cwd: "/repo",
      homeDir: "/home/me",
      analysisAgent: "codex",
      keepDataPath: "/tmp/prompts.md",
      fs,
      spawn,
      collectHumanPrompts: vi.fn().mockResolvedValue({
        traceCount: 1,
        records: [{ traceId: "one", source: "codex", text: "Run the real command" }]
      })
    });

    await expect(fs.readFile("/repo/.poe-code/gaslight.yaml", "utf8")).resolves.toContain(
      "Did you run the real command?"
    );
  });

  it("extracts YAML from Claude JSONL assistant output", async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: [
        JSON.stringify({
          type: "system",
          subtype: "hook_started",
          hook_id: "hook-one"
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "prompt: Implement\nfollowups:\n  - Did Claude parse this as YAML?\n"
              }
            ]
          }
        }),
        JSON.stringify({ type: "result", usage: { input_tokens: 10, output_tokens: 4 } })
      ].join("\n"),
      stderr: ""
    });

    await ingestGaslight({
      cwd: "/repo",
      homeDir: "/home/me",
      analysisAgent: "claude-code",
      keepDataPath: "/tmp/prompts.md",
      fs,
      spawn,
      collectHumanPrompts: vi.fn().mockResolvedValue({
        traceCount: 1,
        records: [{ traceId: "one", source: "claude", text: "Parse Claude JSONL" }]
      })
    });

    await expect(fs.readFile("/repo/.poe-code/gaslight.yaml", "utf8")).resolves.toContain(
      "Did Claude parse this as YAML?"
    );
  });

  it("extracts YAML from a fenced block inside assistant prose", async () => {
    const fs = createFsFromVolume(new Volume()).promises;
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: [
                  "I analyzed the prompt file. Here is the config:",
                  "```yaml",
                  "prompt: Implement",
                  "followups:",
                  "  - Did you verify the real output?",
                  "```"
                ].join("\n")
              }
            ]
          }
        })
      ].join("\n"),
      stderr: ""
    });

    await ingestGaslight({
      cwd: "/repo",
      homeDir: "/home/me",
      analysisAgent: "claude-code",
      keepDataPath: "/tmp/prompts.md",
      fs,
      spawn,
      collectHumanPrompts: vi.fn().mockResolvedValue({
        traceCount: 1,
        records: [{ traceId: "one", source: "claude", text: "Verify real output" }]
      })
    });

    await expect(fs.readFile("/repo/.poe-code/gaslight.yaml", "utf8")).resolves.toContain(
      "Did you verify the real output?"
    );
  });

  it("fails without writing the final file when the analysis agent returns invalid YAML", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/.poe-code/gaslight.yaml": "prompt: Existing\nfollowups:\n  - Keep\n"
      })
    ).promises;

    await expect(
      ingestGaslight({
        cwd: "/repo",
        homeDir: "/home/me",
        analysisAgent: "codex",
        keepDataPath: "/tmp/prompts.md",
        fs,
        spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "not: gaslight\n", stderr: "" }),
        collectHumanPrompts: vi.fn().mockResolvedValue({
          traceCount: 1,
          records: [{ traceId: "one", source: "codex", text: "Try again" }]
        })
      })
    ).rejects.toThrow("Invalid gaslight config");

    await expect(fs.readFile("/repo/.poe-code/codex-gaslight.yaml", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
