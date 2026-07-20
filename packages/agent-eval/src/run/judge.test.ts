import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import type { EvalDef, JudgeSpec, MetricSpec } from "../types.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const mockedAgentSpawn = vi.hoisted(() => ({
  spawnMock: undefined as ReturnType<typeof createSpawnMock> | undefined
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  const spawnMock = createSpawnMock();
  mockedAgentSpawn.spawnMock = spawnMock;
  return {
    ...actual,
    ...spawnMock.factory()
  };
});

const { judgeMetric, judgeRun } = await import("./judge.js");

describe("judgeRun", () => {
  beforeEach(() => {
    vol.reset();
    mockedAgentSpawn.spawnMock!.autonomous.mockReset();
  });

  it("spawns a judge with task, file sizes, test counts, and rubric, then parses scores", async () => {
    vol.fromJSON({
      "/repo/src/a.ts": "abc",
      "/repo/src/secret.txt": "do-not-include"
    });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: JSON.stringify({
        completeness: 4,
        spec_adherence: 5,
        code_quality: 3
      })
    });

    const result = await judgeRun({
      evalDef: createEval(),
      cloneDir: "/repo",
      traceJsonPath: "/runs/trace.json",
      trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
      testsResult: { passed: 2, total: 3 },
      spec: createJudgeSpec(),
      agentUnderTest: "claude-code"
    });

    expect(result).toEqual({
      completeness: 4,
      spec_adherence: 5,
      code_quality: 3,
      mean: 4
    });
    expect(mockedAgentSpawn.spawnMock!.autonomous).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        cwd: "/repo",
        mode: "read",
        model: "judge-model"
      })
    );

    const prompt = mockedAgentSpawn.spawnMock!.autonomous.mock.calls[0]?.[1]?.prompt as string;
    expect(prompt).toContain("Implement the feature.");
    expect(prompt).toContain("src/a.ts\t3 bytes");
    expect(prompt).toContain("src/secret.txt\t14 bytes");
    expect(prompt).not.toContain("do-not-include");
    expect(prompt).toContain("Tests: 2/3 passed");
    expect(prompt).toContain("Normalized trace JSON:");
    expect(prompt).toContain("completeness");
    expect(prompt).toContain("spec_adherence");
    expect(prompt).toContain("code_quality");
  });

  it("falls back to codex when the judge agent matches the agent under test", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: JSON.stringify({
        completeness: 4,
        spec_adherence: 4,
        code_quality: 4
      })
    });

    await judgeRun({
      evalDef: createEval(),
      cloneDir: "/repo",
      traceJsonPath: "/runs/trace.json",
      trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
      testsResult: { passed: 1, total: 1 },
      spec: createJudgeSpec({ agent: "claude-code" }),
      agentUnderTest: "claude-code"
    });

    expect(mockedAgentSpawn.spawnMock!.autonomous.mock.calls[0]?.[0]).toBe("codex");
  });

  it("defers to the shared spawn default when the judge agent has no read mode", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: JSON.stringify({
        completeness: 4,
        spec_adherence: 4,
        code_quality: 4
      })
    });

    await judgeRun({
      evalDef: createEval(),
      cloneDir: "/repo",
      traceJsonPath: "/runs/trace.json",
      trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
      testsResult: { passed: 1, total: 1 },
      spec: createJudgeSpec({ agent: "custom-agent" }),
      agentUnderTest: "claude-code"
    });

    expect(mockedAgentSpawn.spawnMock!.autonomous.mock.calls[0]?.[0]).toBe("custom-agent");
    expect(mockedAgentSpawn.spawnMock!.autonomous.mock.calls[0]?.[1]).not.toHaveProperty("mode");
  });

  it("throws when the judge output is malformed JSON", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: "not json"
    });

    await expect(
      judgeRun({
        evalDef: createEval(),
        cloneDir: "/repo",
        traceJsonPath: "/runs/trace.json",
        trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
        testsResult: { passed: 0, total: 1 },
        spec: createJudgeSpec(),
        agentUnderTest: "claude-code"
      })
    ).rejects.toThrow("Failed to parse judge output");
  });

  it("uses the first non-empty final text field from autonomous output", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: "",
      output: JSON.stringify({
        completeness: 3,
        spec_adherence: 4,
        code_quality: 5
      })
    });

    await expect(
      judgeRun({
        evalDef: createEval(),
        cloneDir: "/repo",
        traceJsonPath: "/runs/trace.json",
        trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
        testsResult: { passed: 1, total: 1 },
        spec: createJudgeSpec(),
        agentUnderTest: "claude-code"
      })
    ).resolves.toEqual({
      completeness: 3,
      spec_adherence: 4,
      code_quality: 5,
      mean: 4
    });
  });

  it("clamps out-of-range values and coerces non-numeric values to zero", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: JSON.stringify({
        completeness: -1,
        spec_adherence: 7,
        code_quality: "bad"
      })
    });

    await expect(
      judgeRun({
        evalDef: createEval(),
        cloneDir: "/repo",
        traceJsonPath: "/runs/trace.json",
        trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
        testsResult: { passed: 0, total: 1 },
        spec: createJudgeSpec(),
        agentUnderTest: "claude-code"
      })
    ).resolves.toEqual({
      completeness: 0,
      spec_adherence: 5,
      code_quality: 0,
      mean: 1.7
    });
  });

  it("rounds the mean to one decimal", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: JSON.stringify({
        completeness: 5,
        spec_adherence: 4,
        code_quality: 3
      })
    });

    const spec = createJudgeSpec({ rubric: ["completeness", "spec_adherence"] });

    await expect(
      judgeRun({
        evalDef: createEval(),
        cloneDir: "/repo",
        traceJsonPath: "/runs/trace.json",
        trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
        testsResult: { passed: 1, total: 2 },
        spec,
        agentUnderTest: "claude-code"
      })
    ).resolves.toEqual({
      completeness: 5,
      spec_adherence: 4,
      mean: 4.5
    });
  });

  it("preserves a rubric score named __proto__", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: '{"__proto__":5}'
    });

    const result = await judgeRun({
      evalDef: createEval(),
      cloneDir: "/repo",
      traceJsonPath: "/runs/trace.json",
      trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
      testsResult: { passed: 1, total: 1 },
      spec: createJudgeSpec({ rubric: ["__proto__"] }),
      agentUnderTest: "claude-code"
    });

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result["__proto__"]).toBe(5);
    expect(result.mean).toBe(5);
  });

  it("uses the resolved judge spec rubric", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: JSON.stringify({
        custom_quality: 5
      })
    });

    await expect(
      judgeRun({
        evalDef: createEval(),
        cloneDir: "/repo",
        traceJsonPath: "/runs/trace.json",
        trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
        testsResult: { passed: 1, total: 1 },
        spec: createJudgeSpec({ rubric: ["custom_quality"] }),
        agentUnderTest: "claude-code"
      })
    ).resolves.toEqual({
      custom_quality: 5,
      mean: 5
    });

    const prompt = mockedAgentSpawn.spawnMock!.autonomous.mock.calls[0]?.[1]?.prompt as string;
    expect(prompt).toContain("custom_quality");
    expect(prompt).not.toContain("spec_adherence");
  });

  it("scores a named metric using task, oracle outcome, and normalized trace evidence", async () => {
    vol.fromJSON({ "/repo/file.ts": "abc" });
    mockedAgentSpawn.spawnMock!.autonomous.mockResolvedValueOnce({
      text: JSON.stringify({
        score: 0.75,
        reason: "The trace follows most plan steps.",
        traceReferences: [2]
      })
    });

    await expect(
      judgeMetric({
        evalDef: createEval(),
        metric: createMetric(),
        cloneDir: "/repo",
        traceJsonPath: "/runs/trace.json",
        trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
        oracleOutcome: { passed: 1, total: 2 },
        agentUnderTest: "claude-code"
      })
    ).resolves.toEqual({
      score: 0.75,
      reason: "The trace follows most plan steps.",
      traceReferences: [2]
    });

    const prompt = mockedAgentSpawn.spawnMock!.autonomous.mock.calls[0]?.[1]?.prompt as string;
    expect(prompt).toContain("Judge named metric: plan_adherence.");
    expect(prompt).toContain("Implement the feature.");
    expect(prompt).toContain("Oracle outcome: 1/2 passed");
    expect(prompt).toContain("Normalized trace JSON:");
    expect(prompt).toContain("Assess the implementation against the written plan.");
  });
});

