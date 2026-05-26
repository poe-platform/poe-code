# Agent eval custom scorer infinite timeout expires immediately

## Summary

The exported `@poe-code/agent-eval` `runScorer()` API accepts a custom scorer definition whose `timeoutMs` is `Infinity`, then passes that value directly to Node's `setTimeout()`. Instead of letting the custom scorer run without a deadline, Node clamps the timer to `1ms`, emits `TimeoutOverflowWarning`, kills the active command, and rejects almost immediately as if the infinite timeout had elapsed.

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

const { runScorer, ScorerTimeoutError } = await import("./run/scorer.js");

describe("agent-eval custom scorer infinite timeout", () => {
  it("times out an active custom scorer immediately", async () => {
    mocks.createHostRunner.mockReturnValue(
      createMockRunner([{ exitCode: 0, exitAfterMs: 1000 }]),
    );
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`);
    process.on("warning", onWarning);
    const startedAt = Date.now();
    try {
      const outcome = await runScorer({
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
            timeoutMs: Infinity,
          },
        } as never,
      }).then(
        () => ({ resolved: true as const }),
        (error: Error) => ({
          name: error.name,
          message: error.message,
          elapsed: Date.now() - startedAt,
        }),
      );
      console.log(JSON.stringify({ outcome, warnings }));
      expect(outcome).toMatchObject({
        name: ScorerTimeoutError.name,
        message: "Scorer timed out after Infinityms",
      });
      expect("elapsed" in outcome && outcome.elapsed).toBeLessThan(100);
    } finally {
      process.off("warning", onWarning);
    }
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
(node:97373) TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
{"outcome":{"name":"ScorerTimeoutError","message":"Scorer timed out after Infinityms","elapsed":2},"warnings":["TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.\nTimeout duration was set to 1."]}
✓ packages/agent-eval/src/__probe__.test.ts > agent-eval custom scorer infinite timeout > times out an active custom scorer immediately
```

## Observed Behavior

`packages/agent-eval/src/index.ts` exports `runScorer()`. The custom scorer path in `packages/agent-eval/src/run/scorer.ts` executes the scorer command through `runScorerCommand()`, which calls `waitForResult(handle, input.timeoutMs)`. `waitForResult()` schedules a timeout directly with the supplied numeric value and does not require it to be finite. When a custom scorer configured to run for one second is assigned `timeoutMs: Infinity`, the public operation rejects as timed out after approximately `2ms` and the child is killed.

## Expected Behavior

The custom scorer runner should reject non-finite timeout configuration clearly, or support a documented unlimited-run mode without scheduling a timer. Supplying an infinite timeout must not cause immediate scorer termination.

## Impact

Evaluation definitions or SDK callers that represent an unlimited custom scoring duration as `Infinity` can terminate all custom scorers before they produce results. This creates false evaluation failures, hides valid score output, and makes timeout diagnostics claim an infinite budget expired when the effective runtime was only about one millisecond.
