import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { discoverDocs } from "./discovery/discovery.js";
import { parseFrontmatter, writeFrontmatter } from "./frontmatter/frontmatter.js";
import type { RalphFrontmatter } from "./frontmatter/frontmatter.js";
import { runRalph } from "./run/ralph.js";
import { createRalphSimulation, failTurn, successTurn } from "./testing/simulation.js";
import { interpolateVariables } from "./variables/variables.js";
import type {
  AgentRunInput,
  AgentRunResult,
  RalphRunOptions,
  RalphRunResult
} from "@poe-code/ralph";

function createFs(files: Record<string, string>) {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    readdir: (filePath: string) =>
      rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath: string) => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: Number(stat.mtimeMs)
      };
    }
  };
}

function createRunFs(files: Record<string, string>) {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    rawFs,
    fs: {
      readFile: (filePath: string, encoding: BufferEncoding) =>
        rawFs.readFile(filePath, encoding) as Promise<string>,
      writeFile: async (filePath: string, content: string) => {
        await rawFs.mkdir(path.dirname(filePath), {
          recursive: true
        });
        await rawFs.writeFile(filePath, content, { encoding: "utf8" });
      },
      readdir: (filePath: string) =>
        rawFs.readdir(filePath) as Promise<string[]>,
      stat: async (filePath: string) => {
        const stat = await rawFs.stat(filePath);
        return {
          isFile: () => stat.isFile(),
          isDirectory: () => stat.isDirectory(),
          mtimeMs: Number(stat.mtimeMs)
        };
      },
      mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
        await rawFs.mkdir(filePath, options);
      },
      rmdir: async (filePath: string) => {
        await rawFs.rmdir(filePath);
      },
      rename: async (oldPath: string, newPath: string) => {
        await rawFs.mkdir(path.dirname(newPath), {
          recursive: true
        });
        await rawFs.rename(oldPath, newPath);
      }
    }
  };
}

describe("@poe-code/ralph public exports", () => {
  it("exports Ralph SDK types", () => {
    const input: AgentRunInput = {
      agent: "codex",
      prompt: "Loop on this doc",
      cwd: "/repo"
    };
    const result: AgentRunResult = {
      stdout: "",
      stderr: "",
      exitCode: 0
    };
    const options: RalphRunOptions = {
      agent: ["codex", "claude-code"],
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      maxIterations: 3
    };
    const runResult = null as unknown as RalphRunResult;

    expect(input.agent).toBe("codex");
    expect(result.exitCode).toBe(0);
    expect(options.agent).toEqual(["codex", "claude-code"]);

    void runResult;
  });
});

