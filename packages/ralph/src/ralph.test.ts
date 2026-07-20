import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveRunLogDir } from "@poe-code/agent-harness-tools";
import { discoverDocs } from "./discovery/discovery.js";
import {
  parseFrontmatter,
  ralphDocumentSchema,
  ralphDocumentSchemaId,
  writeFrontmatter
} from "./frontmatter/frontmatter.js";
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
    readFile: (filePath: string, encoding: BufferEncoding) =>
      rawFs.readFile(filePath, encoding) as Promise<string>,
    readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
    lstat: async (filePath: string) => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

function discoveryDoc(name: string): string {
  return ["---", "kind: ralph", `name: ${name}`, "---", `# ${name}`].join("\n");
}

function createRunFs(files: Record<string, string>) {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    rawFs,
    fs: {
      readFile: (filePath: string, encoding: BufferEncoding) =>
        rawFs.readFile(filePath, encoding) as Promise<string>,
      writeFile: async (filePath: string, content: string, options?: { flag?: string; mode?: number }) => {
        await rawFs.mkdir(path.dirname(filePath), {
          recursive: true
        });
        await rawFs.writeFile(filePath, content, { encoding: "utf8", ...options });
      },
      readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
      open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
      lstat: async (filePath: string) => {
        const stat = await rawFs.lstat(filePath);
        return { isSymbolicLink: () => stat.isSymbolicLink() };
      },
      stat: async (filePath: string) => {
        const stat = await rawFs.stat(filePath);
        return {
          isFile: () => stat.isFile(),
          isDirectory: () => stat.isDirectory(),
          mtimeMs: Number(stat.mtimeMs)
        };
      },
      unlink: async (filePath: string) => {
        await rawFs.unlink(filePath);
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
    } as RalphRunOptions["fs"]
  };
}

describe("@poe-code/ralph public exports", () => {
  it("re-exports the Ralph document schema from the package entrypoint", async () => {
    const pkg = await import("./index.js");
    const frontmatter = await import("./frontmatter/frontmatter.js");

    expect(pkg.ralphDocumentSchema).toBe(frontmatter.ralphDocumentSchema);
    expect(pkg.ralphDocumentSchemaId).toBe(frontmatter.ralphDocumentSchemaId);
  });

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
    expect(ralphDocumentSchemaId).toBe(
      "https://poe-platform.github.io/poe-code/schemas/plans/ralph.schema.json"
    );
    expect(ralphDocumentSchema).toMatchObject({
      $id: ralphDocumentSchemaId,
      type: "object",
      properties: {
        kind: { const: "ralph" },
        version: { type: "integer" },
        skills: { type: "array" },
        status: { type: "object" }
      },
      required: ["kind", "version", "status"]
    });

    void runResult;
  });
});

