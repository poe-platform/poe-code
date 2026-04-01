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
        tests: metricResult({ score: 2 })
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
        tests: metricResult({ score: 2 })
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
        tests: metricResult({ score: 2 })
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
          { name: "tests", direction: "maximize" },
          { name: "test_duration", direction: "minimize" }
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
        tests: metricResult({ score: 2 }),
        test_duration: metricResult({ score: 9 })
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
      "npm run metric:tests",
      "npm run metric:test_duration"
    ]);
  });

  it("short-circuits a metric chain when the first metric fails", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        metric: [
          { name: "tests", direction: "maximize" },
          { name: "test_duration", direction: "minimize" }
        ],
        baseline: {
          tests: 1,
          test_duration: 10
        }
      }),
      turns: [agentMakesChanges()],
      metricResults: {
        tests: metricResult({ score: 0, exitCode: 1 }),
        test_duration: metricResult({ score: 9 })
      }
    });

    const { execCalls, readJournal } = await sim.run();
    const [entry] = await readJournal();

    expect(entry?.status).toBe("discard");
    expect(execCalls.map((call) => call.command)).toEqual(["npm run metric:tests"]);
  });

  it("discards a metric chain when the second metric fails", async () => {
    const sim = createExperimentLoopSimulation({
      maxExperiments: 1,
      docContent: createExperimentDoc({
        metric: [
          { name: "tests", direction: "maximize" },
          { name: "test_duration", direction: "minimize" }
        ],
        baseline: {
          tests: 1,
          test_duration: 10
        }
      }),
      turns: [agentMakesChanges()],
      metricResults: {
        tests: metricResult({ score: 2 }),
        test_duration: metricResult({ score: 11, exitCode: 1 })
      }
    });

    const { execCalls, readJournal } = await sim.run();
    const [entry] = await readJournal();

    expect(entry?.status).toBe("discard");
    expect(execCalls.map((call) => call.command)).toEqual([
      "npm run metric:tests",
      "npm run metric:test_duration"
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
        tests: [metricResult({ score: 2 })]
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
              expect(prompt).toContain("commit\tstatus\tscore\tdurationMs\ttimestamp\toutput");
              expect(prompt).toContain("commit-1\tkeep\t2");
            }
          }
        )
      ],
      metricResults: {
        tests: [metricResult({ score: 2 }), metricResult({ score: 3 })]
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
        tests: metricResult({ score: 2 })
      }
    });

    const { result } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "cancelled",
      experimentsCompleted: 1,
      experimentsKept: 1
    });
  });
});
