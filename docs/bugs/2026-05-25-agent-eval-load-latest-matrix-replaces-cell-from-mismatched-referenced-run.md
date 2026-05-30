---
name: "Agent eval load latest matrix replaces cell from mismatched referenced run"
---

# Agent eval load latest matrix replaces cell from mismatched referenced run

## Summary

The exported `@poe-code/agent-eval` `loadLatestMatrix()` API enriches an aggregate artifact by loading every listed `runId` and re-running `aggregateRuns()` over those results, but never checks that the referenced runs belong to the aggregate artifact's declared cell. A stored aggregate for `expected-task` that points to a result for `other-task` is returned as an `other-task` aggregate without warning.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedCell, EvalRunResult } from "./types.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { loadLatestMatrix } = await import("./report/load.js");

function runResult(): EvalRunResult {
  return {
    runId: "other-run",
    eval: "other-task",
    agent: "codex",
    model: "gpt-5",
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 1,
    durationMs: 10,
    usage: { inputTokens: 1, outputTokens: 1 },
    tests: { passed: 1, total: 1, pass_rate: 1, cases: [] },
    scoring: {
      tests: {
        configured: true,
        required: true,
        configuredWeight: 1,
        effectiveWeight: 1,
        status: "executed"
      },
      judge: {
        configured: false,
        required: false,
        configuredWeight: 0,
        effectiveWeight: 0,
        status: "disabled"
      }
    },
    cheated: false,
    cheatReport: { cheated: false, violations: [] }
  };
}

function aggregateCell(): AggregatedCell {
  return {
    cell: { eval: "expected-task", agent: "codex", model: "gpt-5", planKind: "plan" },
    repeats: 1,
    runIds: ["other-run"],
    cheated_any: false,
    verdicts: { pass: 1, fail: 0, error: 0, cheated: 0, budget_exceeded: 0 },
    iterations: { mean: 1, min: 1, max: 1 },
    durationMs: { mean: 10, min: 10, max: 10 },
    usage: {
      inputTokens: { mean: 1, min: 1, max: 1 },
      outputTokens: { mean: 1, min: 1, max: 1 },
      cachedTokens: { mean: 0, min: 0, max: 0 },
      costUsd: { mean: 0, min: 0, max: 0 }
    },
    totals: { durationMs: 10, inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
    tests: { passRateMean: 1, passRateMin: 1, passRateMax: 1 },
    correctness: { mean: 1, min: 1, max: 1 },
    scoring: {
      tests: { configured: 1, executed: 1, skipped: 0, failed: 0, disabled: 0 },
      judge: { configured: 0, executed: 0, skipped: 0, failed: 0, disabled: 1 }
    },
    integrity: {
      cheatViolations: 0,
      uninspectableActions: 0,
      tracesAvailable: 0,
      executionErrors: 0
    }
  };
}

describe("agent-eval aggregate run binding", () => {
  beforeEach(() => vol.reset());

  it("does not replace an aggregate cell with another cell's referenced run", async () => {
    vol.fromJSON({
      "/runs/2026-05-25T10-00-00Z/aggregate-expected.json": JSON.stringify(aggregateCell()),
      "/runs/2026-05-25T10-00-00Z/other-run/result.json": JSON.stringify(runResult())
    });

    const matrix = await loadLatestMatrix("/runs");
    console.log(JSON.stringify(matrix.cells[0]?.cell));
    expect(matrix.cells[0]?.cell.eval).toBe("expected-task");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/__probe__.test.ts
```

The probe fails after the loader replaces the artifact identity:

```text
{"eval":"other-task","agent":"codex","model":"gpt-5","planKind":"plan"}
AssertionError: expected 'other-task' to be 'expected-task' // Object.is equality

Expected: "expected-task"
Received: "other-task"
```

## Observed Behavior

`packages/agent-eval/src/index.ts` publicly exports `loadLatestMatrix()`. In `packages/agent-eval/src/report/load.ts`, each parsed aggregate cell is passed to `enrichAggregatedCell()`, which loads `cell.runIds` and immediately returns `aggregateRuns(runs)` when the referenced files exist. Since no equality check compares the stored `cell` fields with the referenced run fields, aggregate enrichment discards the artifact's declared identity and substitutes an unrelated cell identity.

## Expected Behavior

Matrix enrichment should accept referenced results only when every loaded run belongs to the aggregate artifact's declared cell. A mismatched run reference should be rejected as corrupted matrix data rather than silently changing the cell returned to the caller.

## Impact

Stale, malformed, or tampered matrix artifacts can cause `loadLatestMatrix()` to display and analyze results under the wrong eval, agent, model, or plan kind. This corrupts stored matrix reports, misattributes metrics and integrity evidence, and can conceal that the aggregate artifact no longer matches its referenced evidence.
