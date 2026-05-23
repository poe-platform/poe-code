import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalRunResult } from "../types.js";
import type { NormalizedTrace } from "./trace/types.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { writeRunArtifacts } = await import("./result-writer.js");

describe("writeRunArtifacts", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("writes all required artifacts and omits judge.json when the judge did not run", async () => {
    await writeRunArtifacts("/runs/run-1", {
      result: createResult(),
      events: [{ sessionUpdate: "tool_call", toolCall: "read" }],
      trace: createTrace(),
      cheatReport: { cheated: false, violations: [] },
      planMd: "# Plan\n",
      evalYaml: "id: task\n"
    });

    expect(JSON.parse(await readText("/runs/run-1/result.json"))).toEqual(createResult());
    expect(await readText("/runs/run-1/events.jsonl")).toBe(
      `${JSON.stringify({ sessionUpdate: "tool_call", toolCall: "read" })}\n`
    );
    expect(JSON.parse(await readText("/runs/run-1/trace.json"))).toEqual(createTrace());
    expect(JSON.parse(await readText("/runs/run-1/cheat-report.json"))).toEqual({
      cheated: false,
      violations: []
    });
    expect(await readText("/runs/run-1/plan.md")).toBe("# Plan\n");
    expect(await readText("/runs/run-1/eval.yaml")).toBe("id: task\n");
    await expect(readText("/runs/run-1/judge.json")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes judge.json when the judge ran", async () => {
    await writeRunArtifacts("/runs/run-1", {
      result: createResult({ judge: { completeness: 4, mean: 4 } }),
      events: [],
      trace: createTrace(),
      cheatReport: { cheated: false, violations: [] },
      judge: { completeness: 4, mean: 4 },
      planMd: "# Plan\n",
      evalYaml: "id: task\n"
    });

    expect(await readText("/runs/run-1/events.jsonl")).toBe("");
    expect(JSON.parse(await readText("/runs/run-1/judge.json"))).toEqual({
      completeness: 4,
      mean: 4
    });
  });
});

async function readText(path: string): Promise<string> {
  const { fs } = await import("memfs");
  return fs.promises.readFile(path, "utf8") as Promise<string>;
}

function createTrace(): NormalizedTrace {
  return {
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    }
  };
}

function createResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    runId: "run-1",
    eval: "task",
    agent: "codex",
    model: "openai/gpt-5",
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 0,
    durationMs: 1,
    usage: {
      inputTokens: 0,
      outputTokens: 0
    },
    tests: {
      passed: 1,
      total: 1,
      pass_rate: 1,
      cases: []
    },
    cheated: false,
    cheatReport: {
      cheated: false,
      violations: []
    },
    ...overrides
  };
}
