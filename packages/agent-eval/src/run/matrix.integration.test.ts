import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EvalRunOptions, EvalRunResult } from "../types.js";
import { sourceFixture } from "./run.integration-helper.js";

const mockedRun = vi.hoisted(() => ({
  runEval: vi.fn<[EvalRunOptions], Promise<EvalRunResult>>()
}));

vi.mock("./run.js", () => ({
  runEval: mockedRun.runEval
}));

const { runMatrix } = await import("./matrix.js");

const tempRoots: string[] = [];

afterEach(async () => {
  mockedRun.runEval.mockReset();

  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runMatrix integration", () => {
  it.each([
    ["agents", { models: ["model-one"] }],
    ["agents", { agents: [], models: ["model-one"] }],
    ["models", { agents: ["agent-a"] }],
    ["models", { agents: ["agent-a"], models: [] }]
  ])("requires %s as a non-empty array", async (field, partialOpts) => {
    await expect(
      collectMatrix({
        sourceDir: sourceFixture("plan"),
        outDir: await createOutDir(),
        verifyOracle: false,
        judge: "off",
        ...partialOpts
      })
    ).rejects.toThrow(`Eval matrix ${field} must be a non-empty array`);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid repeat count %s", async (repeats) => {
    await expect(
      collectMatrix({
        sourceDir: sourceFixture("plan"),
        agents: ["agent-a"],
        models: ["model-one"],
        repeats,
        outDir: await createOutDir(),
        verifyOracle: false,
        judge: "off"
      })
    ).rejects.toThrow("Eval matrix repeats must be a positive integer");
  });

  it("defaults evalIds from the source and repeats to three", async () => {
    const outDir = await createOutDir();

    mockedRun.runEval.mockImplementation(async (opts) => runResult(opts));

    const yielded: EvalRunResult[] = [];
    for await (const result of runMatrix({
      sourceDir: sourceFixture("plan"),
      agents: ["agent-a"],
      models: ["model-one"],
      outDir,
      verifyOracle: false,
      judge: "off"
    })) {
      yielded.push(result);
    }

    expect(mockedRun.runEval).toHaveBeenCalledTimes(3);
    expect(yielded.map((result) => result.runId)).toEqual([
      "run-task:agent-a:model-one:0",
      "run-task:agent-a:model-one:1",
      "run-task:agent-a:model-one:2"
    ]);
  });

  it("yields runs in matrix order, converts thrown runs to error results, and writes cell aggregates", async () => {
    const outDir = await createOutDir();
    const calls: string[] = [];

    mockedRun.runEval.mockImplementation(async (opts) => {
      calls.push(cellKey(opts));

      if (opts.agent === "agent-a" && opts.model === "model/two" && opts.repeatIndex === 1) {
        throw new Error("model two failed");
      }

      return runResult(opts, {
        verdict: "pass",
        correctness: opts.agent === "agent-b" ? 0.5 : 1,
        tests: {
          passed: opts.agent === "agent-b" ? 1 : 2,
          total: 2
        }
      });
    });

    const yielded: EvalRunResult[] = [];
    for await (const result of runMatrix({
      sourceDir: sourceFixture("plan"),
      evalIds: ["task"],
      agents: ["agent-a", "agent-b"],
      models: ["model/one", "model/two"],
      repeats: 2,
      outDir,
      cloneCacheDir: "cache-dir",
      verifyOracle: false,
      judge: "off"
    })) {
      yielded.push(result);
    }

    expect(calls).toEqual([
      "task:agent-a:model/one:0",
      "task:agent-a:model/one:1",
      "task:agent-a:model/two:0",
      "task:agent-a:model/two:1",
      "task:agent-b:model/one:0",
      "task:agent-b:model/one:1",
      "task:agent-b:model/two:0",
      "task:agent-b:model/two:1"
    ]);
    expect(yielded.map((result) => `${result.eval}:${result.agent}:${result.model}`)).toEqual([
      "task:agent-a:model/one",
      "task:agent-a:model/one",
      "task:agent-a:model/two",
      "task:agent-a:model/two",
      "task:agent-b:model/one",
      "task:agent-b:model/one",
      "task:agent-b:model/two",
      "task:agent-b:model/two"
    ]);

    const errorResult = yielded[3];
    expect(errorResult).toMatchObject({
      verdict: "error",
      error: "model two failed",
      eval: "task",
      agent: "agent-a",
      model: "model/two"
    });

    const matrixEntries = await readdirNames(outDir);
    expect(matrixEntries).toHaveLength(1);
    const matrixDir = path.join(outDir, matrixEntries[0] as string);

    await expect(
      readFile(path.join(matrixDir, errorResult?.runId as string, "result.json"), "utf8")
    ).resolves.toContain('"verdict": "error"');

    expect(mockedRun.runEval).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: sourceFixture("plan"),
        evalId: "task",
        agent: "agent-a",
        model: "model/one",
        repeatIndex: 0,
        outDir: matrixDir,
        cloneCacheDir: "cache-dir",
        verifyOracle: false,
        judge: "off"
      })
    );

    await expect(readAggregate(matrixDir, "task", "agent-a", "model~00002fone")).resolves.toMatchObject({
      cell: {
        eval: "task",
        agent: "agent-a",
        model: "model/one",
        planKind: "plan"
      },
      repeats: 2,
      runIds: [yielded[0]?.runId, yielded[1]?.runId],
      correctness: {
        mean: 1,
        min: 1,
        max: 1
      }
    });
    await expect(readAggregate(matrixDir, "task", "agent-a", "model~00002ftwo")).resolves.toMatchObject({
      cell: {
        eval: "task",
        agent: "agent-a",
        model: "model/two",
        planKind: "plan"
      },
      repeats: 2,
      runIds: [yielded[2]?.runId, yielded[3]?.runId],
      correctness: {
        mean: 0.5,
        min: 0,
        max: 1
      }
    });
    await expect(readAggregate(matrixDir, "task", "agent-b", "model~00002fone")).resolves.toMatchObject({
      cell: {
        eval: "task",
        agent: "agent-b",
        model: "model/one",
        planKind: "plan"
      },
      repeats: 2
    });
    await expect(readAggregate(matrixDir, "task", "agent-b", "model~00002ftwo")).resolves.toMatchObject({
      cell: {
        eval: "task",
        agent: "agent-b",
        model: "model/two",
        planKind: "plan"
      },
      repeats: 2
    });
  });

  it("captures non-Error thrown values in synthetic error results", async () => {
    const outDir = await createOutDir();

    mockedRun.runEval.mockRejectedValue("string failure");

    const yielded = await collectMatrix({
      sourceDir: sourceFixture("plan"),
      evalIds: ["task"],
      agents: ["agent-a"],
      models: ["model-one"],
      repeats: 1,
      outDir,
      verifyOracle: false,
      judge: "off"
    });

    expect(yielded).toHaveLength(1);
    expect(yielded[0]).toMatchObject({
      verdict: "error",
      error: "string failure",
      eval: "task",
      agent: "agent-a",
      model: "model-one"
    });
  });

  it("sanitizes agent names in synthetic run and aggregate artifact paths", async () => {
    const outDir = await createOutDir();
    mockedRun.runEval.mockRejectedValue(new Error("missing agent"));

    const [result] = await collectMatrix({
      sourceDir: sourceFixture("plan"),
      evalIds: ["task"],
      agents: ["../../../agent"],
      models: ["model/one"],
      repeats: 1,
      outDir,
      verifyOracle: false,
      judge: "off"
    });

    const [matrixEntry] = await readdirNames(outDir);
    const matrixDir = path.join(outDir, matrixEntry as string);
    expect(result?.runId).not.toContain("/");
    await expect(readFile(path.join(matrixDir, result?.runId as string, "result.json"), "utf8"))
      .resolves.toContain('"verdict": "error"');
    await expect(
      readFile(
        path.join(
          matrixDir,
          "aggregate-task-..~00002f..~00002f..~00002fagent-model~00002fone.json"
        ),
        "utf8"
      )
    ).resolves.toBeTruthy();
  });
});