describe("discoverDocs", () => {
  it("finds local and global markdown docs and sorts them by file name", async () => {
    const fs = createFs({
      "/repo/.poe-code/ralph/plans/zeta.md": "# zeta",
      "/repo/.poe-code/ralph/plans/notes.txt": "ignore",
      "/repo/.poe-code/ralph/plans/alpha.md": "# alpha",
      "/home/test/.poe-code/ralph/plans/beta.md": "# beta"
    });

    await expect(
      discoverDocs({
        cwd: "/repo",
        homeDir: "/home/test",
        fs
      })
    ).resolves.toEqual([
      {
        path: ".poe-code/ralph/plans/alpha.md",
        displayPath: ".poe-code/ralph/plans/alpha.md"
      },
      {
        path: "~/.poe-code/ralph/plans/beta.md",
        displayPath: "~/.poe-code/ralph/plans/beta.md"
      },
      {
        path: ".poe-code/ralph/plans/zeta.md",
        displayPath: ".poe-code/ralph/plans/zeta.md"
      }
    ]);
  });

  it("ignores missing plans directories", async () => {
    const fs = createFs({});

    await expect(
      discoverDocs({
        cwd: "/repo",
        homeDir: "/home/test",
        fs
      })
    ).resolves.toEqual([]);
  });

  it("prefers the local doc when local and global docs share the same file name", async () => {
    const fs = createFs({
      "/repo/.poe-code/ralph/plans/shared.md": "# local",
      "/home/test/.poe-code/ralph/plans/shared.md": "# global"
    });

    await expect(
      discoverDocs({
        cwd: "/repo",
        homeDir: "/home/test",
        fs
      })
    ).resolves.toEqual([
      {
        path: ".poe-code/ralph/plans/shared.md",
        displayPath: ".poe-code/ralph/plans/shared.md"
      }
    ]);
  });

  it("scans only the custom planDirectory when provided", async () => {
    const fs = createFs({
      "/repo/custom-plans/alpha.md": "# alpha",
      "/repo/.poe-code/ralph/plans/default.md": "# default"
    });

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "custom-plans",
      fs
    });

    expect(result).toEqual([
      { path: "custom-plans/alpha.md", displayPath: "custom-plans/alpha.md" }
    ]);
  });

  it("resolves absolute planDirectory paths", async () => {
    const fs = createFs({
      "/abs/plans/doc.md": "# doc"
    });

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "/abs/plans",
      fs
    });

    expect(result).toEqual([
      { path: "/abs/plans/doc.md", displayPath: "/abs/plans/doc.md" }
    ]);
  });

  it("resolves tilde planDirectory paths", async () => {
    const fs = createFs({
      "/home/test/my-plans/doc.md": "# doc"
    });

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "~/my-plans",
      fs
    });

    expect(result).toEqual([
      { path: "~/my-plans/doc.md", displayPath: "~/my-plans/doc.md" }
    ]);
  });

  it("returns empty when custom planDirectory does not exist", async () => {
    const fs = createFs({});

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "nonexistent",
      fs
    });

    expect(result).toEqual([]);
  });
});

