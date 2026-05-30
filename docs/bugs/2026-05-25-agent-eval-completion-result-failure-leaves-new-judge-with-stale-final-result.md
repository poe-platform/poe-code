---
name: "Agent Eval Completion Result Failure Leaves New Judge With Stale Final Result"
---

# Agent Eval Completion Result Failure Leaves New Judge With Stale Final Result

## Summary

`@poe-code/agent-eval` publishes `judge.json` before it commits `result.json` during run completion. If the final result replacement fails, the completion call rejects while the run directory contains a newly committed judge evaluation paired with a stale prior final result from an earlier completion attempt.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { fs as memfs, vol } from "memfs";
import { beforeEach, expect, it, vi } from "vitest";

import type { EvalRunResult } from "../types.js";

vi.mock("node:fs/promises", async () => ({
  ...memfs.promises,
  async rename(oldPath: string, newPath: string) {
    if (newPath.endsWith("/result.json")) {
      throw new Error("result rename failed");
    }
    await memfs.promises.rename(oldPath, newPath);
  }
}));

const { writeRunCompletion } = await import("./result-writer.js");

beforeEach(() => {
  vol.reset();
  vol.fromJSON({
    "/runs/run-1/result.json": JSON.stringify(result({ correctness: 0, judge: { completeness: 1, mean: 1 } })),
    "/runs/run-1/judge.json": JSON.stringify({ completeness: 1, mean: 1 })
  }, "/");
});

it("publishes a new judge result while retaining an old final result after failure", async () => {
  await expect(
    writeRunCompletion("/runs/run-1", {
      result: result({ correctness: 1, judge: { completeness: 5, mean: 5 } }),
      judge: { completeness: 5, mean: 5 }
    })
  ).rejects.toThrow("result rename failed");

  expect(JSON.parse(vol.readFileSync("/runs/run-1/judge.json", "utf8") as string)).toEqual({
    completeness: 5,
    mean: 5
  });
  expect(JSON.parse(vol.readFileSync("/runs/run-1/result.json", "utf8") as string)).toMatchObject({
    correctness: 0,
    judge: { mean: 1 }
  });
});

function result(overrides: Partial<EvalRunResult>): EvalRunResult {
  return {
    runId: "run-1",
    eval: "task",
    agent: "codex",
    model: "model",
    planKind: "plan",
    verdict: "pass",
    correctness: 0,
    iterations: 1,
    durationMs: 1,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 },
    tests: { passed: 1, total: 1, pass_rate: 1, cases: [] },
    scoring: {
      tests: { configured: true, required: true, configuredWeight: 1, effectiveWeight: 1, status: "executed" },
      judge: { configured: true, required: false, configuredWeight: 1, effectiveWeight: 1, status: "executed" }
    },
    cheated: false,
    cheatReport: { cheated: false, violations: [] },
    trace: { available: false },
    ...overrides
  };
}
```

Run:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-eval/src/run/__probe__.test.ts > publishes a new judge result while retaining an old final result after failure
```

Remove the disposable probe after validation.

## Observed Behavior

`writeRunCompletion()` commits `judge.json` first and only afterward delegates to `writeRunResult()` for `result.json` at `packages/agent-eval/src/run/result-writer.ts:47` through `packages/agent-eval/src/run/result-writer.ts:59`. Each individual file replacement uses a temporary file followed by `rename()` at `packages/agent-eval/src/run/result-writer.ts:61` through `packages/agent-eval/src/run/result-writer.ts:68`, but the two-file completion bundle is not atomic. In the probe, failure of only the `result.json` rename leaves `judge.json` updated to mean `5` while the retained `result.json` still records prior correctness `0` and prior judge mean `1`.

## Expected Behavior

A completed evaluation evidence set should publish `judge.json` and `result.json` consistently, or preserve the prior completed pair when either commit fails. A rejected completion write must not leave run artifacts that describe conflicting judged outcomes for the same run directory.

## Impact

Filesystem failures during final evaluation persistence can make benchmark evidence internally contradictory: consumers reading `judge.json` observe the new assessment, while summary/report consumers reading `result.json` observe the old outcome. Comparisons, dashboards, audit review, and rerun decisions can therefore disagree about the same evaluation despite the completion operation having failed.
