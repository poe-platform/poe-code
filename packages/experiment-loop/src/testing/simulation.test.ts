import { describe, expect, it } from "vitest";
import { parseExperimentFrontmatter } from "../frontmatter/frontmatter.js";
import {
  agentCrash,
  agentMakesChanges,
  createExperimentDoc,
  createExperimentLoopSimulation,
  metricResult
} from "./simulation.js";

describe("createExperimentLoopSimulation", () => {
  it("keeps a single-metric experiment when the score improves", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      files: {
        "src/index.ts": "export const value = 1;\n"
      },
      turns: [
        agentMakesChanges({
          "src/index.ts": "export const value = 2;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 })
      }
    });

    const { result, readDoc, readFile, readJournal } = await sim.run();
    const doc = parseExperimentFrontmatter(await readDoc());
    const entries = await readJournal();

    expect(result).toMatchObject({
      stopReason: "max_experiments",
      experimentsCompleted: 1,
      experimentsKept: 1
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        status: "keep",
        score: 2
      })
    );
    expect(doc.frontmatter.baseline).toEqual({ tests: 2 });
    expect(await readFile("src/index.ts")).toBe("export const value = 2;\n");
  });

  it("applies agent file changes when paths are absolute", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      files: {
        "src/index.ts": "export const value = 1;\n"
      },
      turns: [
        agentMakesChanges({
          "/repo/src/index.ts": "export const value = 2;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 })
      }
    });

    const { readFile } = await sim.run();

    expect(await readFile("src/index.ts")).toBe("export const value = 2;\n");
  });

  it("discards a single-metric experiment when the score does not improve", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        baseline: { tests: 2 }
      }),
      files: {
        "src/index.ts": "export const value = 1;\n"
      },
      turns: [
        agentMakesChanges({
          "src/index.ts": "export const value = 99;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 })
      }
    });

    const { result, git, readDoc, readFile, readJournal } = await sim.run();
    const doc = parseExperimentFrontmatter(await readDoc());
    const entries = await readJournal();

    expect(result.experimentsKept).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        status: "discard",
        score: 2
      })
    );
    expect(doc.frontmatter.baseline).toEqual({ tests: 2 });
    expect(await readFile("src/index.ts")).toBe("export const value = 1;\n");
    expect(git.resetCalls).toEqual([{ commitHash: "base-1", cwd: "/repo" }]);
  });

  it("keeps a metric chain when every score passes and improves", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        metric: [
          { name: "tests", script: "node scripts/metric-tests.mjs", direction: "maximize" },
          { name: "test_duration", script: "node scripts/metric-duration.mjs", direction: "minimize" }
        ],
        baseline: {
          tests: 1,
          test_duration: 10
        }
      }),
      turns: [
        agentMakesChanges({
          "src/index.ts": "export const faster = true;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 }),
        "node scripts/metric-duration.mjs": metricResult({ score: 9 })
      }
    });

    const { result, execCalls, readDoc, readJournal } = await sim.run();
    const doc = parseExperimentFrontmatter(await readDoc());
    const [entry] = await readJournal();

    expect(result.experimentsKept).toBe(1);
    expect(entry).toEqual(
      expect.objectContaining({
        status: "keep",
        score: null
      })
    );
    expect(doc.frontmatter.baseline).toEqual({
      tests: 2,
      test_duration: 9
    });
    expect(execCalls.map((call) => call.command)).toEqual([
      "node scripts/metric-tests.mjs",
      "node scripts/metric-duration.mjs"
    ]);
  });

  it("short-circuits a metric chain when the first metric fails", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        metric: [
          { name: "tests", script: "node scripts/metric-tests.mjs", direction: "maximize" },
          { name: "test_duration", script: "node scripts/metric-duration.mjs", direction: "minimize" }
        ],
        baseline: {
          tests: 1,
          test_duration: 10
        }
      }),
      turns: [agentMakesChanges()],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 0, exitCode: 1 }),
        "node scripts/metric-duration.mjs": metricResult({ score: 9 })
      }
    });

    const { execCalls, readJournal } = await sim.run();
    const [entry] = await readJournal();

    expect(entry?.status).toBe("discard");
    expect(execCalls.map((call) => call.command)).toEqual(["node scripts/metric-tests.mjs"]);
  });

  it("discards a metric chain when the second metric fails", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        metric: [
          { name: "tests", script: "node scripts/metric-tests.mjs", direction: "maximize" },
          { name: "test_duration", script: "node scripts/metric-duration.mjs", direction: "minimize" }
        ],
        baseline: {
          tests: 1,
          test_duration: 10
        }
      }),
      turns: [agentMakesChanges()],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 }),
        "node scripts/metric-duration.mjs": metricResult({ score: 11, exitCode: 1 })
      }
    });

    const { execCalls, readJournal } = await sim.run();
    const [entry] = await readJournal();

    expect(entry?.status).toBe("discard");
    expect(execCalls.map((call) => call.command)).toEqual([
      "node scripts/metric-tests.mjs",
      "node scripts/metric-duration.mjs"
    ]);
  });

  it("logs agent crashes to the journal and continues the loop", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 2,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      turns: [
        agentCrash({
          stdout: "boom stdout\n",
          stderr: "boom stderr\n"
        }),
        agentMakesChanges({
          "src/index.ts": "export const fixed = true;\n"
        })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 2 })]
      }
    });

    const { prompts, result, readJournal } = await sim.run();
    const entries = await readJournal();

    expect(result).toMatchObject({
      experimentsCompleted: 2,
      experimentsKept: 1
    });
    expect(entries.map((entry) => entry.status)).toEqual(["crash", "keep"]);
    expect(entries[0]?.output).toContain("boom stdout");
    expect(entries[0]?.output).toContain("boom stderr");
    expect(prompts[1]).toContain("Last crash output");
    expect(prompts[1]).toContain("boom stdout");
  });

  it("injects prior journal entries into later agent prompts", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 2,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      turns: [
        agentMakesChanges({
          "src/index.ts": "export const step = 1;\n"
        }),
        agentMakesChanges(
          {
            "src/index.ts": "export const step = 2;\n"
          },
          {
            assertPrompt: (prompt) => {
              expect(prompt).toContain("commit\tstatus\tscore\tdurationMs\ttimestamp\toutput\tagentOutput");
              expect(prompt).toContain("commit-1\tkeep\t2");
            }
          }
        )
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 2 }), metricResult({ score: 3 })]
      }
    });

    const { result } = await sim.run();

    expect(result.experimentsKept).toBe(2);
  });

  it("returns a cancelled stop reason when the abort signal fires", async () => {
    const controller = new AbortController();
    const sim = createExperimentLoopSimulation({
      maxExperiments: 3,
      signal: controller.signal,
      docContent: createExperimentDoc({
        baseline: { tests: 1 }
      }),
      turns: [
        agentMakesChanges(
          {
            "src/index.ts": "export const done = true;\n"
          },
          {
            assertPrompt: () => {
              controller.abort();
            }
          }
        )
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": metricResult({ score: 2 })
      }
    });

    const { result } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "cancelled",
      experimentsCompleted: 1,
      experimentsKept: 1
    });
  });

  it("re-reads the prompt from disk on each iteration", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 2,
      docContent: createExperimentDoc({
        baseline: { tests: 1 },
        body: "# Original prompt\n\nDo the original thing.\n"
      }),
      turns: [
        agentMakesChanges(
          { "src/a.ts": "1" },
          {
            assertPrompt: async (_prompt, ctx) => {
              const doc = await ctx.readFile("/repo/.poe-code/experiments/plan.md");
              const updated = doc.replace("Original prompt", "Updated prompt");
              await ctx.writeFile("/repo/.poe-code/experiments/plan.md", updated);
            }
          }
        ),
        agentMakesChanges(
          { "src/b.ts": "2" },
          {
            assertPrompt: (prompt) => {
              expect(prompt).toContain("Updated prompt");
            }
          }
        )
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 2 }), metricResult({ score: 3 })]
      }
    });

    const { result } = await sim.run();

    expect(result.experimentsKept).toBe(2);
  });

  it("preserves user edits when persistDoc writes back", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 2,
      docContent: createExperimentDoc({
        baseline: { tests: 1 },
        body: "# Speed up tests\n\nOriginal constraints.\n"
      }),
      turns: [
        agentMakesChanges(
          { "src/a.ts": "1" },
          {
            assertPrompt: async (_prompt, ctx) => {
              const doc = await ctx.readFile("/repo/.poe-code/experiments/plan.md");
              const updated = doc.replace("Original constraints", "New constraints added by user");
              await ctx.writeFile("/repo/.poe-code/experiments/plan.md", updated);
            }
          }
        ),
        agentMakesChanges({ "src/b.ts": "2" })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 2 }), metricResult({ score: 3 })]
      }
    });

    const { readDoc } = await sim.run();
    const doc = await readDoc();

    expect(doc).toContain("New constraints added by user");
  });

  it("collects baseline from metrics when baseline is null", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        baseline: null
      }),
      turns: [agentMakesChanges({ "src/a.ts": "1" })],
      metricResults: {
        "node scripts/metric-tests.mjs": [metricResult({ score: 5 }), metricResult({ score: 6 })]
      }
    });

    const { result, readDoc } = await sim.run();
    const doc = parseExperimentFrontmatter(await readDoc());

    expect(doc.frontmatter.baseline).toEqual({ tests: 6 });
    expect(result.experimentsKept).toBe(1);
  });

  it("cycles agents round-robin across experiments", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 4,
      docContent: createExperimentDoc({
        agent: ["claude-code", "codex"],
        baseline: { tests: 1 }
      }),
      turns: [
        agentMakesChanges({ "src/a.ts": "1" }),
        agentMakesChanges({ "src/b.ts": "2" }),
        agentMakesChanges({ "src/c.ts": "3" }),
        agentMakesChanges({ "src/d.ts": "4" })
      ],
      metricResults: {
        "node scripts/metric-tests.mjs": [
          metricResult({ score: 2 }),
          metricResult({ score: 3 }),
          metricResult({ score: 4 }),
          metricResult({ score: 5 })
        ]
      }
    });

    const { runs } = await sim.run();

    expect(runs.map((run) => run.agent)).toEqual([
      "claude-code",
      "codex",
      "claude-code",
      "codex"
    ]);
  });
});