function createMetric(): MetricSpec {
  return {
    id: "plan_adherence",
    enabled: true,
    required: false,
    weight: 1,
    threshold: 0.8,
    evaluator: {
      kind: "judge",
      agent: "codex",
      model: "judge-model",
      instructions: "Assess the implementation against the written plan."
    }
  };
}

function createJudgeSpec(overrides: Partial<JudgeSpec> = {}): JudgeSpec {
  return {
    agent: "codex",
    model: "judge-model",
    rubric: ["completeness", "spec_adherence", "code_quality"],
    ...overrides
  };
}

function createEval(overrides: Partial<EvalDef> = {}): EvalDef {
  return {
    id: "eval-1",
    title: "Eval 1",
    rootDir: "/evals/eval-1",
    target: {
      repo: "owner/repo",
      ref: "main",
      planDest: "docs/plans/feature.md"
    },
    scorer: {
      command: "npm test",
      cwd: "",
      resultPath: "score.json",
      timeoutMs: 1_000
    },
    oracle: {
      path: "oracle",
      solutionDest: "."
    },
    budget: {
      maxIterations: 1,
      maxTokens: 1_000,
      wallClockMs: 1_000
    },
    judge: createJudgeSpec(),
    weights: {
      tests: 1,
      judge: 1
    },
    plan: {
      path: "/evals/eval-1/plan.md",
      kind: "plan",
      body: "Implement the feature.",
      frontmatter: {}
    },
    ...overrides
  };
}
