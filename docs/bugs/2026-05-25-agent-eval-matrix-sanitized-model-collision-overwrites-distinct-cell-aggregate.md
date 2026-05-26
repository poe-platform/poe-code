# Agent Eval Matrix Sanitized Model Collision Overwrites Distinct Cell Aggregate

## Summary

The exported `runMatrix()` API writes per-cell aggregates using a filename whose model component replaces every non-path-safe character with `-`. Distinct valid model names such as `model/a` and `model-a` therefore map to the same aggregate file, so the later cell silently overwrites the earlier cell's results.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { fs as memfs, vol } from "memfs";
import { beforeEach, expect, it, vi } from "vitest";

import type { EvalRunOptions, EvalRunResult } from "../types.js";

const mockedRun = vi.hoisted(() => ({
  runEval: vi.fn<[EvalRunOptions], Promise<EvalRunResult>>()
}));

vi.mock("node:fs/promises", async () => memfs.promises);
vi.mock("../source/open.js", () => ({
  openSource: vi.fn(async () => ({ rootDir: "/source" }))
}));
vi.mock("../source/registry.js", () => ({
  listEvals: vi.fn(async () => ["task"]),
  loadEval: vi.fn(async () => ({ plan: { kind: "plan" }, weights: { tests: 1, judge: 0 } }))
}));
vi.mock("./run.js", () => ({
  runEval: mockedRun.runEval
}));

const { runMatrix } = await import("./matrix.js");

beforeEach(() => {
  vol.reset();
  vol.mkdirSync("/runs", { recursive: true });
  mockedRun.runEval.mockReset();
});

it("overwrites aggregates for distinct models with the same safe path", async () => {
  mockedRun.runEval.mockImplementation(async (options) => result(options));

  for await (const _result of runMatrix({
    sourceDir: "/source",
    evalIds: ["task"],
    agents: ["codex"],
    models: ["model/a", "model-a"],
    repeats: 1,
    outDir: "/runs",
    verifyOracle: false,
    judge: "off"
  })) {
    // Consume results to complete matrix writing.
  }

  const matrixDir = `/runs/${vol.readdirSync("/runs")[0] as string}`;
  const entries = vol.readdirSync(matrixDir).filter((entry) => String(entry).startsWith("aggregate-"));
  const aggregate = JSON.parse(
    vol.readFileSync(`${matrixDir}/aggregate-task-codex-model-a.json`, "utf8") as string
  ) as { cell: { model: string } };

  expect(entries).toEqual(["aggregate-task-codex-model-a.json"]);
  expect(aggregate.cell.model).toBe("model-a");
});

function result(options: EvalRunOptions): EvalRunResult {
  return {
    runId: `run-${options.model}`,
    eval: options.evalId,
    agent: options.agent,
    model: options.model,
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 1,
    durationMs: 1,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 },
    tests: { passed: 1, total: 1, pass_rate: 1, cases: [] },
    scoring: {
      tests: { configured: true, required: true, configuredWeight: 1, effectiveWeight: 1, status: "executed" },
      judge: { configured: true, required: false, configuredWeight: 0, effectiveWeight: 0, status: "disabled", reason: "disabled" }
    },
    cheated: false,
    cheatReport: { cheated: false, violations: [] },
    trace: { available: false }
  };
}
```

Run:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-eval/src/run/__probe__.test.ts > overwrites aggregates for distinct models with the same safe path
```

Remove the disposable probe after validation.

## Observed Behavior

`runMatrix()` iterates each requested model and writes an aggregate for every completed cell at `packages/agent-eval/src/run/matrix.ts:36` through `packages/agent-eval/src/run/matrix.ts:58`. The output filename includes `safePathSegment(model)` at `packages/agent-eval/src/run/matrix.ts:156` through `packages/agent-eval/src/run/matrix.ts:167`, while `safePathSegment()` converts any character outside letters, digits, `.`, `_`, and `-` to `-` at `packages/agent-eval/src/run/matrix.ts:185` through `packages/agent-eval/src/run/matrix.ts:205`. In the probe, both cells complete, but the matrix directory contains only `aggregate-task-codex-model-a.json`, and its retained `cell.model` is `model-a`; the earlier `model/a` aggregate has been erased.

## Expected Behavior

Every distinct matrix cell should retain a distinct aggregate artifact, even when model identifiers contain characters that are not safe in filenames. Aggregate naming should be collision-resistant or the matrix should reject colliding output paths before executing cells rather than silently replacing results.

## Impact

Evaluation matrices using provider-style model identifiers such as `vendor/model` alongside similarly named aliases can lose completed aggregate evidence without reporting any error. Matrix reports, comparisons, and downstream analysis can omit one cell or attribute the surviving aggregate as if the overwritten evaluation never ran, undermining benchmark reliability.