describe("parseFrontmatter", () => {
  it("returns defaults when no frontmatter exists", () => {
    const result = parseFrontmatter("# My Plan\n\nSome content");

    expect(result).toEqual({
      data: {
        status: {
          state: "open",
          iteration: 0
        }
      },
      body: "# My Plan\n\nSome content"
    });
  });

  it("parses nested frontmatter with a single agent and iterations", () => {
    const doc = [
      "---",
      "agent: claude-code",
      "iterations: 5",
      "status:",
      "  state: in_progress",
      "  iteration: 3",
      "---",
      "# My Plan",
      "",
      "Content"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result).toEqual({
      data: {
        agent: "claude-code",
        iterations: 5,
        status: {
          state: "in_progress",
          iteration: 3
        }
      },
      body: "# My Plan\n\nContent"
    });
  });

  it("parses an agent array", () => {
    const doc = [
      "---",
      "agent:",
      "  - claude-code",
      "  - codex",
      "status:",
      "  state: open",
      "  iteration: 0",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data).toEqual({
      agent: ["claude-code", "codex"],
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("migrates legacy flat frontmatter to the nested status shape", () => {
    const doc = [
      "---",
      "status: pending",
      "iteration: 2",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result).toEqual({
      data: {
        status: {
          state: "open",
          iteration: 2
        }
      },
      body: "Body"
    });
  });

  it("maps legacy cancelled state back to open", () => {
    const doc = [
      "---",
      "status: cancelled",
      "iteration: 7",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data.status).toEqual({
      state: "open",
      iteration: 7
    });
  });

  it("ignores invalid agent and iterations values", () => {
    const doc = [
      "---",
      "agent:",
      "  - claude-code",
      "  - 3",
      "iterations: 0",
      "status:",
      "  state: nope",
      "  iteration: -1",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result).toEqual({
      data: {
        status: {
          state: "open",
          iteration: 0
        }
      },
      body: "Body"
    });
  });

  it("preserves an empty agent array for later validation", () => {
    const doc = ["---", "agent: []", "---", "Body"].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data).toEqual({
      agent: [],
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("parses extends for config resolution", () => {
    const doc = ["---", "extends: true", "---", "Body"].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data).toEqual({
      extends: true,
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("handles empty document", () => {
    const result = parseFrontmatter("");

    expect(result).toEqual({
      data: {
        status: {
          state: "open",
          iteration: 0
        }
      },
      body: ""
    });
  });
});

describe("writeFrontmatter", () => {
  it("writes nested status with agent and iterations", () => {
    const result = writeFrontmatter(
      {
        agent: "claude-code",
        iterations: 3,
        status: {
          state: "in_progress",
          iteration: 1
        }
      },
      "# My Plan\n\nContent"
    );

    expect(result).toBe(
      [
        "---",
        "agent: claude-code",
        "iterations: 3",
        "status:",
        "  state: in_progress",
        "  iteration: 1",
        "---",
        "# My Plan",
        "",
        "Content"
      ].join("\n")
    );
  });

  it("roundtrips agent arrays through parse and write", () => {
    const frontmatter: RalphFrontmatter = {
      agent: ["claude-code", "codex"],
      iterations: 5,
      status: {
        state: "completed",
        iteration: 5
      }
    };
    const body = "# Test\n\nContent here";
    const written = writeFrontmatter(frontmatter, body);
    const parsed = parseFrontmatter(written);

    expect(parsed.data).toEqual(frontmatter);
    expect(parsed.body).toBe(body);
  });

  it("always writes the new nested format after reading a legacy document", () => {
    const original = [
      "---",
      "status: pending",
      "iteration: 0",
      "---",
      "# Plan",
      "",
      "Body"
    ].join("\n");

    const { data, body } = parseFrontmatter(original);
    const result = writeFrontmatter(data, body);

    expect(result).toBe(
      [
        "---",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Plan",
        "",
        "Body"
      ].join("\n")
    );
  });
});

describe("createRalphSimulation", () => {
  it("runs the requested number of iterations with the doc prompt", async () => {
    const sim = createRalphSimulation({
      docContent: "Ship the change",
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { result, prompts, runs } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "max_iterations",
      docPath: ".poe-code/ralph/plans/plan.md",
      iterationsCompleted: 2
    });
    expect(prompts).toEqual(["Ship the change", "Ship the change"]);
    expect(runs).toEqual([
      {
        agent: "codex",
        prompt: "Ship the change",
        cwd: "/repo"
      },
      {
        agent: "codex",
        prompt: "Ship the change",
        cwd: "/repo"
      }
    ]);
  });

  it("cycles agents round-robin across iterations", async () => {
    const sim = createRalphSimulation({
      agent: ["claude-code", "codex"],
      docContent: "Keep rotating",
      maxIterations: 5,
      turns: [
        successTurn(),
        successTurn(),
        successTurn(),
        successTurn(),
        successTurn()
      ]
    });

    const { runs } = await sim.run();

    expect(runs.map((run) => run.agent)).toEqual([
      "claude-code",
      "codex",
      "claude-code",
      "codex",
      "claude-code"
    ]);
  });

  it("uses each agent once when iterations matches the agent list length", async () => {
    const sim = createRalphSimulation({
      agent: ["claude-code", "codex", "kimi"],
      docContent: "Keep rotating",
      maxIterations: 3,
      turns: [successTurn(), successTurn(), successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs.map((run) => run.agent)).toEqual([
      "claude-code",
      "codex",
      "kimi"
    ]);
  });

  it("rejects an empty agent array", async () => {
    const sim = createRalphSimulation({
      agent: [],
      docContent: "No agent",
      maxIterations: 1,
      turns: [successTurn()]
    });

    await expect(sim.run()).rejects.toThrow(
      "agent must contain at least one entry"
    );
  });

  it("uses the prompt from initial read even if body changes mid-run", async () => {
    const sim = createRalphSimulation({
      docContent: "Version one",
      maxIterations: 2,
      turns: [
        successTurn(undefined, {
          "src/index.ts": "changed"
        }),
        successTurn()
      ]
    });

    const { prompts } = await sim.run();

    expect(prompts).toEqual(["Version one", "Version one"]);
  });

  it("preserves external body changes when updating frontmatter", async () => {
    const sim = createRalphSimulation({
      docContent: "Original body",
      maxIterations: 2,
      turns: [
        {
          assertPrompt: async (_prompt, ctx) => {
            const current = await ctx.readFile(
              ".poe-code/ralph/plans/plan.md"
            );
            const { data } = parseFrontmatter(current);
            const updated = writeFrontmatter(data, "Body changed by another agent");
            await ctx.writeFile(".poe-code/ralph/plans/plan.md", updated);
          },
          output: { stdout: "", exitCode: 0 }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const content = await ctx.readFile(
              ".poe-code/ralph/plans/plan.md"
            );
            const { body } = parseFrontmatter(content);
            expect(body).toBe("Body changed by another agent");
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    await sim.run();
  });

  it("preserves externally added frontmatter fields when updating status", async () => {
    const sim = createRalphSimulation({
      docContent: [
        "---",
        "agent: codex",
        "iterations: 3",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Plan"
      ].join("\n"),
      maxIterations: 2,
      turns: [
        {
          assertPrompt: async (_prompt, ctx) => {
            const current = await ctx.readFile(
              ".poe-code/ralph/plans/plan.md"
            );
            const { data, body } = parseFrontmatter(current);
            const updated = writeFrontmatter(
              { ...data, iterations: 10 },
              body
            );
            await ctx.writeFile(".poe-code/ralph/plans/plan.md", updated);
          },
          output: { stdout: "", exitCode: 0 }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const content = await ctx.readFile(
              ".poe-code/ralph/plans/plan.md"
            );
            const { data } = parseFrontmatter(content);
            expect(data.iterations).toBe(10);
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    await sim.run();
  });

  it("writes nested frontmatter with in_progress status on start", async () => {
    let capturedContent = "";
    const sim = createRalphSimulation({
      docContent: "# Plan",
      maxIterations: 1,
      turns: [
        {
          assertPrompt: async (_prompt, ctx) => {
            capturedContent = await ctx.readFile(
              ".poe-code/ralph/plans/plan.md"
            );
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    await sim.run();

    const { data } = parseFrontmatter(capturedContent);
    expect(data.status).toEqual({
      state: "in_progress",
      iteration: 0
    });
  });

  it("updates nested frontmatter iteration count after each iteration", async () => {
    let iterationAfterFirst = -1;
    const sim = createRalphSimulation({
      docContent: "# Plan",
      maxIterations: 2,
      turns: [
        successTurn(),
        {
          assertPrompt: async (_prompt, ctx) => {
            const content = await ctx.readFile(
              ".poe-code/ralph/plans/plan.md"
            );
            const { data } = parseFrontmatter(content);
            iterationAfterFirst = data.status.iteration;
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    await sim.run();

    expect(iterationAfterFirst).toBe(1);
  });

  it("preserves agent and iterations config while the run updates status", async () => {
    const sim = createRalphSimulation({
      docContent: [
        "---",
        "agent:",
        "  - claude-code",
        "  - codex",
        "iterations: 5",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Plan"
      ].join("\n"),
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { readFile } = await sim.run();

    const archived = await readFile(".poe-code/ralph/plans/archive/plan.md");
    const { data } = parseFrontmatter(archived);
    expect(data).toEqual({
      agent: ["claude-code", "codex"],
      iterations: 5,
      status: {
        state: "completed",
        iteration: 2
      }
    });
  });

  it("archives plan on max_iterations completion", async () => {
    const sim = createRalphSimulation({
      docContent: "# Archive me",
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { readFile } = await sim.run();

    const archived = await readFile(
      ".poe-code/ralph/plans/archive/plan.md"
    );
    const { data, body } = parseFrontmatter(archived);
    expect(data.status).toEqual({
      state: "completed",
      iteration: 2
    });
    expect(body).toBe("# Archive me");
  });

  it("writes open status on abort signal", async () => {
    const controller = new AbortController();
    const sim = createRalphSimulation({
      docContent: "# Cancel me",
      maxIterations: 3,
      signal: controller.signal,
      turns: [
        {
          assertPrompt: () => {
            controller.abort();
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    const { result, readFile } = await sim.run();

    expect(result.stopReason).toBe("cancelled");
    const content = await readFile(".poe-code/ralph/plans/plan.md");
    const { data } = parseFrontmatter(content);
    expect(data.status).toEqual({
      state: "open",
      iteration: 1
    });
  });

  it("strips nested frontmatter from the prompt sent to the agent", async () => {
    const sim = createRalphSimulation({
      docContent: [
        "---",
        "agent: codex",
        "iterations: 2",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Real content"
      ].join("\n"),
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { prompts } = await sim.run();

    expect(prompts).toEqual(["# Real content"]);
  });

  it("still strips legacy frontmatter from the prompt sent to the agent", async () => {
    const sim = createRalphSimulation({
      docContent: "---\nstatus: pending\niteration: 0\n---\n# Legacy content",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { prompts } = await sim.run();

    expect(prompts).toEqual(["# Legacy content"]);
  });

  it("uses inline model from agent specifier notation", async () => {
    const sim = createRalphSimulation({
      agent: "claude-code:anthropic/claude-opus-4.6",
      docContent: "# Plan",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs[0]).toMatchObject({
      agent: "claude-code",
      model: "anthropic/claude-opus-4.6"
    });
  });

  it("per-agent inline models work with agent arrays", async () => {
    const sim = createRalphSimulation({
      agent: ["claude-code:anthropic/claude-opus-4.6", "codex:openai/gpt-5.4"],
      docContent: "# Plan",
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs[0]).toMatchObject({
      agent: "claude-code",
      model: "anthropic/claude-opus-4.6"
    });
    expect(runs[1]).toMatchObject({
      agent: "codex",
      model: "openai/gpt-5.4"
    });
  });

  it("interpolates {{ current_file }} in the prompt with the doc path", async () => {
    const sim = createRalphSimulation({
      docContent: "Fix issues in {{ current_file }}",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { prompts } = await sim.run();

    expect(prompts[0]).toBe(
      "Fix issues in /repo/.poe-code/ralph/plans/plan.md"
    );
  });

  it("preserves {{ current_file }} template in the file after run", async () => {
    const sim = createRalphSimulation({
      docContent: "Fix {{ current_file }}",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { readFile } = await sim.run();

    const archived = await readFile(
      ".poe-code/ralph/plans/archive/plan.md"
    );
    const { body } = parseFrontmatter(archived);
    expect(body).toBe("Fix {{ current_file }}");
  });

  it("holds an agent-kit workflow lock while the iteration is running", async () => {
    const { fs, rawFs } = createRunFs({
      "/repo/.poe-code/ralph/plans/plan.md": "# Plan"
    });
    const runAgent = vi.fn(async () => {
      const stat = await rawFs.stat("/repo/.poe-code/ralph/plans/plan.md.lock");
      expect(stat.isDirectory()).toBe(true);
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    });

    await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      maxIterations: 1,
      fs,
      runAgent
    });

    await expect(
      rawFs.stat("/repo/.poe-code/ralph/plans/plan.md.lock")
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("stops on first failed iteration", async () => {
    const sim = createRalphSimulation({
      docContent: "Keep trying",
      maxIterations: 3,
      turns: [failTurn("first")]
    });

    const { result, runs } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "failed",
      iterationsCompleted: 1
    });
    expect(runs).toHaveLength(1);
  });
});

describe("runRalph config resolution", () => {
  it("inherits base prompt and config when the doc sets extends true", async () => {
    const { fs } = createRunFs({
      "/repo/.poe-code/ralph/plans/plan.md": [
        "---",
        "extends: true",
        "---",
        ""
      ].join("\n"),
      "/repo/.poe-code/ralph/bases/plan.md": [
        "---",
        "agent: codex",
        "iterations: 2",
        "---",
        "# Base prompt"
      ].join("\n")
    });
    const runAgent = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      fs,
      runAgent
    });

    expect(result).toMatchObject({
      stopReason: "max_iterations",
      iterationsCompleted: 2
    });
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      agent: "codex",
      prompt: "# Base prompt"
    });
  });

  it("lets CLI iterations override the document iterations", async () => {
    const { fs } = createRunFs({
      "/repo/.poe-code/ralph/plans/plan.md": [
        "---",
        "extends: true",
        "iterations: 5",
        "---",
        ""
      ].join("\n"),
      "/repo/.poe-code/ralph/bases/plan.md": [
        "---",
        "agent: codex",
        "iterations: 4",
        "---",
        "# Base prompt"
      ].join("\n")
    });
    const runAgent = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      maxIterations: 2,
      fs,
      runAgent
    });

    expect(result.iterationsCompleted).toBe(2);
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(runAgent.mock.calls[0]?.[0].prompt).toBe("# Base prompt");
  });

  it("fills defaults when the doc and bases do not specify config", async () => {
    const { fs } = createRunFs({
      "/repo/.poe-code/ralph/plans/plan.md": "# Document prompt"
    });
    const runAgent = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      fs,
      runAgent
    });

    expect(result.iterationsCompleted).toBe(3);
    expect(runAgent).toHaveBeenCalledTimes(3);
    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      agent: "claude-code",
      prompt: "# Document prompt"
    });
  });

  it("stays backward compatible when extends is not set", async () => {
    const { fs } = createRunFs({
      "/repo/.poe-code/ralph/plans/plan.md": "# Document prompt",
      "/repo/.poe-code/ralph/bases/plan.md": [
        "---",
        "agent: codex",
        "iterations: 9",
        "---",
        "# Base prompt"
      ].join("\n")
    });
    const runAgent = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      fs,
      runAgent
    });

    expect(result.iterationsCompleted).toBe(3);
    expect(runAgent).toHaveBeenCalledTimes(3);
    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      agent: "claude-code",
      prompt: "# Document prompt"
    });
  });
});

describe("interpolateVariables", () => {
  it("replaces {{ current_file }} with the doc path", () => {
    const result = interpolateVariables("Edit {{ current_file }} please", {
      current_file: "/repo/plans/plan.md"
    });

    expect(result).toBe("Edit /repo/plans/plan.md please");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = interpolateVariables(
      "Open {{ current_file }} and review {{ current_file }}",
      { current_file: "/repo/plan.md" }
    );

    expect(result).toBe("Open /repo/plan.md and review /repo/plan.md");
  });

  it("handles multiple different variables", () => {
    const result = interpolateVariables(
      "File: {{ current_file }}, Dir: {{ cwd }}",
      { current_file: "/repo/plan.md", cwd: "/repo" }
    );

    expect(result).toBe("File: /repo/plan.md, Dir: /repo");
  });

  it("leaves unknown variables untouched", () => {
    const result = interpolateVariables("Hello {{ unknown_var }}", {
      current_file: "/repo/plan.md"
    });

    expect(result).toBe("Hello {{ unknown_var }}");
  });

  it("handles no variables in the template", () => {
    const result = interpolateVariables("No variables here", {
      current_file: "/repo/plan.md"
    });

    expect(result).toBe("No variables here");
  });

  it("handles empty template", () => {
    const result = interpolateVariables("", {
      current_file: "/repo/plan.md"
    });

    expect(result).toBe("");
  });

  it("handles whitespace variations in braces", () => {
    const result = interpolateVariables(
      "A {{current_file}} B {{ current_file }} C {{  current_file  }}",
      { current_file: "/repo/plan.md" }
    );

    expect(result).toBe("A /repo/plan.md B /repo/plan.md C /repo/plan.md");
  });
});
