---
name: "Agent eval comparison NUL delimiter collides distinct cells"
---

# Agent eval comparison NUL delimiter collides distinct cells

## Summary

The exported `@poe-code/agent-eval` `compareResultCollections()` API groups evaluation results by concatenating cell fields with a NUL (`\u0000`) delimiter, without escaping NUL characters already present in those fields. Two genuinely different cells can therefore generate the same internal grouping key and be compared as though they were the same eval/agent/model combination.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareResultCollections } from "./aggregate.js";
import type { EvalRunResult } from "./types.js";

function run(input: Partial<EvalRunResult>): EvalRunResult {
  return {
    runId: "run",
    eval: "eval",
    agent: "agent",
    model: "model",
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 1,
    durationMs: 100,
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 },
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
    cheatReport: { cheated: false, violations: [] },
    ...input
  };
}

describe("agent-eval comparison NUL delimiter collision", () => {
  it("compares distinct cells whose encoded group keys collide", () => {
    const baseline = run({
      runId: "baseline",
      eval: "alpha\u0000bravo",
      agent: "charlie",
      correctness: 1
    });
    const current = run({
      runId: "current",
      eval: "alpha",
      agent: "bravo\u0000charlie",
      correctness: 0
    });

    expect([baseline.eval, baseline.agent]).not.toEqual([current.eval, current.agent]);
    const comparison = compareResultCollections([baseline], [current]);
    console.log(JSON.stringify(comparison));
    expect(comparison).toEqual([]);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/__probe__.test.ts
```

The expectation fails because a comparison is returned for the distinct cells:

```text
- Expected
+ Received

- []
+ [
+   {
+     "cell": {
+       "agent": "bravo\u0000charlie",
+       "eval": "alpha",
+       "model": "model",
+       "planKind": "plan"
+     },
+     "deltas": [
+       {
+         "baseline": 1,
+         "current": 0,
+         "delta": -1,
+         "dimension": "oracle_correctness",
+         "regression": true
+       }
+     ],
+     "regressions": 1
+   }
+ ]
```

## Observed Behavior

`packages/agent-eval/src/index.ts` publicly exports `compareResultCollections()`. In `packages/agent-eval/src/aggregate.ts`, `groupRuns()` produces each key with `cellKeys.map((cellKey) => run[cellKey]).join("\u0000")`. The baseline cell `{ eval: "alpha\u0000bravo", agent: "charlie" }` and the current cell `{ eval: "alpha", agent: "bravo\u0000charlie" }` both encode to the same key, so the API emits a regression comparing unrelated runs.

## Expected Behavior

Result comparison should only compare runs from exactly equal cells. Cell identity encoding must be collision-safe for every string accepted by the public result type, or the API must explicitly validate and reject unsupported cell values before comparison.

## Impact

Consumers loading or constructing result collections can receive false baseline regressions for unrelated evaluation cells when an eval, agent, or model identifier contains a NUL character. This can corrupt automated performance gates, misattribute regressions to the wrong target, and display misleading comparison output without any validation error.