describe("discoverDocs", () => {
  it("finds local markdown docs from the default plan directory", async () => {
    const fs = createFs({
      "/repo/.poe-code/ralph/plans/zeta.md": discoveryDoc("zeta"),
      "/repo/.poe-code/ralph/plans/notes.txt": "ignore",
      "/repo/.poe-code/ralph/plans/alpha.md": discoveryDoc("alpha"),
      "/home/test/.poe-code/ralph/plans/beta.md": discoveryDoc("beta")
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

  it("uses the local default plan directory when local and global docs share a file name", async () => {
    const fs = createFs({
      "/repo/.poe-code/ralph/plans/shared.md": discoveryDoc("local"),
      "/home/test/.poe-code/ralph/plans/shared.md": discoveryDoc("global")
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
      "/repo/custom-plans/alpha.md": discoveryDoc("alpha"),
      "/repo/.poe-code/ralph/plans/default.md": discoveryDoc("default")
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
      "/abs/plans/doc.md": discoveryDoc("doc")
    });

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "/abs/plans",
      fs
    });

    expect(result).toEqual([{ path: "/abs/plans/doc.md", displayPath: "/abs/plans/doc.md" }]);
  });

  it("resolves tilde planDirectory paths", async () => {
    const fs = createFs({
      "/home/test/my-plans/doc.md": discoveryDoc("doc")
    });

    const result = await discoverDocs({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "~/my-plans",
      fs
    });

    expect(result).toEqual([{ path: "~/my-plans/doc.md", displayPath: "~/my-plans/doc.md" }]);
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

  it("parses skill references", () => {
    const doc = [
      "---",
      "skills: [foo, claude/bar]",
      "status:",
      "  state: open",
      "  iteration: 0",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data).toEqual({
      skills: ["foo", "claude/bar"],
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("leaves plans without skills unchanged", () => {
    const doc = ["---", "agent: codex", "---", "Body"].join("\n");

    const result = parseFrontmatter(doc);

    expect(Object.hasOwn(result.data, "skills")).toBe(false);
    expect(result.data).toEqual({
      agent: "codex",
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("parses hooks from Ralph plan frontmatter", () => {
    const doc = ["---", "hooks:", "  from: claude", "---", "Body"].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data).toMatchObject({
      hooks: { from: "claude" }
    });
  });

  it("parses optional hook bridge configuration", () => {
    const doc = [
      "---",
      "hooks:",
      "  from: claude",
      "  strategy: transform",
      "  scope: merged",
      "---",
      "Body"
    ].join("\n");

    expect(parseFrontmatter(doc).data.hooks).toEqual({
      from: "claude",
      strategy: "transform",
      scope: "merged"
    });
  });

  it("does not accept inherited hook fields", async () => {
    await withObjectPrototypeProperties({ from: "polluted" }, () => {
      const doc = ["---", "hooks: {}", "---", "Body"].join("\n");

      expect(() => parseFrontmatter(doc)).toThrow('"hooks.from" must be a non-empty string');
    });
  });

  it.each([
    {
      name: "missing from",
      yaml: ["hooks:", "  scope: project"],
      message: '"hooks.from" must be a non-empty string'
    },
    {
      name: "invalid strategy",
      yaml: ["hooks:", "  from: claude", "  strategy: copy"],
      message: '"hooks.strategy" must be "auto", "symlink", or "transform"'
    },
    {
      name: "invalid scope",
      yaml: ["hooks:", "  from: claude", "  scope: team"],
      message: '"hooks.scope" must be "project", "user", or "merged"'
    }
  ])("rejects hooks with $name", ({ yaml, message }) => {
    const doc = ["---", ...yaml, "---", "Body"].join("\n");

    expect(() => parseFrontmatter(doc)).toThrow(message);
  });

  it.each([
    ["unknown hook strategy key", ["hooks:", "  from: claude", "  stratgey: transform"], "stratgey"],
    ["unknown hook scope key", ["hooks:", "  from: claude", "  scoep: user"], "scoep"]
  ])("rejects $0", (_name, yaml, key) => {
    const doc = ["---", ...yaml, "---", "Body"].join("\n");

    expect(() => parseFrontmatter(doc)).toThrow(String(key));
  });

  it("allows arbitrary top-level metadata keys", () => {
    const doc = [
      "---",
      "agent: codex",
      "saved_for_later:",
      "  reason: Wait for queue capacity",
      "custom_owner: platform",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data.agent).toBe("codex");
  });

  it("rejects a document declaring a different workflow kind", () => {
    const doc = ["---", "kind: experiment", "---", "Body"].join("\n");

    expect(() => parseFrontmatter(doc)).toThrow(/kind.*ralph/i);
  });

  it("leaves plans without hooks unchanged", () => {
    const doc = ["---", "agent: codex", "---", "Body"].join("\n");

    const result = parseFrontmatter(doc);

    expect(Object.hasOwn(result.data, "hooks")).toBe(false);
  });

  it("rejects malformed skill references", () => {
    expect(() =>
      parseFrontmatter(
        [
          "---",
          "skills: [foo/bar/baz]",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "Body"
        ].join("\n")
      )
    ).toThrow(/must contain skill references/i);

    expect(() =>
      parseFrontmatter(
        ["---", "skills: foo", "status:", "  state: open", "  iteration: 0", "---", "Body"].join(
          "\n"
        )
      )
    ).toThrow(/must be an array of strings/i);
  });

  it("migrates legacy flat frontmatter to the nested status shape", () => {
    const doc = ["---", "status: pending", "iteration: 2", "---", "Body"].join("\n");

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
    const doc = ["---", "status: cancelled", "iteration: 7", "---", "Body"].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data.status).toEqual({
      state: "open",
      iteration: 7
    });
  });

  it.each([
    {
      name: "empty agent array",
      lines: ["agent: []"],
      message: '"agent" must be a non-empty string or non-empty string array'
    },
    {
      name: "agent array with a blank entry",
      lines: ["agent:", "  - claude-code", "  - \"\""],
      message: '"agent" must be a non-empty string or non-empty string array'
    },
    {
      name: "agent array with a non-string entry",
      lines: ["agent:", "  - claude-code", "  - 3"],
      message: '"agent" must be a non-empty string or non-empty string array'
    },
    {
      name: "scalar agent with a blank value",
      lines: ['agent: "  "'],
      message: '"agent" must be a non-empty string or non-empty string array'
    },
    {
      name: "zero iterations",
      lines: ["iterations: 0"],
      message: '"iterations" must be a positive integer'
    },
    {
      name: "fractional iterations",
      lines: ["iterations: 1.5"],
      message: '"iterations" must be a positive integer'
    },
    {
      name: "negative iterations",
      lines: ["iterations: -1"],
      message: '"iterations" must be a positive integer'
    }
  ])("rejects invalid $name", ({ lines, message }) => {
    const doc = ["---", ...lines, "---", "Body"].join("\n");

    expect(() => parseFrontmatter(doc)).toThrow(message);
  });

  it.each([
    {
      name: "nested status state",
      lines: ["status:", "  state: nope", "  iteration: 0"],
      message: '"status.state" must be "open", "in_progress", "completed", or "failed"'
    },
    {
      name: "nested status iteration",
      lines: ["status:", "  state: open", "  iteration: -1"],
      message: '"status.iteration" must be a non-negative integer'
    },
    {
      name: "legacy status",
      lines: ["status: done", "iteration: 0"],
      message: '"status" must be "open", "pending", "cancelled", "overbake_abort", "in_progress", or "completed"'
    },
    {
      name: "legacy iteration",
      lines: ["status: pending", "iteration: -2"],
      message: '"iteration" must be a non-negative integer'
    }
  ])("rejects invalid $name", ({ lines, message }) => {
    const doc = ["---", ...lines, "---", "Body"].join("\n");

    expect(() => parseFrontmatter(doc)).toThrow(message);
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

  it("ignores inherited frontmatter fields", async () => {
    await withObjectPrototypeProperties(
      {
        agent: "polluted-agent",
        extends: true,
        iterations: 9,
        status: { state: "in_progress", iteration: 4 }
      },
      () => {
        const result = parseFrontmatter(["---", "{}", "---", "Body"].join("\n"));

        expect(result.data).toEqual({
          status: {
            state: "open",
            iteration: 0
          }
        });
      }
    );
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
        `$schema: ${ralphDocumentSchemaId}`,
        "kind: ralph",
        "version: 1",
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
      skills: ["foo", "claude/bar"],
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
    const original = ["---", "status: pending", "iteration: 0", "---", "# Plan", "", "Body"].join(
      "\n"
    );

    const { data, body } = parseFrontmatter(original);
    const result = writeFrontmatter(data, body);

    expect(result).toBe(
      [
        "---",
        `$schema: ${ralphDocumentSchemaId}`,
        "kind: ralph",
        "version: 1",
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
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run).toMatchObject({
        agent: "codex",
        prompt: "Ship the change",
        cwd: "/repo",
        logDir: resolveRunLogDir({
          planPath: "/repo/.poe-code/ralph/plans/plan.md",
          runner: "ralph",
          homeDir: "/home/test"
        })
      });
      expect(run.logFileName).toMatch(/^\d{8}-\d{6}-\d{3}-codex\.jsonl$/);
      expect(Object.hasOwn(run, "mode")).toBe(false);
    }
  });

  it("cycles agents round-robin across iterations", async () => {
    const sim = createRalphSimulation({
      agent: ["claude-code", "codex"],
      docContent: "Keep rotating",
      maxIterations: 5,
      turns: [successTurn(), successTurn(), successTurn(), successTurn(), successTurn()]
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

    expect(runs.map((run) => run.agent)).toEqual(["claude-code", "codex", "kimi"]);
  });

  it("passes skills to the agent runner", async () => {
    const sim = createRalphSimulation({
      docContent: ["---", "skills: [foo, claude/bar]", "---", "Use focused skills"].join("\n"),
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs.map((run) => run.skills)).toEqual([
      ["foo", "claude/bar"],
      ["foo", "claude/bar"]
    ]);
  });

  it("omits skills from agent runner input when the plan has no skills field", async () => {
    const sim = createRalphSimulation({
      docContent: "No skills",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { runs } = await sim.run();

    expect(Object.hasOwn(runs[0]!, "skills")).toBe(false);
  });

  it("passes hooks to the agent runner", async () => {
    const sim = createRalphSimulation({
      docContent: ["---", "hooks:", "  from: claude", "---", "Use hooks"].join("\n"),
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs[0]).toMatchObject({ hooks: { from: "claude" } });
  });

  it("omits hooks from agent runner input when the plan has no hooks field", async () => {
    const sim = createRalphSimulation({
      docContent: "No hooks",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { runs } = await sim.run();

    expect(Object.hasOwn(runs[0]!, "hooks")).toBe(false);
  });

  it("rejects an empty agent array", async () => {
    const sim = createRalphSimulation({
      agent: [],
      docContent: "No agent",
      maxIterations: 1,
      turns: [successTurn()]
    });

    await expect(sim.run()).rejects.toThrow("agent must contain at least one entry");
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
            const current = await ctx.readFile(".poe-code/ralph/plans/plan.md");
            const { data } = parseFrontmatter(current);
            const updated = writeFrontmatter(data, "Body changed by another agent");
            await ctx.writeFile(".poe-code/ralph/plans/plan.md", updated);
          },
          output: { stdout: "", exitCode: 0 }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const content = await ctx.readFile(".poe-code/ralph/plans/plan.md");
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
            const current = await ctx.readFile(".poe-code/ralph/plans/plan.md");
            const { data, body } = parseFrontmatter(current);
            const updated = writeFrontmatter({ ...data, iterations: 10 }, body);
            await ctx.writeFile(".poe-code/ralph/plans/plan.md", updated);
          },
          output: { stdout: "", exitCode: 0 }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const content = await ctx.readFile(".poe-code/ralph/plans/plan.md");
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
            capturedContent = await ctx.readFile(".poe-code/ralph/plans/plan.md");
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
            const content = await ctx.readFile(".poe-code/ralph/plans/plan.md");
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
      docPath: ".poe-code/ralph/plans/02-second.md",
      docContent: "# Archive me",
      maxIterations: 2,
      turns: [successTurn(), successTurn()],
      files: {
        ".poe-code/ralph/plans/01-first.md": discoveryDoc("first"),
        ".poe-code/ralph/plans/03-third.md": discoveryDoc("third")
      }
    });

    const { fs, readFile } = await sim.run();

    expect((await fs.readdir("/repo/.poe-code/ralph/plans")).sort()).toEqual([
      "01-first.md",
      "03-third.md",
      "archive"
    ]);
    expect((await fs.readdir("/repo/.poe-code/ralph/plans/archive")).sort()).toEqual(["second.md"]);

    const archived = await readFile(".poe-code/ralph/plans/archive/second.md");
    const { data, body } = parseFrontmatter(archived);
    expect(data.status).toEqual({
      state: "completed",
      iteration: 2
    });
    expect(body).toBe("# Archive me");
  });

  it("leaves the completed plan active when archive is disabled", async () => {
    const sim = createRalphSimulation({
      docPath: ".poe-code/ralph/plans/plan.md",
      docContent: "# Keep me",
      maxIterations: 1,
      archive: false,
      turns: [successTurn()]
    });

    const { fs, readFile } = await sim.run();

    const completed = await readFile(".poe-code/ralph/plans/plan.md");
    expect(parseFrontmatter(completed).data.status).toEqual({
      state: "completed",
      iteration: 1
    });
    await expect(
      fs.readFile("/repo/.poe-code/ralph/plans/archive/plan.md", "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("archives a relative doc from its own directory", async () => {
    const sim = createRalphSimulation({
      docPath: "plan.md",
      docContent: "# Root plan",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { fs, readFile } = await sim.run();

    expect((await fs.readdir("/repo")).sort()).toEqual(["archive"]);
    const archived = await readFile("archive/plan.md");
    const { data, body } = parseFrontmatter(archived);
    expect(data.status).toEqual({
      state: "completed",
      iteration: 1
    });
    expect(body).toBe("# Root plan");
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
      iteration: 0
    });
  });

  it("reports cancellation when the executor fails after aborting the run signal", async () => {
    const { fs } = createRunFs({
      "/repo/.poe-code/ralph/plans/plan.md": "---\nagent: claude-code\niterations: 2\n---\nWork"
    });
    const controller = new AbortController();

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      fs,
      signal: controller.signal,
      runAgent: async () => {
        controller.abort();
        throw new Error("transport closed after cancel");
      }
    });

    expect(result.stopReason).toBe("cancelled");
  });

  it("reports the agent loaded for each live iteration", async () => {
    const docPath = "/repo/.poe-code/ralph/plans/work.md";
    const documentFor = (agent: string) => `---\nagent: ${agent}\niterations: 2\n---\nWork`;
    const { fs } = createRunFs({ [docPath]: documentFor("claude-code") });
    const announced: string[] = [];
    const executed: string[] = [];

    await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath,
      fs,
      onIterationStart: (_iteration, _maxIterations, agent) => announced.push(agent),
      runAgent: async (input) => {
        executed.push(input.agent);
        if (executed.length === 1) {
          await fs!.writeFile(docPath, documentFor("codex"));
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    expect(executed).toEqual(["claude-code", "codex"]);
    expect(announced).toEqual(executed);
  });

  it("interpolates the live iteration limit in reloaded prompts", async () => {
    const docPath = "/repo/.poe-code/ralph/plans/work.md";
    const documentFor = (iterations: number) => `---\nagent: claude-code\niterations: ${iterations}\n---\nLimit={{ max_iterations }}`;
    const { fs } = createRunFs({ [docPath]: documentFor(2) });
    const prompts: string[] = [];

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath,
      fs,
      runAgent: async (input) => {
        prompts.push(input.prompt);
        if (prompts.length === 1) {
          await fs!.writeFile(docPath, documentFor(3));
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    expect(prompts).toEqual(["Limit=2", "Limit=3", "Limit=3"]);
    expect(result).toMatchObject({
      stopReason: "max_iterations",
      iterationsCompleted: 3
    });
    const archived = await fs.readFile("/repo/.poe-code/ralph/plans/archive/work.md", "utf8");
    expect(parseFrontmatter(archived).data.status).toEqual({
      state: "completed",
      iteration: 3
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

  it("rejects a model-only agent specifier", async () => {
    const sim = createRalphSimulation({
      agent: ":openai/gpt-5.4",
      docContent: "# Plan",
      maxIterations: 1,
      turns: [successTurn()]
    });

    await expect(sim.run()).rejects.toThrow(/agent.*non-empty/i);
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

    expect(prompts[0]).toBe("Fix issues in /repo/.poe-code/ralph/plans/plan.md");
  });

  it("interpolates iteration variables for each prompt sent to the agent", async () => {
    const sim = createRalphSimulation({
      docContent: "Append {{ current_iteration }} of {{ max_iterations }}",
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { prompts } = await sim.run();

    expect(prompts).toEqual(["Append 1 of 2", "Append 2 of 2"]);
  });

  it("preserves {{ current_file }} template in the file after run", async () => {
    const sim = createRalphSimulation({
      docContent: "Fix {{ current_file }}",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { readFile } = await sim.run();

    const archived = await readFile(".poe-code/ralph/plans/archive/plan.md");
    const { body } = parseFrontmatter(archived);
    expect(body).toBe("Fix {{ current_file }}");
  });

  it("restores open status when the agent throws unexpectedly", async () => {
    const { fs, rawFs } = createRunFs({
      "/repo/.poe-code/ralph/plans/plan.md": "# Plan"
    });
    let callCount = 0;
    const runAgent = vi.fn(async () => {
      callCount += 1;

      if (callCount === 1) {
        return {
          stdout: "",
          stderr: "",
          exitCode: 0
        };
      }

      throw new Error("boom");
    });

    await expect(
      runRalph({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: ".poe-code/ralph/plans/plan.md",
        maxIterations: 3,
        fs,
        runAgent
      })
    ).rejects.toThrow("boom");

    const content = await rawFs.readFile("/repo/.poe-code/ralph/plans/plan.md", "utf8");
    const { data } = parseFrontmatter(content as string);

    expect(data.status).toEqual({
      state: "open",
      iteration: 1
    });
  });

  it("rejects an aborted run through a symlinked document", async () => {
    const { fs, rawFs } = createRunFs({
      "/outside/external-ralph.md": [
        "---",
        "kind: ralph",
        "agent: claude-code",
        "iterations: 1",
        "status:",
        "  state: in_progress",
        "  iteration: 4",
        "---",
        "# External Ralph"
      ].join("\n")
    });
    await rawFs.mkdir("/repo/docs/plans", { recursive: true });
    await rawFs.symlink("/outside/external-ralph.md", "/repo/docs/plans/linked.md");
    const controller = new AbortController();
    controller.abort();

    await expect(runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "docs/plans/linked.md",
      fs,
      runAgent: vi.fn(),
      signal: controller.signal
    })).rejects.toThrow(/symbolic link/i);
    await expect(rawFs.readFile("/outside/external-ralph.md", "utf8"))
      .resolves.toContain("iteration: 4");
  });

  it("rejects status writes through a symlinked legacy temp sibling", async () => {
    const targetPath = "/repo/docs/plans/plan.md";
    const original = "---\nkind: ralph\nagent: codex\niterations: 1\nstatus:\n  state: open\n  iteration: 0\n---\n# Preserve this Ralph plan\n";
    const { fs, rawFs } = createRunFs({
      [targetPath]: original,
      "/outside/target.md": "external"
    });
    await rawFs.symlink("/outside/target.md", `${targetPath}.tmp`);
    const controller = new AbortController();
    controller.abort();

    await expect(runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: targetPath,
      fs,
      runAgent: vi.fn(),
      signal: controller.signal
    })).rejects.toThrow(/symbolic link/i);
    await expect(rawFs.readFile("/outside/target.md", "utf8")).resolves.toBe("external");
    await expect(rawFs.readFile(targetPath, "utf8")).resolves.toBe(original);
  });

  it("rejects temp-sibling lstat failures that only inherit missing-path codes", async () => {
    const targetPath = "/repo/docs/plans/plan.md";
    const original = "---\nkind: ralph\nagent: codex\niterations: 1\nstatus:\n  state: open\n  iteration: 0\n---\n# Preserve this Ralph plan\n";
    const { fs, rawFs } = createRunFs({ [targetPath]: original });
    const baseLstat = fs!.lstat.bind(fs);
    const lstatError = new Error("lstat failed");
    fs!.lstat = async (filePath: string) => {
      if (filePath === `${targetPath}.tmp`) {
        throw lstatError;
      }
      return baseLstat(filePath);
    };
    const controller = new AbortController();
    controller.abort();

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(runRalph({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: targetPath,
        fs,
        runAgent: vi.fn(),
        signal: controller.signal
      })).rejects.toBe(lstatError);
    });
    await expect(rawFs.readFile(targetPath, "utf8")).resolves.toBe(original);
  });

  it("rejects workflow configuration from a symlinked base directory", async () => {
    const { fs, rawFs } = createRunFs({
      "/repo/docs/plans/linked.md": "---\nkind: ralph\nextends: true\n---\n",
      "/outside/linked.md": "---\nkind: ralph\nagent: codex\niterations: 1\n---\n"
    });
    await rawFs.mkdir("/repo/.poe-code/ralph", { recursive: true });
    await rawFs.symlink("/outside", "/repo/.poe-code/ralph/bases");

    await expect(runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "docs/plans/linked.md",
      fs,
      runAgent: vi.fn()
    })).rejects.toThrow(/symbolic link/i);
  });

  it("preserves the document when cancelled status persistence fails", async () => {
    const targetPath = "/repo/docs/plans/plan.md";
    const original = "---\nkind: ralph\nagent: codex\niterations: 1\nstatus:\n  state: open\n  iteration: 0\n---\n# Preserve this Ralph plan\n";
    const { fs, rawFs } = createRunFs({ [targetPath]: original });
    const baseWriteFile = fs!.writeFile.bind(fs);
    fs!.writeFile = async (filePath: string, content: string) => {
      await baseWriteFile(filePath, content.slice(0, 12));
      throw new Error("ralph disk full");
    };
    const controller = new AbortController();
    controller.abort();

    await expect(runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: targetPath,
      fs,
      runAgent: vi.fn(),
      signal: controller.signal
    })).rejects.toThrow("ralph disk full");
    await expect(rawFs.readFile(targetPath, "utf8")).resolves.toBe(original);
  });

  it("cleans failed status temp writes that only inherit existing-path codes", async () => {
    const targetPath = "/repo/docs/plans/plan.md";
    const original = "---\nkind: ralph\nagent: codex\niterations: 1\nstatus:\n  state: open\n  iteration: 0\n---\n# Preserve this Ralph plan\n";
    const { fs, rawFs } = createRunFs({ [targetPath]: original });
    const baseWriteFile = fs!.writeFile.bind(fs);
    fs!.writeFile = async (filePath: string, content: string, options?: { flag?: string; mode?: number }) => {
      if (filePath.startsWith(`${targetPath}.`) && filePath.endsWith(".tmp")) {
        await baseWriteFile(filePath, content.slice(0, 12), options);
        throw new Error("ralph disk full");
      }
      await baseWriteFile(filePath, content, options);
    };
    const controller = new AbortController();
    controller.abort();

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(runRalph({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: targetPath,
        fs,
        runAgent: vi.fn(),
        signal: controller.signal
      })).rejects.toThrow("ralph disk full");
    });

    await expect(rawFs.readFile(targetPath, "utf8")).resolves.toBe(original);
    await expect(rawFs.readdir(path.dirname(targetPath))).resolves.toEqual(["plan.md"]);
  });

  it("uses agent-kit path resolution for home-directory docs", async () => {
    const { fs, rawFs } = createRunFs({
      "/home/test/.poe-code/ralph/plans/plan.md": "# Home plan"
    });
    const runAgent = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "~/.poe-code/ralph/plans/plan.md",
      maxIterations: 1,
      fs,
      runAgent
    });

    expect(result).toMatchObject({
      docPath: "~/.poe-code/ralph/plans/plan.md",
      stopReason: "max_iterations",
      iterationsCompleted: 1
    });
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        prompt: "# Home plan",
        cwd: "/repo"
      })
    );

    const archived = await rawFs.readFile(
      "/home/test/.poe-code/ralph/plans/archive/plan.md",
      "utf8"
    );
    const { data } = parseFrontmatter(archived as string);

    expect(data.status).toEqual({
      state: "completed",
      iteration: 1
    });
  });

  it("passes runtime config cwd through to the agent runner", async () => {
    const { fs } = createRunFs({
      "/repo/docs/plan.md": "# Runtime plan"
    });
    const runAgent = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    await runRalph({
      cwd: "/tmp/ralph-work",
      homeDir: "/home/test",
      docPath: "/repo/docs/plan.md",
      maxIterations: 1,
      runtime: "docker",
      runtimeConfigCwd: "/repo",
      fs,
      runAgent
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/ralph-work",
        runtime: "docker",
        runtimeConfigCwd: "/repo"
      })
    );
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
      "/repo/.poe-code/ralph/plans/plan.md": ["---", "extends: true", "---", ""].join("\n"),
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
    const result = interpolateVariables("Open {{ current_file }} and review {{ current_file }}", {
      current_file: "/repo/plan.md"
    });

    expect(result).toBe("Open /repo/plan.md and review /repo/plan.md");
  });

  it("handles multiple different variables", () => {
    const result = interpolateVariables("File: {{ current_file }}, Dir: {{ cwd }}", {
      current_file: "/repo/plan.md",
      cwd: "/repo"
    });

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