async function createOutDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-eval-matrix-"));
  tempRoots.push(root);
  const outDir = path.join(root, "runs");
  await mkdir(outDir, { recursive: true });
  return outDir;
}

async function readdirNames(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return readdir(dir);
}

async function readAggregate(
  matrixDir: string,
  evalId: string,
  agent: string,
  modelSafe: string
): Promise<unknown> {
  const content = await readFile(
    path.join(matrixDir, `aggregate-${evalId}-${agent}-${modelSafe}.json`),
    "utf8"
  );
  return JSON.parse(content) as unknown;
}

async function collectMatrix(opts: Parameters<typeof runMatrix>[0]): Promise<EvalRunResult[]> {
  const results: EvalRunResult[] = [];

  for await (const result of runMatrix(opts)) {
    results.push(result);
  }

  return results;
}

function cellKey(opts: EvalRunOptions): string {
  return `${opts.evalId}:${opts.agent}:${opts.model}:${opts.repeatIndex}`;
}

function runResult(
  opts: EvalRunOptions,
  overrides: Partial<Omit<EvalRunResult, "tests">> & {
    tests?: Partial<EvalRunResult["tests"]>;
  } = {}
): EvalRunResult {
  const { tests, ...rest } = overrides;
  return {
    runId: `run-${cellKey(opts)}`,
    eval: opts.evalId,
    agent: opts.agent,
    model: opts.model,
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 1,
    durationMs: 10,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      costUsd: 0
    },
    tests: {
      passed: 1,
      total: 1,
      pass_rate: 1,
      cases: [],
      ...tests
    },
    scoring: {
      tests: {
        configured: true,
        required: true,
        configuredWeight: 1,
        effectiveWeight: 1,
        status: "executed"
      },
      judge: {
        configured: true,
        required: false,
        configuredWeight: 0,
        effectiveWeight: 0,
        status: "disabled",
        reason: "disabled"
      }
    },
    cheated: false,
    cheatReport: {
      cheated: false,
      violations: []
    },
    ...rest
  };
}
