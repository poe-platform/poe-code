---
name: "Agent eval custom scorer accepts overflowing JSON result numbers"
---

# Agent eval custom scorer accepts overflowing JSON result numbers

## Summary

The exported `@poe-code/agent-eval` `runScorer()` API accepts custom scorer result files whose required numeric fields overflow to non-finite JavaScript values. A standards-valid JSON result containing `passed: 1e309`, `total: 1e309`, and `durationMs: 1e309` is parsed and returned as `Infinity` values instead of being rejected as malformed scoring output.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";

const mocks = vi.hoisted(() => ({ createHostRunner: vi.fn(), readFile: vi.fn() }));
vi.mock("@poe-code/process-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/process-runner")>()),
  createHostRunner: mocks.createHostRunner,
}));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("./run/vitest-runner.js", () => ({ runVitest: vi.fn() }));

const { runScorer } = await import("./run/scorer.js");

describe("agent-eval custom scorer overflowing totals", () => {
  it("returns JSON exponent overflow in passed and duration fields", async () => {
    mocks.createHostRunner.mockReturnValue(createMockRunner([{ exitCode: 0 }]));
    mocks.readFile.mockResolvedValue(
      '{"passed":1e309,"total":1e309,"cases":[{"name":"case","passed":true,"durationMs":1e309}]}',
    );
    const result = await runScorer({
      evalDir: "/eval",
      cloneDir: "/clone",
      evalDef: {
        id: "x",
        kind: "plan",
        task: "t",
        oracle: { path: "oracle" },
        scorer: {
          command: "score",
          cwd: ".",
          resultPath: "result.json",
          timeoutMs: 1000,
        },
      } as never,
    });
    console.log(JSON.stringify({
      passed: String(result.passed),
      total: String(result.total),
      duration: String(result.cases[0]?.durationMs),
    }));
    expect(result).toEqual({
      passed: Infinity,
      total: Infinity,
      cases: [{ name: "case", passed: true, durationMs: Infinity }],
    });
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/__probe__.test.ts
```

The probe prints:

```text
{"passed":"Infinity","total":"Infinity","duration":"Infinity"}
✓ packages/agent-eval/src/__probe__.test.ts > agent-eval custom scorer overflowing totals > returns JSON exponent overflow in passed and duration fields
```

## Observed Behavior

`packages/agent-eval/src/index.ts` exports `runScorer()`. The custom result parser in `packages/agent-eval/src/run/scorer.ts` validates `passed` and `total` only with `typeof ... === "number"`; its `isCaseResults()` validation applies the same check to each `durationMs`. JSON exponent overflow is valid JSON and decodes to `Infinity`, satisfying each type-only check. The public API consequently returns infinite score totals and infinite per-case durations as accepted evaluator output.

## Expected Behavior

Custom scorer result parsing should require finite, semantically valid numeric counts and durations, rejecting or normalizing overflowed values before they are incorporated into an evaluation result.

## Impact

Custom scorers, corrupted result files, or compromised evaluation workspaces can return impossible scoring state while the evaluator reports success. Infinite counts and durations can break aggregation, formatting, JSON persistence, pass/fail calculations, performance comparisons, and downstream quality gates that trust the parsed custom scorer result.
