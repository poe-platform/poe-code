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
      keepDataPath: ".poe-code/ingest/human-prompts.jsonl",
      fs,
      spawn,
      collectHumanPrompts
    });

    expect(result).toMatchObject({
      outputPath: ".poe-code/codex-gaslight.yaml",
      dataPath: ".poe-code/ingest/human-prompts.jsonl",
      promptCount: 1,
      traceCount: 2
    });
    await expect(fs.readFile("/repo/.poe-code/ingest/human-prompts.jsonl", "utf8")).resolves.toBe(
      '{"traceId":"one","source":"codex","cwd":"/repo","timestamp":"2026-06-13T12:00:00.000Z","text":"Did you test it?"}\n'
    );
    expect(spawn).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        cwd: "/repo",
        mode: "read",
        prompt: expect.stringContaining("/repo/.poe-code/ingest/human-prompts.jsonl")
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
      keepDataPath: "/tmp/prompts.jsonl",
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

  it("stores default prompt data under the workspace so the analysis agent can read it", async () => {
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

    expect(result.dataPath).toMatch(/^\.poe-code\/ingest\/human-prompts-\d+-\d+-\d+\.jsonl$/);
    const absoluteDataPath = `/repo/${result.dataPath}`;
    await expect(fs.readFile(absoluteDataPath, "utf8")).resolves.toContain(
      "Check workspace data"
    );
    expect(spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: expect.stringContaining(absoluteDataPath)
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
      keepDataPath: "/tmp/prompts.jsonl",
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
      keepDataPath: "/tmp/prompts.jsonl",
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
      keepDataPath: "/tmp/prompts.jsonl",
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
        keepDataPath: "/tmp/prompts.jsonl",
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
