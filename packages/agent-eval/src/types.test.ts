import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveScorer } from "./types.js";
import type { EvalDef } from "./types.js";

describe("resolveScorer", () => {
  it("returns default vitest scorer when scorer is absent", () => {
    const evalDef = createEval({ scorer: undefined });

    expect(resolveScorer(evalDef)).toEqual({
      kind: "vitest",
      testsDir: path.join(evalDef.rootDir, "oracle", "tests")
    });
  });

  it("returns custom scorer when scorer is present", () => {
    const evalDef = createEval();

    expect(resolveScorer(evalDef)).toEqual({
      kind: "custom",
      spec: evalDef.scorer
    });
  });

  it("resolves default vitest testsDir as an absolute path using oracle.path", () => {
    const evalDef = createEval({
      rootDir: "evals/smoke",
      scorer: undefined,
      oracle: {
        path: "custom-oracle",
        solutionDest: "."
      }
    });
    const result = resolveScorer(evalDef);

    expect(result.kind).toBe("vitest");
    expect(result.testsDir).toBe(path.resolve("evals/smoke", "custom-oracle", "tests"));
    expect(path.isAbsolute(result.testsDir)).toBe(true);
  });

  it("joins oracle.path under the eval root before resolving", () => {
    const evalDef = createEval({
      scorer: undefined,
      oracle: {
        path: "/custom-oracle",
        solutionDest: "."
      }
    });

    expect(resolveScorer(evalDef)).toEqual({
      kind: "vitest",
      testsDir: path.resolve(path.join(evalDef.rootDir, "/custom-oracle", "tests"))
    });
  });
});

function createEval(overrides: Partial<EvalDef> = {}): EvalDef {
  return {
    id: "smoke",
    title: "Smoke eval",
    rootDir: "/repo/evals/smoke",
    target: {
      repo: "https://example.com/repo.git",
      ref: "main",
      planDest: "docs/plans/eval-task.md"
    },
    scorer: {
      command: "npm test",
      cwd: "",
      resultPath: "score.json",
      timeoutMs: 1000
    },
    oracle: {
      path: "oracle",
      solutionDest: "."
    },
    budget: {
      maxIterations: 10,
      maxTokens: 1000,
      wallClockMs: 60000
    },
    judge: {
      agent: "codex",
      model: "gpt-5",
      rubric: ["completeness"]
    },
    weights: {
      tests: 0.7,
      judge: 0.3
    },
    plan: {
      path: "/repo/evals/smoke/plan.md",
      kind: "pipeline",
      body: "Run the task.",
      frontmatter: {
        kind: "pipeline"
      }
    },
    ...overrides
  };
}
